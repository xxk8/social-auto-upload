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
        # round-AI-paywall: this cell is **dead-after-bypass for
        # user-facing AI** (the 9 paths in `_AI_FEATURE_BLOCKED_FOR_FREE`
        # fire HTTP 402 before this lookup) and **never read for
        # utility AI** either — the pre-quota skip in
        # `_check_usage_quota` matches `_AI_UTILITY_PATH_PREFIXES`
        # and short-circuits first. The `0` default is a grep-friendly
        # signal that both layers route around the value.
        #
        # **To bring back a daily AI quota for free users**: remove
        # paths from `_AI_FEATURE_BLOCKED_FOR_FREE` AND
        # `_AI_UTILITY_PATH_PREFIXES` first — raising this value
        # alone will NOT restore the quota.
        "ai_generate": int(os.environ.get("SAU_TIER_FREE_AI", "0")),
        "accounts": int(os.environ.get("SAU_TIER_FREE_ACCOUNTS", "3")),
        "inbox": int(os.environ.get("SAU_TIER_FREE_INBOX", "20")),
        # round-OPT-MONETIZE-v1 — soft-paywall for Studio renders.
        # Unlike AI (which is hard-blocked for free via the
        # tier_required 402 gate above), Studio render is SOFT:
        # free users get N renders/day, then see an UpsellModal
        # that pitches the pro tier. The `_STUDIO_GATED_ACTIONS`
        # frozenset below flags this action to `exceeds_tier_quota`
        # + `get_quota` so the 429 envelope carries
        # `can_upgrade: True, required_tier: "pro"` — same upgrade
        # affordance as AI, just at-limit instead of always-on.
        # Env knobs: SAU_TIER_FREE_STUDIO_RENDER (default 3) +
        # SAU_TIER_PRO_STUDIO_RENDER (default 50). Picked to match
        # the rate the studio_render pipeline consumes
        # bandwidth/CPU at (1 Remotion bundle ~30s wall + Pexels
        # fetch ~6s/scene + TTS ~3-6s/scene — 3/day fits a free
        # user exploring the feature; 50/day fits a heavy operator
        # assembling weekly content).
        "studio_render": int(
            os.environ.get("SAU_TIER_FREE_STUDIO_RENDER", "3")
        ),
    },
    "pro": {
        "publish": -1,
        "ai_generate": -1,
        "accounts": -1,
        # Pro tier gets 50 renders/day by default (env: SAU_TIER_PRO_STUDIO_RENDER).
        # Hard cap (NOT -1/unlimited) so a runaway script can't burn
        # through the operator's PG connection pool / CDN budget
        # unnoticed. Future round can promote to -1 once we ship
        # a per-render creditless model (e.g. measured in dollars).
        "studio_render": int(
            os.environ.get("SAU_TIER_PRO_STUDIO_RENDER", "50")
        ),
    },
    "legacy": {
        "publish": -1,
        "ai_generate": -1,
        "accounts": -1,
        # Legacy (pre-monetization) users keep unlimited (-1).
        "studio_render": -1,
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

# ── AI tier-gating (free tier hard-block, round-AI-paywall-v1) ──────
# Internationalized SaaS convention (Stripe / Jasper / Notion AI): every
# user-facing AI generation endpoint is a Pro-tier feature. Free tier
# sees an HTTP 402 with a `tier_required` envelope (see
# _TIER_BLOCKED_RESPONSE) the React side branches on to render an
# upgrade banner. Pro/legacy pass through unchanged.
#
# Allowlist (free can still hit these — utility/admin endpoints that
# DO NOT cost user credits):
#   • /api/ai/models             → GET  : model picker
#   • /api/ai/config             → GET  : sidebar status indicator
#   • /api/ai/keys               → GET  : key list (admin via inline check)
#   • /api/ai/config             → POST/DELETE : admin-only key mgmt (inline)
#   • /api/ai/keys/batch         → POST : admin-only batch upload (inline)
#
# Notes:
#   • frozenset of full paths (NOT prefixes) — there's no real prefix
#     collision in this surface but explicit allowlist is less
#     fragile than `not startswith(...)` heuristics.
#   • Trail-slash tolerance via rstrip("/") so curl variants don't
#     leak through the gate. Per-route handlers should normalize too.
_AI_FEATURE_BLOCKED_FOR_FREE: frozenset[str] = frozenset({
    "/api/ai/generate",
    "/api/ai/generate/stream",
    "/api/ai/generate/multi-platform",
    "/api/ai/generate/variants",
    "/api/ai/enhance-prompt",
    "/api/ai/search",
    "/api/ai/images/search",
    "/api/ai/recommend-images",
    "/api/ai/images/fetch",
})
_AI_BLOCKED_PATHS_NORMALIZED: frozenset[str] = frozenset(
    p.rstrip("/") for p in _AI_FEATURE_BLOCKED_FOR_FREE
)

# Maps an `action` (TIER_LIMITS key) to whether the action is a
# Pro-tier-gated feature (UI reads this to surface the upgrade CTA in
# the quota indicator without first making a guarded /api/ai/* call).
_AI_GATED_ACTIONS: frozenset[str] = frozenset({"ai_generate"})

# round-OPT-MONETIZE-v1 — Studio render soft-paywall marker.
# Semantically distinct from _AI_GATED_ACTIONS:
#   • _AI_GATED_ACTIONS — tier=free ALWAYS gets `can_upgrade: True`
#     (because they're hard-blocked; limit is 0).
#   • _STUDIO_GATED_ACTIONS — tier=free gets `can_upgrade: True`
#     ONLY when they hit the daily limit (limit is 3, not 0).
# The shared surface is "free user sees the upgrade chip" — but
# the trigger is different. Pro tier at-limit (50/50) keeps a
# plain quota_exceeded response (no upsell CTA) — matching the
# routing of /api/upload/ publish-limit, no need to upsell to
# enterprise when the honest fix is "wait until tomorrow".
_STUDIO_GATED_ACTIONS: frozenset[str] = frozenset({"studio_render"})

# AI **utility** endpoint prefixes that DO NOT cost user credits and
# stay reachable by all tiers (free-compatible). These are skipped
# BEFORE the per-action daily-quota check fires so a flipped-to-0
# `TIER_LIMITS["free"]["ai_generate"]` (post round-AI-paywall-v2)
# doesn't regress their access. Concrete paths:
#   • /api/ai/models       → GET  (model picker data)
#   • /api/ai/config       → ANY  (sidebar status, admin key mgmt)
#   • /api/ai/keys         → ANY  (key list, batch admin POST)
# Admin-only handlers (POST/DELETE on /api/ai/config, POST on
# /api/ai/keys/batch) gate themselves inline via session['role'] —
# the metering skip here does not weaken that authz layer.
_AI_UTILITY_PATH_PREFIXES: tuple[str, ...] = (
    "/api/ai/models",
    "/api/ai/config",
    "/api/ai/keys",
)


def _is_action_studio_gated(action: str | None) -> bool:
    """True iff `action` is one the user-facing Studio surface uses.

    Mirrors ``_is_action_ai_gated`` — drives the
    ``can_upgrade / required_tier`` flags at-limit in
    ``get_quota`` so the renderer-side pill can show
    "已达今日上限 · 升级专业版" with a tap-to-`/pricing?from=studio`
    CTA without first round-tripping via a guarded 402 (Studio's
    paywall is SOFT — the limit fires at-limit, not unconditionally
    like AI).

    Round-OPT-MONETIZE-v1: the trigger difference is intentional.
    ``_AI_GATED_ACTIONS`` says "free user, you cannot use this period"
    (limit=0, can_upgrade=always); ``_STUDIO_GATED_ACTIONS`` says
    "free user, you used your today allotment, want more for $?"
    (limit=3, can_upgrade=at-or-over-limit only).
    """
    return action in _STUDIO_GATED_ACTIONS


def _is_path_ai_blocked_for_tier(path: str, tier: str) -> bool:
    """True iff path is gated AND tier=free.

    Pro/legacy/None-of-the-above all return False. Path is normalized
    (trailing slash stripped) so curl variants don't leak through.
    """
    if tier != "free":
        return False
    return path.rstrip("/") in _AI_BLOCKED_PATHS_NORMALIZED


def _is_action_ai_gated(action: str | None) -> bool:
    """True iff `action` is one the user-facing AI surface uses.

    Used by `get_quota` to attach `required_tier: "pro"` flags so the
    frontend can render the upgrade CTA in the quota indicator without
    first issuing a guarded request.
    """
    return action in _AI_GATED_ACTIONS


def _tier_blocked_response(path: str) -> tuple["Response", int]:
    """Stripe-style 402 envelope for AI-tier-gated endpoints.

    Follows the existing `success: false · error: <code>` shape so
    axios clients can branch on `success === false && error === 'tier_required'`
    with one if/else — same shape as the existing `quota_exceeded`
    envelope (action / message) plus `code / required_tier / upgrade_url`
    extensions for the internationalized Tier-Required contract.
    """
    # Stable slug derived from the path so the frontend can branch on
    # `blocked_action` for nuanced copy (e.g. "图片素材" vs "文案生成").
    slug = (
        path.replace("/api/ai/", "", 1)
        .strip("/")
        .replace("/", "-")
        .replace("_", "-") or "ai"
    )
    return (
        jsonify(
            {
                "success": False,
                "error": "tier_required",
                "code": "AI_TIER_REQUIRED",
                "required_tier": "pro",
                "blocked_action": slug,
                "message": (
                    "AI 功能仅向专业版及以上用户开放。"
                    "升级专业版解锁 AI 内容生成、图片素材搜索等所有 AI 能力。"
                ),
                "upgrade_url": "/pricing?from=ai",
                "action": "ai_generate",
            }
        ),
        402,
    )


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


def exceeds_tier_quota(
    user_id: int, action: str
) -> tuple["Response", int] | None:
    """Bypass quota check — call inline from route handlers
    whose path lives OUTSIDE the global ``_METERED_PREFIXES``.

    Round-OPT-MONETIZE-v1: ``POST /api/studio/projects/<id>/render``
    is a heavy ~30-second Remotion bundle + Pexels fetches + TTS
    subprocesses that needs careful quota gating, but it's mounted
    under ``/api/studio/`` which doesn't belong in the global
    metered-prefix list (that prefix would also gate harmless GETs
    like ``/api/studio/projects`` / ``/api/studio/projects/<id>`` /
    ``/api/studio/tts/health`` / ``/api/studio/render/<id>/<file>``
    — none of which should consume a credit). So this helper is the
    inline-only quota gate for Studio render: the route handler
    calls it at the top, returns the tuple if the user is over
    quota, or proceeds to render and calls :func:`log_action` on
    success.

    The 429 envelope shape matches the existing quota_exceeded
    contract in ``_check_usage_quota``, EXTENDED for actions in
    ``_STUDIO_GATED_ACTIONS`` (and ``_AI_GATED_ACTIONS``) with::

        can_upgrade: bool
        required_tier: "pro" | None
        blocked_action: "studio-render" | "ai-generate" | ...
        upgrade_url: "/pricing?from=..."

    ``can_upgrade: True`` says "show UpsellModal CTA inside this
    error surface, don't just toast" — the React side branches on
    this one field. ``upgrade_url`` is the visitor-facing /pricing
    route with the ``?from=<slug>`` query so marketing attribution
    can split which CTA path converted.

    Returns ``None`` when:
      * metering is disabled (``SAU_METERING_ENABLED=false``)
      * the tier's limit is -1 (unlimited)
      * the action is unknown to TIER_LIMITS (treats as unlimited;
        MRO-endpoints that don't meter return None fast)
      * the user is strictly under their limit
    """
    if not _metering_enabled():
        return None
    tier = _get_user_tier(user_id)
    limits = TIER_LIMITS.get(tier, TIER_LIMITS["legacy"])
    limit = limits.get(action, -1)
    if limit == -1:
        return None  # Unlimited for this tier

    used = _count_actions(user_id, action)
    if used < limit:
        return None

    # At-or-over-limit. Build the 429 envelope. For "gated" actions
    # (Studio / AI), include the upgrade-pitch fields so the React
    # side can render UpsellModal / AiPaywallBanner instead of a
    # plain toast.
    is_ai_gated = _is_action_ai_gated(action)
    is_studio_gated = _is_action_studio_gated(action)
    requires_upgrade = bool(
        (is_ai_gated or is_studio_gated) and tier == "free"
    )
    reset_at = _tomorrow_start_iso()

    # Stable slug for the React-side copy branching ("图片素材" vs
    # "文案生成" vs "剧本工坊渲染").
    slug = action.replace("_", "-")
    blocked_action = (
        "studio-render"
        if is_studio_gated
        else ("ai-generate" if is_ai_gated else slug)
    )
    upgrade_url = (
        "/pricing?from=studio"
        if is_studio_gated
        else "/pricing?from=ai"
        if is_ai_gated
        else "/pricing"
    )

    payload: dict = {
        "success": False,
        "error": "quota_exceeded",
        "action": action,
        "limit": limit,
        "used": used,
        "reset_at": reset_at,
        "can_upgrade": requires_upgrade,
        "required_tier": "pro" if requires_upgrade else None,
        "blocked_action": blocked_action,
        "upgrade_url": upgrade_url,
        "message": (
            f"已达到今日{action}配额上限 ({limit}次)，升级 Pro 解锁更多额度"
            if requires_upgrade
            else f"已达到今日{action}配额上限 ({limit}次)，明日自动重置"
        ),
    }
    return jsonify(payload), 429


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
        # Skip AI **utility** endpoints (model picker, sidebar status,
        # key list / key mgmt) — they don't cost user credits so the
        # daily-quota counter should never increment on them. This
        # skip is also what keeps `TIER_LIMITS["free"]["ai_generate"]
        # = 0` from regressing free-tier access to these reads (post
        # round-AI-paywall-v2). See _AI_UTILITY_PATH_PREFIXES for the
        # exact set; admin authz on the writes is inline at the
        # route handler.
        if any(path.startswith(p) for p in _AI_UTILITY_PATH_PREFIXES):
            return None

        from web_runner.routes.auth import _current_user_id, _is_auth_enabled

        if not _is_auth_enabled():
            return None

        user_id = _current_user_id()
        if user_id is None:
            return None

        tier = _get_user_tier(user_id)

        # ── AI tier-gating (round-AI-paywall-v1): free tier hard-block
        # before the per-action quota check fires. The 402 envelope
        # carries `error: tier_required` so React can branch on a
        # stable identifier (vs. quota_exceeded's 429). See
        # _AI_FEATURE_BLOCKED_FOR_FREE + _tier_blocked_response for
        # the contract details.
        if _is_path_ai_blocked_for_tier(path, tier):
            return _tier_blocked_response(path)

        action = _resolve_action(path)
        if action is None:
            return None

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
    """Return current user's quota status across all actions.

    Response shape (round-AI-paywall-v1 extended): top-level keys are
    `tier` (free|pro|legacy) + `quotas` (dict per action). Each
    `quotas[<action>]` entry carries BOTH a metering group AND a
    tier-classification group:

      Metering (daily counter):
        • limit        (int)        — -1 = unlimited, 0 = tier-blocked
        • used         (int)
        • remaining    (int)        — -1 when unlimited
        • resets_at    (ISO | null) — UTC midnight rollover

      Tier-classification (round-AI-paywall-v1):
        • is_unlimited (bool)       — true ↔ limit == -1
        • can_upgrade  (bool)       — true ↔ tier-blocked for this user
        • required_tier("pro"|null) — set iff can_upgrade

    Reader guidance: the metering fields are authoritative for
    consumption counters; the tier-classification fields are signals
    the React side reads to decide whether to render an upgrade CTA
    in the quota chip WITHOUT first issuing a guarded /api/ai/*
    request. They are NOT redundant — the React side needs both to
    differentiate "free tier running out of daily quota" from
    "free tier hard-blocked by paywall".
    """
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if not _is_auth_enabled():
        # No auth → return unlimited. Mirrors the "dev mode" shape;
        # both old (publish/ai_generate/accounts) AND new
        # (studio_render) actions live in the row set so the
        # frontend can render a pill with consistent shape (no
        # "studio_render key missing" downstream).
        return jsonify({
            "success": True,
            "data": {
                "tier": "legacy",
                "quotas": {
                    a: {"limit": -1, "used": 0, "remaining": -1}
                    for a in (
                        "publish",
                        "ai_generate",
                        "accounts",
                        "studio_render",
                    )
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
    # Per the round-AI-paywall-v1 contract: an action that's tier-blocked
    # for the user's current tier returns `required_tier: "pro"` plus
    # `can_upgrade: true` so the React side can render an upgrade CTA
    # in the quota indicator WITHOUT first issuing a guarded request.
    # Sentinel: `limit: 0` (NOT -1) so absolute users see a concrete
    # "0 / 0" instead of "unlimited", matching the Stripe-ecosystem
    # pattern recommended in the discovery research.
    # Iterates the union of metered actions + gated actions so the
    # webhookdelivered quota envelope covers everything the React
    # side may want to render a pill for. `studio_render` joins the
    # legacy (`"publish", "ai_generate"`) tuple in this round
    # (round-OPT-MONETIZE-v1).
    for action in ("publish", "ai_generate", "studio_render"):
        limit = limits.get(action, -1)
        is_ai_gated = _is_action_ai_gated(action)
        is_studio_gated = _is_action_studio_gated(action)
        # AI: requires_upgrade iff tier==free (always-blocked).
        # Studio: requires_upgrade iff tier==free AND used >= limit
        # (soft paywall — N/day then upsell). Pro at-limit on Studio
        # deliberately does NOT surface the upsell CTA (no
        # enterprise tier to upsell to; "wait until tomorrow" is
        # the honest answer; the rounded pill shows counters-only).
        if is_ai_gated and tier == "free":
            requires_upgrade = True
        elif is_studio_gated and tier == "free":
            used_early = _count_actions(user_id, action)
            requires_upgrade = used_early >= limit
        else:
            requires_upgrade = False
        if requires_upgrade:
            # Sentinel: `limit: 0` (NOT -1) so absolute users see a
            # concrete "0 / 0" instead of "unlimited", matching the
            # Stripe-ecosystem pattern from the discovery research.
            # For Studio, surface the ACTUAL limit so the pill can
            # show "3 / 3 · 升级专业版" instead of just "0 / 0".
            display_limit = 0 if is_ai_gated else limit
            quotas[action] = {
                "limit": display_limit,
                "used": display_limit,  # already at-or-over
                "remaining": 0,
                "resets_at": None if is_ai_gated else reset_at,
                "is_unlimited": False,
                "can_upgrade": True,
                "required_tier": "pro",
            }
        elif limit == -1:
            quotas[action] = {
                "limit": -1,
                "used": 0,
                "remaining": -1,
                "resets_at": None,
                "is_unlimited": True,
                "can_upgrade": False,
                "required_tier": None,
            }
        else:
            used = _count_actions(user_id, action)
            quotas[action] = {
                "limit": limit,
                "used": used,
                "remaining": max(0, limit - used),
                "resets_at": reset_at,
                "is_unlimited": False,
                "can_upgrade": False,
                "required_tier": None,
            }

    # Account quota is a current-count check, not daily
    account_limit = limits.get("accounts", -1)
    if account_limit == -1:
        quotas["accounts"] = {
            "limit": -1,
            "used": 0,
            "remaining": -1,
            "is_unlimited": True,
            "can_upgrade": False,
            "required_tier": None,
        }
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
            "is_unlimited": False,
            "can_upgrade": False,
            "required_tier": None,
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
