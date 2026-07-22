"""Notifications test endpoints for local shell."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from web_runner.utils import log

bp = Blueprint("notifications", __name__)


@bp.post("/api/notifications/test-health")
def test_health():
    payload = request.get_json(silent=True) or {}
    channel = payload.get("channel") or "email"
    log(f"[notifications] test-health channel={channel} (local shell no-op)")
    return jsonify({
        "success": True,
        "message": f"local shell: {channel} test acknowledged (no external send)",
        "data": {"channel": channel, "sent": False},
    })
