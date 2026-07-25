"""Admin API — Postgres-backed for local Web Shell.

Front-end: ``sau_web/frontend/src/features/admin/adminApi.ts``
"""
from __future__ import annotations

import csv
import io
import os
import platform
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import Blueprint, Response, jsonify, request, session

from web_runner.db import get_connection
from web_runner.routes.auth import _is_auth_enabled, _current_user_id, _serialize_user

bp = Blueprint("admin", __name__)


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _is_auth_enabled():
            return fn(*args, **kwargs)
        uid = _current_user_id()
        if uid is None:
            return jsonify({"success": False, "message": "未登录"}), 401
        with get_connection() as conn:
            conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
            user = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not user or (user.get("role") or "") != "admin":
            return jsonify({"success": False, "message": "需要管理员"}), 403
        return fn(*args, **kwargs)

    return wrapper


def _ensure_audit_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER,
            action TEXT NOT NULL,
            detail TEXT,
            created_at TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0
        )
        """
    )


@bp.get("/api/admin/users")
@admin_required
def admin_users():
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT * FROM users ORDER BY id DESC"
        ).fetchall()
    users = []
    for r in rows:
        users.append({
            "id": r["id"],
            "email": r.get("email"),
            "role": r.get("role") or "user",
            "name": r.get("name"),
            "avatar": r.get("avatar"),
            "tier": r.get("license_tier") or "legacy",
            "is_founder": bool(r.get("is_founder")),
            "created_at": r.get("created_at"),
            "last_login": r.get("last_login"),
        })
    if not users and not _is_auth_enabled():
        users = [{
            "id": 0,
            "email": "local@sau.dev",
            "role": "admin",
            "name": "local",
            "tier": "legacy",
            "is_founder": True,
            "created_at": _now(),
            "last_login": _now(),
        }]
    return jsonify({"success": True, "data": users})


@bp.put("/api/admin/users/<int:user_id>/role")
@admin_required
def admin_set_role(user_id: int):
    payload = request.get_json(silent=True) or {}
    role = payload.get("role") or "user"
    if role not in ("admin", "user"):
        return jsonify({"success": False, "message": "invalid role"}), 400
    with get_connection() as conn:
        cur = conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        conn.commit()
        if cur.rowcount == 0 and user_id != 0:
            return jsonify({"success": False, "message": "user not found"}), 404
        _ensure_audit_table(conn)
        conn.execute(
            "INSERT INTO admin_audit_log (actor_user_id, action, detail, created_at) "
            "VALUES (?, ?, ?, ?)",
            (_current_user_id() or 0, "set_role", f"user={user_id} role={role}", _now()),
        )
        conn.commit()
    return jsonify({"success": True, "data": {"id": user_id, "role": role}})


@bp.get("/api/admin/audit")
@admin_required
def admin_audit():
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        _ensure_audit_table(conn)
        rows = conn.execute(
            "SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return jsonify({"success": True, "data": rows})


@bp.get("/api/admin/overview")
@admin_required
def admin_overview():
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        total_users = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()["cnt"]
        total_tasks = conn.execute("SELECT COUNT(*) AS cnt FROM tasks").fetchone()["cnt"]
        success = conn.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'success'"
        ).fetchone()["cnt"]
        rate = round((success / total_tasks * 100), 1) if total_tasks else 0.0
        recent = conn.execute(
            "SELECT task_id, platform, action, status, created, account "
            "FROM tasks ORDER BY created DESC LIMIT 10"
        ).fetchall()
    if not _is_auth_enabled() and total_users == 0:
        total_users = 1
    return jsonify({
        "success": True,
        "data": {
            "total_users": total_users,
            "active_today": total_users,
            "total_tasks": total_tasks,
            "task_success_rate": rate,
            "recent_actions": [
                {
                    "id": i + 1,
                    "user_id": 0,
                    "action": f"{r.get('action')}:{r.get('status')}",
                    "created_at": r.get("created"),
                    "user_email": r.get("account") or "local",
                    "platform": r.get("platform"),
                    "task_id": r.get("task_id"),
                }
                for i, r in enumerate(recent)
            ],
        },
    })


@bp.get("/api/admin/audit/unacknowledged-count")
@admin_required
def admin_unack_count():
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        _ensure_audit_table(conn)
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE acknowledged = 0"
        ).fetchone()
    return jsonify({"success": True, "data": {"count": row["cnt"] if row else 0}})


@bp.post("/api/admin/audit/acknowledge")
@admin_required
def admin_ack():
    with get_connection() as conn:
        _ensure_audit_table(conn)
        cur = conn.execute(
            "UPDATE admin_audit_log SET acknowledged = 1 WHERE acknowledged = 0"
        )
        conn.commit()
        updated = cur.rowcount
    return jsonify({"success": True, "data": {"updated": updated}})


@bp.get("/api/admin/system")
@admin_required
def admin_system():
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        by_status = conn.execute(
            "SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status"
        ).fetchall()
        by_platform = conn.execute(
            "SELECT platform, COUNT(*) AS cnt FROM tasks GROUP BY platform"
        ).fetchall()
        errors = conn.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE status IN ('failed','error')"
        ).fetchone()["cnt"]
    return jsonify({
        "success": True,
        "data": {
            "by_status": {r["status"] or "unknown": r["cnt"] for r in by_status},
            "by_platform": {r["platform"] or "unknown": r["cnt"] for r in by_platform},
            "error_count": errors,
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "auth_enabled": _is_auth_enabled(),
        },
    })


@bp.get("/api/admin/trends")
@admin_required
def admin_trends():
    metric = request.args.get("metric") or "tasks"
    days = request.args.get("days", 14, type=int)
    days = max(1, min(days, 90))
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT substr(created,1,10) AS day, status, COUNT(*) AS cnt "
            "FROM tasks WHERE substr(created,1,10) >= ? "
            "GROUP BY day, status ORDER BY day",
            (start,),
        ).fetchall()
    by_day: dict[str, dict] = {}
    for r in rows:
        day = r["day"] or ""
        slot = by_day.setdefault(day, {"day": day, "total": 0, "success": 0, "failed": 0})
        cnt = int(r["cnt"] or 0)
        slot["total"] += cnt
        if r["status"] == "success":
            slot["success"] += cnt
        elif r["status"] in ("failed", "error"):
            slot["failed"] += cnt
    series = list(by_day.values())
    return jsonify({
        "success": True,
        "data": {
            "metric": metric,
            "days": days,
            "series": series,
        },
    })


@bp.get("/api/admin/trends/export")
@admin_required
def admin_trends_export():
    days = request.args.get("days", 14, type=int)
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(
            "SELECT substr(created,1,10) AS day, status, COUNT(*) AS cnt "
            "FROM tasks WHERE substr(created,1,10) >= ? GROUP BY day, status ORDER BY day",
            (start,),
        ).fetchall()
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["day", "status", "cnt"])
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return Response(
        buf.getvalue().encode("utf-8-sig"),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=admin_trends.csv"},
    )


@bp.post("/api/admin/founder/transfer")
@admin_required
def founder_transfer():
    payload = request.get_json(silent=True) or {}
    target = payload.get("target_user_id")
    return jsonify({
        "success": True,
        "message": "local shell: founder transfer is a no-op",
        "data": {"target_user_id": target, "applied": False},
    })
