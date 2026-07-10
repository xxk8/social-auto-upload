"""Task management routes (PR2: dialect-aware Database)."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

from web_runner.db import get_database
from web_runner.utils import (
    _db_get_all_tasks,
    _db_get_error_events,
    _db_get_logs,
    _db_get_task,
    _db_insert_task,
    _new_task_id,
    _run_sau,
    _scheduled_timers,
    _timer_lock,
    log,
    task_executor,
)

bp = Blueprint("tasks", __name__)


@bp.get("/api/tasks")
def list_tasks():
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", 0, type=int)
    rows = _db_get_all_tasks(limit=limit, offset=offset)
    return jsonify({"success": True, "data": rows})


@bp.post("/api/tasks/retry")
def retry_task():
    payload = request.get_json(silent=True) or {}
    task_id = payload.get("task_id")
    if not task_id:
        return jsonify({"success": False, "message": "task_id is required"}), 400
    task = _db_get_task(task_id)
    if not task:
        return jsonify({"success": False, "message": f"Task not found: {task_id}"}), 404
    stored_argv = task.get("argv")
    if not stored_argv:
        return jsonify({"success": False, "message": "Cannot retry: no stored argv for this task"}), 400
    argv = _parse_stored_argv(stored_argv)
    if argv is None:
        return jsonify({"success": False, "message": "Cannot retry: invalid stored argv"}), 400
    new_task_id = _new_task_id("retry")
    _db_insert_task(
        task_id=new_task_id, status="pending",
        platform=task.get("platform", "") or "",
        action=f"retry-{task.get('action', 'unknown')}",
        account=task.get("account", "") or "",
        created=datetime.now().isoformat(timespec="seconds"), argv=argv,
    )
    # Use new executor with retry priority
    try:
        from web_runner.executor import PRIORITY_RETRY, submit_task
        platform = argv[0] if argv and not argv[0].startswith("-") else ""
        submit_task(_run_sau, new_task_id, argv, priority=PRIORITY_RETRY, platform=platform, task_id=new_task_id)
    except Exception:
        task_executor.submit(_run_sau, new_task_id, argv)
    log(f"[{new_task_id}] retry of {task_id}: sau {' '.join(argv)}")
    return jsonify({"success": True, "data": {"task_id": new_task_id}})


def _parse_stored_argv(stored_argv: str) -> list[str] | None:
    """Parse a stored `tasks.argv` JSON column back into a list[str].

    On SQLite `stored_argv` is a JSON-encoded string; on Postgres the
    same column is JSONB and the value already arrives as dict/list (when
    loaded via `db.json_load`). The helper handles both shapes so the
    route stays dialect-agnostic.
    """
    db = get_database()
    value = db.json_load(stored_argv)
    if isinstance(value, list):
        return [str(v) for v in value]
    return None


@bp.post("/api/tasks/delete")
def delete_task():
    payload = request.get_json(silent=True) or {}
    task_id = payload.get("task_id")
    if not task_id:
        return jsonify({"success": False, "message": "task_id is required"}), 400
    task = _db_get_task(task_id)
    if not task:
        return jsonify({"success": False, "message": f"Task not found: {task_id}"}), 404
    if task.get("status") in ("pending", "running"):
        return jsonify({"success": False, "message": "Cannot delete running task"}), 400
    with _timer_lock:
        timer = _scheduled_timers.pop(task_id, None)
    if timer:
        timer.cancel()
    db = get_database()
    db.execute("DELETE FROM tasks WHERE task_id = ?", (task_id,))
    log(f"[tasks] deleted task: {task_id}")
    return jsonify({"success": True, "message": f"Task {task_id} deleted"})


@bp.post("/api/tasks/clear")
def clear_tasks():
    payload = request.get_json(silent=True) or {}
    status_filter = payload.get("status", ["success", "failed", "error"])
    if isinstance(status_filter, str):
        status_filter = [status_filter]
    placeholders = ",".join("?" for _ in status_filter)
    db = get_database()
    deleted = db.execute(
        f"DELETE FROM tasks WHERE status IN ({placeholders})",
        tuple(status_filter),
    )
    log(f"[tasks] cleared {deleted} tasks with status: {status_filter}")
    return jsonify({"success": True, "data": {"deleted": deleted}})


@bp.post("/api/tasks/add")
def add_task():
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    action = payload.get("action")
    account = payload.get("account")
    argv = payload.get("argv")
    priority = payload.get("priority", 1)  # PRIORITY_NORMAL default
    scheduled_at = payload.get("scheduled_at")
    if not platform or not action or not account:
        return jsonify({"success": False, "message": "platform, action, account are required"}), 400
    if not argv:
        argv = [platform, action, "--account", account]
        if action == "upload-video":
            title = payload.get("title", "Untitled")
            file_path = payload.get("file")
            if not file_path:
                return jsonify({"success": False, "message": "file is required for upload-video"}), 400
            argv += ["--title", title, "--file", file_path]
        elif action == "upload-note":
            title = payload.get("title", "Untitled")
            images = payload.get("images", [])
            if not images:
                return jsonify({"success": False, "message": "images are required for upload-note"}), 400
            argv += ["--title", title, "--images", *images]
    task_id = _new_task_id(action)
    status = "scheduled" if scheduled_at else "pending"
    _db_insert_task(
        task_id=task_id, status=status, platform=platform,
        action=action, account=account,
        created=datetime.now().isoformat(timespec="seconds"), argv=argv,
    )
    # Set priority and scheduled_at if provided
    if scheduled_at or priority != 1:
        db = get_database()
        db.execute(
            "UPDATE tasks SET priority = ?, scheduled_at = ? WHERE task_id = ?",
            (priority, scheduled_at, task_id),
        )

    if scheduled_at:
        try:
            from web_runner.utils import _schedule_task
            parsed = datetime.fromisoformat(scheduled_at)
            _schedule_task(task_id, argv, parsed)
        except Exception as exc:
            log(f"[{task_id}] warning: failed to schedule: {exc}")
            # Fall back to immediate execution
            task_executor.submit(_run_sau, task_id, argv)
    else:
        # Use new executor with priority
        try:
            from web_runner.executor import submit_task
            submit_task(_run_sau, task_id, argv, priority=priority, platform=platform, task_id=task_id)
        except Exception:
            task_executor.submit(_run_sau, task_id, argv)
    log(f"[{task_id}] manual task: sau {' '.join(argv)}")
    return jsonify({"success": True, "data": {"task_id": task_id}})


@bp.post("/api/tasks/reschedule")
def reschedule_task():
    """Reschedule a pending task to a new time."""
    payload = request.get_json(silent=True) or {}
    task_id = payload.get("task_id")
    new_scheduled_at = payload.get("new_scheduled_at")

    if not task_id:
        return jsonify({"success": False, "message": "task_id is required"}), 400
    if not new_scheduled_at:
        return jsonify({"success": False, "message": "new_scheduled_at is required"}), 400

    task = _db_get_task(task_id)
    if not task:
        return jsonify({"success": False, "message": f"Task not found: {task_id}"}), 404
    if task.get("status") != "pending":
        return jsonify({"success": False, "message": "Can only reschedule pending tasks"}), 409

    try:
        new_dt = datetime.fromisoformat(new_scheduled_at)
    except ValueError:
        return jsonify({"success": False, "message": "Invalid datetime format. Use ISO 8601."}), 400

    if new_dt < datetime.now():
        return jsonify({"success": False, "message": "Cannot schedule in the past"}), 400

    db = get_database()
    db.execute(
        "UPDATE tasks SET scheduled_at = ?, status = 'scheduled' WHERE task_id = ?",
        (new_dt.isoformat(timespec="seconds"), task_id),
    )

    # Re-schedule with timer
    from web_runner.utils import _schedule_task
    stored_argv = task.get("argv")
    argv = _parse_stored_argv(stored_argv) if stored_argv else []
    if argv:
        _schedule_task(task_id, argv, new_dt)

    log(f"[{task_id}] rescheduled to {new_dt.isoformat()}")
    return jsonify({
        "success": True,
        "data": {
            "task_id": task_id,
            "scheduled_at": new_dt.isoformat(timespec="seconds"),
        },
    })


@bp.post("/api/tasks/copy")
def copy_task():
    """Clone a pending/scheduled task to a new scheduled-at time.

    Used by the calendar's right-click "复制到另一天" action. The new
    task inherits the source task's exact argv (platform / action /
    account / media paths), so the duplicate is byte-for-byte faithful —
    only `task_id`, `created`, and `scheduled_at` differ.
    """
    payload = request.get_json(silent=True) or {}
    task_id = payload.get("task_id")
    new_scheduled_at = payload.get("new_scheduled_at")
    if not task_id:
        return jsonify({"success": False, "message": "task_id is required"}), 400
    if not new_scheduled_at:
        return jsonify({"success": False, "message": "new_scheduled_at is required"}), 400

    task = _db_get_task(task_id)
    if not task:
        return jsonify({"success": False, "message": f"Task not found: {task_id}"}), 404
    if task.get("status") not in ("pending", "scheduled"):
        return jsonify({"success": False, "message": "Can only copy pending/scheduled tasks"}), 409

    try:
        new_dt = datetime.fromisoformat(new_scheduled_at)
    except ValueError:
        return jsonify({"success": False, "message": "Invalid datetime format. Use ISO 8601."}), 400
    if new_dt < datetime.now():
        return jsonify({"success": False, "message": "Cannot schedule in the past"}), 400

    stored_argv = task.get("argv")
    argv = _parse_stored_argv(stored_argv) if stored_argv else None
    if argv is None:
        # Fallback: reconstruct a minimal argv if the stored JSON was lost.
        argv = [task.get("platform", "") or "", task.get("action", "") or "",
                "--account", task.get("account", "") or ""]

    new_task_id = _new_task_id("copy")
    _db_insert_task(
        task_id=new_task_id, status="scheduled",
        platform=task.get("platform", "") or "",
        action=task.get("action", "") or "",
        account=task.get("account", "") or "",
        created=datetime.now().isoformat(timespec="seconds"), argv=argv,
    )
    db = get_database()
    db.execute(
        "UPDATE tasks SET scheduled_at = ? WHERE task_id = ?",
        (new_dt.isoformat(timespec="seconds"), new_task_id),
    )

    from web_runner.utils import _schedule_task
    _schedule_task(new_task_id, argv, new_dt)

    log(f"[{new_task_id}] copied from {task_id} to {new_dt.isoformat()}")
    return jsonify({
        "success": True,
        "data": {
            "task_id": new_task_id,
            "source_task_id": task_id,
            "scheduled_at": new_dt.isoformat(timespec="seconds"),
        },
    })


@bp.get("/api/tasks/scheduled")
def list_scheduled_tasks():
    """List tasks scheduled within a date range."""
    from_date = request.args.get("from")
    to_date = request.args.get("to")

    db = get_database()
    conditions = ["scheduled_at IS NOT NULL", "status IN ('pending', 'scheduled')"]
    params: list = []

    if from_date:
        conditions.append("scheduled_at >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("scheduled_at <= ? || 'z'")
        params.append(to_date)

    where = " AND ".join(conditions)
    rows = db.fetch_all(
        f"SELECT task_id, platform, account, action, status, scheduled_at, created "
        f"FROM tasks WHERE {where} ORDER BY scheduled_at",
        tuple(params),
    )

    tasks = []
    for row in rows:
        # Extract title from argv if available
        title = ""
        argv_raw = row.get("argv") if "argv" in row else None
        if argv_raw:
            argv = _parse_stored_argv(argv_raw)
            if argv:
                for i, arg in enumerate(argv):
                    if arg == "--title" and i + 1 < len(argv):
                        title = argv[i + 1]
                        break

        tasks.append({
            "task_id": row["task_id"],
            "platform": row.get("platform", ""),
            "account": row.get("account", ""),
            "title": title,
            "status": row.get("status", ""),
            "scheduled_at": row.get("scheduled_at"),
        })

    return jsonify({"success": True, "data": {"tasks": tasks}})


# ── /api/publish/history ──────────────────────────────────────────────
# Operator-AboutTab Timeline feed (Components/ui/timeline.tsx). Filters
# the ``tasks`` table to upload actions only — login / cookie-validation
# tasks are not user-facing "publish" outcomes and would otherwise pollute
# the modal's 发布历史 pane. Reshapes each row to TimelineItemData so the
# React frontend consumes it byte-identical to the legacy
# MOCK_PUBLISH_HISTORY constant.
#
# Ponytail-ultra: NO auth gate at this route. Parity with
# ``/api/tasks`` and ``/api/tasks/scheduled`` (lightweight read). The
# PreferencesDialog that consumes this is route-level auth-gated at
# ``/dashboard/*`` via the global ``/api/*`` whitelist in
# ``web_runner/__init__.py`` when ``SAU_AUTH_ENABLED=true``. If a
# future privacy requirement emerges (per-user publish history
# isolation), add a ``user_id`` filter here + a column on ``tasks``
# (see web_runner/routes/__init__.py for the registration surface).


@bp.get("/api/publish/history")
def list_publish_history():
    """Return recent publish events for the operator AboutTab Timeline.

    Filters: ``action IN ('upload-video', 'upload-note')`` only. Newest
    first, capped by ``limit`` (default 20, max 100). Each row is
    remapped to ``TimelineItemData`` shape:

      • ``id``          = ``tasks.task_id``
      • ``date``        = ISO datetime → ``"YYYY-MM-DD HH:MM"`` (matches
                          the legacy mock format so a row's date column
                          renders identically before/after the cutover —
                          zero visual churn for an existing user)
      • ``title``       = ``argv[--title]`` value OR ``--file`` basename
                          stem OR ``<action>-<short task_id>`` placeholder
      • ``platform``    = ``tasks.platform``
      • ``status``      = lifecycle→Timeline 3-state mapping (see
                          ``_timeline_status`` helper)
      • ``url``         = ``argv[--url|--video-url]`` value OR
                          ``tasks.result`` JSON's ``url`` / ``share_url``
      • ``description`` = ``"账号: <account>·<error|ok|等待>"``
                          so the user sees WHAT happened AND which
                          account performed it without grepping logs
    """
    raw_limit = request.args.get("limit", default=20, type=int)
    # Defensive clamp: limit must be positive int, cap at 100 so an
    # accidental ``?limit=999999`` doesn't pull 10k rows into the modal.
    # No `or 20` guard — ``request.args.get(..., default=20, type=int)``
    # already returns 20 for any unparseable / missing value, and
    # adding `or 20` would MASK a legitimate ``?limit=0`` (treated as
    # default via the `or`) instead of floored-to-1 as the test
    # contract requires.
    limit = max(1, min(raw_limit, 100))
    db = get_database()
    rows = db.fetch_all(
        "SELECT task_id, created, platform, action, account, status, "
        "argv, result, error FROM tasks "
        "WHERE action IN ('upload-video', 'upload-note') "
        "ORDER BY created DESC, task_id DESC LIMIT ?",
        (limit,),
    )
    items: list[dict] = []
    for row in rows:
        argv = _parse_stored_argv(row.get("argv") or "") or []
        raw_status = row.get("status", "")
        timeline_status = _timeline_status(raw_status)
        items.append({
            "id": row["task_id"],
            "date": _format_timeline_date(row.get("created")),
            "title": _title_from_argv(argv, row.get("action", ""), row["task_id"]),
            "platform": row.get("platform") or "",
            "status": timeline_status,
            "url": _url_from_row(row, argv, db) or None,
            "description": _build_description(row, timeline_status),
        })
    return jsonify({"success": True, "data": items})


def _title_from_argv(argv: list[str], action: str, task_id: str) -> str:
    """Push the 3-step title-extraction chain into a named helper.

    Priority:
      1. ``--title <value>`` (operator-chosen title)
      2. ``--file <path>`` basename stem (recognizable video filename)
      3. ``<action>#<short task_id>`` (last-resort placeholder)

    Index safety: every ``--key`` lookup is paired with
    ``i + 1 < len(argv)`` so a trailing-flag argv (e.g. ``[--title]``
    with no following value) does NOT IndexError and silently falls
    through to the next priority level.
    """
    for i, arg in enumerate(argv):
        if arg == "--title" and i + 1 < len(argv) and argv[i + 1].strip():
            return argv[i + 1]
    for i, arg in enumerate(argv):
        if arg == "--file" and i + 1 < len(argv):
            stem = Path(argv[i + 1]).stem
            if stem:
                return stem
    return f"{action or 'task'}#{task_id[-6:]}"


def _url_from_row(row: dict, argv: list[str], db) -> str:
    """Resolve the upstream-published URL for a successful task.

    Fallback chain: ``argv --url|--video-url`` value (rare, older CLI
    flags) → ``tasks.result`` JSON's ``url`` / ``share_url`` (modern
    path; ``_store_result`` writes this when the upstream CLI emits
    ``[UPLOAD_RESULT]<json>`` lines). Defensive against malformed
    ``result`` blobs (non-JSON, non-dict, missing keys) — any failure
    collapses to ``""`` so the Timeline's optional ``url`` field stays
    forward-compatible (Timeline renders no link when empty).

    The ``db`` parameter is hoisted from the route's outer
    ``get_database()`` call so this hot-path helper doesn't
    re-instantiate per-row (a 100-row response previously triggered
    100 redundant ``get_database()`` calls).
    """
    for i, arg in enumerate(argv):
        if arg in ("--url", "--video-url") and i + 1 < len(argv):
            return argv[i + 1]
    raw = row.get("result") or ""
    if raw:
        try:
            # Project-wide invariant: every Database implementation
            # exposes ``json_load`` (see web_runner/utils.py ::
            # _LOG_ERROR_EVENTS, web_runner/routes/tasks.py ::
            # _parse_stored_argv). No hasattr-fallback drift needed.
            loaded = db.json_load(raw)
            if isinstance(loaded, dict):
                return loaded.get("url") or loaded.get("share_url") or ""
        except (ValueError, TypeError):
            pass
    return ""


def _timeline_status(raw: str) -> str:
    """Map the broader task-lifecycle status set onto Timeline's
    3-state contract (``success | failed | pending``).

      success / cookie_valid          → success
      failed  / error / cookie_invalid → failed
      pending / scheduled / running,
      anything unknown                → pending

    Defensive default to ``pending`` (safe UI — neither green check
    nor red x) so a future schema drift surfaces as a yellow dot,
    not a confusing exception in the modal.
    """
    if raw in ("success", "cookie_valid"):
        return "success"
    if raw in ("failed", "error", "cookie_invalid"):
        return "failed"
    return "pending"


def _format_timeline_date(iso: str) -> str:
    """Render the ISO ``created`` datetime into the
    ``"YYYY-MM-DD HH:MM"`` format the Timeline's mock data uses, so a
    row's date column renders identically before/after the mock→API
    cutover. Empty input → empty string. Anything that fails to slice
    keeps the raw ISO (Timeline accepts raw ISO per its contract).
    """
    if not iso:
        return ""
    try:
        return iso.replace("T", " ")[:16]
    except (AttributeError, TypeError):
        return iso


def _build_description(row: dict, status: str) -> str:
    """Compose the 1-line description rendered below each title.

    Roles:
      • success: ``"账号: <account>"`` — credit the account, no
        spammy "ok" duplicate of the status badge.
      • failed:  ``"账号: <account> · <error snippet>"`` so the
        user sees WHAT went wrong without grepping logs.
      • pending: ``"账号: <account> · 等待执行"`` — same shape with a
        deterministic in-flight tag.
    Empty account → no leading prefix; the remainder still renders.
    """
    account = row.get("account") or ""
    parts: list[str] = [f"账号: {account}"] if account else []
    if status == "failed" and row.get("error"):
        err = (row.get("error") or "").replace("\n", " ").strip()
        if err:
            parts.append(err[:80])
    elif status == "pending":
        parts.append("等待执行")
    return " · ".join(parts) if parts else ""


@bp.get("/api/logs")
def get_logs():
    after = request.args.get("after")
    task_id = request.args.get("task_id")
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", 0, type=int)
    return jsonify({"success": True, "data": _db_get_logs(after, task_id, limit=limit, offset=offset)})


@bp.get("/api/error-events")
def get_error_events_route():
    platform = request.args.get("platform")
    account = request.args.get("account")
    action = request.args.get("action")
    exc_type = request.args.get("exc_type")
    after = request.args.get("after")
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", 0, type=int)
    return jsonify({
        "success": True,
        "data": _db_get_error_events(
            after=after, platform=platform, account=account,
            action=action, exc_type=exc_type, limit=limit, offset=offset,
        ),
    })
