"""Smart scheduling — derive best hours from local task history.

Front-end: ``api.scheduling.*`` / SchedulingDialog
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from web_runner.db import get_connection

bp = Blueprint("scheduling", __name__)


def _hour_of_week(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00").replace(" ", "T"))
        if dt.tzinfo:
            dt = dt.replace(tzinfo=None)
    except ValueError:
        return None
    return dt.weekday() * 24 + dt.hour


def _insights_for(platform: str | None = None, account: str | None = None) -> dict:
    sql = "SELECT created, scheduled_at, status, platform, account FROM tasks WHERE 1=1"
    params: list = []
    if platform:
        sql += " AND platform = ?"
        params.append(platform)
    if account:
        sql += " AND account = ?"
        params.append(account)

    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(sql, params).fetchall()

    buckets: dict[int, dict] = defaultdict(lambda: {"samples": 0, "success": 0})
    for r in rows:
        how = _hour_of_week(r.get("scheduled_at") or r.get("created"))
        if how is None:
            continue
        b = buckets[how]
        b["samples"] += 1
        if r.get("status") == "success":
            b["success"] += 1

    insights = []
    now = datetime.now()
    for how, b in sorted(buckets.items()):
        if b["samples"] < 1:
            continue
        dow = how // 24
        hour = how % 24
        days_ahead = (dow - now.weekday()) % 7
        candidate = now.replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(
            days=days_ahead
        )
        if candidate <= now:
            candidate += timedelta(days=7)
        rate = b["success"] / b["samples"] if b["samples"] else 0
        insights.append({
            "hour_of_week": how,
            "weekday": dow,
            "hour": hour,
            "samples": b["samples"],
            "success": b["success"],
            "avg_views": int(rate * 1000),
            "success_rate": rate,
            "next_occurrence": candidate.strftime("%Y-%m-%d %H:%M:%S"),
        })
    insights.sort(key=lambda x: (x["success_rate"], x["samples"]), reverse=True)
    ready = len(insights) >= 3
    return {
        "insights": insights,
        "ready": ready,
        "platform": platform,
        "account": account,
        "message": None if ready else "数据积累中：多发几条成功任务后推荐会更准",
    }


@bp.get("/api/scheduling/insights")
@bp.post("/api/scheduling/insights")
def scheduling_insights():
    payload = request.get_json(silent=True) or {}
    platform = request.args.get("platform") or payload.get("platform")
    account = request.args.get("account") or payload.get("account")
    return jsonify({"success": True, "data": _insights_for(platform, account)})


@bp.get("/api/scheduling/auto-assign")
@bp.post("/api/scheduling/auto-assign")
def auto_assign():
    raw = request.get_json(silent=True)
    if isinstance(raw, list):
        assignments = []
        for item in raw:
            platform = (item or {}).get("platform")
            account = (item or {}).get("account")
            data = _insights_for(platform, account)
            pick = (data.get("insights") or [None])[0]
            assignments.append({
                "platform": platform,
                "account": account,
                "scheduled_at": pick["next_occurrence"] if pick else None,
                "suggested": pick,
            })
        ready = any(a.get("scheduled_at") for a in assignments)
        return jsonify({"success": True, "data": {"assignments": assignments, "ready": ready}})

    payload = raw or {}
    platform = request.args.get("platform") or payload.get("platform")
    account = request.args.get("account") or payload.get("account")
    data = _insights_for(platform, account)
    insights = data.get("insights") or []
    pick = insights[0] if insights else None
    return jsonify({
        "success": True,
        "data": {
            "suggested": pick,
            "scheduled_at": pick["next_occurrence"] if pick else None,
            "ready": data.get("ready", False),
            "assignments": [
                {
                    "platform": platform,
                    "account": account,
                    "scheduled_at": pick["next_occurrence"] if pick else None,
                    "suggested": pick,
                }
            ]
            if pick
            else [],
        },
    })
