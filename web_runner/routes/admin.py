"""Admin dashboard API — user management, audit logs, system overview.

All endpoints are protected by @admin_required.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, jsonify, request, session

from web_runner.db import get_database
from web_runner.routes.auth import admin_required, _now_iso

bp = Blueprint("admin", __name__)


# ── Trend-series helpers (admin trends endpoint) ──────────────────
#
# Query strategy (1 query per metric, not N):
#   1. Pull PER-DAY `daily` counts for the last `days` days from each
#      source table (users / tasks / usage_logs). 1 query = a single
#      table scan over the date window.
#   2. Build a Python-side cumulative series by walking oldest-first
#      and accumulating. 0-fills days with no rows so the series
#      length is always exactly `days`.
#
# Why 1 query per metric vs the alternative (N subqueries per metric):
#   * 4 metrics × 14 days = 56 subqueries is a wasteful pattern.
#   * The window-scan + Python-aggregate approach is O(days) per
#     call, with one DB hit per metric (4 hits per page load).
#
# SQL dialect notes (works on both SQLite + Postgres):
#   * `date(col)` is a SQL standard function — both backends accept
#     TEXT and TIMESTAMP inputs and return a `YYYY-MM-DD` string.
#   * `?` placeholders are translated to `%s` automatically by
#     ``web_runner.db._translate_placeholders`` for PG.
#   * The day-window WHERE clause is a single bound param so we
#     avoid any string interpolation of user input (no SQL-inject
#     surface; only the metric key is interpolated, and it's gated
#     by the `_ALLOWED_METRICS` allow-list below).

_TREND_ALLOWED_METRICS: frozenset = frozenset({
    "total_users",
    "active_today",
    "total_tasks",
    "task_success_rate",
})

_TREND_DAYS_MIN = 1
_TREND_DAYS_MAX = 90
_TREND_DAYS_DEFAULT = 14
# Width of the rolling window for the rate metric. 7 is the canonical
# smoothing that keeps recent-trend signal visible while dampening
# single-day noise (a single 0-task day doesn't crash the rate to
# 0%). Note: at the start of a series the window is progressively
# smaller — e.g. for `days=14`, the first 6 points have windows
# < 7 days (i=0 → 1-day window, i=6 → 7-day window) before reaching
# full 7-day coverage at i=6. This is expected rolling-window
# behavior; sparkline readers should be aware that the warm-up
# period is noisier than the steady-state.
_TREND_RATE_WINDOW = 7


def _day_window_dates(days: int) -> list[str]:
    """Return ``days`` ISO date strings, oldest-first, ending today UTC.

    Length is always exactly ``days`` so callers can index by position.
    """
    today = datetime.now(timezone.utc).date()
    return [
        (today - timedelta(days=offset)).isoformat()
        for offset in range(days - 1, -1, -1)
    ]


def _per_day_counts(
    table: str,
    date_col: str,
    earliest_day: str,
    *,
    count_distinct_user: bool = False,
) -> dict[str, int]:
    """Return a ``{YYYY-MM-DD: count}`` map for the given table column.

    The SQL counts per-day rows from `earliest_day` forward (inclusive).
    For ``count_distinct_user=True``, switches to ``COUNT(DISTINCT
    user_id)`` for the per-day active-users metric. Day-window WHERE
    keeps the scan bounded so a multi-year-old tasks table still
    finishes in O(days) rather than O(all-rows).

    ``table`` and ``date_col`` are interpolated into the SQL string
    (not bound) so they MUST be hardcoded from internal callers — a
    defensive allow-list is enforced here so a future refactor that
    reuses this helper with user input can't accidentally introduce
    a SQL-injection surface.
    """
    _ALLOWED_TABLES = frozenset({"users", "tasks", "usage_logs"})
    _ALLOWED_DATE_COLS = frozenset({"created_at", "created"})
    if table not in _ALLOWED_TABLES:
        raise ValueError(f"_per_day_counts: table {table!r} not in allow-list")
    if date_col not in _ALLOWED_DATE_COLS:
        raise ValueError(f"_per_day_counts: date_col {date_col!r} not in allow-list")
    db = get_database()
    cnt_expr = (
        "COUNT(DISTINCT user_id)" if count_distinct_user else "COUNT(*)"
    )
    rows = db.fetch_all(
        f"SELECT date({date_col}) AS d, {cnt_expr} AS cnt "
        f"FROM {table} "
        f"WHERE date({date_col}) >= ? "
        f"GROUP BY date({date_col})",
        (earliest_day,),
    )
    return {row["d"]: int(row["cnt"] or 0) for row in rows}


def _per_day_status_counts(
    table: str,
    date_col: str,
    earliest_day: str,
) -> dict[str, dict[str, int]]:
    """Return ``{YYYY-MM-DD: {total, success}}`` per day for rate metrics.

    The PG + SQLite dialect-safe way to compute a "success rate" over
    a window without doing N subqueries is to do a single GROUP BY
    and project both totals and a SUM-CASE for the success subset.
    """
    db = get_database()
    rows = db.fetch_all(
        f"SELECT date({date_col}) AS d, "
        f"  COUNT(*) AS total, "
        f"  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success "
        f"FROM {table} "
        f"WHERE date({date_col}) >= ? "
        f"GROUP BY date({date_col})",
        (earliest_day,),
    )
    return {
        row["d"]: {
            "total": int(row["total"] or 0),
            "success": int(row["success"] or 0),
        }
        for row in rows
    }


def _build_trend_points(metric: str, days: int) -> list[float]:
    """Compute the N-day value series for ``metric``, oldest-first.

    The series ALWAYS has length ``days``. Days with no source rows
    (fresh DB, weekend quiet, etc.) are 0-filled so the front-end
    sparkline doesn't get a "missing data" shape.
    """
    day_strs = _day_window_dates(days)
    if not day_strs:
        return []
    earliest = day_strs[0]

    if metric == "total_users":
        per_day = _per_day_counts("users", "created_at", earliest)
        cumulative = 0
        out: list[float] = []
        for d in day_strs:
            cumulative += per_day.get(d, 0)
            out.append(float(cumulative))
        return out

    if metric == "total_tasks":
        per_day = _per_day_counts("tasks", "created", earliest)
        cumulative = 0
        out = []
        for d in day_strs:
            cumulative += per_day.get(d, 0)
            out.append(float(cumulative))
        return out

    if metric == "active_today":
        per_day = _per_day_counts(
            "usage_logs", "created_at", earliest, count_distinct_user=True
        )
        return [float(per_day.get(d, 0)) for d in day_strs]

    if metric == "task_success_rate":
        per_day = _per_day_status_counts("tasks", "created", earliest)
        # 7-day rolling success rate ending at each day. The previous
        # implementation walked a cumulative-to-date ratio from
        # ``earliest`` forward, which produced a monotonically
        # non-decreasing series (every new day could only ADD tasks,
        # so the running ratio always moved toward the all-time mean).
        # That shape mis-told the admin's story: a brand-new project
        # at 100% success rate today rendered as a sparkline climbing
        # from 0% → 100% across 14 days, falsely implying "we got
        # better over time." A 7-day rolling window is the canonical
        # smoothing that keeps recent-trend signal visible while
        # dampening single-day noise (a single 0-task day doesn't
        # crash the rate to 0%).
        out: list[float] = []
        for i, _d in enumerate(day_strs):
            window_start = max(0, i - _TREND_RATE_WINDOW + 1)
            win_total = 0
            win_success = 0
            for j in range(window_start, i + 1):
                day_data = per_day.get(day_strs[j])
                if day_data is not None:
                    win_total += day_data["total"]
                    win_success += day_data["success"]
            if win_total == 0:
                out.append(0.0)
            else:
                out.append(round(win_success / win_total * 100, 1))
        return out

    # Defensive: caller should have validated against the allow-list
    # before reaching here. Return empty rather than 500 so a future
    # metric added without endpoint validation can't crash the page.
    return []


@bp.get("/api/admin/users")
@admin_required
def list_users_admin():
    """List all users with tier info (admin only)."""
    db = get_database()
    rows = db.fetch_all(
        "SELECT id, email, role, COALESCE(license_tier, 'legacy') AS tier, created_at, last_login "
        "FROM users ORDER BY id"
    )
    return jsonify({"success": True, "data": rows})


@bp.put("/api/admin/users/<int:user_id>/role")
@admin_required
def update_user_role_admin(user_id: int):
    """Change a user's role with audit logging (admin only).

    Prevents self-demotion (an admin cannot downgrade themselves).
    """
    from flask import session

    payload = request.get_json(silent=True) or {}
    new_role = payload.get("role")
    if new_role not in ("admin", "user"):
        return jsonify({"success": False, "message": "role 必须是 admin 或 user"}), 400

    db = get_database()

    # Prevent self-demotion
    current_admin_id = session.get("user_id")
    if current_admin_id == user_id:
        return jsonify({"success": False, "message": "不能修改自己的角色"}), 403

    # Fetch target user
    user = db.fetch_one(
        "SELECT id, role, email FROM users WHERE id = ?", (user_id,)
    )
    if not user:
        return jsonify({"success": False, "message": "用户不存在"}), 404

    old_role = user["role"]
    if old_role == new_role:
        return jsonify({"success": False, "message": "新角色与当前角色相同"}), 400

    db.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, user_id))

    # Write audit log.  Audit-log failure is a warning, not a hard
    # error — the role change succeeded and the user should see 200.
    # A transient audit-log table issue (FK/NULL constraint in
    # SAU_AUTH_ENABLED=false mode, locked DB, etc.) must not take
    # down the response.  Mirrors the try/except contract from
    # export_trends below.
    now = _now_iso()
    try:
        db.execute(
            "INSERT INTO admin_audit_log (admin_user_id, target_user_id, action, detail, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                current_admin_id,
                user_id,
                "role_change",
                json.dumps({"old_role": old_role, "new_role": new_role}),
                now,
            ),
        )
    except Exception as _audit_exc:  # noqa: BLE001 — logged, not re-raised
        try:
            from utils.log import logger as _audit_logger
            _audit_logger.warning(
                "admin role-change audit log failed (user_id=%d old=%s new=%s): %s",
                user_id, old_role, new_role, _audit_exc,
            )
        except Exception:
            # Logger import itself failed — silently drop the audit
            # row but still return the 200.
            pass

    return jsonify({
        "success": True,
        "data": {
            "id": user_id,
            "role": new_role,
            "email": user["email"],
        },
    })


@bp.get("/api/admin/audit")
@admin_required
def list_audit_logs():
    """List admin audit logs with pagination + optional date range (admin only).

    Query params:
      page, per_page — pagination (default 1, 50; per_page clamped to 1..100)
      start_date, end_date — ISO datetime strings (e.g. 2026-07-05T00:00:00)
                               filtering on created_at inclusive.
    """
    page = max(1, request.args.get("page", 1, type=int))
    per_page = max(1, min(request.args.get("per_page", 50, type=int), 100))
    offset = (page - 1) * per_page

    start_date = request.args.get("start_date", "", type=str).strip()
    end_date = request.args.get("end_date", "", type=str).strip()

    db = get_database()
    where_clauses = []
    params: list = []

    if start_date:
        where_clauses.append("a.created_at >= ?")
        params.append(start_date)
    if end_date:
        where_clauses.append("a.created_at <= ?")
        params.append(end_date)

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    logs = db.fetch_all(
        f"SELECT a.id, a.admin_user_id, a.target_user_id, a.action, a.detail, a.created_at, "
        f"  admin.email AS admin_email, target.email AS target_email "
        f"FROM admin_audit_log a "
        f"LEFT JOIN users admin ON admin.id = a.admin_user_id "
        f"LEFT JOIN users target ON target.id = a.target_user_id "
        f"{where_sql} "
        f"ORDER BY a.created_at DESC "
        f"LIMIT ? OFFSET ?",
        (*params, per_page, offset),
    )

    count_sql = f"SELECT COUNT(*) AS cnt FROM admin_audit_log a {where_sql}"
    total_row = db.fetch_one(count_sql, tuple(params))
    total = total_row["cnt"] if total_row else 0

    return jsonify({
        "success": True,
        "data": {
            "logs": logs,
            "total": total,
            "page": page,
            "per_page": per_page,
        },
    })


@bp.get("/api/admin/overview")
@admin_required
def get_overview():
    """System overview statistics (admin only).

    Query params:
      start_date, end_date — ISO datetime strings filtering recent_actions
                               on usage_logs.created_at inclusive.
    """
    db = get_database()

    total_users_row = db.fetch_one("SELECT COUNT(*) AS cnt FROM users")
    total_users = total_users_row["cnt"] if total_users_row else 0

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    active_today_row = db.fetch_one(
        "SELECT COUNT(DISTINCT user_id) AS cnt FROM usage_logs WHERE created_at >= ?",
        (today,),
    )
    active_today = active_today_row["cnt"] if active_today_row else 0

    total_tasks_row = db.fetch_one("SELECT COUNT(*) AS cnt FROM tasks")
    total_tasks = total_tasks_row["cnt"] if total_tasks_row else 0

    success_row = db.fetch_one("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'success'")
    success_count = success_row["cnt"] if success_row else 0
    task_success_rate = round((success_count / total_tasks * 100), 1) if total_tasks > 0 else 0.0

    start_date = request.args.get("start_date", "", type=str).strip()
    end_date = request.args.get("end_date", "", type=str).strip()

    where_clauses = []
    params: list = []

    if start_date:
        where_clauses.append("u.created_at >= ?")
        params.append(start_date)
    if end_date:
        where_clauses.append("u.created_at <= ?")
        params.append(end_date)

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    recent_actions = db.fetch_all(
        f"SELECT u.id, u.user_id, u.action, u.created_at, usr.email AS user_email "
        f"FROM usage_logs u "
        f"LEFT JOIN users usr ON usr.id = u.user_id "
        f"{where_sql} "
        f"ORDER BY u.created_at DESC LIMIT 10",
        tuple(params),
    )

    return jsonify({
        "success": True,
        "data": {
            "total_users": total_users,
            "active_today": active_today,
            "total_tasks": total_tasks,
            "task_success_rate": task_success_rate,
            "recent_actions": recent_actions,
        },
    })


@bp.get("/api/admin/audit/unacknowledged-count")
@admin_required
def get_unacknowledged_audit_count():
    """Return the number of unacknowledged admin audit logs.

    Used by the frontend audit nav-tab badge to surface "new" admin
    actions that the current admin hasn't reviewed yet. Count is
    scoped to ALL admin actions (not per-admin) because any admin
    viewing the audit page "acknowledges" the event for the team.
    """
    db = get_database()
    row = db.fetch_one(
        "SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE acknowledged = 0"
    )
    return jsonify({"success": True, "data": {"count": row["cnt"] if row else 0}})


@bp.post("/api/admin/audit/acknowledge")
@admin_required
def acknowledge_audit_logs():
    """Mark all unacknowledged admin audit logs as acknowledged.

    Called by the frontend when the admin visits the Audit page so
    the badge count resets to zero.
    """
    db = get_database()
    updated = db.execute(
        "UPDATE admin_audit_log SET acknowledged = 1 WHERE acknowledged = 0"
    )
    return jsonify({"success": True, "data": {"updated": updated}})


@bp.get("/api/admin/system")
@admin_required
def get_system():
    """System status: task breakdown by status, platform, errors (admin only)."""
    db = get_database()

    # Tasks by status
    status_rows = db.fetch_all(
        "SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status"
    )
    tasks_by_status = {row["status"]: row["cnt"] for row in status_rows}

    # Tasks by platform
    platform_rows = db.fetch_all(
        "SELECT platform, COUNT(*) AS cnt FROM tasks WHERE platform IS NOT NULL GROUP BY platform"
    )
    tasks_by_platform = {row["platform"]: row["cnt"] for row in platform_rows}

    # Errors by type
    error_rows = db.fetch_all(
        "SELECT exc_type, COUNT(*) AS cnt FROM error_events "
        "WHERE exc_type IS NOT NULL GROUP BY exc_type ORDER BY cnt DESC LIMIT 10"
    )
    errors_by_type = {row["exc_type"]: row["cnt"] for row in error_rows}

    return jsonify({
        "success": True,
        "data": {
            "tasks_by_status": tasks_by_status,
            "tasks_by_platform": tasks_by_platform,
            "errors_by_type": errors_by_type,
        },
    })


@bp.get("/api/admin/trends")
@admin_required
def get_trends():
    """Return N-day value series for a given admin-overview metric (admin only).

    Query params:
      metric — one of: ``total_users``, ``active_today``, ``total_tasks``,
               ``task_success_rate``. Required.
      days   — integer 1..90 (default 14). Clamped silently so a typo
               like ``days=999`` doesn't 500 the page.

    Response shape:
      ``{ success, data: { metric, days, points: number[] } }``
      ``points`` is the N-day series, OLDEST FIRST, ending at today UTC.
      Days with no source rows are 0-filled so the series length is
      always exactly ``days`` (the front-end sparkline renderer
      requires a fixed-length array).

    The front-end ``adminApi.getTrends()`` is the primary consumer
    (replaces the in-memory ``trendMock`` on AdminOverviewPage);
    ``trendMock`` is still wired as a fallback for when this endpoint
    5xx's or the network drops.
    """
    metric = (request.args.get("metric", "") or "").strip()
    if metric not in _TREND_ALLOWED_METRICS:
        return jsonify({
            "success": False,
            "message": (
                f"metric 必须是以下之一: {', '.join(sorted(_TREND_ALLOWED_METRICS))}"
            ),
        }), 400

    raw_days = request.args.get("days", _TREND_DAYS_DEFAULT, type=int)
    # ``type=int`` already returns None on parse failure; coerce
    # to default. Then clamp the range.
    days = _TREND_DAYS_DEFAULT if raw_days is None else raw_days
    days = max(_TREND_DAYS_MIN, min(days, _TREND_DAYS_MAX))

    points = _build_trend_points(metric, days)
    return jsonify({
        "success": True,
        "data": {
            "metric": metric,
            "days": days,
            "points": points,
        },
    })


@bp.get("/api/admin/trends/export")
@admin_required
def export_trends():
    """Stream N-day value series as CSV (admin only).

    Query params:
      metric — optional. One of the same 4 allow-listed keys the JSON
               endpoint accepts. When omitted, the response contains
               all 4 metrics in a single 5-column CSV (date +
               total_users + active_today + total_tasks +
               task_success_rate). When provided, the response is a
               2-column CSV (date, value).
      days   — 1..90, default 14, silently clamped.

    Response:
      200 with ``Content-Type: text/csv`` + ``Content-Disposition:
      attachment; filename=sau-trends-{scope}-{days}d-{YYYY-MM-DD}.csv``.
      A UTF-8 BOM (``\\ufeff``) is prepended so Excel-CN imports the
      file without the "Data → From Text/CSV" wizard.
      400 on unknown metric (mirrors the JSON endpoint's allow-list
      contract).
      401/403 on auth failures (via ``@admin_required``).

    Audit log:
      A ``export_trends`` row is inserted BEFORE the stream is
      returned so the side effect is durably recorded even if the
      client aborts mid-stream. ``detail`` is JSON with ``metric``,
      ``days``, ``row_count``, ``file_format`` for forensic replay.

    Streaming:
      Implemented as a Flask generator wrapped in
      ``Response(generate(), mimetype="text/csv")``. For 14 days the
      total payload is <1 KB so streaming is functionally equivalent
      to a single-shot response; the generator pattern is here so
      future days windows (days=90) don't reflow the whole payload
      in memory.
    """
    metric = (request.args.get("metric", "") or "").strip()
    if metric and metric not in _TREND_ALLOWED_METRICS:
        return jsonify({
            "success": False,
            "message": (
                f"metric 必须是以下之一: {', '.join(sorted(_TREND_ALLOWED_METRICS))}"
            ),
        }), 400

    raw_days = request.args.get("days", _TREND_DAYS_DEFAULT, type=int)
    days = _TREND_DAYS_DEFAULT if raw_days is None else raw_days
    days = max(_TREND_DAYS_MIN, min(days, _TREND_DAYS_MAX))
    dates = _day_window_dates(days)

    # Audit log FIRST so a mid-stream client abort still records the
    # attempt. ``target_user_id`` is NULL because there's no target
    # user; ``detail`` carries the full request context for replay.
    # Audit failure is a warning, not a hard error: a transient
    # audit-log table issue (FK violation, locked DB, etc.) should
    # not take down the export path. The CSV is the primary
    # deliverable; the audit row is forensic nice-to-have.
    db = get_database()
    now = _now_iso()
    admin_id = session.get("user_id")
    detail = json.dumps({
        "metric": metric or "all",
        "days": days,
        "row_count": days,
        "file_format": "csv",
    })
    try:
        db.execute(
            "INSERT INTO admin_audit_log (admin_user_id, target_user_id, action, detail, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (admin_id, None, "export_trends", detail, now),
        )
    except Exception as _audit_exc:  # noqa: BLE001 — logged, not re-raised
        # Lazy import to avoid a top-level import cycle (utils.log is
        # imported at module level elsewhere, but doing it here keeps
        # the audit-failure path fully self-contained).
        try:
            from utils.log import logger as _audit_logger
            _audit_logger.warning(
                "admin trends export audit log failed (metric=%s days=%d): %s",
                metric or "all", days, _audit_exc,
            )
        except Exception:
            # Logger import itself failed — silently drop the audit
            # row but still serve the CSV. The user shouldn't see a
            # 500 because of a forensics-only side effect.
            pass

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if metric:
        points = _build_trend_points(metric, days)
        scope = metric
        header = "date,value"

        def _generate_per_metric():
            # UTF-8 BOM so Excel-CN auto-detects encoding. ISO
            # date + numeric value fields are RFC 4180-safe without
            # any quoting.
            yield "\ufeff" + header + "\n"
            for d, p in zip(dates, points):
                yield f"{d},{p}\n"
    else:
        m_total_users = _build_trend_points("total_users", days)
        m_active_today = _build_trend_points("active_today", days)
        m_total_tasks = _build_trend_points("total_tasks", days)
        m_task_success_rate = _build_trend_points("task_success_rate", days)
        scope = "all"
        header = "date,total_users,active_today,total_tasks,task_success_rate"

        def _generate_all_metrics():
            yield "\ufeff" + header + "\n"
            for i, d in enumerate(dates):
                yield (
                    f"{d},"
                    f"{m_total_users[i]},"
                    f"{m_active_today[i]},"
                    f"{m_total_tasks[i]},"
                    f"{m_task_success_rate[i]}\n"
                )

    filename = f"sau-trends-{scope}-{days}d-{today_str}.csv"
    return Response(
        _generate_per_metric() if metric else _generate_all_metrics(),
        mimetype="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Cache-Control": "no-store",
        },
    )
