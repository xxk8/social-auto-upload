"""Studio (Script Studio) routes — Phase 1: project CRUD.

OpenSpec ref: ``openspec/changes/script-studio`` (tasks.md §1).

Endpoints (Phase 1, v0.1 看到项目):
  * POST   /api/studio/projects          create a project
  * GET    /api/studio/projects          list OWN projects (ordered by updated_at DESC)
  * GET    /api/studio/projects/{id}     get a single project + child rows
  * DELETE /api/studio/projects/{id}     hard delete + FK CASCADE to episodes/assets

Phase 2 (v0.2) adds follow-up + generate SSE endpoints and the
associated ``studio_engine.py`` LLM channel; Phase 3 (v0.3) adds
episode-level PATCH + asset append + GET-export endpoints. This
module only ships the Phase 1 surface — see ``script-engine/spec.md``
for the full roadmap.

Authorization
-------------
* The global auth gate in :func:`web_runner.create_app` rejects all
  ``/api/*`` requests without a session (``401``). So unprotected
  endpoints by definition fail closed — no ``@login_required``
  decorators required.
* Owner isolation is enforced via the ``_load_project(user_id,
  project_id)`` helper: every read/write takes an ``owner_user_id
  = ?`` predicate so User A cannot see or modify User B's
  projects. Non-owner access returns ``404`` (not ``403``) so the
  response does NOT leak the existence of someone else's
  project id.
* Cascade delete is wired in the schema (``ON DELETE CASCADE`` on
  ``studio_episodes.project_id`` and ``studio_assets.project_id``)
  and ``PRAGMA foreign_keys=ON`` is set in
  ``PostgresDatabase._connect`` (and is the PG default), so a
  DELETE on the parent row atomically removes both child rows.
"""

from __future__ import annotations

import json
import os
import urllib.parse as _urllib_parse
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify, request, Response, session

from utils.log import logger as _task_logger
from web_runner.db import get_database

# round-OPT-MONETIZE-v1 — Studio render soft-paywall imports.
# Inline (NOT mounted via the global metering middleware) because
# /api/studio/projects/<id>/render is a heavy ~30 s Remotion bundle
# that we'd rather block surgically than lose to false-positives
# on neighbouring GETs (tts.health, project list, asset serve).
log_action = __import__(
    "web_runner.middleware.usage_metering", fromlist=["log_action"]
).log_action
exceeds_tier_quota = __import__(
    "web_runner.middleware.usage_metering", fromlist=["exceeds_tier_quota"]
).exceeds_tier_quota

bp = Blueprint("studio", __name__)


# ── Constants ────────────────────────────────────────────────────────

_TITLE_MAX_LEN = 80
# Round-T2 follow-up: bumped from 500 → 2000 chars. Operators were
# hitting `synopsis 长度不能超过 500 个字符` 400s on multi-paragraph
# storyboards. The constant is env-overridable so deployments can
# tune per-stack: dense Chinese storyboards typically want 2000-5000,
# single-paragraph Western projects stay at the original 500. Mirrors
# the env-override pattern established for `_STUDIO_CANVAS_MAX_SIZE`
# below. See `docs/dev/studio-renderer-ops.md §Body size limits`.
_SYNOPSIS_MAX_LEN = int(
    os.environ.get("SAU_SYNOPSIS_MAX_LEN", "2000")
)
_VALID_ACTS = frozenset({"起", "承", "转", "合"})
# Studio whiteboard canvas max size (UTF-8 encoded bytes, NOT Python str character count).
# Env override `SAU_STUDIO_CANVAS_MAX_SIZE` lets operators tune per-deployment;
# default 10 MiB (10485760 bytes) per openspec/changes/studio-whiteboard spec.
_STUDIO_CANVAS_MAX_SIZE = int(
    os.environ.get("SAU_STUDIO_CANVAS_MAX_SIZE", str(10 * 1024 * 1024))
)


# ── Helpers ──────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _current_user_id() -> int | None:
    """Return the authed user id from the session, or None.

    When auth is disabled (SAU_AUTH_ENABLED=false) the session has no
    user_id. Return the synthetic admin id 0 so the studio routes work
    in the dev auth-disabled path — mirrors ``authenticate_sse_request``
    in :mod:`web_runner.routes.auth` and the global ``/api/*``
    before_request gate that is bypassed when auth is off.
    """
    from web_runner.routes.auth import _is_auth_enabled
    if not _is_auth_enabled():
        return 0
    return session.get("user_id")


def _load_project(user_id: int, project_id: int) -> dict | None:
    """Return the project row IF it belongs to ``user_id``, else None.

    Used as the single source of truth for owner-isolation across
    GET / DELETE endpoints. Returns ``None`` instead of ``False``
    so the call site can use the natural ``if project is None`` /
    row-not-found pattern, AND so a 404 response is uniform for
    both "doesn't exist" and "exists but not yours" — preventing
    existence-introspection via differing status codes.
    """
    db = get_database()
    return db.fetch_one(
        "SELECT * FROM studio_projects WHERE id = ? AND owner_user_id = ?",
        (project_id, user_id),
    )


def _serialize_project(row: dict) -> dict:
    """Project row → response dict.

    Mirrors the contract in :file:`openspec/changes/script-studio/
    specs/script-engine/spec.md §studio_projects`. ``scenes_json``
    and ``dialogues_json`` are kept as raw strings (the spec says
    they're TEXT in SQLite / JSONB in PG; the abstraction's
    ``json_load`` decodes on read, but for the Phase 1 list view
    we don't need to deserialize — episodes are sparsely fetched).
    """
    # Phase 2 — read `overlay_opacity` so the frontend can pre-fill a
    # slider before any backend write path lands. Default 0.5 mirrors
    # the COLUMN DEFAULT 0.5 declared in `_init_db_postgres`. Falls
    # back to 0.5 for NULL (pre-migration rows / places where the
    # series ran on a DB that pre-dates this column).
    # Phase 3 (round-OPT-presets-v1) — read `render_config` (JSONB)
    # so the Remotion bridge payload can carry the chosen visual
    # preset id forward to the Node bridge. The Python side is a pure
    # pass-through: psycopg's ``dict_row`` row_factory decodes JSONB
    # columns to dict on SELECT, so we hand the raw decoded value
    # back. NULL (legacy rows) decodes to None which the
    # ``presets.ts`` ``getPresetById`` helper then maps to the
    # Classic preset at render-time — see
    # ``sau_web/frontend/remotion_studio/presets.ts``.
    return {
        "id": row["id"],
        "title": row["title"],
        "synopsis": row["synopsis"],
        "style": row.get("style"),
        "status": row["status"],
        "owner_user_id": row["owner_user_id"],
        "overlay_opacity": (
            float(row["overlay_opacity"])
            if row.get("overlay_opacity") is not None
            else 0.5
        ),
        "render_config": row.get("render_config"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _serialize_asset(row: dict) -> dict:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "kind": row["kind"],
        "code": row["code"],
        "name": row["name"],
        "prompt": row["prompt"],
        "ref_image_url": row.get("ref_image_url"),
        "created_at": row["created_at"],
    }


def _serialize_episode(row: dict) -> dict:
    """Episode row → response dict.

    ``scenes_json`` / ``dialogues_json`` are emitted as the decoded
    Python structure (``list``/``dict``) rather than the raw JSON
    string. The frontend ``ScriptViewer`` tree renderer expects a
    typed array (per tasks.md §1.2.4 and
    ``script-viewer/spec.md``). Empty-string columns decode to None
    via ``db.json_load``.
    """
    db = get_database()
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "episode_no": row["episode_no"],
        "act": row["act"],
        "title": row["title"],
        "scenes": db.json_load(row.get("scenes_json")) or [],
        "dialogues": db.json_load(row.get("dialogues_json")) or [],
        "status": row["status"],
        "created_at": row["created_at"],
    }


def _canvas_size_bytes(canvas_data: object) -> int:
    """UTF-8 byte length of the JSON-serialized canvas snapshot.

    Per openspec/changes/studio-whiteboard spec.md: the server's only
    size obligation is the UTF-8 encoded byte length of the canonical
    JSON form (ensure_ascii=False, separators=(",", ":")). This MUST
    match the client-side preflight (JSON.stringify + TextEncoder
    .encode()) so the rejection boundary is byte-equivalent on both
    sides. Using Python `len(str(canvas_data))` or the default
    json.dumps separators would diverge by up to ~3x on CJK-heavy
    payloads.
    """
    return len(
        json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _serialize_canvas(raw: object) -> dict | None:
    """Parse the raw canvas_data column back to its native Python form.

    Returns None for NULL / empty inputs; otherwise returns the parsed
    JSON object. Per spec.md `Backend is schema-version-agnostic`:
    the server returns the stored JSON value without any schema or
    content transformation. The client-side tldraw instance is solely
    responsible for any version migration on load.
    """
    if raw is None:
        return None
    if isinstance(raw, (str, bytes, bytearray)):
        stripped = raw.strip() if isinstance(raw, str) else raw.decode("utf-8", errors="replace").strip()
        if not stripped:
            return None
        return json.loads(stripped)
    return raw


def _validate_canvas_payload(
    canvas_data: object,
) -> tuple[object | None, str | None, int]:
    """Validate + canonicalize a canvas_data body for PATCH /canvas.

    Contract per spec.md `Save with non-object canvas_data` +
    `Save exceeds UTF-8 byte size limit`:
      * ``canvas_data`` MUST be a JSON object or null
      * UTF-8 encoded byte size MUST be <= _STUDIO_CANVAS_MAX_SIZE

    Returns ``(canonical_value, error_message, http_status)`` where
    ``canonical_value`` is either the original dict, None, or
    the JSON-stringified canonical form (suitable for direct
    SQLite TEXT storage); ``error_message`` is None on success and
    a Chinese string on failure; ``http_status`` is the response
    code the caller should return (``200`` on success, ``400``
    for non-object payloads, ``413`` for size-cap violations).

    The 413 vs 400 distinction matters because clients and reverse
    proxies treat 413 (Payload Too Large) differently from 400
    (Bad Request) — e.g. nginx and Cloudflare honor
    ``client_max_body_size`` based on 413. Conflating the two would
    break size-based backpressure signaling at the edge.

    The server does NOT inspect, validate, or interpret the
    tldraw internal structure (`schema` field, `store.records`
    shape types, bindings, future fields). Any of those are
    accepted unchanged.
    """
    if canvas_data is not None and not isinstance(canvas_data, dict):
        return None, "canvas_data 必须是 JSON 对象", 400
    if canvas_data is not None:
        size = _canvas_size_bytes(canvas_data)
        if size > _STUDIO_CANVAS_MAX_SIZE:
            return None, (
                f"画布数据过大（超过 {_STUDIO_CANVAS_MAX_SIZE} 字节），请精简后重试"
            ), 413
        # Canonicalize before storage so the size measurement is
        # stable and the stored value matches what the client
        # re-serializes with the same settings.
        return (
            json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")),
            None,
            200,
        )
    return None, None, 200  # null payload is a valid clear-canvas operation


def _validate_create_payload(payload: dict) -> tuple[dict | None, str | None]:
    """Validate + sanitize a POST body. Returns ``(data, error_message)``.

    ``data`` is ``None`` and ``error_message`` is a Chinese string
    when validation fails; callers return ``400`` with that
    message. Otherwise ``data`` is the cleaned dict ready to write
    to the DB.
    """
    title = (payload.get("title") or "").strip()
    synopsis = (payload.get("synopsis") or "").strip()
    style_raw = payload.get("style")
    style = style_raw.strip() if isinstance(style_raw, str) else None

    if not title:
        return None, "title 必填,不能为空"
    if len(title) > _TITLE_MAX_LEN:
        return None, f"title 长度不能超过 {_TITLE_MAX_LEN} 个字符"
    if not synopsis:
        return None, "synopsis 必填,不能为空"
    if len(synopsis) > _SYNOPSIS_MAX_LEN:
        return None, f"synopsis 长度不能超过 {_SYNOPSIS_MAX_LEN} 个字符"
    if style is not None and not style:
        # Empty string is treated the same as absent — clear the
        # style, don't store a meaningless empty-string.
        style = None

    return {"title": title, "synopsis": synopsis, "style": style}, None


def _validate_update_payload(payload: dict) -> tuple[dict | None, str | None]:
    """Validate + sanitize a PATCH body. Returns ``(data, error_message)``.

    Every field is OPTIONAL — a partial update only touches the keys
    present in the body. Absent keys are left untouched on the row.
    Validates the same length/emptiness bounds as
    :func:`_validate_create_payload` for any field that IS supplied, so
    a caller can't shrink the title to empty or blow past the column
    limits via an edit.
    """
    data: dict = {}

    if "title" in payload:
        title = (payload.get("title") or "").strip()
        if not title:
            return None, "title 不能为空"
        if len(title) > _TITLE_MAX_LEN:
            return None, f"title 长度不能超过 {_TITLE_MAX_LEN} 个字符"
        data["title"] = title

    if "synopsis" in payload:
        synopsis = (payload.get("synopsis") or "").strip()
        if not synopsis:
            return None, "synopsis 不能为空"
        if len(synopsis) > _SYNOPSIS_MAX_LEN:
            return None, f"synopsis 长度不能超过 {_SYNOPSIS_MAX_LEN} 个字符"
        data["synopsis"] = synopsis

    if "style" in payload:
        style_raw = payload.get("style")
        style = style_raw.strip() if isinstance(style_raw, str) else None
        # Empty string clears the style rather than storing a
        # meaningless empty-string; explicit null also clears it.
        data["style"] = style

    if "render_config" in payload:
        rc = payload.get("render_config")
        rc_error = _validate_render_config(rc)
        if rc_error is not None:
            return None, rc_error
        # Canonicalise to a value that psycopg can hand to JSONB
        # without surprise. ``None`` clears the column; ``{}``
        # stores an empty dict (operator-visible as "default
        # Classic" preset on the bridge side). String ``""``
        # normalises the same as ``None`` so a forced-clear from a
        # form's empty submit doesn't store a meaningless empty
        # object.
        #
        # CRITICAL (round-OPT-presets-v1 bug-fix): the dict
        # branch MUST json.dumps before storing. psycopg's `%s`
        # placeholder cannot auto-adapt a Python ``dict`` to a
        # JSONB column without an explicit `::jsonb` SQL cast.
        # Since the SET clause is dynamically built per PATCH
        # (different column set on every call), inlining a
        # `::jsonb` cast for one column risks dynamic-SQL
        # fragility — the json.dumps path mirrors what
        # `_validate_canvas_payload` does for `canvas_data` and
        # works regardless of how many other columns ride the
        # same PATCH. On SELECT, ``psycopg.rows.dict_row``
        # auto-decodes the stored JSONB value back to a dict so
        # `_serialize_project` keeps returning the original
        # structure to callers.
        if rc == "" or rc is None:
            data["render_config"] = None
        elif isinstance(rc, dict):
            data["render_config"] = json.dumps(
                rc, ensure_ascii=False, separators=(",", ":")
            )
        # else: validated above to a dict or None already

    if not data:
        return None, "没有提供任何可更新的字段"

    return data, None


def _validate_render_config(value: object) -> str | None:
    """Validate a PATCH body's ``render_config`` value.

    Contract per
    ``openspec/changes/studio-visual-presets/specs/visual-presets/
    spec.md`` §"PATCH validation":
      * ``render_config`` MUST be a dict or null (or empty string,
        which clears the column). Other shapes (list, scalar,
        nested-dict-of-lists, etc.) are rejected with a 400.
      * The body MUST round-trip cleanly through ``json.dumps`` so
        psycopg can hand it to PG JSONB without surprise — e.g.
        a ``datetime`` or a ``Decimal`` in the dict would fail at
        INSERT time. ``json.dumps`` is the canonical serialiser
        for Python dicts to JSONB-acceptable shapes (str, int,
        float, bool, None, list, dict) and a TypeError surfaces
        any non-canonical entry.
      * The chosen ``preset`` (when present) MUST be a string of
        length 1..64 — large-but-not-gigantic cap that accommodates
        the longest realistic future preset id without admitting
        pathological PATCH bodies. The Python side does NOT
        whitelist against the TS catalog: unknown ids are stored
        verbatim so the bridge decides how to handle them
        (fallback to Classic per ``presets.ts::getPresetById``).

    Returns None on success, a Chinese error string on failure.
    """
    if value is None or value == "":
        return None
    if not isinstance(value, dict):
        return "render_config 必须是 JSON 对象"
    try:
        # Cannonicalise to ensure round-trip parity with the
        # bridge's JSON.parse side. ``ensure_ascii=False`` mirrors
        # node's ``JSON.parse`` for CJK keys/values, but the
        # resulting JSON text is what psycopg will hand to PG.
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        return f"render_config 包含无法序列化的值: {exc}"
    # Schema contract (tightened in round-OPT-presets-v1 follow-up):
    # when `preset` is present, it MUST be a non-empty string.
    # Earlier accept of `{"preset": null, "version": 1}` was a
    # silent de-facto clear that the picker UI couldn't
    # distinguish from a legacy unset row — surface it as a 400
    # so the schema stays self-documenting. Operators who want
    # to "clear the preset" use `{render_config: null}` (or the
    # empty-string normalisation already performed upstream by
    # `_validate_update_payload`).
    if "preset" in value:
        preset = value["preset"]
        if not isinstance(preset, str):
            return "render_config.preset 必须是字符串"
        if not preset:
            return (
                "render_config.preset 不能为空字符串 — 请把整个 "
                "render_config 设为 null 来清空"
            )
        if len(preset) > 64:
            return (
                f"render_config.preset 长度不能超过 64 个字符 "
                f"(当前 {len(preset)})"
            )
    return None


# ── Routes ───────────────────────────────────────────────────────────


@bp.post("/api/studio/projects")
def create_project():
    """Create a new project. Body: ``{title, synopsis, style?}``.

    Status defaults to ``draft``. Returns the new project's id +
    serialized record.

    Auth: implicit via the global ``/api/*`` auth gate. Owner is
    set from the session's ``user_id`` — there is no body field
    for ``owner_user_id`` (a non-admin client cannot create a
    project under another user's id).
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    payload = request.get_json(silent=True) or {}
    data, err = _validate_create_payload(payload)
    if err is not None:
        return jsonify({"success": False, "message": err}), 400

    now = _now_iso()
    db = get_database()
    project_id = db.insert_returning_id(
        "INSERT INTO studio_projects "
        "(title, synopsis, style, status, owner_user_id, created_at, updated_at) "
        "VALUES (?, ?, ?, 'draft', ?, ?, ?)",
        (data["title"], data["synopsis"], data["style"], user_id, now, now),
    )

    row = db.fetch_one(
        "SELECT * FROM studio_projects WHERE id = ?", (project_id,)
    )
    _task_logger.info(
        f"[studio] project created id={project_id} owner={user_id} title={data['title']!r}"
    )
    return jsonify({"success": True, "data": _serialize_project(row)}), 200


@bp.get("/api/studio/projects")
def list_projects():
    """List projects owned by the current user, ordered by ``updated_at DESC``.

    Returns ``[]`` when the user has zero projects (200, not 404).
    Cross-user isolation is enforced at the WHERE clause; User B
    sees their own projects only.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    db = get_database()
    rows = db.fetch_all(
        "SELECT * FROM studio_projects "
        "WHERE owner_user_id = ? "
        "ORDER BY updated_at DESC, id DESC",
        (user_id,),
    )
    return jsonify({"success": True, "data": [_serialize_project(r) for r in rows]}), 200


@bp.get("/api/studio/projects/<int:project_id>")
def get_project(project_id: int):
    """Fetch a single project + its episodes + assets.

    404 (not 403) for non-owner access to prevent enumeration of
    other users' project ids via response-code differential.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    db = get_database()
    episodes = db.fetch_all(
        "SELECT * FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
        (project_id,),
    )
    assets = db.fetch_all(
        "SELECT * FROM studio_assets WHERE project_id = ? ORDER BY kind, code",
        (project_id,),
    )

    payload = _serialize_project(project)
    payload["episodes"] = [_serialize_episode(r) for r in episodes]
    payload["assets"] = [_serialize_asset(r) for r in assets]
    return jsonify({"success": True, "data": payload}), 200


@bp.patch("/api/studio/projects/<int:project_id>")
def update_project(project_id: int):
    """Update editable fields of a project (title / synopsis / style).

    Partial update — only the keys present in the JSON body are
    written; ``updated_at`` is bumped on every successful write so the
    list view re-orders correctly. Owner isolation is enforced via
    :func:`_load_project` (404 for non-owner / missing), and field
    bounds are checked by :func:`_validate_update_payload`.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    payload = request.get_json(silent=True) or {}
    data, err = _validate_update_payload(payload)
    if err is not None:
        return jsonify({"success": False, "message": err}), 400

    set_clauses = ", ".join(f"{col} = ?" for col in data)
    db = get_database()
    db.execute(
        f"UPDATE studio_projects SET {set_clauses}, updated_at = ? "
        f"WHERE id = ? AND owner_user_id = ?",
        (*data.values(), _now_iso(), project_id, user_id),
    )

    row = db.fetch_one(
        "SELECT * FROM studio_projects WHERE id = ?", (project_id,)
    )
    _task_logger.info(
        f"[studio] project updated id={project_id} owner={user_id} fields={list(data)}"
    )
    return jsonify({"success": True, "data": _serialize_project(row)}), 200


@bp.delete("/api/studio/projects/<int:project_id>")
def delete_project(project_id: int):
    """Hard-delete a project + FK cascade to episodes + assets.

    Returns 404 for both "doesn't exist" and "exists but not yours"
    (owner isolation). No partial-delete semantics — the FK cascade
    is the contract, and ``PRAGMA foreign_keys=ON`` is set on every
    Sqlite connection in :class:`web_runner.db.PostgresDatabase._connect`
    so the cascade triggers reliably in production + test.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    db = get_database()
    db.execute(
        "DELETE FROM studio_projects WHERE id = ? AND owner_user_id = ?",
        (project_id, user_id),
    )
    _task_logger.info(
        f"[studio] project deleted id={project_id} owner={user_id}"
    )
    return jsonify({"success": True, "data": {"id": project_id}}), 200


# ── Episode CRUD (Phase 3, round-OPT-T2-follow-up) ──────────────────────
# Phase 1 only shipped project CRUD; Phase 3 (per the module's top-of-file
# overview) adds episode-level append + edit + per-episode assets. The
# APPEND endpoint lands first because (a) the user's 「起/承/转/合」 insert
# workflow is add-mostly with light in-flight edits (NOT the long-lived
# auto-save loop the eventual PATCH endpoint will power), and (b) shipping
# the append path first unblocks the editor's "generate four-act"
# pipeline before the heavy PATCH auto-save lands.
#
# The PATCH /api/studio/episodes/<id> task (§3.3.1 in tasks.md) is
# still pending — when it lands, this file will gain a sibling route
# next to the one below.

_EPISODE_TITLE_MAX_LEN = 200


def _validate_create_episode_item(payload: Any) -> tuple[dict | None, str | None]:
    """Validate ONE episode body.

    Item shape::

        { title?, act, scenes_json?, dialogues_json? }

    ``scenes_json`` / ``dialogues_json`` accept EITHER a JSON
    list-of-dicts (canonical form the JS picker will send) OR a
    pre-stringified JSON string (round-trips through the
    `_validate_canvas_payload`-style byte-equivalence contract: the
    server emits via ``json.dumps(..., ensure_ascii=False,
    separators=(",", ":"))`` so a PATCH + re-GET returns byte-equivalent
    data — see `_canvas_size_bytes`'s docstring for why this canonical
    form matters for CJK payloads).

    ``act`` MUST be one of `_VALID_ACTS = {"起", "承", "转", "合"}`. Status
    is hard-coded to ``'draft'`` on insert — clients can't transition
    state at write time; the eventual ``PATCH /api/studio/episodes/<id>``
    will handle status transitions.
    """
    if not isinstance(payload, dict):
        return None, "episode 必须是 JSON 对象"
    act = (payload.get("act") or "").strip()
    if act not in _VALID_ACTS:
        return None, f"act 必须是 {sorted(_VALID_ACTS)} 之一"
    title_raw = payload.get("title")
    title_clean = title_raw.strip() if isinstance(title_raw, str) else None
    if title_clean is not None and len(title_clean) > _EPISODE_TITLE_MAX_LEN:
        return None, f"title 长度不能超过 {_EPISODE_TITLE_MAX_LEN} 个字符"

    scenes = payload.get("scenes_json", [])
    if isinstance(scenes, str):
        try:
            scenes = json.loads(scenes)
        except (ValueError, TypeError):
            return None, "scenes_json 必须能解析为 JSON"
    if scenes is None:
        scenes = []  # missing key IS valid → insert with empty list
    if not isinstance(scenes, list):
        return None, "scenes_json 必须是 JSON 数组"

    dialogues = payload.get("dialogues_json", [])
    if isinstance(dialogues, str):
        try:
            dialogues = json.loads(dialogues)
        except (ValueError, TypeError):
            return None, "dialogues_json 必须能解析为 JSON"
    if dialogues is None:
        dialogues = []
    if not isinstance(dialogues, list):
        return None, "dialogues_json 必须是 JSON 数组"

    return {
        "act": act,
        "title": title_clean,
        "scenes_json": json.dumps(scenes, ensure_ascii=False, separators=(",", ":")),
        "dialogues_json": json.dumps(dialogues, ensure_ascii=False, separators=(",", ":")),
    }, None


@bp.post("/api/studio/projects/<int:project_id>/episodes")
def create_project_episodes(project_id: int):
    """Append one or more episodes to a project.

    Body shape (auto-detected)::

        # single
        { title?, act, scenes_json?, dialogues_json? }

        # batch (canonical multi-episode path for 「起/承/转/合」)
        [
            { title?, act, scenes_json?, dialogues_json? },
            …,
        ]

    Each item is validated through :func:`_validate_create_episode_item`.
    The first validation error short-circuits the entire batch (atomic
    all-or-nothing) because the canonical workflow is "insert all four
    acts together" — a partial-write of 2 of 4 acts would leave the user
    with a half-populated storyboard and no obvious way to recover
    before PATCH /episodes land.

    ``episode_no`` is server-assigned at append time via
    ``COALESCE(MAX(episode_no), 0) + i + 1`` ALONG WITH the INSERT
    statements inside a single ``db.transaction()`` block. Calling
    ``db.xxx`` outside the ``with`` block would race-grab a SECOND
    connection that can't see the in-flight rows, plus rollback would
    silently ignore writes on that second connection — see
    ``PostgresTransactionHandle`` docstring + the prior round's
    deadlock writeup for why this matters.

    Auth: implicit via the global ``/api/*`` before_request gate. We
    additionally call :func:`_current_user_id` so the explicit 401
    contract mirrors the rest of the project CRUD surface. Owner: 404
    for non-owner (uniform with ``get_project`` / ``update_project``).

    Returns 201 with ``{ "success": True, "data": [_serialize_episode(r)] }``.
    Empty batch → 400 (this is a client bug; silent 200 [] would mask
    a typo in the caller's payload shape).
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({
            "success": False,
            "message": "body 必须是 JSON 对象或数组",
        }), 400

    if isinstance(payload, list):
        items_raw = payload
    elif isinstance(payload, dict):
        items_raw = [payload]
    else:
        return jsonify({
            "success": False,
            "message": "body 必须是 JSON 对象或数组",
        }), 400

    if not items_raw:
        return jsonify({
            "success": False,
            "message": "episode 列表不能为空",
        }), 400

    validated: list[dict] = []
    for i, item in enumerate(items_raw):
        data, err = _validate_create_episode_item(item)
        if err is not None:
            return jsonify({
                "success": False,
                "message": f"第 {i + 1} 项: {err}",
            }), 400
        validated.append(data)

    db = get_database()
    now = _now_iso()
    inserted_rows: list[dict] = []

    try:
        with db.transaction() as tx:
            # All reads + writes MUST go through `tx`, not `db`.
            # See ``db.PostgresTransactionHandle`` — grabbing a 2nd
            # pool conn outside the `with` scope would deadlock on
            # PG connection starvation AND ignore rollback on the
            # uncommitted writes.
            max_row = tx.fetch_one(
                "SELECT COALESCE(MAX(episode_no), 0) AS mx "
                "FROM studio_episodes WHERE project_id = ?",
                (project_id,),
            )
            base_no = int(max_row["mx"]) if max_row else 0

            for i, data in enumerate(validated):
                ep_no = base_no + i + 1
                new_id = tx.insert_returning_id(
                    "INSERT INTO studio_episodes "
                    "(project_id, episode_no, act, title, scenes_json, "
                    "dialogues_json, status, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)",
                    (
                        project_id,
                        ep_no,
                        data["act"],
                        data["title"],
                        data["scenes_json"],
                        data["dialogues_json"],
                        now,
                    ),
                )
                row = tx.fetch_one(
                    "SELECT * FROM studio_episodes WHERE id = ?",
                    (new_id,),
                )
                inserted_rows.append(row)

            # round-OPT-T2-follow-up polish — bump the parent row's
            # `updated_at` so the projects-list view (``ORDER BY
            # updated_at DESC, id DESC`` in StudioPage's
            # ``list_projects``) reorders correctly when an operator
            # navigates back from a project detail after appending
            # episodes. Without this bump, the project stays at its
            # OLD list position even though the user just edited it
            # — confusing "I just added episodes, why is the card
            # still buried?" UX. Same `tx` connection so it shares
            # the in-flight transaction with the episode inserts
            # above (commit-or-rollback atomic); same `_now_iso()`
            # so the parent `updated_at` strictly equals the child
            # `created_at` for the episodes appended in this call,
            # which downstream profiling uses as the canonical
            # "last touched at" mark.
            tx.execute(
                "UPDATE studio_projects SET updated_at = ? "
                "WHERE id = ? AND owner_user_id = ?",
                (now, project_id, user_id),
            )
    except Exception as exc:  # noqa: BLE001 — route-level safety net
        # `db.transaction()` ctx-mgr already rolled back the inner
        # writes; we just need to surface a clean 500. log + return.
        _task_logger.exception(
            f"[studio] episodes append failed id={project_id} "
            f"count_requested={len(validated)}: {type(exc).__name__}: {exc}"
        )
        return jsonify({
            "success": False,
            "message": "episodes 写入失败,已自动回滚事务 — 稍后重试",
        }), 500

    _task_logger.info(
        f"[studio] episodes appended id={project_id} owner={user_id} "
        f"count={len(inserted_rows)} "
        f"acts={','.join(d['act'] for d in validated)}"
    )
    return jsonify({
        "success": True,
        "data": [_serialize_episode(r) for r in inserted_rows],
    }), 201


# ── Seedance 2.0 markdown export (round-OPT-seedance-export) ────────────────
# OpenSpec ref: ``openspec/changes/script-studio/tasks.md §3.4.1,.3.4.4``。
# Mirrors the byte-equivalent layout used by the open-source
# `liangdabiao/Seedance2-Storyboard-Generator` project:
#  - E0X - <title> header
#  - 素材上传清单  table (素材槽 | 文件 | 说明)
#  - Seedance Prompt block (timeline segments)
#  - 【声音】 + 【参考】 lines
#  - 尾帧描述
# Output is postable to Seedance 2.0 directly (operator copies markdown
# into the model input box and lets the model render the storyboard).
# All 全角 punctuation (【】,「、,」「:,」) preserved as literals so a
# markdown reparser downstream sees the same bytes our backend emits.

# Canonical asset-slot ordering: 角色 before 场景 before 道具 (matches
# the printable C01 → S01 → P01 → N order operators expect on a printed
# storyboard), then the render-time caches (background + background_video)
# so the operator can swap those late. voiceover is excluded —
# 配音 lives under 【声音】 not under 素材上传清单 (picture-only surface).
_SEEDANCE_KIND_SORT_ORDER = (
    "character",
    "scene",
    "prop",
    "background",
    "background_video",
)


def _seedance_asset_sort_key(asset: dict) -> tuple:
    """Sort key that sorts an asset row by image-slot index then by
    the asset kind's natural order (e.g. C01 vs C02 by code string).
    Used to render 素材清单 rows in a predictable order.
    """
    kind = (asset.get("kind") or "").strip()
    try:
        kind_order = _SEEDANCE_KIND_SORT_ORDER.index(kind)
    except ValueError:
        kind_order = len(_SEEDANCE_KIND_SORT_ORDER)
    code = (asset.get("code") or "")
    return (kind_order, code)


def _slugify_studio_filename(name: str, *, fallback: str = "storyboard") -> str:
    """Sanitize a project / episode title for file paths + HTTP headers.

    Substitutes every char that is NOT (alphanumeric + a curated
    keep set) to `_`. The keep set is intentionally narrow so the
    function doubles as a zip-slip-safe slugifier — ``os.path.sep``
    (``/`` and ``\\``), control chars, and HTTP-quote-fighters
    (``"<>|?*:``) all fall into the `_` bucket. Adjacent `_` runs
    are collapsed once by the strip pass. Trim leading/trailing
    periods because ``...`` is a Windows-reserved name shape AND
    a Heroku slug-forbidden pattern. Caps at 80 chars to stay
    below HTTP/1.1 header-line limits. Returns ``fallback`` if the
    input sanitizes to empty.

    Note: keeps ASCII alphanumerics + `_-(). ` + the CJK
    fullwidth parens `（）` since admins frequently use them in
    project titles (e.g. `《林冲》宝贝计划（草稿）`).
    """
    keep = "-_.()（） "
    out: list[str] = []
    prev_underscore = False
    for ch in name:
        if ch.isalnum() or ch in keep:
            out.append(ch)
            prev_underscore = False
        elif not prev_underscore:
            out.append("_")
            prev_underscore = True
    cleaned = "".join(out).strip().strip(".") or fallback
    return cleaned[:80]


def _content_disposition_filename(display: str, ascii_fallback: str) -> str:
    """Build a Content-Disposition header value with RFC 5987 fallback.

    Emits BOTH a legacy ``filename="<ascii>"`` (read by HTTP servers
    that don't honor RFC 5987) AND a ``filename*=UTF-8''<percent-encoded>``
    part (RFC 5987 — required by Safari 12- and most HTTP middleware
    when filename contains non-ASCII bytes like CJK characters).
    The ASCII fallback is computed by stripping every non-ASCII char
    from ``display`` so CJK names like ``剧名`` still produce a clean
    ``attachment; filename="storyboard"`` for legacy clients.
    """
    ascii_part = (
        (ascii_fallback or "storyboard")
        .encode("ascii", "ignore")
        .decode("ascii")
        or "storyboard"
    )
    encoded = _urllib_parse.quote(display, safe="")
    return f"attachment; filename=\"{ascii_part}\"; filename*=UTF-8''{encoded}"


def _format_seedance_episode_md(
    episode: dict, project_assets: list[dict]
) -> str:
    """Serialize ONE episode row + project assets into the Seedance 2.0
    per-episode storyboard markdown.

    Layout (byte-exact to the upstream liangdabiao template):
        E0X - <title>

        素材上传清单
        | 素材槽 | 文件 | 说明 |
        | :--- | :--- | :--- |
        | 图片1 | C01 | <name>:<prompt> |
        | 图片2 | S01 | ... |
        ...

        Seedance Prompt
        <style>, 9:16竖屏, <synopsis-capsule>
        0-3秒画面：
        <scene[0]>
        3-6秒画面：
        <scene[1]>
        ...

        【声音】BGM: <style> · 对白: <joined dialogues> · 旁白: <synopsis>

        【参考】@图片1 <name>, @图片2 <name>, ...

        尾帧描述
        第 N 集结尾的关键定格镜头，用于下一集开场衔接。

    Implementation notes (round-OPT-seedance-export):
      * `scenes_json` is treated as an ordered list; if shorter than
        5 entries we pad to 5 empty blocks so the timeline always
        reads identically to the upstream template (avoids
        半成品 3 段 typos downstream parsers may catch). If longer,
        we extend naturally.
      * dialogues are joined with ` · ` as the canonical separator
        (同样 punctuation contract with 【声音】 + 气口 cost — fullwidth
        middle-dot is the upstream convention).
      * 素材清单 slot labels are 1-based 图片{N}, sorted by
        `_seedance_asset_sort_key`. Empty slots fill with `…` so the
        table always reads as a complete N-row matrix.
    """
    scenes = episode.get("scenes") or []
    dialogues = episode.get("dialogues") or []
    ep_no = int(episode.get("episode_no") or 0)
    title = (episode.get("title") or "").strip() or "未命名"

    # Sort assets for 素材清单 (角色 before 场景 before 道具).
    sorted_assets = sorted(project_assets, key=_seedance_asset_sort_key)

    # Build 素材清单 table.
    asset_lines = [
        "| 素材槽 | 文件 | 说明 |",
        "| :--- | :--- | :--- |",
    ]
    for i, asset in enumerate(sorted_assets):
        slot_label = f"图片{i + 1}"
        code = (asset.get("code") or "").strip() or "—"
        name = (asset.get("name") or "").strip() or code
        prompt = (asset.get("prompt") or "").strip().replace("\n", " ")[:60]
        asset_lines.append(f"| {slot_label} | {code} | {name}：{prompt} |")

    # Seedance Prompt timeline — 3-second segments, min 5 blocks.
    SEG = 5
    n = max(SEG, len(scenes))

    proj_style_part = (episode.get("__project", {}).get("style") or "").strip() or "默认"
    proj_synopsis = (episode.get("__project", {}).get("synopsis") or "").strip()
    proj_synopsis_capsule = proj_synopsis.replace("\n", " ")[:80] or "默认剧情"

    timeline_lines = [
        f"{proj_style_part}, 9:16竖屏, {proj_synopsis_capsule}",
    ]
    for i in range(n):
        start = i * 3
        end = (i + 1) * 3
        body = ""
        if i < len(scenes):
            scene = scenes[i]
            if isinstance(scene, dict):
                body = (scene.get("body") or scene.get("title") or scene.get("description") or "").strip()
            elif isinstance(scene, str):
                body = scene.strip()
            elif scene is not None:
                body = str(scene).strip()
        if not body and i == 0 and proj_synopsis_capsule != "默认剧情":
            body = proj_synopsis_capsule
        timeline_lines.append(f"{start}-{end}秒画面：")
        timeline_lines.append(body or "保持节奏")
        timeline_lines.append("")

    # 【声音】 block — BGM (style) + 对白 (dialogues) + 旁白 (synopsis).
    dialogue_chunks = []
    for d in dialogues:
        if isinstance(d, dict):
            dialogue_chunks.append(
                (d.get("text") or d.get("content") or d.get("dialogue") or "").strip()
            )
        elif isinstance(d, str):
            dialogue_chunks.append(d.strip())
        elif d is not None:
            dialogue_chunks.append(str(d).strip())
    dialogue_str = " · ".join(s for s in dialogue_chunks if s)[:120] or "无"
    narration_str = proj_synopsis_capsule if proj_synopsis_capsule != "默认剧情" else "无"
    sound_block = f"【声音】BGM: {proj_style_part} · 对白: {dialogue_str} · 旁白: {narration_str}"

    # 【参考】 block.
    ref_strs = []
    for i, asset in enumerate(sorted_assets):
        name = (asset.get("name") or "").strip() or (asset.get("code") or "")
        ref_strs.append(f"@图片{i + 1} {name}")
    if not ref_strs:
        ref_strs.append("@图片1 —")
    ref_block = f"【参考】{', '.join(ref_strs)}"

    # Assemble.
    parts = [
        f"E{ep_no:02d} - {title}",
        "",
        "素材上传清单",
        *asset_lines,
        "",
        "Seedance Prompt",
        *timeline_lines,
        sound_block,
        "",
        ref_block,
        "",
        "尾帧描述",
        f"第 {ep_no} 集结尾的关键定格镜头，用于衔接下一集开场。",
        "",
    ]
    return "\n".join(parts)


def _format_seedance_project_md(
    project: dict, episodes: list[dict]
) -> str:
    """Project-wide master file (`_剧本.md`) for the Seedance 2.0 zip.

    Mirrors the upstream `_剧本.md` shape:
      # <title>

      ## 项目简介
      <synopsis>

      ## 视觉风格
      <style>

      ## 四幕结构
      - 起：第N集 — <title>，第M集 — <title>
      - 承：…
      - 转：…
      - 合：…

      ## 分集列表
      | 集数 | 标题 | 幕 | 状态 |
      | :--- | :--- | :--- | :--- |
      | 1 | … | 起 | draft |
      …
    """
    title = (project.get("title") or "").strip() or "未命名"
    synopsis = (project.get("synopsis") or "").strip() or "（未填写）"
    style = (project.get("style") or "").strip() or "（未指定）"

    # Group episodes by 四幕 (起/承/转/合).
    four_act: dict[str, list[tuple[int, str]]] = {
        "起": [], "承": [], "转": [], "合": [],
    }
    table_lines = [
        "| 集数 | 标题 | 幕 | 状态 |",
        "| :--- | :--- | :--- | :--- |",
    ]
    for ep in episodes:
        ep_no = int(ep.get("episode_no") or 0)
        ep_title = (ep.get("title") or "").strip() or "未命名"
        act = (ep.get("act") or "—").strip()
        status = (ep.get("status") or "draft").strip()
        four_act.setdefault(act, []).append((ep_no, ep_title))
        table_lines.append(f"| {ep_no} | {ep_title} | {act} | {status} |")

    four_act_lines = []
    for act_name in ("起", "承", "转", "合"):
        rows = four_act.get(act_name) or []
        if not rows:
            four_act_lines.append(f"- {act_name}：—")
        else:
            entries = [f"第{n}集 — {t}" for n, t in rows]
            four_act_lines.append(f"- {act_name}：{', '.join(entries)}")

    parts = [
        f"# {title}",
        "",
        "## 项目简介",
        synopsis,
        "",
        "## 视觉风格",
        style,
        "",
        "## 四幕结构",
        *four_act_lines,
        "",
        "## 分集列表",
        *table_lines,
        "",
    ]
    return "\n".join(parts)


@bp.get("/api/studio/projects/<int:project_id>/episodes/<int:episode_no>/export")
def export_episode_route(project_id: int, episode_no: int):
    """Export ONE episode as Seedance 2.0 format markdown.

    Returns ``text/markdown`` (UTF-8) with an attachment
    ``Content-Disposition`` so curl / browser-fetch both save the
    file with a natural name (``E01_<title>.md``). Auth via the
    global /api/* before_request gate; owner via :func:`_load_project`
    (404 for non-owner / missing).

    404 also fires for missing episode_no (uniform with project
    fetch) so existence-introspection via differing status codes
    stays impossible.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    db = get_database()
    ep_row = db.fetch_one(
        "SELECT * FROM studio_episodes WHERE project_id = ? AND episode_no = ?",
        (project_id, episode_no),
    )
    if ep_row is None:
        return jsonify({"success": False, "message": "分集不存在"}), 404

    project_assets = db.fetch_all(
        "SELECT * FROM studio_assets WHERE project_id = ?",
        (project_id,),
    )

    ep_dict = _serialize_episode(ep_row)
    ep_dict["__project"] = _serialize_project(project)
    md = _format_seedance_episode_md(ep_dict, project_assets)

    # Per-episode filename is prefixed with the project slug so two
    # projects of identical `剧名` / identical E01 numbers don't
    # collide in the operator's Downloads/ folder (browser-side
    # dedup would otherwise silently rename to `.md (1)` …).
    project_slug = _slugify_studio_filename(
        project.get("title") or f"project_{project_id}",
        fallback=f"project_{project_id}",
    )
    ep_slug = _slugify_studio_filename(
        f"E{episode_no:02d}_{(ep_row.get('title') or 'episode')}",
        fallback="episode",
    )
    filename_display = f"{project_slug}-{ep_slug}_分镜.md"
    headers = {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": _content_disposition_filename(
            filename_display, ep_slug
        ),
        "Cache-Control": "no-store",
    }
    _task_logger.info(
        f"[studio] episode exported project={project_id} ep={episode_no} "
        f"byts={len(md.encode('utf-8'))} assets={len(project_assets)}"
    )
    return md, 200, headers


@bp.get("/api/studio/projects/<int:project_id>/export")
def export_project_route(project_id: int):
    """Export the WHOLE project as a Seedance 2.0 zip —
    `_剧本.md` + per-episode `E0X_分镜.md`.

    Built in-memory via ``zipfile.ZipFile`` (stdlib — no extra dep).
    Bot operator / non-prod / unit-test friendly: zero on-disk
    residue, no cross-UID mount failures (mirrors the design choice
    ``_render_via_remotion`` adopted in step-5 long-term fix).

    Auth + owner isolation same as the project-detail endpoint.
    Empty project (zero episodes) still emits a valid zip with
    just `_剧本.md` so the operator can still download a skeleton
    to seed the next iteration.
    """
    import io as _io
    import zipfile as _zipfile

    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    db = get_database()
    ep_rows = db.fetch_all(
        "SELECT * FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
        (project_id,),
    )
    project_assets = db.fetch_all(
        "SELECT * FROM studio_assets WHERE project_id = ?",
        (project_id,),
    )

    project_dict = _serialize_project(project)
    project_md = _format_seedance_project_md(
        project_dict, [_serialize_episode(r) for r in ep_rows]
    )

    # Pre-compute the project slug ONCE for every per-episode filename
    # inside the zip — keeps `<project>-E01_<title>_分镜.md` distinct
    # across projects that share the same episode number / title.
    project_slug = _slugify_studio_filename(
        project.get("title") or f"project_{project_id}",
        fallback=f"project_{project_id}",
    )
    buf = _io.BytesIO()
    with _zipfile.ZipFile(buf, "w", _zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("_剧本.md", project_md.encode("utf-8"))
        for ep_row in ep_rows:
            ep_dict = _serialize_episode(ep_row)
            ep_dict["__project"] = project_dict
            ep_md = _format_seedance_episode_md(ep_dict, project_assets)
            ep_no = int(ep_row.get("episode_no") or 0)
            ep_slug = _slugify_studio_filename(
                f"E{ep_no:02d}_{(ep_row.get('title') or 'episode')}",
                fallback="episode",
            )
            # Final-name convention: <project>-<E0X>_<title>_分镜.md so
            # two projects with identical episode_no don't collide when
            # unzipped into the same folder.
            zf.writestr(
                f"{project_slug}-{ep_slug}_分镜.md",
                ep_md.encode("utf-8"),
            )
    buf.seek(0)

    zip_name_safe = _slugify_studio_filename(
        f"{(project.get('title') or 'project')}_全剧",
        fallback="project",
    )
    _task_logger.info(
        f"[studio] project exported id={project_id} "
        f"episodes={len(ep_rows)} assets={len(project_assets)}"
    )
    # Werkzeug's default `download_name=` writes ONLY
    # `filename="..."` — CJK names break in Safari 12- and most
    # HTTP middleware. Manually attach the RFC 5987 dual-form
    # header so Chinese titles download cleanly across all major
    # browsers.
    response = _send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{zip_name_safe}.zip",
    )
    response.headers["Content-Disposition"] = _content_disposition_filename(
        f"{zip_name_safe}.zip", zip_name_safe
    )
    return response


# ── Render (storyboard → MP4) ────────────────────────────────────────

import os as _os
import json as _json
import subprocess as _subprocess
import tempfile as _tempfile
import shutil as _shutil

from flask import send_file as _send_file

# Render backend — only Remotion (round-Video-Backgrounds-v1).
# Pre-round branches (MoviePy fallback `web_runner/studio_render.py`
# + `_render_via_hyperframes` legacy Node bridge) were deleted along
# with their tests and the `SAU_STUDIO_RENDERER` env switch. The
# single renderer is ``_render_via_remotion`` below; the only knob
# left is the Node binary path for asdf/volta/v22-managed versions
# (`SAU_STUDIO_NODE_PATH`). Pexels Videos + Edge-TTS are wired via
# ``_resolve_scene_videos`` + ``_resolve_scene_voiceovers`` earlier
# in this module so the rendered MP4 carries both real video and
# synthesized voiceover streams.
_STUDIO_RENDER_TIMEOUT = int(
    _os.environ.get("SAU_STUDIO_RENDER_TIMEOUT", "600")
)

# Rendered artifacts live under <MEDIA_ROOT>/studio/<project_id>/.
_STUDIO_MEDIA_DIR = _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))),
    "media",
    "studio",
)

_MIME = {
    ".mp4": "video/mp4",
    ".ass": "text/x-ssa",
    ".srt": "application/x-subrip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
}


def _project_render_dir(project_id: int) -> str:
    return _os.path.join(_STUDIO_MEDIA_DIR, str(project_id))


# ── Phase 2 — Pexels image-background cache + scene precompute ────
# These three helpers run BEFORE the Remotion bridge spawn so the
# Node bundle never has to learn Pexels IDs, hit PEXELS_API_KEY,
# or hash a `studio_assets.kind='background'` cache row. The bridge
# only sees `scenes[]` + `background_urls[]` + `overlay_opacity`
# already prepared. Pexels is the chosen open-source image source
# (the existing `web_runner/routes/ai.py::_search_pexels` already
# serves the recommendation grid in /dashboard/publish), and its
# CDN URLs are stable + hot-linkable so Remotion's headless Chromium
# can fetch them at render-time without a Flask `/api/.../image`
# proxy. UPSERT into `studio_assets.kind='background'` keyed by
# `code='scene_<idx:03d>'` makes the response cache-through by
# prompt.
import concurrent.futures as _cf
from datetime import datetime as _dt_module  # noqa: F401  (used by callers, re-export)
from typing import Optional as _Optional


def _auto_image_prompt(project_dict: dict, scene_dict: dict) -> str:
    """Auto-derive a Pexels query from project.style + scene body.

    The user picked "自动拼装（零迁移）" over the "加 foreground 列"
    alternative, so we synthesize the prompt from existing column
    data rather than add `studio_episodes.foreground_prompt`. The
    rule: ``"<style>, <title>, <body>"`` with empty parts collapsed.
    Falls back to a single descriptive eyebrow if both are absent
    so Pexels still gets a valid keyword.
    """
    style = (project_dict.get("style") or "").strip()
    title = (scene_dict.get("title") or "").strip()
    body = (scene_dict.get("body") or "").strip()
    pieces = [p for p in (style, title, body) if p]
    if not pieces:
        # Last-resort so Pexels still has SOMETHING to query.
        return "cinematic still, atmospheric, 9:16 portrait"
    return ", ".join(pieces)


def _build_scenes_for_render(
    project_dict: dict,
    episodes_list: list[dict],
) -> list[dict]:
    """Python side of the Remotion bridge — mirrors the Node-side
    `sau_web/frontend/remotion_studio/render.mjs::buildScenes`.

    Round-Video-Backgrounds-v1 deleted the legacy
    `hyperframes/render.js::buildScenes` (the Hyperframes Node
    bridge was removed along with `SAU_STUDIO_RENDERER=hyperframes`).
    The single cross-language contract is now Python-emit → Node-
    consume via the parallel-array shape:
        `scenes[i]` ↔ `background_urls[i]` ↔ `background_videos[i]`
        ↔ `voiceovers[i]`
    Drift between Python and JS is caught by
    ``test_studio_remotion_render.py`` alignment assertions.

    The body is rendered as a single string per card (joining
    each episode's `scenes_json` + `dialogues_json` chunks with
    newline separators — the same join shape the legacy MoviePy
    fallback used before it was deleted).
    """
    scenes_out: list[dict] = []
    if episodes_list:
        for ep in episodes_list:
            scenes_json = ep.get("scenes") or []
            dialogues = ep.get("dialogues") or []
            if scenes_json or dialogues:
                chunks = (
                    [str(s) for s in scenes_json]
                    + [str(d) for d in dialogues]
                )
                body = "\n".join(chunks).strip()
                if body:
                    scenes_out.append(
                        {
                            "title": (
                                f"第 {ep.get('episode_no') or '?'} 集 · "
                                f"{ep.get('title') or ''}"
                            ).strip(),
                            "body": body,
                        }
                    )
            elif ep.get("title"):
                scenes_out.append(
                    {
                        "title": (
                            f"第 {ep.get('episode_no') or '?'} 集"
                        ).strip(),
                        "body": str(ep.get("title") or "").strip(),
                    }
                )
    if not scenes_out:
        synopsis = (project_dict.get("synopsis") or "").strip()
        if synopsis:
            for line in synopsis.replace("\r", "\n").split("\n"):
                if line.strip():
                    scenes_out.append(
                        {
                            "title": (project_dict.get("title") or "梗概").strip(),
                            "body": line.strip(),
                        }
                    )
    if not scenes_out:
        scenes_out.append(
            {
                "title": (project_dict.get("title") or "未命名").strip(),
                "body": "（暂无内容）",
            }
        )
    return scenes_out


def _resolve_scene_backgrounds(
    project_dict: dict,
    scenes_list: list[dict],
) -> list[_Optional[str]]:
    """Resolve one Pexels CDN URL per scene, cache-through by
    `studio_assets.kind='background' + code='scene_<idx:03d>'`.

    Cache hit path returns the persisted `ref_image_url` directly
    without any external HTTP traffic. Cache miss path synthesises
    the prompt from `_auto_image_prompt`, calls
    `_search_pexels(orientation='portrait')`, takes the first
    normalised photo's `full` URL, and UPSERTs the row.

    Failure modes (silent-degrade so one bad scene never kills an
    otherwise-good render):
      * PEXELS_API_KEY unset → returns ``[None] * N``.
      * `_search_pexels` raises or returns ``[]`` → ``None`` for
        that scene.
      * UPSERT raises → we still return the URL we just fetched
        (best-effort: caller can re-render to retry cache write).
      * Cache row malformed → ``None`` (defensive: a non-string or
        empty `ref_image_url` is treated as a miss).

    The 3-worker ThreadPoolExecutor caps concurrent external HTTP
    traffic so a 10-scene script doesn't open 10 parallel HTTPS
    sockets (Pexels's recommendation rate limit is documented at
    200/h + 20000/mo on free tier — see
    `docs/ai-material-search.md`).
    """
    n = len(scenes_list)
    out: list[_Optional[str]] = [None] * n
    if n == 0:
        return out
    project_id = project_dict.get("id")
    if project_id is None:
        return out
    db = get_database()
    if db is None:
        return out

    # Cache read — one round-trip reads every background row for
    # this project so the parallel fan-out below doesn't issue an
    # extra SELECT per scene.
    try:
        cached_rows = db.fetch_all(
            "SELECT code, ref_image_url FROM studio_assets "
            "WHERE project_id = ? AND kind = 'background'",
            (project_id,),
        )
    except Exception as e:  # noqa: BLE001 — surface as full-no-degrade
        _task_logger.warning(
            f"[studio] bg cache select failed: {type(e).__name__}: {e}"
        )
        cached_rows = []
    cache_index: dict[str, str] = {}
    for row in (cached_rows or []):
        code = row.get("code")
        url = row.get("ref_image_url")
        if code and isinstance(url, str) and url.strip():
            cache_index[str(code)] = url.strip()

    # Cross-scene dedupe within THIS render call. Without this guard,
    # two adjacent scenes whose prompts share Pexels search tokens can
    # resolve to the *same* photo, producing a jarring 5-second loop of
    # an identical still. `seen_pexels_ids` is closure-shared across the
    # worker pool so the second scene sees the first scene's pick and
    # picks the second candidate instead.
    #
    # Scope note (Phase-2 minimal): dedupe is intentionally
    # *within-render-call only*. Cross-render-call dedupe would
    # require a persisted `upstream_id` column on `studio_assets`
    # (which doesn't exist today). That schema migration is a Phase-3
    # concern — the operator can manually fix bad dedupes by editing
    # `studio_assets.kind='background'` rows directly via a follow-up
    # SQL UPDATE. For Phase 2 the in-render dedupe is sufficient to
    # prevent the back-to-back identical-still failure mode that the
    # `#121` reviewer reproduction showed.
    seen_pexels_ids: set[str] = set()

    def _resolve_scene(idx: int, scene_dict: dict) -> tuple[int, _Optional[str]]:
        code = f"scene_{idx:03d}"
        cached_url = cache_index.get(code)
        if cached_url:
            return idx, cached_url
        prompt = _auto_image_prompt(project_dict, scene_dict)
        url: _Optional[str] = None
        # We request 2 candidates instead of 1 so cross-scene dedupe
        # has a fallback photo to pick when the first choice was
        # already used by an earlier scene in this render call.
        try:
            from web_runner.routes.ai import (
                _normalize_pexels_photo,
                _search_pexels,
            )
            raw = _search_pexels(prompt, count=2, orientation="portrait")
        except Exception as e:  # noqa: BLE001 — single-source failure
            _task_logger.warning(
                f"[studio] Pexels call failed for scene {idx} "
                f"prompt={prompt!r}: {type(e).__name__}: {e}"
            )
            raw = []
        chosen_norm: dict | None = None
        chosen_upstream_id: str = ""
        if raw:
            # Walk candidates left-to-right. Skip any whose upstream
            # id is already in `seen_pexels_ids` (chosen by an earlier
            # scene in this render call OR persisted from a previous
            # render via cached_ids). The first fresh one wins — this
            # keeps each pick deterministic and predictable on
            # re-renders, unlike a `random.sample(candidates)` which
            # would re-shuffle on every render.
            for candidate in raw:
                try:
                    norm = _normalize_pexels_photo(candidate)
                except Exception as e:  # noqa: BLE001 — defensive normalise
                    _task_logger.warning(
                        f"[studio] Pexels normalise failed for scene {idx}: "
                        f"{type(e).__name__}: {e}"
                    )
                    continue
                upstream_id = candidate.get("id")
                id_key = str(upstream_id) if upstream_id is not None else ""
                if id_key and id_key in seen_pexels_ids:
                    continue
                chosen_norm = norm
                chosen_upstream_id = id_key
                break
        if chosen_norm is not None:
            url = (
                chosen_norm.get("full")
                or chosen_norm.get("preview")
                or chosen_norm.get("thumb")
            )
        if url and chosen_upstream_id:
            seen_pexels_ids.add(chosen_upstream_id)
        if not url:
            return idx, None
        # UPSERT (best-effort). Failure here doesn't drop the URL
        # on the floor — caller has already extracted it.
        try:
            db.execute(
                "INSERT INTO studio_assets "
                "(project_id, kind, code, name, prompt, ref_image_url, created_at) "
                "VALUES (?, 'background', ?, ?, ?, ?, ?) "
                "ON CONFLICT (project_id, kind, code) DO UPDATE SET "
                "ref_image_url = EXCLUDED.ref_image_url, "
                "prompt = EXCLUDED.prompt, name = EXCLUDED.name",
                (
                    project_id,
                    code,
                    (scene_dict.get("title") or f"scene {idx}")[:80],
                    prompt[:500],
                    url,
                    _now_iso(),
                ),
            )
        except Exception as e:  # noqa: BLE001
            _task_logger.warning(
                f"[studio] bg cache UPSERT failed for {code}: "
                f"{type(e).__name__}: {e}"
            )
        return idx, url

    max_workers = max(1, min(n, 3))
    with _cf.ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_resolve_scene, i, sc) for i, sc in enumerate(scenes_list)]
        for fut in futures:
            try:
                idx, url = fut.result(timeout=20)
                if url:
                    out[idx] = url
            except Exception as e:  # noqa: BLE001
                _task_logger.warning(
                    f"[studio] future raised for scene bg: "
                    f"{type(e).__name__}: {e}"
                )
    return out


# ── Phase 3 (round-Video-Backgrounds-v1) — video-first pipeline ────
# The Studio render now plays a real downloaded Pexels VIDEO clip per
# scene background via Remotion `<OffthreadVideo>` rather than a static
# Pexels image. The video-first path runs alongside (not in lieu of)
# the image fallback above: if a scene's `_search_pexels_videos` call
# returns no acceptable portrait MP4, that scene's `background_videos[i]`
# is ``None`` and SceneCard falls through to the existing `<Image>` —
# preserving the pre-round behaviour for that scene.
#
# The voiceover path is independent: every scene's body is one
# ``edge-tts`` call (refactored into ``web_runner.studio_tts``) that
# produces a per-scene MP3 at ``media/studio/<id>/media/scene_<idx>.mp3``
# if the CLI is installed. The MP3 lands in the same ``media/`` dir
# as the video so the download-cache UPDATEs share one folder.
#
# Both new helpers preserve the parallel-array contract:
#   `background_videos[i]` aligns 1:1 with `scenes[i]` (and with the
#   existing `background_urls[i]` from `_resolve_scene_backgrounds`)
#   so render.mjs's inputProps carry three independent parallel arrays.
# SceneCard picks the media per `i` index.


def _auto_video_prompt(project_dict: dict, scene_dict: dict) -> str:
    """Pexels Videos query — same shape as `_auto_image_prompt`.

    Re-uses the existing style + title + body concatenation rather
    than inventing a new schema so a user facing "same prompt fed to
    both backends" stays obvious. Pexels Videos matches natural
    language better than the still-photo API, so this works
    without any extra cinematic term injection.
    """
    style = (project_dict.get("style") or "").strip()
    title = (scene_dict.get("title") or "").strip()
    body = (scene_dict.get("body") or "").strip()
    pieces = [p for p in (style, title, body) if p]
    if not pieces:
        # Last-resort so Pexels Videos still has SOMETHING to query.
        # "cinematic motion" is a stronger video-API hook than the
        # still-photo fallback `cinematic still, atmospheric, ...`
        # because Pexels Videos indexes by motion keywords.
        return "cinematic motion, atmospheric, 9:16 portrait"
    return ", ".join(pieces)


def _build_absolute_url(project_id: int | str, rel_path: str) -> str:
    """Build an absolute URL the headless Chromium inside Remotion can fetch.

    Honours ``X-Forwarded-Host`` + ``X-Forwarded-Proto`` when the
    reverse proxy (nginx, traefik, ALB, ...) sets them, falling
    back to :data:`flask.request.host_url` otherwise. This is
    essential for production deploys: ``request.host_url`` returns
    Flask's WSGI view (typically ``http://127.0.0.1:6001/`` when
    the operator hits via a proxied domain), so without the
    forwarding-header check the headless Chromium inside
    ``renderMedia()`` would try to fetch from the Flask-internal
    port and either 502 (no route) or 404 silently.

    The Python app doesn't have ``werkzeug.middleware.proxy_fix.
    ProxyFix`` installed globally because the global middleware
    would patch every route's WSGI environ; we instead read the
    headers directly here so the fix is scoped to the Studio
    renderer (the only consumer that builds absolute URLs for
    Remotion). A future global ProxyFix switch is a single-line
    change in :file:`web_runner/create_app` if other routes need
    the same logic.

    Falls back to ``http://127.0.0.1:6001`` when there's no
    request context (unit-tests, background workers) so the
    helper never crash-fails outside HTTP.
    """
    try:
        from flask import request
        # X-Forwarded-Proto can be a comma-separated chain (multi-
        # hop proxy). For our single-hop case the first value is
        # the operator-facing scheme. Same for X-Forwarded-Host.
        xfp = (request.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip()
        xfh = (request.headers.get("X-Forwarded-Host") or "").split(",")[0].strip()
        if xfp and xfh:
            return f"{xfp}://{xfh}{rel_path}"
        base = request.host_url
        if base:
            return base.rstrip("/") + rel_path
    except RuntimeError:
        # No active request context.
        pass
    return f"http://127.0.0.1:6001{rel_path}"


def _media_dir_for(project_id: int | str) -> str:
    """Per-project staging dir for downloaded mp4 + synthesized mp3.

    Lives next to ``media/studio/<id>/render.mp4`` so an operator's
    :file:`media/studio/<id>/` listing reads as ``render.mp4`` +
    ``captions.{srt,ass}`` + ``media/scene_*.{mp4,mp3}`` — visible
    at-a-glance during triage.
    """
    return _os.path.join(_STUDIO_MEDIA_DIR, str(project_id), "media")


def _resolve_scene_videos(
    project_dict: dict,
    scenes_list: list[dict],
) -> list[_Optional[str]]:
    """[docstring — see round-Video-Backgrounds-v1 doc at top of helper]"""
    n = len(scenes_list)
    out: list[_Optional[str]] = [None] * n
    if n == 0:
        return out
    project_id = project_dict.get("id")
    if project_id is None:
        return out
    db = get_database()
    if db is None:
        return out

    # Cache-read — same broad pattern as `_resolve_scene_backgrounds`
    # so re-renders don't re-download an MP4 we already have on disk.
    try:
        cached_rows = db.fetch_all(
            "SELECT code, ref_image_url FROM studio_assets "
            "WHERE project_id = ? AND kind = 'background_video'",
            (project_id,),
        )
    except Exception as e:  # noqa: BLE001
        _task_logger.warning(
            f"[studio] video cache select failed: {type(e).__name__}: {e}"
        )
        cached_rows = []
    cache_index: dict[str, str] = {}
    for row in (cached_rows or []):
        code = row.get("code")
        url = row.get("ref_image_url")
        if code and isinstance(url, str) and url.strip():
            cache_index[str(code)] = url.strip()

    seen_video_ids: set[str] = set()

    def _resolve_scene(idx: int, scene_dict: dict) -> tuple[int, _Optional[str]]:
        code = f"scene_{idx:03d}"
        cached_url = cache_index.get(code)
        if cached_url:
            # Defensive disk-existence check (round-Video-Backgrounds-v1
            # follow-up): a `studio_assets.kind='background_video'` cache
            # row can outlive the file it points at — manual operator
            # wipe, partial download that crashed mid-write, or a
            # test cleanup that touched the row but left the disk
            # alone. Without this guard the cached_url short-circuits
            # re-download and Remotion's headless Chromium would GET
            # a 404 mid-render, Node would crash (exit 4), and the
            # route would surface a misleading 500. Mirror exists
            # in ``_resolve_scene_voiceovers`` for the same reason.
            media_dir = _media_dir_for(project_id)
            expected_path = _os.path.join(media_dir, f"{code}.mp4")
            if _os.path.isfile(expected_path):
                return idx, cached_url
        prompt = _auto_video_prompt(project_dict, scene_dict)
        chosen_norm: dict | None = None
        try:
            from web_runner.routes.ai import _search_pexels_videos, _normalize_pexels_video
            raw = _search_pexels_videos(
                prompt, count=2, orientation="portrait", min_duration=4
            )
        except Exception as e:  # noqa: BLE001
            _task_logger.warning(
                f"[studio] Pexels Videos call failed for scene {idx} "
                f"prompt={prompt!r}: {type(e).__name__}: {e}"
            )
            raw = []
        if raw:
            for candidate in raw:
                try:
                    norm = _normalize_pexels_video(candidate)
                except Exception as e:  # noqa: BLE001
                    _task_logger.warning(
                        f"[studio] Pexels Videos normalise failed for scene {idx}: "
                        f"{type(e).__name__}: {e}"
                    )
                    continue
                upstream_id = norm.get("id") or ""
                if upstream_id and upstream_id in seen_video_ids:
                    continue
                if not norm.get("download_url"):
                    continue
                chosen_norm = norm
                if upstream_id:
                    seen_video_ids.add(upstream_id)
                break
        if chosen_norm is None:
            return idx, None

        # Download to disk so Remotion reads a LOCAL file (not the
        # upstream CDN — that's more reliable for cross-region deploys
        # AND avoids burning Pexels's per-IP bandwidth twice on
        # re-renders).
        from web_runner.routes.ai import _download_video_to_disk
        media_dir = _media_dir_for(project_id)
        _os.makedirs(media_dir, exist_ok=True)
        out_path = _os.path.join(media_dir, f"{code}.mp4")
        ok, err = _download_video_to_disk(chosen_norm["download_url"], out_path)
        if not ok:
            _task_logger.warning(
                f"[studio] video download failed for scene {idx} "
                f"url={chosen_norm['download_url'][:80]!r}...: {err}"
            )
            return idx, None
        # Build an absolute URL so headless Chromium inside Remotion
        # can fetch the file. _build_absolute_url resolves to the
        # operator-side request host (so a reverse proxied deploy
        # reports the operator URL, not Flask's internal localhost).
        relative_url = f"/api/studio/render/{project_id}/media/{code}.mp4"
        absolute_url = _build_absolute_url(project_id, relative_url)

        try:
            db.execute(
                "INSERT INTO studio_assets "
                "(project_id, kind, code, name, prompt, ref_image_url, created_at) "
                "VALUES (?, 'background_video', ?, ?, ?, ?, ?) "
                "ON CONFLICT (project_id, kind, code) DO UPDATE SET "
                "ref_image_url = EXCLUDED.ref_image_url, "
                "prompt = EXCLUDED.prompt, name = EXCLUDED.name",
                (
                    project_id,
                    code,
                    (scene_dict.get("title") or f"scene {idx}")[:80],
                    prompt[:500],
                    absolute_url,
                    _now_iso(),
                ),
            )
        except Exception as e:  # noqa: BLE001
            _task_logger.warning(
                f"[studio] video cache UPSERT failed for {code}: "
                f"{type(e).__name__}: {e}"
            )
        return idx, absolute_url

    max_workers = max(1, min(n, 3))
    with _cf.ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_resolve_scene, i, sc) for i, sc in enumerate(scenes_list)]
        for fut in futures:
            try:
                idx, url = fut.result(timeout=60)
                if url:
                    out[idx] = url
            except Exception as e:  # noqa: BLE001
                _task_logger.warning(
                    f"[studio] video future raised for scene: "
                    f"{type(e).__name__}: {e}"
                )
    return out


def _resolve_scene_voiceovers(
    project_dict: dict,
    scenes_list: list[dict],
) -> list[_Optional[str]]:
    """[docstring]"""
    n = len(scenes_list)
    out: list[_Optional[str]] = [None] * n
    if n == 0:
        return out
    project_id = project_dict.get("id")
    if project_id is None:
        return out
    db = get_database()
    if db is None:
        return out

    # Cache read — same UPSERT-shaped table; ``kind='voiceover'`` is the
    # discriminator so two duplicate-edges coexist with image + video
    # (each row carries one URL via ``ref_image_url``).
    try:
        cached_rows = db.fetch_all(
            "SELECT code, ref_image_url, prompt FROM studio_assets "
            "WHERE project_id = ? AND kind = 'voiceover'",
            (project_id,),
        )
    except Exception as e:  # noqa: BLE001
        _task_logger.warning(
            f"[studio] voiceover cache select failed: {type(e).__name__}: {e}"
        )
        cached_rows = []

    # Cache key is `(code, prompt-hash)` — re-rendering the same
    # script picks up the cached MP3; an operator who edits a
    # single body line should NEVER re-synthesize (edge-tts latency
    # ~3–6 s per scene) for the unchanged scenes. Without the
    # prompt-hash check the cache would return a stale MP3 whose
    # body drifted from the current scene row.
    cache_index: dict[str, str] = {}
    for row in (cached_rows or []):
        code = row.get("code")
        url = row.get("ref_image_url")
        cached_prompt = row.get("prompt") or ""
        if code and isinstance(url, str) and url.strip() and cached_prompt:
            cache_index[str(code)] = (url.strip(), cached_prompt)

    def _resolve_scene(idx: int, scene_dict: dict) -> tuple[int, _Optional[str]]:
        code = f"scene_{idx:03d}"
        body_text = (scene_dict.get("body") or "").strip()
        if not body_text:
            return idx, None
        cached = cache_index.get(code)
        if cached and cached[1] == body_text:
            # Defensive disk-existence check (round-Video-Backgrounds-v1
            # follow-up): the cache row can outlive the file it
            # points at — manual wipe, partial synthesize, or test
            # cleanup. Without this guard ``cached[0]`` (an absolute
            # URL pointing at the on-disk file) gets handed to
            # Remotion's ``<Audio>`` and Chromium GETs → Flask 404 →
            # Node crash → misleading 500. Mirror exists in
            # ``_resolve_scene_videos`` for the same reason.
            media_dir = _media_dir_for(project_id)
            expected_path = _os.path.join(media_dir, f"{code}.mp3")
            if _os.path.isfile(expected_path):
                return idx, cached[0]

        from web_runner.studio_tts import synthesize_voiceover
        media_dir = _media_dir_for(project_id)
        _os.makedirs(media_dir, exist_ok=True)
        out_path = _os.path.join(media_dir, f"{code}.mp3")
        ok, err = synthesize_voiceover(body_text, out_path)
        if not ok:
            _task_logger.warning(
                f"[studio] voiceover synthesize failed for scene {idx}: {err}"
            )
            return idx, None

        relative_url = f"/api/studio/render/{project_id}/media/{code}.mp3"
        absolute_url = _build_absolute_url(project_id, relative_url)

        try:
            db.execute(
                "INSERT INTO studio_assets "
                "(project_id, kind, code, name, prompt, ref_image_url, created_at) "
                "VALUES (?, 'voiceover', ?, ?, ?, ?, ?) "
                "ON CONFLICT (project_id, kind, code) DO UPDATE SET "
                "ref_image_url = EXCLUDED.ref_image_url, prompt = EXCLUDED.prompt",
                (
                    project_id,
                    code,
                    (scene_dict.get("title") or f"scene {idx}")[:80],
                    body_text[:500],
                    absolute_url,
                    _now_iso(),
                ),
            )
        except Exception as e:  # noqa: BLE001
            _task_logger.warning(
                f"[studio] voiceover cache UPSERT failed for {code}: "
                f"{type(e).__name__}: {e}"
            )
        return idx, absolute_url

    # TTS is slower than image search; cap at 2 workers so a single
    # 7-scene storyboard doesn't burst 7 simultaneous edge-tts
    # subprocesses (the upstream TTS endpoint doesn't like that).
    max_workers = max(1, min(n, 2))
    with _cf.ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_resolve_scene, i, sc) for i, sc in enumerate(scenes_list)]
        for fut in futures:
            try:
                idx, url = fut.result(timeout=120)
                if url:
                    out[idx] = url
            except Exception as e:  # noqa: BLE001
                _task_logger.warning(
                    f"[studio] voiceover future raised for scene: "
                    f"{type(e).__name__}: {e}"
                )
    return out


@bp.post("/api/studio/projects/<int:project_id>/render")
def render_project_route(project_id: int):
    """Render a project's storyboard to an MP4 (+ .ass/.srt captions).

    Owner-isolated via :func:`_load_project`. This is a synchronous
    render (short-form storyboards are seconds long); for longer
    projects this should move onto the task executor / a job queue
    and poll via the returned artifact URLs.

    Returns ``{url, captions_ass, captions_srt, duration}`` on success.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    db = get_database()
    episodes = db.fetch_all(
        "SELECT * FROM studio_episodes WHERE project_id = ? ORDER BY episode_no",
        (project_id,),
    )
    assets = db.fetch_all(
        "SELECT * FROM studio_assets WHERE project_id = ? ORDER BY kind, code",
        (project_id,),
    )

    # round-OPT-MONETIZE-v1 — inline soft-paywall gate. The helper
    # returns a (response, status) tuple AT OR OVER quota OR None
    # when allowed; free-tier over-quota carries ``can_upgrade:
    # true`` so the React side renders UpsellModal instead of a
    # plain toast. We deliberately check quota AFTER
    # owner-isolation so a non-owner still gets a 404 (NOT a 429)
    # — paying free-tier users should not be able to enumerate
    # other users' project ids via differing status codes.
    # Placed AFTER episode/asset fetches because those two DB
    # round-trips are owner-scoped (the SELECT has no
    # owner_user_id filter, only the project row was owner-checked)
    # — owner-isolation is sufficient up to this point.
    quota_gate = exceeds_tier_quota(user_id, "studio_render")
    if quota_gate is not None:
        return quota_gate

    out_dir = _project_render_dir(project_id)
    out_path = _os.path.join(out_dir, "render.mp4")

    try:
        manifest = _render_via_remotion(
            project,
            [_serialize_episode(r) for r in episodes],
            out_path,
            project_id,
        )
    except RuntimeError as exc:
        _task_logger.exception(
            f"[studio] remotion render failed id={project_id}"
        )
        return jsonify({"success": False, "message": f"渲染失败:{exc}"}), 500

    # round-OPT-MONETIZE-v1 — record the rendering action so the
    # inbound ``/api/usage/quota`` envelope reflects the new
    # ``used`` count on the next /api/studio/projects/<id>/render
    # attempt without a 60-second polling lag. ``log_action``
    # internally swallows the underlying ``_log_usage`` exception
    # with a warning log so it never raises a 5xx here.
    log_action(user_id, "studio_render")

    url = f"/api/studio/render/{project_id}/render.mp4"
    return jsonify(
        {
            "success": True,
            "data": {
                "url": url,
                "captions_ass": f"/api/studio/render/{project_id}/captions.ass",
                "captions_srt": f"/api/studio/render/{project_id}/captions.srt",
                "duration": manifest["duration"],
                "width": manifest["width"],
                "height": manifest["height"],
            },
        }
    ), 200


def _render_via_remotion(
    project: dict,
    episodes: list[dict],
    out_path: str,
    project_id: int,
) -> dict[str, Any]:
    """Render via the Remotion Node bridge (React → MP4).

    Spawns ``node sau_web/frontend/remotion_studio/render.mjs`` with a
    JSON payload on stdin. The bridge uses ``@remotion/bundler`` +
    ``@remotion/renderer`` to bundle the React composition headlessly
    and emit an MP4 + sibling .srt/.ass subtitle files. Returns a
    manifest dict parsed from the bridge's single-line JSON stdout.

    We deliberately do NOT use ``npx`` for the spawn — ``npx`` will
    prompt ``Ok to proceed? (y)`` on a cold cache and hang in a
    non-interactive server shell. ``node`` (the binary) is in PATH on
    the deploy image; if it isn't, the spawn raises ``FileNotFoundError``
    which the caller surfaces as a 500.

    The default render path is Remotion via this bridge — pure ESM
    Node script, no npx, no global npm packages, no per-call env
    switch. ``SAU_STUDIO_RENDERER`` no longer exists; the previous
    `=remotion` / `=moviepy` / `=hyperframes` tri-state was removed
    along with the MoviePy and Hyperframes backends in
    round-Video-Backgrounds-v1. If this section stops being the
    only render branch, the operator-runnable
    ``docs/dev/studio-renderer-ops.md`` needs a parallel update.
    """
    import sys as _sys

    repo_root = _os.path.dirname(
        _os.path.dirname(
            _os.path.dirname(_os.path.abspath(__file__))
        )
    )
    bridge = _os.path.join(
        repo_root, "sau_web", "frontend", "remotion_studio", "render.mjs"
    )
    if not _os.path.isfile(bridge):
        raise RuntimeError(f"找不到 Remotion 桥接脚本: {bridge}")

    # Honour an operator-overridden Node binary path (helpful for asdf /
    # nvm-managed environments where the global `node` is not the one
    # that owns `node_modules/`). Default to the env PATH lookup.
    node_bin = _os.environ.get("SAU_STUDIO_NODE_PATH") or "node"

    # Phase 2 — pre-compute scenes[] + backgroundUrls[] + overlay
    # opacity so the Remotion bridge can render Pexels-backed cards.
    # The scene order MUST match what `sau_web/frontend/remotion_studio/
    # render.mjs::buildScenes()` produces from `episodes`; we mirror
    # that logic here so the parallel-arrays contract holds
    # (background_urls[i] sits behind scenes[i]). Drift between
    # Python and Node will be caught by the alignment tests in
    # `tests/test_studio_remotion_render.py`.
    precomputed_scenes = _build_scenes_for_render(project, episodes)
    background_urls = _resolve_scene_backgrounds(project, precomputed_scenes)
    # Round-Video-Backgrounds-v1 — parallel arrays for video clip
    # backgrounds (Remotion `<OffthreadVideo>`) and per-scene
    # voiceover (Remotion `<Audio>`). Same index-aligned contract
    # as `background_urls`; SceneCard consumes all three in lock-step.
    # Worst-case latency: a 7-scene storyboard = 7×~6 s TTS +
    # 7×~3 s Pexels Videos fetch = ~63 s wall time. Comfortably
    # under `_STUDIO_RENDER_TIMEOUT` default 600 s.
    background_videos = _resolve_scene_videos(project, precomputed_scenes)
    voiceover_urls = _resolve_scene_voiceovers(project, precomputed_scenes)
    overlay_opacity = (
        float(project.get("overlay_opacity"))
        if project.get("overlay_opacity") is not None
        else 0.5
    )

    payload = _json.dumps(
        {
            "project": {
                "id": project.get("id"),
                "title": project.get("title"),
                "synopsis": project.get("synopsis"),
                "style": project.get("style"),
                "overlay_opacity": overlay_opacity,
                # round-OPT-presets-v1 — the chosen Visual Style
                # Preset id is forwarded to the Remotion bridge so
                # render.mjs can resolve it against
                # ``presets.ts``. ``render_config`` is the FULL
                # JSONB dict so future per-renderer fields (custom
                # fonts, motion curves, vendor-specific opaques)
                # can ride this same payload without an ALTER
                # round-trip. ``None`` (legacy rows pre-PR-A)
                # defaults to the Classic preset at the Node
                # ``getSceneById`` layer.
                "render_config": project.get("render_config"),
            },
            # `scenes` is the canonical flat list (preferred by
            # render.mjs when present). `episodes` is preserved for
            # any caller / debug surface that wants the structured
            # tree form.
            "scenes": precomputed_scenes,
            "background_urls": background_urls,
            "background_videos": background_videos,
            "voiceovers": voiceover_urls,
            "overlay_opacity": overlay_opacity,
            "episodes": [
                {
                    "episode_no": ep.get("episode_no"),
                    "title": ep.get("title"),
                    "scenes": ep.get("scenes") or [],
                    "dialogues": ep.get("dialogues") or [],
                }
                for ep in episodes
            ],
        },
        ensure_ascii=False,
    )

    final_dir = _os.path.dirname(out_path)
    # Final destination mkdir BEFORE the tempdir block so a partial-write
    # condition (bridge crash before copy) leaves NO residue in the
    # user-visible tree. The bridge writes the artifacts to the tempdir
    # below; the user-facing `media/studio/<id>/` only gets populated via
    # the post-render shutil.copy step inside the `with` block.
    _os.makedirs(final_dir, exist_ok=True)

    # Step 5 long-term fix: write render.mp4 + captions.srt + captions.ass
    # to a fresh `tempfile.TemporaryDirectory()`, then shutil.copy them
    # to the final path. This makes the cross-UID mount-fs PermissionError
    # case obsolete across Compose / systemd / k8s in one shot — the
    # bridge writes to a user-owned tmpdir (always writable from the
    # Flask process) and the copy step lands the result on whatever
    # mount the operator configured. The `TemporaryDirectory` context
    # manager guarantees cleanup on both success AND raise paths
    # (Python 3.2+ standard semantics via the weakref-finalizer pattern),
    # so /tmp never accumulates `mkdtemp_render_*` residue across
    # failed renders.
    with _tempfile.TemporaryDirectory(prefix="sau_render_") as tmp_dir:
        tmp_out_path = _os.path.join(tmp_dir, _os.path.basename(out_path))
        try:
            proc = _subprocess.run(
                [node_bin, bridge, "--out", tmp_out_path],
                input=payload.encode("utf-8"),
                capture_output=True,
                timeout=_STUDIO_RENDER_TIMEOUT,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"node 未安装或不在 PATH (尝试调用 {node_bin}): {exc}"
            ) from exc
        except _subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"渲染超时 (>{_STUDIO_RENDER_TIMEOUT}s)"
            ) from exc

        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip() or "未知错误"
            raise RuntimeError(err)

        # POST-RENDER: copy all 3 artifacts to the final destination.
        # The bridge wrote render.mp4 + captions.srt + captions.ass into
        # the tmpdir (sharing tmp_dir as parent); we move them to the
        # user-visible path. shutil.copy reads from the user-owned tmp
        # and writes to dst. If the dst is on a cross-UID mount that
        # Flask can't write to, PermissionError surfaces here as a clean
        # RuntimeError for the route's 500 path — the operator's
        # troubleshooting row 14 still names this exact mode, but the
        # pre-Step-5 "bridge writes across the mount" failure surface
        # is gone.
        try:
            # `copy2` (not `copy`) preserves mtime/ctime/atime from the
            # tmp file — keeps the bridge's `writeFileSync` timestamp as
            # the canonical "render finished at" marker. This matters
            # for downstream ffprobe-based caching (mtime is the
            # canonical cache-invalidation key); `shutil.copy` would
            # reset mtime to NOW and silently invalidate caches that
            # would otherwise hit.
            _shutil.copy2(tmp_out_path, out_path)
            _shutil.copy2(
                _os.path.join(tmp_dir, "captions.srt"),
                _os.path.join(final_dir, "captions.srt"),
            )
            _shutil.copy2(
                _os.path.join(tmp_dir, "captions.ass"),
                _os.path.join(final_dir, "captions.ass"),
            )
        except PermissionError as exc:
            raise RuntimeError(
                f"跨权限级复制失败 (cross-UID copy to {final_dir}: {exc})"
            ) from exc

        try:
            result = _json.loads(proc.stdout.decode("utf-8"))
            return {
                "duration": result.get("duration", 0),
                "width": result.get("width", 1080),
                "height": result.get("height", 1920),
            }
        except _json.JSONDecodeError:
            # If bridge emitted non-JSON on stdout (e.g. Chromium log noise
            # snuck through), fall back to stderr-derived duration.
            return {
                "duration": 0,
                "width": 1080,
                "height": 1920,
            }


@bp.get("/api/studio/tts/health")
def tts_health():
    """Surface TTS engine availability to the operator UI.

    Round-Video-Backgrounds-v1: ``_resolve_scene_voiceovers`` silent-
    degrades when ``edge-tts`` CLI is missing (returns ``[None]*N``)
    so a render still produces an MP4 — but the MP4 is silent. The
    StudioDetailPage pill needs a real status surface so the operator
    knows WHY their rendered file lacks a voiceover, instead of
    scratching their head over a silent MP4.

    Auth: implicit via the global ``/api/*`` auth gate
    (``_current_user_id()`` returns the synthetic-admin id 0 when
    ``SAU_AUTH_ENABLED=false`` so the pill still works on dev /
    CI). Both branches produce the SAME envelope shape — the
    frontend only reads ``data.available`` / ``data.voice`` /
    ``data.install_hint``.

    Response shape:
      ``{
        available: bool,            # edge-tts CLI on PATH?
        voice: str,                 # resolved voice id (env-loaded or default)
        default_voice: str,         # constant; mirrors studio_tts._DEFAULT_VOICE
        install_hint: str,          # operator-side remediation text
        reason: str,                # populated when available=False
      }``

    Cost: a single ``shutil.which('edge-tts')`` syscall. No Pexels
    traffic, no subprocess, no DB hit. Safe to poll on every
    StudioDetailPage render.
    """
    from web_runner.studio_tts import _DEFAULT_VOICE, has_edge_tts_cli

    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    available = has_edge_tts_cli()
    install_hint = "安装 edge-tts：pip install edge-tts  （或加到 pyproject.toml 的 web extras）"
    if available:
        return jsonify(
            {
                "success": True,
                "data": {
                    "available": True,
                    "voice": _DEFAULT_VOICE,
                    "default_voice": _DEFAULT_VOICE,
                    "install_hint": install_hint,
                },
            }
        ), 200
    return jsonify(
        {
            "success": True,
            "data": {
                "available": False,
                "voice": _DEFAULT_VOICE,
                "default_voice": _DEFAULT_VOICE,
                "install_hint": install_hint,
                "reason": "未安装 edge-tts CLI",
            },
        }
    ), 200


@bp.get("/api/studio/render/<int:project_id>/<path:filename>")
def serve_render(project_id: int, filename: str):
    """Serve a rendered artifact (mp4 / ass / srt) for the project.

    Reuses the owner-isolation pattern: we re-check the project exists
    for the current user before handing back a file, so user A cannot
    fetch user B's renders by guessing an id.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    directory = _project_render_dir(project_id)
    # Guard against path traversal from the <path:filename> matcher.
    safe = _os.path.basename(filename)
    full = _os.path.join(directory, safe)
    if not _os.path.isfile(full):
        return jsonify({"success": False, "message": "文件不存在"}), 404

    return _send_file(full, mimetype=_MIME.get(_os.path.splitext(safe)[1], "application/octet-stream"))


_MEDIA_MIME = {
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
}


@bp.get("/api/studio/render/<int:project_id>/media/<path:filename>")
def serve_studio_media(project_id: int, filename: str):
    """Serve a downloaded Pexels Video MP4 or synthesized Edge-TTS MP3.

    Round-Video-Backgrounds-v1: SceneCard's `<OffthreadVideo src=...>`
    and `<Audio src=...>` ping this route during ``renderMedia`` to
    fetch the local-stage file. Same owner-isolation pattern as
    ``serve_render``: we re-check the project exists for the current
    user before handing back a file, so user A cannot fetch user B's
    generated MP4s by guessing an id.

    Path-traversal guard: `_os.path.basename(filename)` strips any
    `..` segments before the join so a malicious path can never
    escape :file:`media/studio/<id>/media/`. The 404 for non-existent
    files is uniform so existence-introspection via differing
    status codes is impossible.

    The 1h public cache mirrors `_IMAGE_FETCH_MAX_BYTES`'s Pexels /
    Pixabay photo-fetch contract — the file's content is stable
    across re-renders unless the operator re-uploads the body line
    that produced the MP3 (which busts the cache via the
    ``cache_index[code].prompt != body_text`` check inside
    `_resolve_scene_voiceovers`). Without this hint, headless
    Chromium inside Remotion re-fetches the same MP4 once per
    scene per render.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    directory = _media_dir_for(project_id)
    # Guard against path traversal: strip any parent-dir segments
    # so `../../../etc/passwd` collapses to `passwd` before the join.
    safe = _os.path.basename(filename)
    full = _os.path.join(directory, safe)
    if not _os.path.isfile(full):
        return jsonify({"success": False, "message": "文件不存在"}), 404

    mimetype = _MEDIA_MIME.get(_os.path.splitext(safe)[1], "application/octet-stream")
    return _send_file(
        full,
        mimetype=mimetype,
        # 1h cache: avoids the headless Chromium re-fetching the same
        # MP4 / MP3 once per scene per render. Disk-stored artefacts
        # don't change unless the operator edits the source body, so
        # 1h strikes the same trade-off as `/api/ai/images/fetch`.
        max_age=3600,
    )



# ═══════════════════════════════════════════════════════════════════════
#  AI generation — studio-ai-script-generation
# ═══════════════════════════════════════════════════════════════════════


@bp.post("/api/studio/projects/<int:project_id>/generate")
def generate_episodes(project_id: int):
    """Generate four-act episodes for a project via LLM streaming.

    Streams Server-Sent Events back to the client.  On the
    ``generation_done`` event the parsed episodes are persisted to
    ``studio_episodes`` inside a single transaction.

    Auth: implicit via the global ``/api/*`` auth gate.  Owner isolation
    is enforced via :func:`_load_project` (404 for non-owner / missing).
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    # Import here to avoid circular imports at module load time.
    from web_runner.studio_engine import generate_episodes_sse

    def stream():
        episodes_data: list[dict] | None = None
        try:
            for event in generate_episodes_sse(
                title=project["title"],
                synopsis=project["synopsis"],
                style=project.get("style"),
            ):
                yield event
                # Capture the parsed episodes from the generation_done event
                # so we can persist them after the stream finishes.
                if event.startswith("event: generation_done"):
                    try:
                        data = json.loads(event.split("data: ", 1)[1])
                        episodes_data = data.get("episodes")
                    except (json.JSONDecodeError, IndexError):
                        episodes_data = None
        except Exception as exc:  # noqa: BLE001 — route-level safety net
            _task_logger.exception(
                f"[studio] generate stream failed id={project_id}"
            )
            yield f"event: error\ndata: {json.dumps({'message': str(exc)}, ensure_ascii=False)}\n\n"
            return

        if episodes_data:
            _persist_generated_episodes(project_id, user_id, episodes_data)

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _persist_generated_episodes(
    project_id: int,
    user_id: int,
    episodes_data: list[dict],
) -> None:
    """Persist AI-generated episodes atomically.

    Filters invalid acts, assigns ``episode_no`` starting from
    ``MAX(episode_no) + 1``, inserts the rows, and bumps the parent
    project's ``updated_at``.  Any exception is logged and swallowed
    so the SSE stream already completed does not turn into a 500.
    """
    db = get_database()
    now = _now_iso()
    try:
        with db.transaction() as tx:
            max_row = tx.fetch_one(
                "SELECT COALESCE(MAX(episode_no), 0) AS mx "
                "FROM studio_episodes WHERE project_id = ?",
                (project_id,),
            )
            base_no = int(max_row["mx"]) if max_row else 0

            for i, ep in enumerate(episodes_data):
                act = (ep.get("act") or "").strip()
                if act not in _VALID_ACTS:
                    continue
                title = (ep.get("title") or "").strip() or "未命名"
                scenes = ep.get("scenes") if isinstance(ep.get("scenes"), list) else []
                dialogues = ep.get("dialogues") if isinstance(ep.get("dialogues"), list) else []
                tx.execute(
                    "INSERT INTO studio_episodes "
                    "(project_id, episode_no, act, title, scenes_json, "
                    "dialogues_json, status, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)",
                    (
                        project_id,
                        base_no + i + 1,
                        act,
                        title,
                        json.dumps(scenes, ensure_ascii=False, separators=(",", ":")),
                        json.dumps(dialogues, ensure_ascii=False, separators=(",", ":")),
                        now,
                    ),
                )

            tx.execute(
                "UPDATE studio_projects SET updated_at = ? "
                "WHERE id = ? AND owner_user_id = ?",
                (now, project_id, user_id),
            )
        _task_logger.info(
            f"[studio] generated episodes persisted id={project_id} "
            f"count={len(episodes_data)}"
        )
    except Exception as exc:  # noqa: BLE001
        _task_logger.exception(
            f"[studio] episodes persist failed id={project_id}: {exc}"
        )


# ═══════════════════════════════════════════════════════════════════════
#  Canvas endpoints — studio-whiteboard (per spec.md in
#  openspec/changes/studio-whiteboard/specs/canvas-editor/spec.md)
# ═══════════════════════════════════════════════════════════════════════


@bp.get("/api/studio/projects/<int:project_id>/canvas")
def get_canvas(project_id: int):
    """Lazy-load a project's stored canvas data.

    Owner-isolated via :func:`_load_project`. Returns the stored
    TldrawSnapshot dict (or null if unset). The server is
    **schema-version-agnostic**: the entire tldraw internal
    structure (``schema`` field, ``store.records`` shape types,
    bindings, future fields) is opaque storage. No schema
    inspection or migration is performed server-side — that is
    the client-side tldraw instance's responsibility on load.

    Kept separate from ``GET /api/studio/projects/{id}`` to
    avoid bloating the project detail payload with up to
    ``_STUDIO_CANVAS_MAX_SIZE`` (10 MiB) of tldraw JSON on every
    project page load (per design.md Decision #7).
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401
    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404
    db = get_database()
    row = db.fetch_one(
        "SELECT canvas_data FROM studio_projects WHERE id = ? AND owner_user_id = ?",
        (project_id, user_id),
    )
    raw = row.get("canvas_data") if row else None
    return jsonify(
        {"success": True, "data": {"canvas_data": _serialize_canvas(raw)}}
    ), 200


@bp.patch("/api/studio/projects/<int:project_id>/canvas")
def save_canvas(project_id: int):
    """Save canvas data for a project.

    Body: ``{ canvas_data: <TldrawSnapshot dict> | null }``. Owner
    isolation enforced via :func:`_load_project` (404 for
    non-owner). The server's only validation is per
    :func:`_validate_canvas_payload`:
      * ``canvas_data`` MUST be a JSON object or null
      * UTF-8 byte size MUST be <= ``_STUDIO_CANVAS_MAX_SIZE``

    The server does NOT inspect, validate, or transform the
    tldraw internal structure (any ``schema`` version, any record
    type, any future field is accepted unchanged). On success,
    ``updated_at`` is bumped and the new timestamp is returned.
    """
    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401
    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404

    payload = request.get_json(silent=True) or {}
    if "canvas_data" not in payload:
        return jsonify({"success": False, "message": "canvas_data 必填"}), 400

    canvas_data = payload["canvas_data"]
    stored_value, err, err_status = _validate_canvas_payload(canvas_data)
    if err is not None:
        return jsonify({"success": False, "message": err}), err_status

    now = _now_iso()
    db = get_database()
    db.execute(
        "UPDATE studio_projects SET canvas_data = ?, updated_at = ? "
        "WHERE id = ? AND owner_user_id = ?",
        (stored_value, now, project_id, user_id),
    )
    _task_logger.info(
        f"[studio] canvas saved id={project_id} owner={user_id} "
        f"size={len(stored_value) if stored_value else 0}B"
    )
    return jsonify(
        {"success": True, "data": {"id": project_id, "updated_at": now}}
    ), 200
