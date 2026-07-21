"""License management routes — activation, status, deactivation, admin key generation.

License keys follow format SAU-{TIER}-{RANDOM} where RANDOM is a
12-char alphanumeric token.  Keys are validated by format check +
DB lookup (key must exist and not be bound to another user).
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from utils.log import logger as _task_logger
from web_runner.db import get_database

bp = Blueprint("license", __name__)

_KEY_TOKEN_LEN = 12
_KEY_ALPHABET = string.ascii_uppercase + string.digits


def validate_license_key_format(key: str) -> tuple[str, str | None]:
    """Validate a license key's format only (no DB check).

    Returns (tier, None) on format success, or ("", error_message) on failure.
    """
    if not key or not isinstance(key, str):
        return "", "License key is required"

    parts = key.strip().upper().split("-")
    if len(parts) != 3:
        return "", "Invalid key format. Expected SAU-{TIER}-{TOKEN}"

    prefix, tier, token = parts
    if prefix != "SAU":
        return "", "Key must start with SAU-"
    if tier not in ("PRO",):
        return "", f"Unknown tier: {tier}"
    if len(token) != _KEY_TOKEN_LEN:
        return "", f"Invalid key token length (expected {_KEY_TOKEN_LEN} chars)"

    return tier.lower(), None


def _require_admin():
    """Return user_id if admin, or None."""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if not _is_auth_enabled():
        return None
    uid = _current_user_id()
    if uid is None:
        return None
    db = get_database()
    user = db.fetch_one("SELECT role FROM users WHERE id = ?", (uid,))
    if not user or user.get("role") != "admin":
        return None
    return uid


# ── Endpoints ───────────────────────────────────────────────────────


@bp.post("/api/license/activate")
def activate_license():
    """Activate a license key for the current user."""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    data = request.get_json(silent=True) or {}
    key = data.get("key", "").strip()
    if not key:
        return jsonify({"success": False, "message": "License key is required"}), 400

    tier, err = validate_license_key_format(key)
    if err:
        return jsonify({"success": False, "message": err}), 422

    if not _is_auth_enabled():
        return jsonify({
            "success": True,
            "data": {"tier": tier, "message": "Auth disabled — license applied in-memory only"},
        })

    uid = _current_user_id()
    if uid is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    db = get_database()
    key_upper = key.strip().upper()

    # Check if key is already used by another user
    existing = db.fetch_one(
        "SELECT id FROM users WHERE license_key = ? AND id != ?",
        (key_upper, uid),
    )
    if existing:
        return jsonify({"success": False, "message": "该 License Key 已被其他用户使用"}), 409

    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE users SET license_tier = ?, license_key = ?, license_activated_at = ? WHERE id = ?",
        (tier, key_upper, now, uid),
    )

    _task_logger.info(f"[license] user {uid} activated {tier} tier")
    return jsonify({
        "success": True,
        "data": {"tier": tier, "activated_at": now},
    })


@bp.get("/api/license/status")
def license_status():
    """Return current user's license status."""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if not _is_auth_enabled():
        return jsonify({
            "success": True,
            "data": {"tier": "legacy", "key": None, "activated_at": None},
        })

    uid = _current_user_id()
    if uid is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    db = get_database()
    user = db.fetch_one(
        "SELECT license_tier, license_key, license_activated_at FROM users WHERE id = ?",
        (uid,),
    )
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    tier = user.get("license_tier") or "legacy"
    raw_key = user.get("license_key")
    masked = None
    if raw_key and len(raw_key) > 8:
        masked = raw_key[:7] + "****"

    return jsonify({
        "success": True,
        "data": {
            "tier": tier,
            "key": masked,
            "activated_at": user.get("license_activated_at"),
        },
    })


@bp.post("/api/license/deactivate")
def deactivate_license():
    """Deactivate the current user's license, reverting to free tier."""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if not _is_auth_enabled():
        return jsonify({"success": True, "data": {"tier": "legacy"}})

    uid = _current_user_id()
    if uid is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    db = get_database()
    db.execute(
        "UPDATE users SET license_tier = 'free', license_key = NULL, license_activated_at = NULL WHERE id = ?",
        (uid,),
    )

    _task_logger.info(f"[license] user {uid} deactivated license, reverted to free")
    return jsonify({"success": True, "data": {"tier": "free"}})


@bp.post("/api/license/generate")
def generate_license_keys():
    """Generate license keys (admin only).

    Creates random keys in SAU-{TIER}-{TOKEN} format.
    Keys are NOT pre-stored in DB — they are validated on activation
    by format check + uniqueness constraint.
    """
    admin_id = _require_admin()
    if admin_id is None:
        return jsonify({"success": False, "message": "Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    tier = data.get("tier", "pro").lower()
    count = min(int(data.get("count", 1)), 100)

    if tier not in ("pro",):
        return jsonify({"success": False, "message": f"Cannot generate keys for tier: {tier}"}), 400

    keys = []
    for _ in range(count):
        token = "".join(secrets.choice(_KEY_ALPHABET) for _ in range(_KEY_TOKEN_LEN))
        key = f"SAU-{tier.upper()}-{token}"
        keys.append(key)

    _task_logger.info(f"[license] admin {admin_id} generated {count} {tier} keys")
    return jsonify({"success": True, "data": {"keys": keys, "tier": tier}})
