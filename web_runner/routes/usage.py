"""Usage quota — local shell reports unlimited daily counters.

Front-end: ``GET /api/usage/quota`` (studio + client.usage).

Returns both shapes so older callers reading ``actions`` and the
Studio pill reading ``quotas.studio_render.is_unlimited`` keep working.
"""
from __future__ import annotations

from flask import Blueprint, jsonify

bp = Blueprint("usage", __name__)


def _unlimited_slot() -> dict:
    return {
        "limit": -1,
        "used": 0,
        "remaining": -1,
        "resets_at": None,
        "is_unlimited": True,
        "unlimited": True,  # legacy alias
        "can_upgrade": False,
        "required_tier": None,
    }


@bp.get("/api/usage/quota")
def usage_quota():
    slot = _unlimited_slot()
    actions = {
        "upload_video": dict(slot),
        "upload_note": dict(slot),
        "publish": dict(slot),
        "ai_generate": dict(slot),
        "studio_render": dict(slot),
        "studio_generate": dict(slot),
        "inbox_download": dict(slot),
        "crawl": dict(slot),
        "accounts": dict(slot),
    }
    return jsonify({
        "success": True,
        "data": {
            "tier": "legacy",
            "day": None,
            # StudioRenderQuotaPill / StudioDetailPage contract
            "quotas": {
                "publish": dict(slot),
                "ai_generate": dict(slot),
                "accounts": dict(slot),
                "studio_render": dict(slot),
            },
            # Older local-shell clients
            "actions": actions,
            "message": "本地 Web Shell 不限额",
        },
    })
