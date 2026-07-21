"""Open REST API + API key management (openspec/changes/product-roadmap-2026q3 Phase 3).

API keys (17.1): create / list / revoke, stored as SHA-256 hashes.
Open endpoints (17.2 / 17.3): ``POST /api/v1/publish`` and
``GET /api/v1/tasks/<id>`` authenticated by ``Authorization: Bearer
<key>`` (or ``X-API-Key``). API doc (17.4): ``GET /api/v1/openapi.json``.
"""
from __future__ import annotations

import hashlib
import secrets

from flask import Blueprint, g, jsonify, request

from web_runner.db import (
    create_api_key,
    get_api_key_by_hash,
    list_api_keys,
    revoke_api_key,
    touch_api_key,
)
from web_runner.routes.tasks import _dispatch_task
from web_runner.utils import _db_get_task, _db_insert_task, _new_task_id

bp = Blueprint("api_v1", __name__)

_VALID_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent", "bilibili", "tiktok", "baijiahao"}


def _require_api_key():
    """Validate the API key from the request; abort with 401 on failure.

    Sets ``g.api_key_id`` for the handler. Returns the response (401) or
    ``None`` when authorized.
    """
    auth = request.headers.get("Authorization", "")
    key = ""
    if auth.lower().startswith("bearer "):
        key = auth[7:].strip()
    else:
        key = request.headers.get("X-API-Key", "").strip()
    if not key:
        return jsonify({"success": False, "message": "API key required"}), 401
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    row = get_api_key_by_hash(key_hash)
    if not row or row.get("revoked_at"):
        return jsonify({"success": False, "message": "Invalid or revoked API key"}), 401
    g.api_key_id = row["id"]
    touch_api_key(row["id"])
    return None


def _auth_or_401():
    resp = _require_api_key()
    if resp is not None:
        return resp
    return None


# ── API key management (17.1) ──────────────────────────────────────────
@bp.get("/api/api-keys")
def list_keys():
    rows = list_api_keys()
    data = [
        {
            "id": r["id"],
            "name": r["name"],
            "masked": r["masked"],
            "created_at": r.get("created_at"),
            "revoked_at": r.get("revoked_at"),
            "last_used_at": r.get("last_used_at"),
        }
        for r in rows
    ]
    return jsonify({"success": True, "data": data})


@bp.post("/api/api-keys")
def create_key():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "message": "name is required"}), 400
    raw = "sk-" + secrets.token_hex(24)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    masked = "sk-…" + raw[-4:]
    key_id = create_api_key(name, key_hash, masked)
    # The raw key is returned exactly once.
    return jsonify({
        "success": True,
        "data": {"id": key_id, "name": name, "key": raw, "masked": masked},
    })


@bp.delete("/api/api-keys/<int:key_id>")
def revoke_key(key_id: int):
    revoke_api_key(key_id)
    return jsonify({"success": True})


# ── Open publish (17.2) ────────────────────────────────────────────────
@bp.post("/api/v1/publish")
def v1_publish():
    deny = _auth_or_401()
    if deny is not None:
        return deny

    body = request.get_json(silent=True) or {}
    platform = (body.get("platform") or "").strip()
    account = (body.get("account") or "").strip()
    action = (body.get("action") or "upload-video").strip()
    title = (body.get("title") or "").strip()
    file_path = (body.get("file") or "").strip()
    scheduled_at = (body.get("scheduled_at") or "") or None

    if platform not in _VALID_PLATFORMS:
        return jsonify({"success": False, "message": f"invalid platform: {platform}"}), 400
    if not account:
        return jsonify({"success": False, "message": "account is required"}), 400
    if action == "upload-video" and not file_path:
        return jsonify({"success": False, "message": "file is required for upload-video"}), 400

    argv = [platform, action, "--account", account]
    if action == "upload-video":
        argv += ["--title", title or "Untitled", "--file", file_path]
        if body.get("desc"):
            argv += ["--desc", body["desc"]]
        if body.get("tags"):
            argv += ["--tags", body["tags"]]

    task_id = _new_task_id(action)
    _db_insert_task(
        task_id=task_id, status="scheduled" if scheduled_at else "pending",
        platform=platform, action=action, account=account,
        created=__import__("datetime").datetime.now().isoformat(timespec="seconds"), argv=argv,
    )
    _dispatch_task(task_id, argv, platform=platform, scheduled_at=scheduled_at, force=True)
    return jsonify({"success": True, "data": {"task_id": task_id}}), 201


# ── Open task query (17.3) ─────────────────────────────────────────────
@bp.get("/api/v1/tasks/<task_id>")
def v1_get_task(task_id: str):
    deny = _auth_or_401()
    if deny is not None:
        return deny
    task = _db_get_task(task_id)
    if not task:
        return jsonify({"success": False, "message": "Task not found"}), 404
    return jsonify({"success": True, "data": task})


# ── API docs (17.4) ───────────────────────────────────────────────────
@bp.get("/api/v1/openapi.json")
def openapi_spec():
    spec = {
        "openapi": "3.0.3",
        "info": {
            "title": "Social Auto Upload Open API",
            "version": "2026.3.0",
            "description": "Open REST API for triggering publishes and querying tasks. "
                           "Authenticate with an API key via the `Authorization: Bearer <key>` "
                           "header or `X-API-Key` header.",
        },
        "servers": [{"url": "/"}],
        "components": {
            "securitySchemes": {
                "apiKeyAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "description": "SAU API key (Bearer token)",
                }
            }
        },
        "security": [{"apiKeyAuth": []}],
        "paths": {
            "/api/v1/publish": {
                "post": {
                    "summary": "Create and dispatch a publish task",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["platform", "account"],
                                    "properties": {
                                        "platform": {"type": "string", "enum": sorted(_VALID_PLATFORMS)},
                                        "account": {"type": "string"},
                                        "action": {"type": "string", "default": "upload-video"},
                                        "title": {"type": "string"},
                                        "file": {"type": "string"},
                                        "desc": {"type": "string"},
                                        "tags": {"type": "string"},
                                        "scheduled_at": {"type": "string", "format": "date-time"},
                                    },
                                }
                            }
                        }
                    },
                    "responses": {
                        "201": {"description": "Task created"},
                        "400": {"description": "Validation error"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
            "/api/v1/tasks/{task_id}": {
                "get": {
                    "summary": "Query a task by id",
                    "parameters": [
                        {"name": "task_id", "in": "path", "required": True, "schema": {"type": "string"}}
                    ],
                    "responses": {
                        "200": {"description": "Task found"},
                        "404": {"description": "Not found"},
                        "401": {"description": "Unauthorized"},
                    },
                }
            },
        },
    }
    return jsonify(spec)
