"""Calendar tasks — maps PostgreSQL ``tasks`` onto a month-view contract.

Front-end: ``sau_web/frontend/src/api/calendar.ts``
  GET /api/calendar/tasks?start=YYYY-MM-DD&end=YYYY-MM-DD[&platform=][&account=]
  → { success, data: { tasks, summary: { total, by_platform, by_status } } }
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime

from flask import Blueprint, jsonify, request

from web_runner.db import get_connection

bp = Blueprint("calendar", __name__)


def _csv(s: str) -> list[str]:
    return [p.strip() for p in (s or "").split(",") if p.strip()]


def _title_from_argv(argv_raw: str | None, action: str, task_id: str) -> str:
    if not argv_raw:
        return action or task_id
    try:
        argv = json.loads(argv_raw)
    except (json.JSONDecodeError, TypeError):
        return action or task_id
    if not isinstance(argv, list):
        return action or task_id
    for i, a in enumerate(argv):
        if a in ("--title", "-t") and i + 1 < len(argv):
            return str(argv[i + 1])
    return action or task_id


def _effective_date(scheduled_at: str | None, created: str | None) -> str:
    raw = (scheduled_at or created or "")[:10]
    return raw if re.match(r"^\d{4}-\d{2}-\d{2}$", raw) else ""


@bp.get("/api/calendar/tasks")
def calendar_tasks():
    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    if not start or not end:
        return jsonify({
            "success": False,
            "message": "start and end are required (YYYY-MM-DD)",
        }), 400
    for label, value in (("start", start), ("end", end)):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            return jsonify({
                "success": False,
                "message": f"Invalid {label}={value!r}; use YYYY-MM-DD",
            }), 400

    platforms = _csv(request.args.get("platform", ""))
    accounts = _csv(request.args.get("account", ""))

    # Postgres: compare date prefix of COALESCE(scheduled_at, created).
    sql = (
        "SELECT task_id, platform, account, action, status, "
        "scheduled_at, created, argv, title "
        "FROM tasks WHERE "
        "substr(COALESCE(NULLIF(scheduled_at, ''), created), 1, 10) >= ? "
        "AND substr(COALESCE(NULLIF(scheduled_at, ''), created), 1, 10) < ?"
    )
    params: list = [start, end]
    if platforms:
        ph = ",".join("?" for _ in platforms)
        sql += f" AND platform IN ({ph})"
        params.extend(platforms)
    if accounts:
        ph = ",".join("?" for _ in accounts)
        sql += f" AND account IN ({ph})"
        params.extend(accounts)
    sql += " ORDER BY COALESCE(NULLIF(scheduled_at, ''), created), task_id"

    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(sql, params).fetchall()

    by_platform: Counter[str] = Counter()
    by_status: Counter[str] = Counter()
    tasks = []
    for row in rows:
        platform = row.get("platform") or ""
        status = row.get("status") or ""
        account = row.get("account") or ""
        by_platform[platform or "(none)"] += 1
        by_status[status or "(none)"] += 1
        scheduled_at = row.get("scheduled_at") or ""
        created = row.get("created") or ""
        title = row.get("title") or _title_from_argv(
            row.get("argv"), row.get("action") or "", row["task_id"]
        )
        tasks.append({
            "task_id": row["task_id"],
            "platform": platform,
            "account": account,
            "action": row.get("action"),
            "status": status,
            "title": title,
            "scheduled_at": scheduled_at or None,
            "created": created,
            "effective_date": _effective_date(scheduled_at, created),
        })

    return jsonify({
        "success": True,
        "data": {
            "tasks": tasks,
            "summary": {
                "total": len(tasks),
                "by_platform": dict(by_platform),
                "by_status": dict(by_status),
            },
        },
    })
