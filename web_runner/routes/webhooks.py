"""Webhook config API (openspec/changes/webhook-notifications).

GET  /api/webhooks/config -> current config (secrets masked)
PUT  /api/webhooks/config -> upsert routing rows (DB overrides .env)
POST /api/webhooks/test  -> connectivity test via matching adapter
"""

from __future__ import annotations

import json

from flask import Blueprint, jsonify, request

from web_runner.notifications import (
    db_get_webhook_config,
    db_upsert_webhook_config,
    resolve_webhooks,
    _build_payload,
    _classify_url,
)

bp = Blueprint("webhooks", __name__, url_prefix="/api/webhooks")


def _mask(secret: str | None) -> str | None:
    if not secret:
        return None
    if len(secret) <= 4:
        return "****"
    return "****" + secret[-4:]


@bp.get("/config")
def get_config():
    rows = db_get_webhook_config()
    data = [
        {
            "id": r["id"],
            "platform": r.get("platform"),
            "account": r.get("account"),
            "url": r["url"],
            "secret": _mask(r.get("secret")),
            "enabled": bool(r.get("enabled", 1)),
        }
        for r in rows
    ]
    return jsonify({"success": True, "data": data})


@bp.put("/config")
def put_config():
    body = request.get_json(silent=True)
    if not isinstance(body, list):
        return jsonify({"success": False, "message": "body must be a list of routing rows"}), 400
    for r in body:
        if not isinstance(r, dict) or not r.get("url"):
            return jsonify({"success": False, "message": "each row needs a url"}), 400
    db_upsert_webhook_config(body)
    return jsonify({"success": True, "data": {"count": len(body)}})


@bp.post("/test")
def test_webhook():
    body = request.get_json(silent=True) or {}
    url = body.get("url")
    secret = body.get("secret")
    if not url:
        return jsonify({"success": False, "message": "url required"}), 400
    channel = _classify_url(url)
    from web_runner.notifications import UploadEvent

    event = UploadEvent(event_type="upload.success", title="[TEST] 通知连通性测试", status="success")
    try:
        query, payload = _build_payload(channel, event, secret)
        from web_runner.notifications import _http_post

        _http_post(url + query, payload)
        return jsonify({"success": True, "data": {"channel": channel, "status": "sent"}})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "message": f"{channel} delivery failed: {exc}"}), 502
