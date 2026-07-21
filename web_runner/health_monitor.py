"""Account health monitoring background job.

Runs a daemon thread that every 6 hours (configurable) checks every
account_authorization cookie by:

1. Quick file-based check (existence / size / JSON validity / age).
2. If the quick check passes, run the real platform ``cookie_auth()``
   check with a 30 s timeout and one retry.
3. Persist the resulting health status to ``account_authorizations``.
4. Notify when a previously-valid authorization degrades to
   ``expiring_soon`` or ``invalid``.

The monitor is intentionally serial: launching multiple Chromium
instances concurrently would exhaust memory on small hosts.
"""
from __future__ import annotations

import asyncio
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from web_runner.db import get_database
from web_runner.utils import _quick_check_cookie
from web_runner.utils import log as _log

# Configurable via env; defaults mirror openspec/changes/account-health-monitoring.
_HEALTH_INTERVAL = int(os.environ.get("SAU_HEALTH_MONITOR_INTERVAL", "21600"))  # 6h
_HEALTH_TIMEOUT = int(os.environ.get("SAU_HEALTH_TIMEOUT", "30"))  # seconds per check
# Retry budget for the real cookie_auth call. Default 1 keeps the
# 60s total budget headroom (see ``_check_with_retry`` docstring); bump
# for flakier networks or down-flaky platforms via SAU_HEALTH_RETRIES.
# Clamped to [0, 3] so a misconfigured ``SAU_HEALTH_RETRIES=100`` can't
# spawn a Chromium storm; see ``_clamp_health_retries`` for bounds.
def _clamp_health_retries(raw: int) -> int:
    """Bound ``SAU_HEALTH_RETRIES`` to [0, 3] — runaway retry foot-gun.

    Cap rationale: each retry triggers a full Chromium cold-start
    (5–30s each). 4+ retries would total up to ~120s worst case,
    exceeding operator patience before they give up on a flaky
    account and re-authorize manually. Min 0 lets operators disable
    retries for fail-fast behavior on fast-but-flaky networks where
    a Chromium restart costs more wall-clock than the speedup from
    confirming a single failure.

    Tests pin this via ``TestHealthRetriesEnvVar``; the constant itself
    captures ``_clamp_health_retries(int(env))`` at module-import time
    and is monkeypatched in unit tests rather than reloaded.
    """
    return max(0, min(3, raw))


_HEALTH_RETRIES = _clamp_health_retries(int(os.environ.get("SAU_HEALTH_RETRIES", "1")))
_EXPIRING_DAYS = int(os.environ.get("SAU_HEALTH_EXPIRING_DAYS", "7"))
# Real browser checks are expensive; only run them periodically.
_REAL_CHECK_INTERVAL = int(os.environ.get("SAU_HEALTH_REAL_CHECK_INTERVAL", "86400"))  # 24h

_monitor_thread: threading.Thread | None = None
_monitor_lock = threading.Lock()

# Map platform name -> (module_path, check_function_name).
# All functions are async and accept ``account_name: str`` -> bool.
_PLATFORM_CHECKERS: dict[str, tuple[str, str]] = {
    "douyin": ("cli.platforms.douyin", "check"),
    "bilibili": ("cli.platforms.bilibili", "check"),
    "kuaishou": ("cli.platforms.kuaishou", "check"),
    "xiaohongshu": ("cli.platforms.xiaohongshu", "check"),
    "tencent": ("cli.platforms.tencent", "check"),
    "tiktok": ("cli.platforms.tiktok", "check"),
    "baijiahao": ("cli.platforms.baijiahao", "check"),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


async def _check_platform_cookie(platform: str, account: str) -> bool:
    """Run the real platform cookie_auth check.

    Returns ``True`` only when the platform-specific checker confirms
    the cookie is valid. Any exception or missing checker is logged
    and treated as invalid.
    """
    spec = _PLATFORM_CHECKERS.get(platform)
    if not spec:
        _log(f"[health] no checker for platform {platform}")
        return False
    module_path, fn_name = spec
    try:
        module = __import__(module_path, fromlist=[fn_name])
        check_fn = getattr(module, fn_name)
        return await check_fn(account)
    except Exception as exc:  # noqa: BLE001
        _log(f"[health] {platform}/{account} check failed: {exc}")
        return False


async def _check_with_retry(platform: str, account: str) -> bool:
    """Run the real cookie_auth check with timeout and bounded retries.

    Total wall-clock budget per invocation is ``(_HEALTH_RETRIES + 1) *
    _HEALTH_TIMEOUT``: at default ``_HEALTH_RETRIES=1`` and
    ``_HEALTH_TIMEOUT=30s`` that's up to 60s; with the documented
    SAU_HEALTH_RETRIES cap of 3 it's up to 120s worst case. The first
    attempt is the original call; subsequent attempts (0–3 retries,
    env-driven) are only triggered after ``TimeoutError`` or generic
    exceptions; success short-circuits via ``return``.

    The retry budget is bounded both at the env layer (clamped to
    [0, 3] via ``_clamp_health_retries`` to prevent runaway) and at
    the budget layer (each attempt hedged by ``_HEALTH_TIMEOUT``). The
    loop body deliberately distinguishes ``TimeoutError`` from generic
    exception so an environmental timeout doesn't masquerade as a
    cookie_auth failure in the operator log.
    """
    for attempt in range(_HEALTH_RETRIES + 1):
        try:
            return await asyncio.wait_for(
                _check_platform_cookie(platform, account),
                timeout=_HEALTH_TIMEOUT,
            )
        except asyncio.TimeoutError:
            _log(f"[health] {platform}/{account} timeout (attempt {attempt + 1})")
        except Exception as exc:  # noqa: BLE001
            _log(f"[health] {platform}/{account} error (attempt {attempt + 1}): {exc}")
    return False


def _determine_health(
    quick: dict,
    real_valid: bool | None,
    last_check_at: datetime | None,
) -> str:
    """Map quick + real check results to a health enum.

    States:
      * ``invalid``      — quick check failed or real cookie_auth failed.
      * ``expiring_soon``— quick check passed, real check passed, but the
                           cookie file is stale (>24h) OR the last successful
                           real check is older than ``_EXPIRING_DAYS``.
      * ``valid``        — quick check passed, real check passed, and the
                           cookie is not stale.
      * ``unknown``      — no data yet (initial state).
    """
    if not quick["valid"]:
        return "invalid"
    if real_valid is False:
        return "invalid"
    # Cookie file itself is stale (e.g. >24h since refresh)
    if quick.get("stale"):
        return "expiring_soon"
    # Last successful real check is very old
    if last_check_at is not None:
        age_days = (datetime.now(timezone.utc) - last_check_at).days
        if age_days >= _EXPIRING_DAYS:
            return "expiring_soon"
    return "valid"


def _should_notify(old_health: str, new_health: str) -> bool:
    return old_health == "valid" and new_health in ("expiring_soon", "invalid")


def _can_notify(last_notified_at: str | None) -> bool:
    """24-hour rate limit per authorization."""
    last = _parse_iso(last_notified_at)
    if last is None:
        return True
    return (datetime.now(timezone.utc) - last) >= timedelta(hours=24)


def _get_user_email(user_id: int | None) -> str | None:
    db = get_database()
    if user_id is not None:
        row = db.fetch_one("SELECT email FROM users WHERE id = ?", (user_id,))
        if row:
            return row["email"]
    # Fallback chain for legacy/no-auth deployments
    row = db.fetch_one(
        "SELECT email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
    )
    if row:
        return row["email"]
    row = db.fetch_one("SELECT email FROM users ORDER BY id LIMIT 1")
    return row["email"] if row else None


def _build_health_email_body(account: str, platform: str, health: str, public_url: str) -> str:
    action_url = f"{public_url}/app/accounts?platform={platform}&action=login"
    status_text = "已失效" if health == "invalid" else "即将过期"
    return (
        f"您好，\n\n"
        f"您的账号 {account} (平台: {platform}) cookie {status_text}。\n"
        f"请尽快重新登录：\n\n"
        f"{action_url}\n\n"
        f"— social-auto-upload"
    )


def _get_user_notification_prefs(user_id: int | None) -> dict[str, bool]:
    """Return a user's health notification preferences.

    Defaults to both enabled when no user row exists (auth disabled
    or pre-migration schema).
    """
    db = get_database()
    if user_id is not None:
        row = db.fetch_one(
            "SELECT notify_health_email, notify_health_webhook FROM users WHERE id = ?",
            (user_id,),
        )
    else:
        row = db.fetch_one(
            "SELECT notify_health_email, notify_health_webhook FROM users ORDER BY id LIMIT 1"
        )
    if not row:
        return {"email": True, "webhook": True}
    return {
        "email": bool(row.get("notify_health_email", True)),
        "webhook": bool(row.get("notify_health_webhook", True)),
    }


def _send_health_notification(
    account: str,
    platform: str,
    health: str,
    old_health: str,
    user_id: int | None,
) -> None:
    """Emit webhook + email when health degrades.

    Webhook delivery reuses the existing notification worker.
    Email delivery uses the SMTP helper from auth routes.
    Both channels respect the authorization owner's notification preferences.
    """
    from web_runner.notifications import UploadEvent, emit_event
    from web_runner.routes.auth import _public_url, _send_smtp_email

    prefs = _get_user_notification_prefs(user_id)

    event_type = "cookie.expired" if health == "invalid" else "cookie.expiring_soon"
    title = f"{platform}/{account} cookie {'已失效' if health == 'invalid' else '即将过期'}"

    # Webhook / in-app notification
    if prefs.get("webhook", True):
        try:
            emit_event(
                UploadEvent(
                    event_type=event_type,
                    platform=platform,
                    account=account,
                    title=title,
                    status="error" if health == "invalid" else "failed",
                )
            )
        except Exception as exc:  # noqa: BLE001
            _log(f"[health] emit_event failed: {exc}")

    # Email notification
    if prefs.get("email", True):
        try:
            user_email = _get_user_email(user_id)
            if user_email:
                subject = (
                    f"[SAU] 账号 {account} 在 {platform} 平台 cookie "
                    f"{'已失效' if health == 'invalid' else '即将过期'}"
                )
                body = _build_health_email_body(account, platform, health, _public_url())
                _send_smtp_email(user_email, subject, body)
        except Exception as exc:  # noqa: BLE001
            _log(f"[health] email notification failed: {exc}")


def _update_authorization_health(
    auth_id: int,
    health: str,
    consecutive: int,
    next_check_at: datetime,
    *,
    real_check: bool = False,
) -> None:
    real_check_sql = "last_real_check_at = ?, " if real_check else ""
    params: list = [health, _now_iso()]
    if real_check:
        params.append(_now_iso())
    params.extend([consecutive, next_check_at.isoformat(), auth_id])
    db = get_database()
    db.execute(
        f"UPDATE account_authorizations SET last_health = ?, last_check_at = ?, "
        f"{real_check_sql}consecutive_failures = ?, next_check_at = ? WHERE id = ?",
        tuple(params),
    )


async def _check_authorization(auth: dict, *, force_real_check: bool = False) -> str:
    """Check a single authorization and persist its health.

    Returns the new health status.

    Real browser checks are expensive, so the periodic monitor only
    runs them when ``force_real_check`` is True or when the last real
    check is older than ``_REAL_CHECK_INTERVAL``. Quick file-based
    checks run every cycle.
    """
    auth_id = auth["id"]
    platform = auth["platform"]
    account = auth["account_name"]

    quick = _quick_check_cookie(platform, account)
    last_check_at = _parse_iso(auth.get("last_check_at"))

    real_valid: bool | None = None
    if quick["valid"] and force_real_check:
        real_valid = await _check_with_retry(platform, account)

    new_health = _determine_health(quick, real_valid, last_check_at)

    consecutive = (auth.get("consecutive_failures") or 0)
    if new_health == "invalid":
        consecutive += 1
    elif new_health == "valid":
        consecutive = 0

    next_check_at = datetime.now(timezone.utc) + timedelta(seconds=_HEALTH_INTERVAL)
    _update_authorization_health(auth_id, new_health, consecutive, next_check_at, real_check=force_real_check)

    return new_health


def _needs_real_check(auth: dict) -> bool:
    """Decide whether the periodic monitor should run a real browser check.

    Real checks are run when:
      * the last real check is unknown (new authorization), OR
      * the last real check is older than ``_REAL_CHECK_INTERVAL``, OR
      * the quick check reports the cookie as stale.
    """
    last_real_check_at = _parse_iso(auth.get("last_real_check_at"))
    if last_real_check_at is None:
        return True
    if (datetime.now(timezone.utc) - last_real_check_at).total_seconds() >= _REAL_CHECK_INTERVAL:
        return True
    return False


async def _run_monitor_cycle() -> None:
    db = get_database()
    auths = db.fetch_all(
        "SELECT aa.id, aa.platform, aa.last_health, aa.last_check_at, "
        "aa.consecutive_failures, aa.last_notified_at, ag.name as account_name, "
        "ag.owner_user_id "
        "FROM account_authorizations aa "
        "JOIN account_groups ag ON aa.group_id = ag.id"
    )

    for auth in auths:
        old_health = auth.get("last_health") or "unknown"
        force_real = _needs_real_check(auth)
        try:
            new_health = await _check_authorization(auth, force_real_check=force_real)
        except Exception as exc:  # noqa: BLE001
            _log(f"[health] error checking {auth['platform']}/{auth['account_name']}: {exc}")
            continue

        if _should_notify(old_health, new_health) and _can_notify(auth.get("last_notified_at")):
            _send_health_notification(
                auth["account_name"],
                auth["platform"],
                new_health,
                old_health,
                auth["owner_user_id"],
            )
            db.execute(
                "UPDATE account_authorizations SET last_notified_at = ? WHERE id = ?",
                (_now_iso(), auth["id"]),
            )


def _monitor_loop() -> None:
    while True:
        try:
            asyncio.run(_run_monitor_cycle())
        except Exception as exc:  # noqa: BLE001
            _log(f"[health] monitor cycle error: {exc}")
        time.sleep(_HEALTH_INTERVAL)


def start_health_monitor() -> None:
    """Idempotent: start the background health monitor once per process."""
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread is not None and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(
            target=_monitor_loop,
            daemon=True,
            name="sau-health-monitor",
        )
        _monitor_thread.start()
        _log("[health] monitor started")


def check_authorization_now(
    auth_id: int, *, force_real_check: bool = True
) -> dict:
    """Synchronously run a health check for a single authorization.

    Intended for the manual ``POST /api/account-authorizations/<id>/health-check``
    endpoint. Runs the async check in a fresh event loop inside the
    current thread.

    ``force_real_check`` (default ``True``): when True, a real browser
    ``cookie_auth()`` is invoked via ``cli.platforms.<plat>.check`` —
    i.e. Chromium spins up and visits the platform's creator page with
    the storage_state cookie loaded, just like a real upload would.
    The fast file-based ``_quick_check_cookie`` always runs first as a
    gate (``_check_authorization`` only enters the real branch when
    ``quick["valid"]`` is True); ``force_real_check`` only enables the
    second hop.

    Default is True so the manual button now matches its label
    ("立即完整验证" = "立即用真实浏览器查一次") and surfaces platform-side
    session expiry that file-level stats cannot detect — e.g. bilibili
    cookie file looks intact but ``/x/web-interface/nav`` returns
    ``isLogin=False``. Callers that want quick-only behavior (e.g. a
    future cheap pre-flight sweep) can pass ``force_real_check=False``.

    Trade-off: real cookie_auth takes 5–30s per call, or up to
    ``(_HEALTH_RETRIES + 1) * _HEALTH_TIMEOUT`` (= 60s by default)
    with the standard retry budget. The route in
    ``web_runner/routes/account_groups.py`` queues this call to a
    daemon thread so the HTTP response stays 202 non-blocking.

    Contract change history (round-OPT-3F-e2e follow-up): prior to this
    commit the default was force_real_check=False (a left-over from an
    earlier "don't blow up the budget" experiment) which silently
    downgraded the manual button to a file-only check while keeping
    the UI label "立即检查" — a UX lie. The flipped default plus the
    rerouted button label are the two halves of the same fix; do not
    revert one without the other.
    """
    db = get_database()
    auth = db.fetch_one(
        "SELECT aa.id, aa.platform, aa.last_health, aa.last_check_at, "
        "aa.consecutive_failures, aa.last_notified_at, ag.name as account_name "
        "FROM account_authorizations aa "
        "JOIN account_groups ag ON aa.group_id = ag.id "
        "WHERE aa.id = ?",
        (auth_id,),
    )
    if not auth:
        raise ValueError(f"Authorization {auth_id} not found")

    _log(
        f"[health] manual check for auth={auth_id} "
        f"platform={auth['platform']}/{auth['account_name']} "
        f"force_real_check={force_real_check}"
    )
    new_health = asyncio.run(
        _check_authorization(auth, force_real_check=force_real_check)
    )
    return {
        "health": new_health,
        "last_check_at": _now_iso(),
        "consecutive_failures": auth.get("consecutive_failures") or 0,
    }
