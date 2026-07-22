"""Analytics — aggregates from local SQLite ``tasks`` table.

Front-end: ``api.analytics.*`` in ``client.ts``
"""
from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime, timedelta

from flask import Blueprint, Response, jsonify, request

from web_runner.db import get_connection

bp = Blueprint("analytics", __name__)


def _parse_day(s: str | None, default: datetime) -> str:
    if not s:
        return default.strftime("%Y-%m-%d")
    try:
        datetime.strptime(s[:10], "%Y-%m-%d")
        return s[:10]
    except ValueError:
        return default.strftime("%Y-%m-%d")


@bp.get("/api/analytics/summary")
def analytics_summary():
    today = datetime.now()
    start = _parse_day(request.args.get("from"), today - timedelta(days=30))
    end = _parse_day(request.args.get("to"), today + timedelta(days=1))

    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT status, platform, created FROM tasks "
            "WHERE substr(COALESCE(created,''),1,10) >= ? "
            "AND substr(COALESCE(created,''),1,10) < ?",
            (start, end),
        ).fetchall()

    by_status: Counter[str] = Counter()
    by_platform: Counter[str] = Counter()
    by_day: Counter[str] = Counter()
    for r in rows:
        by_status[r.get("status") or "unknown"] += 1
        by_platform[r.get("platform") or "unknown"] += 1
        by_day[(r.get("created") or "")[:10]] += 1

    total = len(rows)
    success = by_status.get("success", 0)
    return jsonify({
        "success": True,
        "data": {
            "total": total,
            "success": success,
            "failed": by_status.get("failed", 0) + by_status.get("error", 0),
            "pending": by_status.get("pending", 0) + by_status.get("running", 0),
            "success_rate": (success / total) if total else 0,
            "by_status": dict(by_status),
            "by_platform": dict(by_platform),
            "by_day": dict(sorted(by_day.items())),
            "from": start,
            "to": end,
        },
    })


@bp.get("/api/analytics/accounts")
def analytics_accounts():
    today = datetime.now()
    start = _parse_day(request.args.get("from"), today - timedelta(days=30))
    end = _parse_day(request.args.get("to"), today + timedelta(days=1))

    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT platform, account, status, COUNT(*) AS cnt FROM tasks "
            "WHERE substr(COALESCE(created,''),1,10) >= ? "
            "AND substr(COALESCE(created,''),1,10) < ? "
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
        })
        cnt = int(r.get("cnt") or 0)
        status = r.get("status") or ""
        slot["total"] += cnt
        if status == "success":
            slot["success"] += cnt
        elif status in ("failed", "error"):
            slot["failed"] += cnt

    return jsonify({"success": True, "data": list(accounts.values())})


@bp.get("/api/analytics/export")
def analytics_export():
    today = datetime.now()
    start = _parse_day(request.args.get("from"), today - timedelta(days=30))
    end = _parse_day(request.args.get("to"), today + timedelta(days=1))

    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT task_id, platform, account, action, status, created, scheduled_at, error "
            "FROM tasks WHERE substr(COALESCE(created,''),1,10) >= ? "
            "AND substr(COALESCE(created,''),1,10) < ? "
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
        writer.writerow(r)
    data = buf.getvalue().encode("utf-8-sig")
    return Response(
        data,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=analytics_{start}_{end}.csv"},
    )
