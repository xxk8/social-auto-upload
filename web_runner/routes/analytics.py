"""Analytics dashboard routes — summary stats, per-account stats, CSV export."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, jsonify, request

from web_runner.db import get_database

bp = Blueprint("analytics", __name__)


# 复用 ``web_runner.db.parse_date_param`` 的鲁棒日期 helper (统一
# 兜底语义, 避免路由层各自实现版本漂移)。后者有顶层
# ``except Exception`` 安全网, 任何异常输入都不会让本模块的三个
# analytics 路由 5xx 而是返回默认日期。三处 call-site (``summary``
# / ``accounts`` / ``export``) 一字不改, 因为 ``parse_date_param``
# 与旧 ``_parse_date`` 签名完全兼容。
from web_runner.db import parse_date_param  # noqa: E402

_parse_date = parse_date_param  # thin alias, kept for local readability


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _clamp_date_range(from_date: str, to_date: str, max_days: int) -> tuple[str, str]:
    """Clamp date range to max_days for free tier."""
    from_dt = datetime.strptime(from_date, "%Y-%m-%d")
    to_dt = datetime.strptime(to_date, "%Y-%m-%d")
    max_from = to_dt - timedelta(days=max_days)
    if from_dt < max_from:
        from_date = max_from.strftime("%Y-%m-%d")
    return from_date, to_date


def _get_user_tier() -> str:
    """Get current user's license tier."""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if not _is_auth_enabled():
        return "legacy"
    uid = _current_user_id()
    if uid is None:
        return "legacy"
    db = get_database()
    row = db.fetch_one("SELECT license_tier FROM users WHERE id = ?", (uid,))
    return (row and row.get("license_tier")) or "legacy"


@bp.get("/api/analytics/summary")
def analytics_summary():
    """Return aggregated publish statistics."""
    from_date = _parse_date(request.args.get("from"))
    to_date = _parse_date(request.args.get("to"), default_days_ago=0)

    # Tier-based date window enforcement
    tier = _get_user_tier()
    if tier == "free":
        from_date, to_date = _clamp_date_range(from_date, to_date, max_days=7)

    db = get_database()

    # Total counts
    total_row = db.fetch_one(
        "SELECT COUNT(*) as total FROM tasks WHERE created >= ? AND created <= ? || 'z'",
        (from_date, to_date),
    )
    total = total_row["total"] if total_row else 0

    success_row = db.fetch_one(
        "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'success' AND created >= ? AND created <= ? || 'z'",
        (from_date, to_date),
    )
    success = success_row["cnt"] if success_row else 0

    failed_row = db.fetch_one(
        "SELECT COUNT(*) as cnt FROM tasks WHERE status IN ('failed', 'error') AND created >= ? AND created <= ? || 'z'",
        (from_date, to_date),
    )
    failed = failed_row["cnt"] if failed_row else 0

    # Today's count
    today = _today_str()
    today_row = db.fetch_one(
        "SELECT COUNT(*) as cnt FROM tasks WHERE created >= ? AND created <= ? || 'z'",
        (today, today),
    )
    today_count = today_row["cnt"] if today_row else 0

    # Previous period for trend comparison
    from_dt = datetime.strptime(from_date, "%Y-%m-%d")
    to_dt = datetime.strptime(to_date, "%Y-%m-%d")
    period_days = max((to_dt - from_dt).days, 1)
    prev_from = (from_dt - timedelta(days=period_days)).strftime("%Y-%m-%d")
    prev_to = (from_dt - timedelta(days=1)).strftime("%Y-%m-%d")

    prev_total_row = db.fetch_one(
        "SELECT COUNT(*) as total FROM tasks WHERE created >= ? AND created <= ? || 'z'",
        (prev_from, prev_to),
    )
    prev_total = prev_total_row["total"] if prev_total_row else 0

    prev_success_row = db.fetch_one(
        "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'success' AND created >= ? AND created <= ? || 'z'",
        (prev_from, prev_to),
    )
    prev_success = prev_success_row["cnt"] if prev_success_row else 0

    # By platform
    platform_rows = db.fetch_all(
        "SELECT platform, status, COUNT(*) as cnt FROM tasks "
        "WHERE created >= ? AND created <= ? || 'z' "
        "GROUP BY platform, status",
        (from_date, to_date),
    )
    by_platform: dict[str, dict[str, int]] = {}
    for row in platform_rows:
        plat = row["platform"] or "unknown"
        if plat not in by_platform:
            by_platform[plat] = {"success": 0, "failed": 0}
        if row["status"] == "success":
            by_platform[plat]["success"] = row["cnt"]
        elif row["status"] in ("failed", "error"):
            by_platform[plat]["failed"] = row["cnt"]

    # By day
    day_rows = db.fetch_all(
        "SELECT SUBSTR(created, 1, 10) as day, status, COUNT(*) as cnt FROM tasks "
        "WHERE created >= ? AND created <= ? || 'z' "
        "GROUP BY day, status ORDER BY day",
        (from_date, to_date),
    )
    by_day_map: dict[str, dict[str, int]] = {}
    for row in day_rows:
        day = row["day"]
        if day not in by_day_map:
            by_day_map[day] = {"success": 0, "failed": 0}
        if row["status"] == "success":
            by_day_map[day]["success"] = row["cnt"]
        elif row["status"] in ("failed", "error"):
            by_day_map[day]["failed"] = row["cnt"]
    by_day = [{"date": d, **counts} for d, counts in sorted(by_day_map.items())]

    # Failure reasons (top 5)
    fail_rows = db.fetch_all(
        "SELECT COALESCE(error, 'Unknown error') as reason, COUNT(*) as cnt FROM tasks "
        "WHERE status IN ('failed', 'error') AND created >= ? AND created <= ? || 'z' "
        "AND error IS NOT NULL AND error != '' "
        "GROUP BY reason ORDER BY cnt DESC LIMIT 5",
        (from_date, to_date),
    )
    failure_reasons = [{"reason": r["reason"][:80], "count": r["cnt"]} for r in fail_rows]

    return jsonify({
        "success": True,
        "data": {
            "total": total,
            "success": success,
            "failed": failed,
            "today": today_count,
            "prev_total": prev_total,
            "prev_success": prev_success,
            "by_platform": by_platform,
            "by_day": by_day,
            "failure_reasons": failure_reasons,
        },
    })


@bp.get("/api/analytics/accounts")
def analytics_accounts():
    """Return per-account publish statistics."""
    from_date = _parse_date(request.args.get("from"))
    to_date = _parse_date(request.args.get("to"), default_days_ago=0)

    tier = _get_user_tier()
    if tier == "free":
        from_date, to_date = _clamp_date_range(from_date, to_date, max_days=7)

    db = get_database()

    rows = db.fetch_all(
        "SELECT account, platform, "
        "COUNT(*) as total, "
        "SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success, "
        "SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END) as failed, "
        "MAX(created) as last_active "
        "FROM tasks "
        "WHERE created >= ? AND created <= ? || 'z' "
        "AND account IS NOT NULL AND account != '' "
        "GROUP BY account, platform "
        "ORDER BY total DESC",
        (from_date, to_date),
    )

    accounts = []
    for row in rows:
        total = row["total"]
        success = row["success"]
        rate = round(success / total, 4) if total > 0 else 0
        accounts.append({
            "account": row["account"],
            "platform": row["platform"],
            "total": total,
            "success": success,
            "failed": row["failed"],
            "success_rate": rate,
            "last_active": row["last_active"],
        })

    return jsonify({"success": True, "data": {"accounts": accounts}})


@bp.get("/api/analytics/export")
def analytics_export():
    """Export tasks in date range as CSV."""
    from_date = _parse_date(request.args.get("from"))
    to_date = _parse_date(request.args.get("to"), default_days_ago=0)

    tier = _get_user_tier()
    if tier == "free":
        from_date, to_date = _clamp_date_range(from_date, to_date, max_days=7)

    db = get_database()
    rows = db.fetch_all(
        "SELECT created, platform, account, action, status, error "
        "FROM tasks WHERE created >= ? AND created <= ? || 'z' "
        "ORDER BY created DESC",
        (from_date, to_date),
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["日期", "平台", "账号", "操作", "状态", "错误信息"])
    for row in rows:
        writer.writerow([
            row.get("created", ""),
            row.get("platform", ""),
            row.get("account", ""),
            row.get("action", ""),
            row.get("status", ""),
            row.get("error", ""),
        ])

    csv_content = output.getvalue()
    output.close()

    return Response(
        csv_content,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sau-analytics-{from_date}-{to_date}.csv"},
    )
