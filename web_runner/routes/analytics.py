"""Analytics — aggregates from PostgreSQL ``tasks`` table.

Front-end contract (``useAnalytics`` / charts):

- ``GET /api/analytics/summary`` →
  ``{ success, data: {
      total, success, failed, today, prev_total, prev_success,
      by_platform: { [platform]: { success, failed } },
      by_day: [{ date, success, failed }, ...],
      failure_reasons: [{ reason, count }, ...],
  }}``

- ``GET /api/analytics/accounts`` →
  ``{ success, data: { accounts: [{ account, platform, total, success, failed, success_rate, last_active }] } }``

- ``GET /api/analytics/export`` → CSV download
"""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import datetime, timedelta

from flask import Blueprint, Response, jsonify, request

from web_runner.db import get_connection

bp = Blueprint("analytics", __name__)


def _parse_day(s: str | None, default: datetime) -> str:
    if not s:
        return default.strftime("%Y-%m-%d")
    try:
        # Accept full ISO timestamps from the SPA (rangeToParams).
        raw = s[:10]
        datetime.strptime(raw, "%Y-%m-%d")
        return raw
    except ValueError:
        return default.strftime("%Y-%m-%d")


def _range_bounds() -> tuple[str, str]:
    """Return inclusive-start / exclusive-end day bounds for SQL filters.

    SPA ``rangeToParams`` sends ``to=now`` as the *inclusive* end of the
    window. Our SQL uses ``created < end``, so a raw ``to`` of today would
    drop every task dated today. When the client supplies ``to``, bump it
    by one calendar day for the exclusive upper bound.
    """
    today = datetime.now()
    start = _parse_day(request.args.get("from"), today - timedelta(days=30))
    if request.args.get("to"):
        end_day = _parse_day(request.args.get("to"), today)
        end = (datetime.strptime(end_day, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        end = _parse_day(None, today + timedelta(days=1))
    return start, end


def _is_success(status: str) -> bool:
    return status in ("success", "done", "completed")


def _is_failed(status: str) -> bool:
    return status in ("failed", "error")


@bp.get("/api/analytics/summary")
def analytics_summary():
    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")
    start, end = _range_bounds()

    # Previous window of equal length (for trend arrows).
    try:
        start_dt = datetime.strptime(start, "%Y-%m-%d")
        end_dt = datetime.strptime(end, "%Y-%m-%d")
        span = max((end_dt - start_dt).days, 1)
    except ValueError:
        start_dt = today - timedelta(days=30)
        span = 30
    prev_end = start
    prev_start = (start_dt - timedelta(days=span)).strftime("%Y-%m-%d")

    # ISO-8601 text timestamps compare lexicographically; prefer a sargable
    # range on `created` so idx_tasks_created can be used (substr() cannot).
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT status, platform, created, error FROM tasks "
            "WHERE created >= ? AND created < ?",
            (start, end),
        ).fetchall()
        prev_rows = conn.execute(
            "SELECT status FROM tasks "
            "WHERE created >= ? AND created < ?",
            (prev_start, prev_end),
        ).fetchall()

    by_platform: dict[str, dict[str, int]] = defaultdict(lambda: {"success": 0, "failed": 0})
    by_day: dict[str, dict[str, int]] = defaultdict(lambda: {"success": 0, "failed": 0})
    failure_reasons: dict[str, int] = defaultdict(int)
    total = len(rows)
    success = 0
    failed = 0
    today_count = 0

    for r in rows:
        status = (r.get("status") or "").lower()
        platform = r.get("platform") or "unknown"
        day = (r.get("created") or "")[:10] or "unknown"
        if day == today_str:
            today_count += 1
        if _is_success(status):
            success += 1
            by_platform[platform]["success"] += 1
            by_day[day]["success"] += 1
        elif _is_failed(status):
            failed += 1
            by_platform[platform]["failed"] += 1
            by_day[day]["failed"] += 1
            reason = (r.get("error") or "").strip() or "未知错误"
            # Keep reason short for chart labels.
            if len(reason) > 80:
                reason = reason[:77] + "..."
            failure_reasons[reason] += 1
        else:
            # pending/running/scheduled still contribute to platform volume as non-terminal
            by_platform[platform]["success"] += 0
            by_day[day]["success"] += 0

    prev_total = len(prev_rows)
    prev_success = sum(1 for r in prev_rows if _is_success((r.get("status") or "").lower()))

    by_day_list = [
        {"date": d, "success": v["success"], "failed": v["failed"]}
        for d, v in sorted(by_day.items())
        if d and d != "unknown"
    ]
    reasons_list = [
        {"reason": reason, "count": count}
        for reason, count in sorted(failure_reasons.items(), key=lambda x: -x[1])[:20]
    ]

    return jsonify({
        "success": True,
        "data": {
            "total": total,
            "success": success,
            "failed": failed,
            "today": today_count,
            "prev_total": prev_total,
            "prev_success": prev_success,
            "by_platform": dict(by_platform),
            "by_day": by_day_list,
            "failure_reasons": reasons_list,
            "from": start,
            "to": end,
        },
    })


@bp.get("/api/analytics/accounts")
def analytics_accounts():
    start, end = _range_bounds()

    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT platform, account, status, COUNT(*) AS cnt, "
            "MAX(created) AS last_active FROM tasks "
            "WHERE created >= ? AND created < ? "
            "GROUP BY platform, account, status",
            (start, end),
        ).fetchall()

    accounts: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r.get("platform") or "", r.get("account") or "")
        slot = accounts.setdefault(key, {
            "platform": key[0],
            "account": key[1],
            "total": 0,
            "success": 0,
            "failed": 0,
            "last_active": "",
        })
        cnt = int(r.get("cnt") or 0)
        status = (r.get("status") or "").lower()
        slot["total"] += cnt
        if _is_success(status):
            slot["success"] += cnt
        elif _is_failed(status):
            slot["failed"] += cnt
        la = r.get("last_active") or ""
        if la > (slot.get("last_active") or ""):
            slot["last_active"] = la

    out = []
    for slot in accounts.values():
        total = slot["total"] or 0
        slot["success_rate"] = round((slot["success"] / total) * 100, 1) if total else 0.0
        out.append(slot)

    out.sort(key=lambda x: (-x["total"], x["platform"], x["account"]))
    # Nested under `accounts` for the SPA hook; also keep raw list for older clients.
    return jsonify({"success": True, "data": {"accounts": out}})


@bp.get("/api/analytics/export")
def analytics_export():
    start, end = _range_bounds()

    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT task_id, platform, account, action, status, created, scheduled_at, error "
            "FROM tasks WHERE created >= ? AND created < ? "
            "ORDER BY created DESC",
            (start, end),
        ).fetchall()

    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=["task_id", "platform", "account", "action", "status", "created", "scheduled_at", "error"],
    )
    writer.writeheader()
    for r in rows:
        writer.writerow({k: r.get(k, "") for k in writer.fieldnames})

    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=analytics-export.csv"},
    )
