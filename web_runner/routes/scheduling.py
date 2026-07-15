"""Smart scheduling routes (openspec/changes/product-roadmap-2026q3 Phase 2).

Computes the best post-time per (platform, account) from historical
engagement (`content_metrics` joined with `tasks.created`), stores the
pre-aggregated rows in ``publish_insights`` (recomputed hourly), and
serves recommendation + auto-assign APIs for the PublishPage "智能排期"
feature.

``hour_of_week`` is 0..167 with **Monday 00:00 = 0** (so the 7×24 heatmap
in the frontend lines up with PG's Sunday-based ``EXTRACT(DOW)`` via
``((dow + 6) % 7) * 24 + hour``).
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from web_runner.db import (
    get_database,
    get_insights,
    upsert_insights,
)

bp = Blueprint("scheduling", __name__)

# Cold-start guard: don't surface recommendations until we have enough
# signal (avoid recommending off a single lucky post).
_MIN_SAMPLES = int(__import__("os").environ.get("SAU_INSIGHTS_MIN_SAMPLES", "7"))

_insights_lock = threading.Lock()
_insights_timer: threading.Timer | None = None
_insights_running = False
_INSIGHTS_INTERVAL_SECONDS = int(
    __import__("os").environ.get("SAU_INSIGHTS_INTERVAL_HOURS", "1")
) * 3600


def _hour_of_week_from_created(iso: str) -> int | None:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    dow = dt.weekday()  # Mon=0 .. Sun=6
    return dow * 24 + dt.hour


def _compute_insights_for_account(platform: str, account: str | None) -> int:
    """Aggregate historical engagement into 168 hourly buckets.

    Returns the number of buckets written. Writes one
    ``publish_insights`` row per non-empty hour bucket. Cold-start:
    buckets with fewer than ``_MIN_SAMPLES`` samples are skipped so the
    UI shows "数据积累中" instead of a misleading spike.
    """
    db = get_database()
    if account:
        rows = db.fetch_all(
            """
            SELECT ((EXTRACT(DOW FROM t.created)::int + 6) % 7) * 24
                   + EXTRACT(HOUR FROM t.created)::int AS how,
                   AVG(cm.views) AS avg_views,
                   AVG(cm.likes) AS avg_likes,
                   AVG(cm.comments) AS avg_comments,
                   COUNT(*) AS samples
            FROM content_metrics cm
            JOIN tasks t ON t.task_id = cm.task_id
            WHERE cm.platform = ? AND cm.account = ? AND t.created IS NOT NULL
            GROUP BY how
            """,
            (platform, account),
        )
    else:
        rows = db.fetch_all(
            """
            SELECT ((EXTRACT(DOW FROM t.created)::int + 6) % 7) * 24
                   + EXTRACT(HOUR FROM t.created)::int AS how,
                   AVG(cm.views) AS avg_views,
                   AVG(cm.likes) AS avg_likes,
                   AVG(cm.comments) AS avg_comments,
                   COUNT(*) AS samples
            FROM content_metrics cm
            JOIN tasks t ON t.task_id = cm.task_id
            WHERE cm.platform = ? AND t.created IS NOT NULL
            GROUP BY how
            """,
            (platform,),
        )

    written = 0
    for r in rows:
        samples = int(r.get("samples") or 0)
        if samples < _MIN_SAMPLES:
            continue
        upsert_insights(
            platform, int(r["how"]),
            account=account,
            avg_views=float(r.get("avg_views") or 0),
            avg_likes=float(r.get("avg_likes") or 0),
            avg_comments=float(r.get("avg_comments") or 0),
            sample_count=samples,
        )
        written += 1
    return written


def _insights_aggregate_worker() -> None:
    """Hourly: recompute insights for every (platform, account) pair that
    has engagement data."""
    global _insights_running
    with _insights_lock:
        if _insights_running:
            return
        _insights_running = True
    try:
        db = get_database()
        pairs = db.fetch_all(
            "SELECT DISTINCT platform, account FROM content_metrics "
            "WHERE platform IS NOT NULL"
        )
        for row in pairs:
            try:
                _compute_insights_for_account(row["platform"], row.get("account"))
            except Exception:
                continue
    finally:
        with _insights_lock:
            _insights_running = False


def _insights_loop() -> None:
    global _insights_timer
    try:
        _insights_aggregate_worker()
    except Exception:
        pass
    finally:
        with _insights_lock:
            _insights_timer = threading.Timer(_INSIGHTS_INTERVAL_SECONDS, _insights_loop)
            _insights_timer.daemon = True
            _insights_timer.start()


def start_insights_worker() -> None:
    """Idempotent start of the hourly insights aggregate timer."""
    global _insights_timer
    with _insights_lock:
        if _insights_timer is not None:
            return
        _insights_timer = threading.Timer(_INSIGHTS_INTERVAL_SECONDS, _insights_loop)
        _insights_timer.daemon = True
        _insights_timer.start()


def _next_occurrence(hour_of_week: int, from_dt: datetime | None = None) -> str:
    """ISO datetime of the next occurrence of a ``hour_of_week`` bucket."""
    base = from_dt or datetime.now(timezone.utc)
    base = base.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    target_weekday = hour_of_week // 24  # Mon=0
    target_hour = hour_of_week % 24
    days_ahead = (target_weekday - base.weekday()) % 7
    if days_ahead == 0 and target_hour <= base.hour:
        days_ahead = 7
    occ = base + timedelta(days=days_ahead)
    occ = occ.replace(hour=target_hour)
    return occ.isoformat(timespec="seconds")


@bp.get("/api/scheduling/insights")
def scheduling_insights():
    """Return best-post-time rows for a platform (+ optional account)."""
    platform = request.args.get("platform")
    account = request.args.get("account")
    if not platform:
        return jsonify({"success": False, "message": "platform is required"}), 400
    rows = get_insights(platform, account)
    # Attach next-occurrence ISO for the top buckets.
    enriched = [
        {
            "platform": r["platform"],
            "account": r.get("account"),
            "hour_of_week": r["hour_of_week"],
            "avg_views": round(float(r.get("avg_views") or 0), 2),
            "avg_likes": round(float(r.get("avg_likes") or 0), 2),
            "avg_comments": round(float(r.get("avg_comments") or 0), 2),
            "sample_count": r.get("sample_count"),
            "next_occurrence": _next_occurrence(r["hour_of_week"]),
        }
        for r in rows
    ]
    ready = any(r["sample_count"] and r["sample_count"] >= _MIN_SAMPLES for r in rows)
    return jsonify({
        "success": True,
        "data": {"insights": enriched, "ready": ready, "min_samples": _MIN_SAMPLES},
    })


@bp.get("/api/scheduling/recommend")
def scheduling_recommend():
    """Recommend the top-N best post times for a platform (+ account)."""
    platform = request.args.get("platform")
    account = request.args.get("account")
    try:
        count = int(request.args.get("count", "5"))
    except (ValueError, TypeError):
        count = 5
    count = max(1, min(count, 20))
    if not platform:
        return jsonify({"success": False, "message": "platform is required"}), 400

    rows = get_insights(platform, account)
    ready_rows = [r for r in rows if (r.get("sample_count") or 0) >= _MIN_SAMPLES]
    if not ready_rows:
        return jsonify({
            "success": True,
            "data": {"ready": False, "recommendations": [], "min_samples": _MIN_SAMPLES},
        })
    ranked = sorted(ready_rows, key=lambda r: float(r.get("avg_views") or 0), reverse=True)
    recs = [
        {
            "hour_of_week": r["hour_of_week"],
            "avg_views": round(float(r.get("avg_views") or 0), 2),
            "avg_likes": round(float(r.get("avg_likes") or 0), 2),
            "avg_comments": round(float(r.get("avg_comments") or 0), 2),
            "sample_count": r.get("sample_count"),
            "next_occurrence": _next_occurrence(r["hour_of_week"]),
        }
        for r in ranked[:count]
    ]
    return jsonify({"success": True, "data": {"ready": True, "recommendations": recs}})


@bp.post("/api/scheduling/auto-assign")
def scheduling_auto_assign():
    """Assign a batch of tasks to their best upcoming post times.

    Body: ``{ "items": [{"platform": ..., "account": ..., "ref": ...}, ...] }``.
    Each item gets the highest-avg_views ``hour_of_week`` for its
    (platform, account) and the next occurrence of that hour is returned
    as ``scheduled_at``. Items with insufficient history keep
    ``scheduled_at = null`` (caller falls back to immediate publish).
    """
    body = request.get_json(silent=True) or {}
    items = body.get("items") or []
    if not isinstance(items, list):
        return jsonify({"success": False, "message": "items must be a list"}), 400

    assignments: list[dict] = []
    for item in items:
        platform = (item.get("platform") or "").strip()
        account = item.get("account")
        if not platform:
            assignments.append({**item, "scheduled_at": None, "reason": "missing platform"})
            continue
        rows = get_insights(platform, account)
        ready_rows = [r for r in rows if (r.get("sample_count") or 0) >= _MIN_SAMPLES]
        if not ready_rows:
            assignments.append({**item, "scheduled_at": None, "reason": "insufficient history"})
            continue
        best = max(ready_rows, key=lambda r: float(r.get("avg_views") or 0))
        assignments.append({
            **item,
            "scheduled_at": _next_occurrence(best["hour_of_week"]),
            "hour_of_week": best["hour_of_week"],
            "reason": "best_avg_views",
        })
    return jsonify({"success": True, "data": {"assignments": assignments}})
