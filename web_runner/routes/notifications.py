"""Notification center API (openspec/changes/webhook-notifications).

GET  /api/notifications        -> list (pagination + type filter)
GET  /api/notifications/unread -> unread count
POST /api/notifications/mark-read -> mark read (ids or all)
GET  /api/notifications/sse    -> SSE push of new notifications
"""

from __future__ import annotations

import json
import time

from flask import Blueprint, Response, jsonify, request

from web_runner.notifications import (
    db_count_unread,
    db_list_notifications,
    db_mark_read,
    subscribe,
    unsubscribe,
)
from web_runner.utils import _MAX_SSE_CONNECTIONS

bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")

_SSE_TIMEOUT = 300
_SSE_MAX_CONNECTIONS = _MAX_SSE_CONNECTIONS


def _authenticate() -> int | None:
    from web_runner.routes.auth import _is_auth_enabled, authenticate_sse_request

    if _is_auth_enabled():
        return authenticate_sse_request(request)
    return 0


@bp.get("")
def list_notifications():
    event_type = request.args.get("type")
    try:
        page = int(request.args.get("page", 1))
        page_size = int(request.args.get("page_size", 20))
    except ValueError:
        return jsonify({"success": False, "message": "invalid pagination"}), 400
    rows = db_list_notifications(event_type=event_type, page=page, page_size=page_size)
    return jsonify({"success": True, "data": rows, "unread": db_count_unread()})


@bp.get("/unread")
def unread_count():
    return jsonify({"success": True, "data": {"unread": db_count_unread()}})


@bp.post("/mark-read")
def mark_read():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")
    if ids is not None and not isinstance(ids, list):
        return jsonify({"success": False, "message": "ids must be a list"}), 400
    remaining = db_mark_read(ids if ids else None)
    return jsonify({"success": True, "data": {"unread": remaining}})


@bp.get("/sse")
def notifications_sse():
    uid = _authenticate()
    if uid is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    q = subscribe()

    def generate():
        yield f": {' ' * 4096}\n\n"
        start = time.time()
        try:
            while True:
                if time.time() - start > _SSE_TIMEOUT:
                    yield f"event: error\ndata: {json.dumps({'message': 'SSE timeout'})}\n\n"
                    break
                try:
                    item = q.get(timeout=2)
                    yield f"event: {item['event']}\ndata: {json.dumps(item['data'])}\n\n"
                except Exception:  # noqa: BLE001 — queue.Empty or timeout
                    yield f"event: ping\ndata: {json.dumps({'ts': time.time()})}\n\n"
        finally:
            unsubscribe(q)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
