"""Usage metering middleware and quota management.

Enforces per-user, per-tier usage quotas for publish, AI generation,
and account creation actions.  Controlled by SAU_METERING_ENABLED env var.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Flask, jsonify, request

from utils.log import logger as _task_logger
from web_runner.db import get_database

bp = Blueprint("usage", __name__)

# ── Tier configuration ──────────────────────────────────────────────

TIER_LIMITS: dict[str, dict[str, int]] = {
    "free": {
        "publish": int(os.environ.get("SAU_TIER_FREE_PUBLISH", "5")),
        "ai_generate": int(os.environ.get("SAU_TIER_FREE_AI", "10")),
        "accounts": int(os.environ.get("SAU_TIER_FREE_ACCOUNTS", "3")),
        "inbox": int(os.environ.get("SAU_TIER_FREE_INBOX", "20")),
    },
    "pro": {
        "publish": -1,
        "ai_generate": -1,
        "accounts": -1,
    },
    "legacy": {
        "publish": -1,
        "ai_generate": -1,
        "accounts": -1,
    },
}

# Maps URL prefix → usage action name
_ENDPOINT_ACTION_MAP: dict[str, str] = {
    "/api/upload/": "publish",
    "/api/ai/": "ai_generate",
    "/api/inbox/": "inbox",
}

# Endpoints that should be metered (checked via before_request)
_METERED_PREFIXES = ("/api/upload/", "/api/ai/", "/api/inbox/")


def _metering_enabled() -> bool:
    """Check if metering is enabled via env var."""
    return os.environ.get("SAU_METERING_ENABLED", "true").lower() != "false"


def _get_user_tier(user_id: int) -> str:
    """Fetch user's license tier from DB.  Defaults to 'legacy'."""
    db = get_database()
    row = db.fetch_one(
        "SELECT license_tier FROM users WHERE id = ?",
        (user_id,),
    )
    if row and row.get("license_tier"):
        return row["license_tier"]
    return "legacy"


def _today_start_iso() -> str:
    """Return ISO timestamp for start of today (UTC)."""
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat()


def _tomorrow_start_iso() -> str:
    """Return ISO timestamp for start of tomorrow (UTC)."""
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return tomorrow.isoformat()


def _count_actions(user_id: int, action: str) -> int:
    """Count user's actions since start of today."""
    db = get_database()
    row = db.fetch_one(
        "SELECT COUNT(*) as cnt FROM usage_logs "
        "WHERE user_id = ? AND action = ? AND created_at >= ?",
        (user_id, action, _today_start_iso()),
    )
    return row["cnt"] if row else 0


def _log_usage(user_id: int, action: str) -> None:
    """Record a usage event."""
    db = get_database()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "INSERT INTO usage_logs (user_id, action, created_at) VALUES (?, ?, ?)",
        (user_id, action, now),
    )


def _resolve_action(path: str) -> str | None:
    """Map a request path to a usage action name."""
    for prefix, action in _ENDPOINT_ACTION_MAP.items():
        if path.startswith(prefix):
            return action
    return None


# ── Middleware ───────────────────────────────────────────────────────


def register_usage_middleware(app: Flask) -> None:
    """Register the before_request quota check on the Flask app."""

    @app.before_request
    def _check_usage_quota():
        if not _metering_enabled():
            return None
        path = request.path
        if not any(path.startswith(p) for p in _METERED_PREFIXES):
            return None
        # Skip SSE endpoints (streaming, not discrete actions)
        if "/sse" in path or "/progress" in path:
            return None
        # Skip model listing
        if path.endswith("/models"):
            return None

        from web_runner.routes.auth import _current_user_id, _is_auth_enabled

        if not _is_auth_enabled():
            return None

        user_id = _current_user_id()
        if user_id is None:
            return None

        action = _resolve_action(path)
        if action is None:
            return None

        tier = _get_user_tier(user_id)
        limits = TIER_LIMITS.get(tier, TIER_LIMITS["legacy"])
        limit = limits.get(action, -1)

        if limit == -1:
            return None  # Unlimited

        used = _count_actions(user_id, action)
        if used >= limit:
            return jsonify({
                "success": False,
                "error": "quota_exceeded",
                "action": action,
                "limit": limit,
                "used": used,
                "reset_at": _tomorrow_start_iso(),
                "message": f"已达到今日{action}配额上限 ({limit}次)，升级 Pro 解锁无限额度",
            }), 429

        return None


# ── Quota endpoint ──────────────────────────────────────────────────


@bp.get("/api/usage/quota")
def get_quota():
    """Return current user's quota status across all actions."""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if not _is_auth_enabled():
        # No auth → return unlimited
        return jsonify({
            "success": True,
            "data": {
                "tier": "legacy",
                "quotas": {
                    action: {"limit": -1, "used": 0, "remaining": -1}
                    for action in ("publish", "ai_generate", "accounts")
                },
            },
        })

    user_id = _current_user_id()
    if user_id is None:
        return jsonify({"success": False, "message": "未登录"}), 401

    tier = _get_user_tier(user_id)
    limits = TIER_LIMITS.get(tier, TIER_LIMITS["legacy"])
    reset_at = _tomorrow_start_iso()

    quotas = {}
    for action in ("publish", "ai_generate"):
        limit = limits.get(action, -1)
        if limit == -1:
            quotas[action] = {"limit": -1, "used": 0, "remaining": -1, "resets_at": None}
        else:
            used = _count_actions(user_id, action)
            quotas[action] = {
                "limit": limit,
                "used": used,
                "remaining": max(0, limit - used),
                "resets_at": reset_at,
            }

    # Account quota is a current-count check, not daily
    account_limit = limits.get("accounts", -1)
    if account_limit == -1:
        quotas["accounts"] = {"limit": -1, "used": 0, "remaining": -1}
    else:
        db = get_database()
        row = db.fetch_one(
            "SELECT COUNT(DISTINCT aa.id) as cnt "
            "FROM account_authorizations aa "
            "JOIN account_groups ag ON aa.group_id = ag.id",
        )
        used = row["cnt"] if row else 0
        quotas["accounts"] = {
            "limit": account_limit,
            "used": used,
            "remaining": max(0, account_limit - used),
        }

    return jsonify({
        "success": True,
        "data": {"tier": tier, "quotas": quotas},
    })


def log_action(user_id: int, action: str) -> None:
    """Public helper to log a successful action after completion.

    Call this from route handlers after a successful upload/AI action.
    """
    if not _metering_enabled():
        return
    try:
        _log_usage(user_id, action)
    except Exception as exc:
        _task_logger.warning(f"[usage] failed to log action {action}: {exc}")


def check_account_quota(user_id: int) -> tuple[bool, int, int]:
    """Check if user can add another account.

    Returns (allowed, limit, current_count).
    """
    if not _metering_enabled():
        return True, -1, 0

    tier = _get_user_tier(user_id)
    limits = TIER_LIMITS.get(tier, TIER_LIMITS["legacy"])
    limit = limits.get("accounts", -1)
    if limit == -1:
        return True, -1, 0

    db = get_database()
    row = db.fetch_one(
        "SELECT COUNT(DISTINCT aa.id) as cnt "
        "FROM account_authorizations aa "
        "JOIN account_groups ag ON aa.group_id = ag.id",
    )
    used = row["cnt"] if row else 0
    return used < limit, limit, used
