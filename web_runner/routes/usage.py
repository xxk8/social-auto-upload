"""Usage quota — local shell reports unlimited daily counters.

Front-end: ``GET /api/usage/quota`` (studio + client.usage).
"""
from __future__ import annotations

from flask import Blueprint, jsonify

bp = Blueprint("usage", __name__)


@bp.get("/api/usage/quota")
def usage_quota():
    unlimited = {
        "limit": -1,
        "used": 0,
        "remaining": -1,
        "unlimited": True,
    }
    return jsonify({
        "success": True,
        "data": {
            "tier": "legacy",
            "day": None,
            "actions": {
                "upload_video": dict(unlimited),
                "upload_note": dict(unlimited),
                "ai_generate": dict(unlimited),
                "studio_render": dict(unlimited),
                "studio_generate": dict(unlimited),
                "inbox_download": dict(unlimited),
                "crawl": dict(unlimited),
            },
            "message": "本地 Web Shell 不限额",
        },
    })
