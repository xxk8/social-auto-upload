"""Idempotency-key layer for the 6 task-spawning routes.

Round-OPT-idem-keys (post-OPT-async-202): tab close mid-upload + reopen +
retry must NOT create a duplicate publish. The client generates a UUID
per publish intent, sends it as the ``Idempotency-Key`` request header,
and the backend caches the response keyed by ``(user_id, route, key)``.

Contract (mirrors Stripe-style Idempotency-Key):

  * **First request** with a fresh key → INSERT row with
    ``state='processing'`` (atomic via PG ``ON CONFLICT DO NOTHING``) →
    execute the side effect → UPDATE row to ``state='completed'`` with
    the cached response body / status / headers.
  * **Replay** (same key + same payload) against ``state='completed'``
    → return the cached 202 verbatim + ``Idempotency-Replayed: true``
    marker header.
  * **In-flight concurrent** retry (same key, ``state='processing'``)
    → 409 with ``Retry-After: 5``.
  * **Payload mismatch** (same key, different ``payload_hash``) → 422
    "Idempotency key reused with different payload".
  * **No key** → skip the layer entirely; the route behaves as it did
    pre-round (additive).

Storage: PostgreSQL ``idempotency_keys`` table (composite PK
``(user_id, route, key)``). TTL is 7 days; the periodic janitor
(``cleanup_expired``) deletes past-``expires_at`` rows.

Why PG not in-memory: the primary failure mode this round solves is
"server restart between task-row-commit and client-receiving-202".
In-memory cache is lost on restart, defeating the dedup guarantee.
PG is the single source of truth for tasks already; piggybacking
on the same connection pool is free.

Payload hash: caller-assembled list of route-specific signature parts
(``platform, account, title, file_name, file_size, file_mime`` for
multipart; ``json.dumps(body)`` for JSON routes). File CONTENT is
intentionally NOT hashed — a 200MB upload would cost ~500ms of disk
I/O and ~1MB of RAM, and a 1-byte content difference is a vanishingly
rare edge case.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Response, request

from web_runner.db import get_database
from web_runner.utils import log

IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days
IDEMPOTENCY_INFLIGHT_RETRY_AFTER = 5  # seconds, returned on 409

# Header names — exported so tests + client can reference the canonical
# strings without re-declaring (drift risk if a future refactor renames
# the header in one place but forgets another).
IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"
IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed"


def payload_hash(parts: list[Any]) -> str:
    """SHA-256 hex of a stable, ordered list of payload parts.

    Caller assembles ``parts`` from the route-specific signature
    (platform, account, title, file_name, file_size, file_mime for
    multipart; ``[json.dumps(body)]`` for JSON routes). Plain strings
    are the canonical input; dicts / lists go through ``repr()`` for
    deterministic stringification (no key-order ambiguity for dicts
    since Python 3.7 — but we lock it via sorted-keys in repr).
    """
    normalized: list[str] = []
    for p in parts:
        if isinstance(p, (dict, list)):
            normalized.append(repr(p))
        else:
            normalized.append(str(p))
    raw = "\x1f".join(normalized).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def current_user_id() -> int:
    """Return the current request's authenticated user_id, or 0.

    Auth-disabled mode (SAU_AUTH_ENABLED=false): user_id is always 0
    — idempotency dedup is global-by-key. Safe for the local-only
    deployment the project targets. Multi-user deployments with auth
    enabled get per-user scoping automatically.

    Lazy import of ``_current_user_id`` avoids the
    routes.auth ↔ utils circular dependency at module-load time.
    """
    try:
        from web_runner.routes.auth import _current_user_id

        uid = _current_user_id()
        if uid is None:
            return 0
        try:
            return int(uid)
        except (TypeError, ValueError):
            return 0
    except Exception:
        return 0


def current_route() -> str:
    """Return the current Flask request endpoint path.

    Falls back to ``"unknown"`` outside a request context (test
    fixtures, CLI). The 6 protected routes live under
    ``/api/upload/*`` and ``/api/tasks/*`` so the route string is
    the natural per-route namespace.
    """
    try:
        return request.path or "unknown"
    except RuntimeError:
        return "unknown"


def read_key_from_request() -> str:
    """Read the ``Idempotency-Key`` header from the current request.

    Empty / whitespace-only keys are treated as absent — the route
    falls through to the pre-round behavior (no dedup, no errors).
    The key is also length-capped at 255 chars to keep the DB index
    predictable (a 1MB header would still fit in TEXT but the index
    bloat would be real).
    """
    try:
        raw = request.headers.get(IDEMPOTENCY_KEY_HEADER, "") or ""
    except RuntimeError:
        return ""
    raw = raw.strip()
    if not raw or len(raw) > 255:
        return ""
    return raw


def lookup(user_id: int, route: str, key: str, payload_hash_value: str) -> tuple[str, dict] | None:
    """Look up a cached or in-flight idempotency key.

    Returns one of:
      * ``("replay", cached_dict)`` — caller returns cached 202
        verbatim + ``Idempotency-Replayed: true`` marker.
      * ``("conflict-422", None)`` — row exists with different
        ``payload_hash``. Caller returns 422.
      * ``("inflight-409", None)`` — row exists with
        ``state='processing'``. Caller returns 409 + Retry-After.
      * ``None`` — no row. Caller proceeds to ``claim``.
    """
    if not key:
        return None
    db = get_database()
    row = db.fetch_one(
        "SELECT payload_hash, response_status, response_body, response_headers, "
        "task_id, state FROM idempotency_keys "
        "WHERE user_id = ? AND route = ? AND key = ?",
        (user_id, route, key),
    )
    if row is None:
        return None
    if row.get("payload_hash") != payload_hash_value:
        return ("conflict-422", None)
    if row.get("state") == "completed":
        return (
            "replay",
            {
                "response_status": row.get("response_status"),
                "response_body": row.get("response_body") or "",
                "response_headers": row.get("response_headers") or "{}",
                "task_id": row.get("task_id"),
            },
        )
    return ("inflight-409", None)


def claim(user_id: int, route: str, key: str, payload_hash_value: str) -> bool:
    """Atomically reserve an idempotency key.

    Returns True if newly inserted (caller proceeds); False if the
    row already existed (caller re-runs ``lookup`` to decide between
    409-in-flight and 422-mismatch).

    PG-only primitive: ``INSERT ... ON CONFLICT (user_id, route, key)
    DO NOTHING`` is atomic + idempotent. ``rowcount=1`` vs
    ``rowcount=0`` distinguishes the two outcomes. No advisory lock
    needed — the UNIQUE constraint is the only synchronization
    primitive the round requires.
    """
    if not key:
        return True
    db = get_database()
    expires = (datetime.now(timezone.utc) + timedelta(seconds=IDEMPOTENCY_TTL_SECONDS)).isoformat(timespec="seconds")
    try:
        rowcount = db.execute(
            "INSERT INTO idempotency_keys "
            "(user_id, route, key, payload_hash, state, expires_at) "
            "VALUES (?, ?, ?, ?, 'processing', ?) "
            "ON CONFLICT (user_id, route, key) DO NOTHING",
            (user_id, route, key, payload_hash_value, expires),
        )
    except Exception:
        # Non-PG deploy or transient DB error: fall through to the
        # no-dedup path. Route still works (the key header is
        # documented as best-effort, not required).
        return True
    return rowcount == 1


def complete(
    user_id: int,
    route: str,
    key: str,
    response_body: str,
    response_status: int,
    response_headers: dict | None = None,
    task_id: str | None = None,
) -> None:
    """Persist the final response for a claimed idempotency key.

    Called AFTER the side effect (file write + task row commit) has
    committed. The response body is stored as a JSON string; the
    headers dict is JSON-encoded. The replay path returns
    byte-identical bytes from this cache.

    Headers restricted to the small set the replay path needs
    (Location, Retry-After, Content-Type) — the route passes a
    hand-curated dict, not the full Flask response.
    """
    if not key:
        return
    db = get_database()
    db.execute(
        "UPDATE idempotency_keys SET state = 'completed', "
        "response_status = ?, response_body = ?, response_headers = ?, "
        "task_id = ?, expires_at = (CURRENT_TIMESTAMP + INTERVAL '7 days') "
        "WHERE user_id = ? AND route = ? AND key = ?",
        (
            response_status,
            response_body,
            json.dumps(response_headers or {}),
            task_id,
            user_id,
            route,
            key,
        ),
    )


def release(user_id: int, route: str, key: str) -> None:
    """Drop a claimed-but-failed key so the client can retry.

    Called on the failure path (4xx/5xx). Without this, a 400 on
    the first attempt would lock the key for 7 days, preventing
    the user from correcting their request and retrying.

    Only deletes ``state='processing'`` rows — a concurrent retry
    that already promoted the row to ``completed`` is left alone
    (that retry succeeded; the original request is free to fail
    independently).
    """
    if not key:
        return
    db = get_database()
    try:
        db.execute(
            "DELETE FROM idempotency_keys " "WHERE user_id = ? AND route = ? AND key = ? AND state = 'processing'",
            (user_id, route, key),
        )
    except Exception:
        # Best-effort cleanup. If the DELETE fails, the row
        # expires in 7 days via the janitor — acceptable.
        pass


def cleanup_expired() -> int:
    """Delete rows whose ``expires_at`` is in the past.

    Janitor sweep. Returns the number of rows deleted so the
    operator log shows the sweep's effect. Partial index
    ``idx_idempotency_keys_expires`` covers the query.
    """
    try:
        db = get_database()
        return db.execute("DELETE FROM idempotency_keys WHERE expires_at < CURRENT_TIMESTAMP")
    except Exception as exc:
        log(f"[idempotency] cleanup_expired failed: {type(exc).__name__}: {exc}")
        return 0


def make_replay_response(cached: dict) -> Response:
    """Reconstruct the Flask response from a cached idempotency row.

    Body / status / headers are byte-identical to the original
    202, plus a marker ``Idempotency-Replayed: true`` header.
    """
    body = cached.get("response_body") or ""
    try:
        parsed_headers = json.loads(cached.get("response_headers") or "{}")
    except (ValueError, TypeError):
        parsed_headers = {}
    # Pin ``mimetype='application/json'`` explicitly — Flask's
    # ``Response`` defaults to ``text/html``, and the cached body
    # IS JSON (the 202 contract is JSON-only on these 6 routes).
    # Without this, axios still parses the body but any
    # content-type-sensitive consumer breaks.
    response = Response(body, status=cached.get("response_status") or 202, mimetype="application/json")
    for k, v in (parsed_headers or {}).items():
        try:
            response.headers[k] = str(v)
        except Exception as exc:
            # Operator-visible: a cached header that Flask refuses
            # to set (e.g. contains a control character) is dropped
            # silently otherwise. Log so an operator can chase
            # the bad cache write.
            from web_runner.utils import log

            log(f"[idempotency] replay header drop: {k!r} ({type(exc).__name__})")
    response.headers[IDEMPOTENCY_REPLAYED_HEADER] = "true"
    return response


def make_409_inflight() -> Response:
    """Build the 409 response for a concurrent in-flight retry."""
    body = json.dumps(
        {
            "success": False,
            "message": "Request with this Idempotency-Key is still processing",
        }
    )
    response = Response(body, status=409, mimetype="application/json")
    response.headers["Retry-After"] = str(IDEMPOTENCY_INFLIGHT_RETRY_AFTER)
    return response


def make_422_conflict() -> Response:
    """Build the 422 response for a key + different-payload retry."""
    body = json.dumps(
        {
            "success": False,
            "message": "Idempotency key reused with different payload",
        }
    )
    return Response(body, status=422, mimetype="application/json")


def check_and_claim(user_id: int, route: str, key: str, payload_hash_value: str) -> Response | None:
    """Combined lookup + claim. Returns a Response if the caller
    should return early (replay / 409 / 422); None if the caller
    should proceed with the side effect.

    Two-step because the conflict between two concurrent requests
    is resolved by the second ``lookup`` (after the first wins
    the ``claim`` race): the second caller sees the new row in
    ``state='processing'`` and returns 409 + Retry-After.

    Both lookups share the same SQL, so a third concurrent request
    is handled identically to the second — no spin-wait or
    advisory lock is needed.
    """
    if not key:
        return None
    existing = lookup(user_id, route, key, payload_hash_value)
    if existing:
        kind, payload = existing
        if kind == "replay":
            return make_replay_response(payload)
        if kind == "inflight-409":
            return make_409_inflight()
        if kind == "conflict-422":
            return make_422_conflict()
    if not claim(user_id, route, key, payload_hash_value):
        existing = lookup(user_id, route, key, payload_hash_value)
        if existing:
            kind, payload = existing
            if kind == "replay":
                return make_replay_response(payload)
            if kind == "inflight-409":
                return make_409_inflight()
            if kind == "conflict-422":
                return make_422_conflict()
    return None


def finalize(
    user_id: int,
    route: str,
    key: str,
    response: Response,
    task_id: str | None = None,
) -> None:
    """Idempotency-aware terminal step for the 6 protected routes.

    Called immediately before the route returns. Branches on
    status code:
      * 2xx (commit succeeded) → ``complete`` the key, cache the
        response body + status + headers for future replays.
      * 4xx (client error) → ``release`` the key so the user
        can correct their request and retry with the same UUID.
      * 5xx (server error) → ``release`` the key. The side
        effect may not have committed (e.g. executor submit
        failed after the task row was inserted but before the
        file was written), so a retry should be allowed to
        re-execute. Locking the key for 7 days on a transient
        5xx would block legitimate recovery.

        Trade-off (round-OPT-idem-keys pass-2 review): the
        file-write happens BEFORE the task-row insert in
        ``upload_video`` / ``upload_note``, so a 5xx fired
        after BOTH have committed (e.g. executor submit failed)
        will allow the next retry to write a SECOND file +
        create a SECOND task row. This is a deliberate
        user-recovery-over-dedup choice: better to risk a
        duplicate on a transient 5xx than to lock the user out
        for 7 days. Operators who need strict dedup-on-5xx
        should bump the 5xx→complete branch back in (knowing
        the recovery cost) — the round's design comment
        captures the rationale for future re-evaluation.

    The split is intentionally simple — fine-grained per-side-
    effect release (e.g. "DB-insert succeeded but executor
    submit failed") would require threading the success/failure
    of each substep through the helper, which is more surface
    than the round warrants.
    """
    if not key:
        return
    status = getattr(response, "status_code", 200) or 200
    if 200 <= status < 400:
        try:
            body = response.get_data(as_text=True)
        except Exception:
            body = ""
        try:
            headers = {k: v for k, v in response.headers.items()}
        except Exception:
            headers = {}
        complete(user_id, route, key, body, status, headers, task_id=task_id)
    else:
        # 4xx (client error) AND 5xx (server error) → release
        # the key. 4xx is "user can correct + retry"; 5xx is
        # "transient failure, retry should be allowed to
        # re-execute the side effect". The frontend's response
        # interceptor mirrors this: 2xx + 422 clear, everything
        # else keeps the entry (in case the client wants to
        # retry the same UUID).
        release(user_id, route, key)
