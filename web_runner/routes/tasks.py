"""Task management routes (PR2: dialect-aware Database)."""
from __future__ import annotations

from datetime import datetime

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
