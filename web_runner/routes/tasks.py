"""Task management routes."""
from __future__ import annotations

import json
from datetime import datetime

from flask import Blueprint, Response, jsonify, request

from web_runner.db import db_lock, get_connection
from web_runner.utils import (
    DEFAULT_LOG_LIST_LIMIT,
    DEFAULT_TASK_LIST_LIMIT,
    MAX_LOG_LIST_LIMIT,
    MAX_TASK_LIST_LIMIT,
    _clamp_limit,
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
    subscribe_logs,
    task_executor,
    unsubscribe_logs,
)

bp = Blueprint("tasks", __name__)


@bp.get("/api/tasks")
def list_tasks():
    limit = _clamp_limit(
        request.args.get("limit", type=int),
        DEFAULT_TASK_LIST_LIMIT,
        MAX_TASK_LIST_LIMIT,
    )
    offset = max(0, request.args.get("offset", 0, type=int) or 0)
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
    try:
        argv = json.loads(stored_argv)
    except (json.JSONDecodeError, TypeError):
        return jsonify({"success": False, "message": "Cannot retry: invalid stored argv"}), 400
    new_task_id = _new_task_id("retry")
    _db_insert_task(
        task_id=new_task_id, status="pending",
        platform=task.get("platform", "") or "",
        action=f"retry-{task.get('action', 'unknown')}",
        account=task.get("account", "") or "",
        created=datetime.now().isoformat(timespec="seconds"), argv=argv,
    )
    task_executor.submit(_run_sau, new_task_id, argv)
    log(f"[{new_task_id}] retry of {task_id}: sau {' '.join(argv)}")
    return jsonify({"success": True, "data": {"task_id": new_task_id}})


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
    with db_lock:
        with get_connection() as conn:
            conn.execute("DELETE FROM tasks WHERE task_id = ?", (task_id,))
            conn.commit()
    log(f"[tasks] deleted task: {task_id}")
    return jsonify({"success": True, "message": f"Task {task_id} deleted"})


@bp.post("/api/tasks/clear")
def clear_tasks():
    payload = request.get_json(silent=True) or {}
    status_filter = payload.get("status", ["success", "failed", "error"])
    if isinstance(status_filter, str):
        status_filter = [status_filter]
    placeholders = ",".join("?" for _ in status_filter)
    with db_lock:
        with get_connection() as conn:
            cursor = conn.execute(f"DELETE FROM tasks WHERE status IN ({placeholders})", status_filter)
            deleted = cursor.rowcount
            conn.commit()
    log(f"[tasks] cleared {deleted} tasks with status: {status_filter}")
    return jsonify({"success": True, "data": {"deleted": deleted}})


@bp.post("/api/tasks/add")
def add_task():
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    action = payload.get("action")
    account = payload.get("account")
    argv = payload.get("argv")
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
    scheduled_at = payload.get("scheduled_at") or payload.get("schedule")
    title = payload.get("title")
    _db_insert_task(
        task_id=task_id, status="pending", platform=platform,
        action=action, account=account,
        created=datetime.now().isoformat(timespec="seconds"), argv=argv,
        scheduled_at=scheduled_at, title=title,
    )
    # Immediate run unless purely scheduled far-future only — still enqueue worker;
    # CLI handles schedule flag when present in argv.
    task_executor.submit(_run_sau, task_id, argv)
    log(f"[{task_id}] manual task: sau {' '.join(argv)}")
    return jsonify({"success": True, "data": {"task_id": task_id, "scheduled_at": scheduled_at}})


@bp.get("/api/logs")
def get_logs():
    after = request.args.get("after")
    task_id = request.args.get("task_id")
    limit = _clamp_limit(
        request.args.get("limit", type=int),
        DEFAULT_LOG_LIST_LIMIT,
        MAX_LOG_LIST_LIMIT,
    )
    offset = max(0, request.args.get("offset", 0, type=int) or 0)
    return jsonify(
        {
            "success": True,
            "data": _db_get_logs(after, task_id, limit=limit, offset=offset),
        }
    )


@bp.get("/api/logs/stream")
def stream_logs():
    """SSE live log feed — replaces aggressive REST polling on Logs / FloatingLogs.

    Events:
      - ``ready`` — subscription accepted
      - ``log``   — ``{ts, message}``
    Heartbeats (``: ping``) every ~15s keep proxies from idling out.
    """
    import json as _json
    import queue as _queue

    try:
        q = subscribe_logs()
    except RuntimeError:
        return jsonify({"success": False, "message": "too many log stream subscribers"}), 503

    task_filter = (request.args.get("task_id") or "").strip() or None

    def generate():
        try:
            yield f"event: ready\ndata: {_json.dumps({'success': True})}\n\n"
            while True:
                try:
                    item = q.get(timeout=15)
                except _queue.Empty:
                    yield ": ping\n\n"
                    continue
                if task_filter and task_filter not in (item.get("message") or ""):
                    continue
                yield f"event: log\ndata: {_json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            unsubscribe_logs(q)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@bp.post("/api/tasks/reschedule")
def reschedule_task():
    payload = request.get_json(silent=True) or {}
    task_id = payload.get("task_id")
    new_scheduled_at = payload.get("new_scheduled_at") or payload.get("scheduled_at")
    if not task_id or not new_scheduled_at:
        return jsonify({"success": False, "message": "task_id and new_scheduled_at required"}), 400
    task = _db_get_task(task_id)
    if not task:
        return jsonify({"success": False, "message": f"Task not found: {task_id}"}), 404
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "UPDATE tasks SET scheduled_at = ? WHERE task_id = ?",
                (new_scheduled_at, task_id),
            )
            conn.commit()
    log(f"[tasks] reschedule {task_id} -> {new_scheduled_at}")
    return jsonify({"success": True, "data": {"task_id": task_id, "scheduled_at": new_scheduled_at}})


@bp.post("/api/tasks/copy")
def copy_task():
    payload = request.get_json(silent=True) or {}
    task_id = payload.get("task_id")
    new_scheduled_at = payload.get("new_scheduled_at") or payload.get("scheduled_at")
    if not task_id:
        return jsonify({"success": False, "message": "task_id required"}), 400
    task = _db_get_task(task_id)
    if not task:
        return jsonify({"success": False, "message": f"Task not found: {task_id}"}), 404
    stored_argv = task.get("argv")
    try:
        argv = json.loads(stored_argv) if stored_argv else None
    except (json.JSONDecodeError, TypeError):
        argv = None
    new_id = _new_task_id("copy")
    _db_insert_task(
        task_id=new_id,
        status="pending",
        platform=task.get("platform", "") or "",
        action=task.get("action", "copy") or "copy",
        account=task.get("account", "") or "",
        created=datetime.now().isoformat(timespec="seconds"),
        argv=argv,
    )
    if new_scheduled_at:
        with db_lock:
            with get_connection() as conn:
                conn.execute(
                    "UPDATE tasks SET scheduled_at = ? WHERE task_id = ?",
                    (new_scheduled_at, new_id),
                )
                conn.commit()
    if argv:
        task_executor.submit(_run_sau, new_id, argv)
    log(f"[tasks] copy {task_id} -> {new_id}")
    return jsonify({"success": True, "data": {"task_id": new_id}})


@bp.get("/api/tasks/scheduled")
def list_scheduled():
    start = request.args.get("from") or request.args.get("start")
    end = request.args.get("to") or request.args.get("end")
    sql = (
        "SELECT task_id, platform, account, action, status, created, scheduled_at, argv "
        "FROM tasks WHERE scheduled_at IS NOT NULL"
    )
    params: list = []
    if start:
        # Sargable ISO prefix compare (no substr on the column).
        sql += " AND scheduled_at >= ?"
        params.append(start[:10])
    if end:
        sql += " AND scheduled_at < ?"
        params.append(end[:10])
    sql += " ORDER BY scheduled_at"
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(sql, params).fetchall()
    return jsonify({"success": True, "data": rows})


@bp.get("/api/tasks/stream")
def stream_tasks():
    """SSE task list snapshots for live UIs (replaces aggressive client polling).

    Events:
      - ``initial`` — first snapshot after connect
      - ``update``  — snapshot when status signature changes
      - ``done``    — no pending/running tasks (client may close)
    Heartbeats (``: ping``) keep proxies from idling out the socket.
    Connection ends after ~10 minutes or shortly after all tasks go terminal.
    """
    import time as _time

    def _status_sig(rows: list[dict]) -> str:
        # Cheap change detector: only re-emit when task status surface moves.
        parts = [
            f"{r.get('task_id')}|{r.get('status')}|{r.get('code')}|{(r.get('error') or '')[:80]}"
            for r in rows
        ]
        return "\n".join(parts)

    def generate():
        last_sig: str | None = None
        idle_terminal = 0
        # 300 × 2s ≈ 10 minutes max per connection
        for i in range(300):
            rows = _db_get_all_tasks(limit=100)
            has_running = any(
                (r.get("status") or "") in ("pending", "running") for r in rows
            )
            sig = _status_sig(rows)
            if sig != last_sig:
                last_sig = sig
                event = "initial" if i == 0 else "update"
                payload = json.dumps({"success": True, "data": rows}, ensure_ascii=False)
                yield f"event: {event}\ndata: {payload}\n\n"
            else:
                yield ": ping\n\n"

            if not has_running:
                idle_terminal += 1
                # Two consecutive terminal ticks after the first snapshot → done.
                if idle_terminal >= 2 and i > 0:
                    yield f"event: done\ndata: {json.dumps({'success': True})}\n\n"
                    break
            else:
                idle_terminal = 0
            _time.sleep(2)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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


@bp.get("/api/publish/history")
def publish_history():
    """Recent successful/failed uploads for operator timeline."""
    limit = request.args.get("limit", 20, type=int)
    limit = max(1, min(limit, 100))
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT task_id, platform, account, action, status, created, scheduled_at, title, error "
            "FROM tasks WHERE action LIKE 'upload%' OR action LIKE '%upload%' "
            "ORDER BY created DESC LIMIT ?",
            (limit,),
        ).fetchall()
        if not rows:
            rows = conn.execute(
                "SELECT task_id, platform, account, action, status, created, scheduled_at, title, error "
                "FROM tasks ORDER BY created DESC LIMIT ?",
                (limit,),
            ).fetchall()
    items = []
    for r in rows:
        items.append({
            "id": r["task_id"],
            "task_id": r["task_id"],
            "platform": r.get("platform"),
            "account": r.get("account"),
            "action": r.get("action"),
            "status": r.get("status"),
            "title": r.get("title") or r.get("action"),
            "created_at": r.get("created"),
            "scheduled_at": r.get("scheduled_at"),
            "error": r.get("error"),
        })
    return jsonify({"success": True, "data": items})
