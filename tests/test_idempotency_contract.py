"""Round-OPT-idem-keys contract tests.

Covers the 4 scenarios for the Idempotency-Key protocol on the
6 protected task-spawning routes:

  1. **Fresh** (no header) → 202 + Location + Retry-After.
     Pre-round behavior is preserved for any non-idempotent
     client (curl, integration tests, legacy UI).
  2. **Replay** (same key + same payload, ``state='completed'``)
     → cached 202 verbatim + ``Idempotency-Replayed: true``.
  3. **Mismatch** (same key + different ``payload_hash``)
     → 422 "Idempotency key reused with different payload".
  4. **In-flight** (same key + ``state='processing'``)
     → 409 + ``Retry-After: 5``.

Test isolation: each test uses a unique ``_TEST_PREFIX`` UUID
prefix for its keys and a per-test ``_purge_test_keys``
autouse fixture to delete any keys with that prefix before
+ after the test runs. This prevents UUID-style keys from
leaking across tests (the prefix sweep + the composite-PK
index make the cleanup O(few)).
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta

import psycopg
import pytest

# Tests touch the live PG-backed idempotency_keys table. Skip
# the entire file when DATABASE_URL is unset (no PG available)
# so the test suite still runs on a SQLite-only CI matrix.
_DB_AVAILABLE = bool(os.environ.get("DATABASE_URL", "").strip())
pytestmark = pytest.mark.skipif(not _DB_AVAILABLE, reason="idempotency_keys test requires DATABASE_URL (PG)")

_TEST_PREFIX = "idem-test-"


@pytest.fixture(autouse=True)
def _purge_test_keys():
    """Wipe idempotency_keys rows for this test's prefix.

    Autouse so every test starts from a clean slate. Both the
    pre-test and post-test sweeps are present so a test that
    leaves a row behind (e.g. assertion failure mid-flight)
    doesn't pollute the next test's lookup.
    """
    from web_runner.db import get_database

    db = get_database()
    # Match on the ``key`` prefix (not the ``route``) — the
    # e2e tests use the real route (``/api/tasks/add``) which
    # doesn't contain ``_TEST_PREFIX``; pre-seeding via
    # ``claim()`` + a uuid-based key IS prefixed with
    # ``_TEST_PREFIX``, so the key-based sweep catches every
    # row the helper-level tests + the 3 e2e tests create.
    # (Pre-round fix: the ``route LIKE '%_TEST_PREFIX%'``
    # pattern only matched the helper-level tests' synthetic
    # routes from ``_unique_route()`` — the e2e rows leaked
    # across runs.)
    db.execute(
        "DELETE FROM idempotency_keys WHERE user_id = 0 AND key LIKE ?",
        (f"{_TEST_PREFIX}%",),
    )
    yield
    db.execute(
        "DELETE FROM idempotency_keys WHERE user_id = 0 AND key LIKE ?",
        (f"{_TEST_PREFIX}%",),
    )


def _unique_route(suffix: str = "lookup") -> str:
    """Return a per-test route string that's globally unique.

    The (user_id, route, key) composite PK dedups on the route
    component, so re-using the same route across tests would
    cause false-positive replay matches. The UUID prefix keeps
    each test in its own namespace.
    """
    return f"/_idem_test_{_TEST_PREFIX}{suffix}-{uuid.uuid4().hex[:8]}"


# ── Helper-level tests ───────────────────────────────────────────────


def test_payload_hash_deterministic_for_same_parts():
    """Same parts → same hash. Different order → different hash."""
    from web_runner.idempotency import payload_hash

    h1 = payload_hash(["a", "b", "c"])
    h2 = payload_hash(["a", "b", "c"])
    h3 = payload_hash(["a", "c", "b"])
    assert h1 == h2
    assert h1 != h3
    assert len(h1) == 64  # SHA-256 hex


def test_payload_hash_includes_file_metadata():
    """Multipart signature: file_name + size + mime."""
    from web_runner.idempotency import payload_hash

    base = payload_hash(["douyin", "acct", "title", "v.mp4", "1024", "video/mp4"])
    diff_name = payload_hash(["douyin", "acct", "title", "v2.mp4", "1024", "video/mp4"])
    diff_size = payload_hash(["douyin", "acct", "title", "v.mp4", "1025", "video/mp4"])
    diff_mime = payload_hash(["douyin", "acct", "title", "v.mp4", "1024", "video/quicktime"])
    assert base != diff_name
    assert base != diff_size
    assert base != diff_mime


def test_lookup_returns_none_for_unknown_key():
    """A fresh key → ``None`` (caller proceeds to claim)."""
    from web_runner.idempotency import lookup

    result = lookup(0, _unique_route(), "never-seen-key", "deadbeef")
    assert result is None


def test_claim_succeeds_then_lookup_returns_processing():
    """First claim → row exists in 'processing' state."""
    from web_runner.idempotency import claim, lookup

    route = _unique_route("claim-then-lookup")
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    h = "abc123"

    # First claim wins.
    assert claim(0, route, key, h) is True

    # Lookup sees the row in processing state.
    result = lookup(0, route, key, h)
    assert result is not None
    kind, payload = result
    assert kind == "inflight-409"
    assert payload is None


def test_claim_conflict_returns_false_on_second_call():
    """Second claim for the same key → False (row already exists)."""
    from web_runner.idempotency import claim

    route = _unique_route("double-claim")
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    assert claim(0, route, key, "h") is True
    assert claim(0, route, key, "h") is False


def test_complete_promotes_to_replay():
    """After complete(), lookup returns ('replay', cached)."""
    from web_runner.idempotency import claim, complete, lookup

    route = _unique_route("complete-then-replay")
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    h = "promote-hash"
    claim(0, route, key, h)
    complete(
        0,
        route,
        key,
        response_body='{"success":true,"data":{"task_id":"t-1"}}',
        response_status=202,
        response_headers={"Location": "/api/tasks?task_id=t-1", "Retry-After": "2"},
        task_id="t-1",
    )
    result = lookup(0, route, key, h)
    assert result is not None
    kind, cached = result
    assert kind == "replay"
    assert cached["response_status"] == 202
    assert cached["task_id"] == "t-1"
    assert "task_id" in cached["response_body"]


def test_mismatch_returns_422():
    """Same key + different payload_hash → 'conflict-422'."""
    from web_runner.idempotency import claim, complete, lookup

    route = _unique_route("mismatch")
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    claim(0, route, key, "first-hash")
    complete(0, route, key, response_body="ok", response_status=202, task_id="x")

    # Same key, different payload → 422 path.
    result = lookup(0, route, key, "second-hash")
    assert result is not None
    kind, _ = result
    assert kind == "conflict-422"


def test_release_removes_processing_row():
    """release() drops the row so a retry can re-claim."""
    from web_runner.idempotency import claim, lookup, release

    route = _unique_route("release")
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    claim(0, route, key, "h")
    assert lookup(0, route, key, "h") is not None  # row exists

    release(0, route, key)
    assert lookup(0, route, key, "h") is None  # row gone


def test_cleanup_expired_deletes_past_rows():
    """Janitor sweep drops past-``expires_at`` rows."""
    from web_runner.db import get_database
    from web_runner.idempotency import cleanup_expired, claim

    route = _unique_route("cleanup")
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    claim(0, route, key, "h")

    # Backdate the row's expires_at so cleanup_expired() picks it up.
    db = get_database()
    past = (datetime.now() - timedelta(days=8)).isoformat(timespec="seconds")
    db.execute(
        "UPDATE idempotency_keys SET expires_at = ? WHERE user_id = 0 AND route = ? AND key = ?",
        (past, route, key),
    )

    deleted = cleanup_expired()
    assert deleted >= 1


# ── End-to-end Flask test client (2 representative scenarios) ──────


@pytest.fixture
def client(monkeypatch):
    """Flask test client for the protected routes.

    Uses the real create_app() factory so the idempotency
    middleware + auth gate + before_request hooks all fire.
    For the upload-video / upload-note / tasks-add paths we
    monkeypatch the executor's submit method to capture
    (bypassing the real Chromium-driven CLI subprocess) so the
    test runs in a fraction of a second.

    Auth gate: ``SAU_AUTH_ENABLED=false`` is set BEFORE
    ``create_app()`` runs so the global ``@app.before_request``
    ``_check_auth`` short-circuits and lets the test requests
    reach the route logic. Without this, every /api/* request
    returns 401 (the synthetic-admin path is for /api/auth/me
    only — the other routes still gate on ``_current_user_id()``
    returning non-None, which requires a real session cookie).
    """
    monkeypatch.setenv("SAU_AUTH_ENABLED", "false")
    # The notification worker (started by create_app) hits a
    # pre-existing psycopg dict-adaptation bug in the
    # notifications table INSERT path. These tests are for
    # the idempotency layer, NOT the notification delivery
    # pipeline — mock the worker + emit_event to no-ops so the
    # pre-existing bug doesn't surface as a test failure.
    # TODO: remove the mock once web_runner/notifications.py
    # psycopg dict-adaptation bug is fixed (root cause: `?`
    # placeholder translated to `%s` without JSONB registration
    # on the connection).
    monkeypatch.setattr("web_runner.notifications.start_worker", lambda: None)
    monkeypatch.setattr("web_runner.notifications.emit_event", lambda *a, **kw: None)
    from web_runner import create_app

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_no_key_header_passes_through_normally(client, monkeypatch):
    """No ``Idempotency-Key`` header → 202 + Location, no Idempotency-Replayed."""
    from web_runner import idempotency as _idem

    # Monkeypatch the claim helper to capture (proves the route
    # didn't try to claim a non-existent key).
    called = {"claim": 0}

    def _fake_claim(*_a, **_kw):
        called["claim"] += 1
        return True

    monkeypatch.setattr(_idem, "claim", _fake_claim)
    monkeypatch.setattr(_idem, "lookup", lambda *_a, **_kw: None)

    # Use /api/tasks/add (JSON, no file) — simplest route to test
    # the no-key passthrough.
    resp = client.post(
        "/api/tasks/add",
        json={
            "platform": "douyin",
            "action": "noop",
            "account": "idem-test",
        },
    )
    assert resp.status_code == 202
    assert "Idempotency-Replayed" not in resp.headers
    assert called["claim"] == 0  # no claim when no key header


def test_422_on_key_with_different_payload(client, monkeypatch):
    """Same key + different payload on 2nd request → 422."""
    from web_runner import idempotency as _idem

    # Pre-seed the cache with a row for (0, /api/tasks/add, "key-1")
    # pointing at payload_hash="first-hash". Then send a request
    # with the same key but the route computes "second-hash"
    # → mismatch → 422.
    from web_runner.idempotency import claim, complete

    route = "/api/tasks/add"
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    h_first = "first-hash"
    claim(0, route, key, h_first)
    complete(0, route, key, response_body="ok", response_status=202, task_id="x")

    # Monkeypatch payload_hash to return a DIFFERENT hash on the
    # route's call — simulates a different payload so the
    # pre-seeded row (with h_first) triggers the 422 mismatch
    # path instead of the 202 replay path. The toggle returns
    # "second-hash" on the first (and only) call.
    real_payload_hash = _idem.payload_hash

    def _toggle(parts):
        return "second-hash"

    monkeypatch.setattr(_idem, "payload_hash", _toggle)

    resp = client.post(
        "/api/tasks/add",
        json={"platform": "douyin", "action": "noop", "account": "idem-test"},
        headers={"Idempotency-Key": key},
    )
    assert resp.status_code == 422
    body = json.loads(resp.get_data(as_text=True))
    assert "different payload" in body.get("message", "").lower()

    # Restore for cleanup
    _idem.payload_hash = real_payload_hash


def test_2xx_replay_returns_cached_with_marker(client, monkeypatch):
    """Same key + same payload on 2nd request → cached 202 + Idempotency-Replayed.

    This is the user-visible contract for round-OPT-idem-keys: a tab
    close mid-upload + reopen + retry must NOT create a duplicate
    publish. The frontend detects the replay via the
    ``Idempotency-Replayed: true`` marker header (so axios + the
    legacy retry interceptor can skip the duplicate-execution path
    the second time around) and the body has the same ``task_id``
    as the first request (so the existing TasksPage state map
    keyed by task_id stays coherent).

    Mock surface: ``web_runner.executor.submit_task`` (the new
    priority-aware path) + ``web_runner.utils.task_executor.submit``
    (the fallback for the ``except`` branch) are both no-op'd so the
    first request's background thread doesn't try to invoke
    ``python -m sau_cli`` (which doesn't exist in the test env).
    The route still creates the task row + caches the response;
    we just need the executor to stay quiet so the test isn't
    dominated by a 600s ``subprocess.run`` timeout.
    """
    from web_runner import executor as _executor
    from web_runner.utils import task_executor as _legacy_executor

    monkeypatch.setattr(_executor, "submit_task", lambda *a, **kw: None)
    monkeypatch.setattr(_legacy_executor, "submit", lambda *a, **kw: None)

    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    payload = {
        "platform": "douyin",
        "action": "noop",
        "account": "idem-test-replay",
    }

    # First request: claim + side effect (task row insert) + cache.
    resp1 = client.post(
        "/api/tasks/add",
        json=payload,
        headers={"Idempotency-Key": key},
    )
    assert (
        resp1.status_code == 202
    ), f"first request: expected 202, got {resp1.status_code}: {resp1.get_data(as_text=True)}"
    assert (
        "Idempotency-Replayed" not in resp1.headers
    ), f"first request should NOT carry Idempotency-Replayed marker: {dict(resp1.headers)}"
    body1 = json.loads(resp1.get_data(as_text=True))
    task_id_1 = body1.get("data", {}).get("task_id")
    assert task_id_1, f"first response missing data.task_id: {body1}"
    # 202 contract: Location header is the canonical watch-this-task URL.
    assert resp1.headers.get("Location", "").endswith(
        f"task_id={task_id_1}"
    ), f"first response Location header should point to task_id={task_id_1}: {resp1.headers.get('Location')!r}"

    # Second request: same key + same payload → cache hit. The
    # make_replay_response helper must:
    #   1. Return 202 with byte-identical body (same task_id)
    #   2. Restore the Location header from the cache
    #   3. Add the Idempotency-Replayed: true marker header
    resp2 = client.post(
        "/api/tasks/add",
        json=payload,
        headers={"Idempotency-Key": key},
    )
    assert (
        resp2.status_code == 202
    ), f"second request: expected 202, got {resp2.status_code}: {resp2.get_data(as_text=True)}"
    assert (
        resp2.headers.get("Idempotency-Replayed") == "true"
    ), f"second response must carry Idempotency-Replayed: true, got: {dict(resp2.headers)}"
    body2 = json.loads(resp2.get_data(as_text=True))
    task_id_2 = body2.get("data", {}).get("task_id")
    assert task_id_2 == task_id_1, f"replay returned different task_id: first={task_id_1!r}, second={task_id_2!r}"
    # Replay must also restore the Location header verbatim so a
    # client re-reading the response after a tab restore can poll
    # the same URL.
    assert resp2.headers.get("Location") == resp1.headers.get(
        "Location"
    ), f"replay Location header should match first: {resp1.headers.get('Location')!r} != {resp2.headers.get('Location')!r}"
    # Strongest contract pin: the second request must NOT have
    # created a second task row. Without this check a future
    # refactor that accidentally bypasses the cache (e.g. returns
    # the cached body but still runs the side effect) would slip
    # past the response-equality assertions.
    from web_runner.db import get_database

    db = get_database()
    try:
        rows = db.fetch_all(
            "SELECT task_id FROM tasks WHERE task_id = ?",
            (task_id_1,),
        )
        assert (
            len(rows) == 1
        ), f"replay must not create a 2nd task row; found {len(rows)} rows for task_id={task_id_1!r}"
    finally:
        # The autouse ``_purge_test_keys`` fixture only cleans up
        # the ``idempotency_keys`` table. The task row the route
        # inserts is unique by uuid-based ``task_id`` so it
        # doesn't collide with other tests, but leaking it would
        # pollute the ``tasks`` table over many CI runs — clean
        # up explicitly. Wrapped in try/finally so an assertion
        # failure on the strongest-pin check still drops the row.
        try:
            db.execute("DELETE FROM tasks WHERE task_id = ?", (task_id_1,))
        except (psycopg.Error, OSError):
            # Narrow catch: only DB-layer errors (psycopg.Error)
            # + low-level connection errors (OSError). Matches
            # the rest of the test file's narrow-catch
            # convention (e.g. ``_start_orphan_watchdog`` in
            # ``web_runner/utils.py`` uses the same shape).
            # A best-effort cleanup that masks only the failures
            # it can plausibly see, so a teardown-time DB hiccup
            # doesn't shadow the original test assertion.
            pass


def test_409_on_concurrent_retry_with_same_key(client, monkeypatch):
    """Same key + ``state='processing'`` on 2nd request → 409 + Retry-After: 5.

    Simulates the user-recovery scenario: the 1st request is still
    in flight (``state='processing'``) when the 2nd request arrives
    (e.g. the user double-clicks "Publish" or a retried POST races
    the original). The contract says the 2nd request must return
    409 + ``Retry-After: 5`` so a polite client backing off on
    ``Retry-After`` won't hammer the server, while an unpolite
    client still gets a deterministic non-2xx (no silent
    double-publish).

    Pre-seed approach: ``claim()`` sets ``state='processing'`` and
    the test monkeypatches ``payload_hash`` to return the same
    value the pre-seeded row was created with. The route's
    ``check_and_claim`` then sees ``state='processing'`` + matching
    hash → returns the 409 path. This is the same pre-seed
    pattern as ``test_422_on_key_with_different_payload`` but
    targets the processing-state branch instead of the
    payload-mismatch branch.
    """
    from web_runner import idempotency as _idem
    from web_runner.idempotency import claim

    # Pre-seed the cache with a row in state='processing' for the
    # same key + same payload hash. The first ``claim()`` sets
    # the row to state='processing'; we DO NOT call ``complete()``
    # so the state stays 'processing' — the 409 path needs this
    # state to fire.
    route = "/api/tasks/add"
    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    h_known = "known-inflight-hash"
    claim(0, route, key, h_known)

    # Monkeypatch payload_hash so the route's call returns the
    # same hash the pre-seeded row has. Without this the route's
    # lookup would see a hash mismatch and return 422 "different
    # payload" instead of 409 "in-flight" — the wrong branch.
    monkeypatch.setattr(_idem, "payload_hash", lambda *parts: h_known)

    resp = client.post(
        "/api/tasks/add",
        json={"platform": "douyin", "action": "noop", "account": "idem-test"},
        headers={"Idempotency-Key": key},
    )
    assert resp.status_code == 409, f"expected 409, got {resp.status_code}: {resp.get_data(as_text=True)}"
    assert resp.headers.get("Retry-After") == "5", f"expected Retry-After: 5, got {resp.headers.get('Retry-After')!r}"
    # 409 path: NO Idempotency-Replayed marker (the request was
    # rejected, not replayed). This distinguishes the 409 from
    # the 202 replay path — same status class as a cache hit from
    # the client's perspective would be a regression.
    assert "Idempotency-Replayed" not in resp.headers, f"409 must NOT carry Idempotency-Replayed: {dict(resp.headers)}"
    body = json.loads(resp.get_data(as_text=True))
    assert (
        "still processing" in body.get("message", "").lower()
    ), f"expected 'still processing' in message, got: {body.get('message')!r}"


def test_5xx_releases_key_for_retry(client, monkeypatch):
    """5xx response → key released → retry can re-claim with new task_id.

    Pins the user-recovery-over-dedup trade-off from
    ``docs/web-shell.md`` §"5xx 语义": a transient 5xx (e.g.
    executor OOM) must NOT lock the key for 7 days. The retry
    must be allowed to re-execute the side effect.

    The 5xx trade-off is implemented in
    ``web_runner/idempotency.py::finalize()`` which branches on
    ``response.status_code``: 2xx → ``complete()``, 4xx/5xx →
    ``release()``. The route calls ``finalize()`` immediately
    before returning the response, so any explicit 5xx
    response the route builds will hit the release branch.

    Mock surface:
      * ``web_runner.executor.submit_task`` + ``task_executor.submit``
        → no-ops (so the route's background thread doesn't try
        to invoke the real CLI).
      * ``web_runner.routes.tasks._make_accepted_response`` →
        counter-based mock returning 500 on first call,
        delegating to the real function on subsequent calls.
        This simulates a transient 5xx (response is 500 but
        the side effect — task row insert — has already
        committed) which is exactly the failure mode the
        trade-off protects against.

    Strongest pins:
      * ``lookup(0, route, key, "any-hash")`` after the 5xx
        must return ``None`` (key was released, not left in
        ``state='processing'`` for 7 days).
      * The retry response must be 202 + **fresh** ``task_id``
        (a new claim, NOT a 202 replay) + NO
        ``Idempotency-Replayed`` header.
    """
    from flask import jsonify
    from web_runner import executor as _executor
    from web_runner.utils import _make_accepted_response as _real_make_accepted
    from web_runner.db import get_database

    # Mock the executor (both new + legacy paths) so the
    # route's background thread doesn't try to invoke the
    # real CLI.
    monkeypatch.setattr(_executor, "submit_task", lambda *a, **kw: None)
    from web_runner.utils import task_executor as _legacy_executor

    monkeypatch.setattr(_legacy_executor, "submit", lambda *a, **kw: None)

    # Counter-based mock for _make_accepted_response: 500 on
    # the first call (transient server failure AFTER the task
    # row is committed), 202 (real) on subsequent calls.
    # ``_make_accepted_response`` is imported into
    # ``web_runner.routes.tasks`` module namespace at the top
    # of the file, so monkeypatching the module attribute
    # replaces the route's reference.
    call_state = {"count": 0}

    def _mock_make_accepted(task_id, *args, **kwargs):
        call_state["count"] += 1
        if call_state["count"] == 1:
            # First call: return 500 (transient server failure
            # AFTER task row insert, BEFORE response would have
            # been 202). The route's finalize() then sees
            # status=500 and calls release() on the key.
            resp = jsonify({"success": False, "message": "Internal server error"})
            resp.status_code = 500
            return resp
        # Second call: real 202.
        return _real_make_accepted(task_id, *args, **kwargs)

    monkeypatch.setattr("web_runner.routes.tasks._make_accepted_response", _mock_make_accepted)

    key = f"{_TEST_PREFIX}{uuid.uuid4().hex}"
    payload = {
        "platform": "douyin",
        "action": "noop",
        "account": "idem-test-5xx",
    }

    # First request: claim + side effect (task row insert) +
    # mocked 500 + finalize() sees status=500 → release().
    resp1 = client.post(
        "/api/tasks/add",
        json=payload,
        headers={"Idempotency-Key": key},
    )
    assert (
        resp1.status_code == 500
    ), f"first request: expected 500, got {resp1.status_code}: {resp1.get_data(as_text=True)}"
    # 5xx must NOT carry Idempotency-Replayed (it's a fresh
    # failure, not a replay).
    assert (
        "Idempotency-Replayed" not in resp1.headers
    ), f"5xx must NOT carry Idempotency-Replayed marker: {dict(resp1.headers)}"
    body1 = json.loads(resp1.get_data(as_text=True))
    # Loosened from the exact mocked message string to
    # ``success=False`` + non-empty message — survives a
    # refactor of the mock's body shape while still pinning
    # the "this is an error response" contract.
    assert body1.get("success") is False, f"5xx body must have success=False, got: {body1!r}"
    assert body1.get("message"), f"5xx body must have a non-empty message, got: {body1!r}"

    # Strongest pin: the key was RELEASED (not locked in
    # processing state for 7 days). lookup() with any hash
    # must return None — the row is gone. If a future refactor
    # accidentally moves the 5xx branch to ``complete()``,
    # this assertion would trip red.
    from web_runner.idempotency import lookup

    result = lookup(0, "/api/tasks/add", key, "any-hash")
    assert result is None, f"5xx must release the key, but lookup returned {result!r}"

    # Second request: same key → can re-claim (NOT 409
    # in-flight, NOT 422 mismatch, NOT 202 replay with the
    # original task_id). The first request's row is gone
    # (released), so the route's check_and_claim proceeds
    # with a fresh claim.
    resp2 = client.post(
        "/api/tasks/add",
        json=payload,
        headers={"Idempotency-Key": key},
    )
    assert resp2.status_code == 202, f"retry: expected 202, got {resp2.status_code}: {resp2.get_data(as_text=True)}"
    # The retry is a FRESH claim (the first request was
    # released, not completed), so NO Idempotency-Replayed
    # header. If a future refactor accidentally caches 5xx
    # responses, this assertion would trip red.
    assert (
        resp2.headers.get("Idempotency-Replayed") != "true"
    ), f"retry must be a fresh claim, not a replay: {dict(resp2.headers)}"
    body2 = json.loads(resp2.get_data(as_text=True))
    task_id_2 = body2.get("data", {}).get("task_id")
    assert task_id_2, f"retry response missing data.task_id: {body2}"
    # The Location header must point to the NEW task_id
    # (proof the retry is a fresh claim, not a cache hit).
    assert resp2.headers.get("Location", "").endswith(
        f"task_id={task_id_2}"
    ), f"retry Location header should point to NEW task_id={task_id_2}: {resp2.headers.get('Location')!r}"

    # Cleanup: BOTH the first request's task row (which was
    # inserted before the mocked 500 fired) AND the retry's
    # task row leak. The autouse _purge_test_keys fixture
    # only cleans up the idempotency_keys table, not the
    # tasks table. Use the unique account name to scope the
    # cleanup (safe even if other tests are running in
    # parallel with the same name).
    db = (
        get_database()
    )  # local handle (the direct-DB-check block that previously owned this was removed; cleanup still needs the connection)
    try:
        db.execute(
            "DELETE FROM tasks WHERE account = ?",
            ("idem-test-5xx",),
        )
    except (psycopg.Error, OSError):
        # Narrow catch per the test file's convention; a
        # teardown-time DB hiccup shouldn't shadow the
        # original test assertions.
        pass
