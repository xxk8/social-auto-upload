"""License stubs for local shell — always-active legacy tier.

Front-end: ``api.license.*``
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

bp = Blueprint("license", __name__)


@bp.get("/api/license/status")
def license_status():
    return jsonify({
        "success": True,
        "data": {
            "active": True,
            "tier": "legacy",
            "source": "local-shell",
            "message": "本地 Web Shell 无许可证限制",
        },
    })


@bp.post("/api/license/activate")
def license_activate():
    payload = request.get_json(silent=True) or {}
    key = (payload.get("key") or "").strip()
    return jsonify({
        "success": True,
        "data": {
            "active": True,
            "tier": "legacy",
            "key_preview": (key[:8] + "…") if key else "",
            "message": "本地模式已视为激活",
        },
    })


@bp.post("/api/license/deactivate")
def license_deactivate():
    return jsonify({
        "success": True,
        "message": "本地模式忽略停用",
        "data": {"active": True, "tier": "legacy"},
    })


@bp.post("/api/license/generate")
def license_generate():
    payload = request.get_json(silent=True) or {}
    tier = payload.get("tier") or "legacy"
    count = int(payload.get("count") or 1)
    count = max(1, min(count, 20))
    keys = [f"LOCAL-{tier.upper()}-{i+1:04d}" for i in range(count)]
    return jsonify({"success": True, "data": {"keys": keys, "tier": tier}})
