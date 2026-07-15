"""Content metrics routes (openspec/changes/product-roadmap-2026q3).

Phase 1 — 数据闭环:

  * platform adapters that pull engagement counts (views / likes /
    comments / shares) back from each platform's open API,
  * a per-task fetch helper + an hourly polling worker (started from
    ``web_runner/__init__.py::create_app``),
  * a per-platform sliding-window rate limiter so the worker never
    trips a platform's quota,
  * the four read APIs powering the Analytics "效果" tab
    (summary / accounts / tasks) + a manual refresh trigger.

The platform adapters are intentionally defensive: real Douyin / Bilibili
/ Xiaohongshu open-platform calls require OAuth tokens we don't carry in
this repo. When no token is configured the adapter returns ``None`` and
the poller leaves the existing row untouched (graceful degradation — the
Analytics tab still renders whatever was last pulled, and the table is
created empty so the schema is always present). The adapter structure
(documents the real endpoint + the expected response shape) is the
single place a deployment wires in its own credentials.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

import requests
from flask import Blueprint, jsonify, request

from web_runner.db import (
    get_all_metrics_for_poll,
    get_database,
    get_metrics_by_task,
    parse_date_param,
    upsert_metrics,
)

bp = Blueprint("metrics", __name__)

# Tracked platforms (must be a subset of the schedule-able upload
# platforms that expose a public metrics API).
TRACKED_PLATFORMS = ("douyin", "bilibili", "xiaohongshu")

# Polling cadence (hours). Configurable via env so operators on a tight
# quota can slow it down without a code change.
_POLL_INTERVAL_SECONDS = int(
    __import__("os").environ.get("SAU_METRICS_POLL_INTERVAL_HOURS", "1")
) * 3600

_metrics_lock = threading.Lock()
_metrics_timer: threading.Timer | None = None
_metrics_running = False


# ── Rate limiter (per-platform sliding window) ──────────────────────────
class _PlatformRateLimiter:
    """Sliding-window limiter: at most ``max_calls`` in ``window_seconds``.

    Per-platform instances so one chatty platform can't starve the
    others. Thread-safe (guarded by its own lock).
    """

    def __init__(self, max_calls: int = 60, window_seconds: int = 3600) -> None:
        self._max_calls = max_calls
        self._window = window_seconds
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def allow(self) -> bool:
        now = time.monotonic()
        with self._lock:
            while self._calls and now - self._calls[0] > self._window:
                self._calls.popleft()
            if len(self._calls) >= self._max_calls:
                return False
            self._calls.append(now)
            return True


_RATE_LIMITERS = {p: _PlatformRateLimiter() for p in TRACKED_PLATFORMS}


# ── Adapter contract ────────────────────────────────────────────────────
@dataclass
class PlatformMetricsResult:
    views: int = 0
    likes: int = 0
    comments: int = 0
    shares: int = 0


@runtime_checkable
class PlatformMetricsAdapter(Protocol):
    """Unified adapter interface. Every adapter returns a
    ``PlatformMetricsResult`` (``{views, likes, comments, shares}``)
    or ``None`` when the data can't be fetched (no token, API error).
    """

    platform: str

    def fetch(self, video_id: str | None, account: str | None) -> PlatformMetricsResult | None:
        ...


def _env_token(name: str) -> str | None:
    import os

    val = os.environ.get(name, "").strip()
    return val or None


def _http_get_json(url: str, *, headers: dict, params: dict | None = None, timeout: int = 10):
    resp = requests.get(url, headers=headers, params=params or {}, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


class DouyinMetricsAdapter:
    """Douyin Open Platform (巨量引擎 / 抖音开放平台) video-statistics adapter.

    Real endpoint requires an ``access_token`` (OAuth2 client
    credentials) + the item's ``item_id``. Without a token we return
    ``None`` so the poller skips — no fabricated numbers.
    """

    platform = "douyin"
    # 抖音开放平台 item 数据接口（文档端点，需 access_token）
    _ENDPOINT = "https://open.douyin.com/data/external/item/base/"

    def fetch(self, video_id: str | None, account: str | None) -> PlatformMetricsResult | None:
        token = _env_token("SAU_DOUYIN_ACCESS_TOKEN")
        if not token or not video_id:
            return None
        if not _RATE_LIMITERS[self.platform].allow():
            return None
        try:
            data = _http_get_json(
                self._ENDPOINT,
                headers={"access-token": token},
                params={"item_id": video_id},
            )
            # 抖音返回结构: data.result.list[0].statistics.{play,like,comment,share}
            result = (data or {}).get("data", {}).get("result", {})
            stats = (result.get("list") or [{}])[0].get("statistics", {})
            return PlatformMetricsResult(
                views=int(stats.get("play", 0) or 0),
                likes=int(stats.get("like", 0) or 0),
                comments=int(stats.get("comment", 0) or 0),
                shares=int(stats.get("share", 0) or 0),
            )
        except Exception:
            return None


class BilibiliMetricsAdapter:
    """Bilibili video-statistics adapter.

    Bilibili exposes ``https://api.bilibili.com/x/web-interface/view``
    (no auth for public video stats) keyed by ``bvid``/``aid``.
    """

    platform = "bilibili"
    _ENDPOINT = "https://api.bilibili.com/x/web-interface/view"

    def fetch(self, video_id: str | None, account: str | None) -> PlatformMetricsResult | None:
        if not video_id:
            return None
        if not _RATE_LIMITERS[self.platform].allow():
            return None
        try:
            data = _http_get_json(
                self._ENDPOINT,
                headers={"User-Agent": "sau-metrics/1.0"},
                params={"bvid": video_id},
            )
            stat = (data or {}).get("data", {}).get("stat", {})
            return PlatformMetricsResult(
                views=int(stat.get("view", 0) or 0),
                likes=int(stat.get("like", 0) or 0),
                comments=int(stat.get("reply", 0) or 0),
                shares=int(stat.get("share", 0) or 0),
            )
        except Exception:
            return None


class XiaohongshuMetricsAdapter:
    """Xiaohongshu (小红书) open-platform note-statistics adapter.

    Real endpoint requires a signed request (app_id + app_secret +
    access_token). Without credentials we return ``None``.
    """

    platform = "xiaohongshu"
    _ENDPOINT = "https://ark.xiaohongshu.com/api/dsa/v1/note/statistics"

    def fetch(self, video_id: str | None, account: str | None) -> PlatformMetricsResult | None:
        token = _env_token("SAU_XIAOHONGSHU_ACCESS_TOKEN")
        if not token or not video_id:
            return None
        if not _RATE_LIMITERS[self.platform].allow():
            return None
        try:
            data = _http_get_json(
                self._ENDPOINT,
                headers={"Authorization": f"Bearer {token}"},
                params={"note_id": video_id},
            )
            stats = (data or {}).get("data", {}).get("statistics", {})
            return PlatformMetricsResult(
                views=int(stats.get("view", 0) or 0),
                likes=int(stats.get("like", 0) or 0),
                comments=int(stats.get("comment", 0) or 0),
                shares=int(stats.get("share", 0) or 0),
            )
        except Exception:
            return None


ADAPTERS: dict[str, PlatformMetricsAdapter] = {
    a.platform: a()
    for a in (DouyinMetricsAdapter, BilibiliMetricsAdapter, XiaohongshuMetricsAdapter)
}


# ── Polling worker ──────────────────────────────────────────────────────
def _fetch_metrics_for_task(task_id: str, platform: str, account: str | None, video_id: str | None) -> bool:
    """Pull + upsert metrics for one task. Returns True if a row was written.

    Skips silently when the platform has no adapter or the adapter
    returns ``None`` (no token / API error) — graceful degradation.
    """
    adapter = ADAPTERS.get(platform)
    if adapter is None:
        return False
    result = adapter.fetch(video_id, account)
    if result is None:
        return False
    upsert_metrics(
        task_id, platform,
        account=account, video_id=video_id,
        views=result.views, likes=result.likes,
        comments=result.comments, shares=result.shares,
    )
    return True


def _metrics_poll_worker() -> None:
    """Hourly worker: pull metrics for every succeeded tracked task.

    Runs once per timer tick. Wrapped in ``_metrics_lock`` so a slow
    cycle can't overlap the next tick. Failures are swallowed per-row
    so one bad task never aborts the whole pass.
    """
    global _metrics_running
    with _metrics_lock:
        if _metrics_running:
            return
        _metrics_running = True
    try:
        rows = get_all_metrics_for_poll()
        pulled = 0
        for row in rows:
            try:
                if _fetch_metrics_for_task(
                    row["task_id"], row["platform"],
                    row.get("account"), row.get("video_id") or None,
                ):
                    pulled += 1
            except Exception:
                continue
    finally:
        with _metrics_lock:
            _metrics_running = False


def _metrics_poll_loop() -> None:
    """Re-armed hourly timer (daemon). Reschedules itself after each run."""
    global _metrics_timer
    try:
        _metrics_poll_worker()
    except Exception:
        pass
    finally:
        with _metrics_lock:
            _metrics_timer = threading.Timer(_POLL_INTERVAL_SECONDS, _metrics_poll_loop)
            _metrics_timer.daemon = True
            _metrics_timer.start()


def start_metrics_poller() -> None:
    """Idempotent start of the metrics polling timer (called from create_app)."""
    global _metrics_timer
    with _metrics_lock:
        if _metrics_timer is not None:
            return
        _metrics_timer = threading.Timer(_POLL_INTERVAL_SECONDS, _metrics_poll_loop)
        _metrics_timer.daemon = True
        _metrics_timer.start()


# ── Read APIs ───────────────────────────────────────────────────────────
def _date_bounds() -> tuple[str, str]:
    from_date = parse_date_param(request.args.get("from"))
    to_date = parse_date_param(request.args.get("to"), default_days_ago=0)
    return from_date, to_date


def _platform_filter() -> str | None:
    p = request.args.get("platform")
    return p if p in TRACKED_PLATFORMS else None


@bp.get("/api/metrics/summary")
def metrics_summary():
    """Aggregate engagement by platform + day for the date window."""
    from_date, to_date = _date_bounds()
    platform = _platform_filter()
    db = get_database()

    where = "t.created >= ? AND t.created <= ? || 'z'"
    params: list = [from_date, to_date]
    if platform:
        where += " AND cm.platform = ?"
        params.append(platform)

    platform_rows = db.fetch_all(
        f"""
        SELECT cm.platform,
               SUM(cm.views) AS views, SUM(cm.likes) AS likes,
               SUM(cm.comments) AS comments, SUM(cm.shares) AS shares,
               COUNT(*) AS tasks
        FROM content_metrics cm
        JOIN tasks t ON t.task_id = cm.task_id
        WHERE {where}
        GROUP BY cm.platform
        ORDER BY cm.platform
        """,
        tuple(params),
    )

    totals = {"views": 0, "likes": 0, "comments": 0, "shares": 0, "tasks": 0}
    by_platform: dict[str, dict] = {}
    for r in platform_rows:
        views = int(r.get("views") or 0)
        likes = int(r.get("likes") or 0)
        comments = int(r.get("comments") or 0)
        shares = int(r.get("shares") or 0)
        tasks = int(r.get("tasks") or 0)
        by_platform[r["platform"]] = {
            "views": views, "likes": likes,
            "comments": comments, "shares": shares, "tasks": tasks,
        }
        totals["views"] += views
        totals["likes"] += likes
        totals["comments"] += comments
        totals["shares"] += shares
        totals["tasks"] += tasks

    day_rows = db.fetch_all(
        f"""
        SELECT SUBSTR(t.created, 1, 10) AS day,
               SUM(cm.views) AS views, SUM(cm.likes) AS likes,
               SUM(cm.comments) AS comments, SUM(cm.shares) AS shares
        FROM content_metrics cm
        JOIN tasks t ON t.task_id = cm.task_id
        WHERE {where}
        GROUP BY day ORDER BY day
        """,
        tuple(params),
    )
    by_day = [
        {
            "date": r["day"],
            "views": int(r.get("views") or 0),
            "likes": int(r.get("likes") or 0),
            "comments": int(r.get("comments") or 0),
            "shares": int(r.get("shares") or 0),
        }
        for r in day_rows
    ]

    return jsonify({
        "success": True,
        "data": {"totals": totals, "by_platform": by_platform, "by_day": by_day},
    })


@bp.get("/api/metrics/accounts")
def metrics_accounts():
    """Aggregate engagement by account for the date window."""
    from_date, to_date = _date_bounds()
    platform = _platform_filter()
    db = get_database()

    where = "t.created >= ? AND t.created <= ? || 'z'"
    params: list = [from_date, to_date]
    if platform:
        where += " AND cm.platform = ?"
        params.append(platform)

    rows = db.fetch_all(
        f"""
        SELECT cm.account, cm.platform,
               SUM(cm.views) AS views, SUM(cm.likes) AS likes,
               SUM(cm.comments) AS comments, SUM(cm.shares) AS shares,
               COUNT(*) AS tasks
        FROM content_metrics cm
        JOIN tasks t ON t.task_id = cm.task_id
        WHERE {where} AND cm.account IS NOT NULL AND cm.account != ''
        GROUP BY cm.account, cm.platform
        ORDER BY views DESC
        """,
        tuple(params),
    )
    accounts = [
        {
            "account": r["account"],
            "platform": r["platform"],
            "views": int(r.get("views") or 0),
            "likes": int(r.get("likes") or 0),
            "comments": int(r.get("comments") or 0),
            "shares": int(r.get("shares") or 0),
            "tasks": int(r.get("tasks") or 0),
        }
        for r in rows
    ]
    return jsonify({"success": True, "data": {"accounts": accounts}})


@bp.get("/api/metrics/tasks")
def metrics_tasks():
    """Single-task detail (all platforms) or a paginated task list."""
    task_id = request.args.get("task_id")
    platform = request.args.get("platform")
    if task_id:
        rows = get_metrics_by_task(task_id)
        if platform:
            rows = [r for r in rows if r["platform"] == platform]
        return jsonify({"success": True, "data": {"task_id": task_id, "metrics": rows}})

    db = get_database()
    where = "1=1"
    params: list = []
    if platform:
        where = "cm.platform = ?"
        params.append(platform)
    rows = db.fetch_all(
        f"""
        SELECT cm.task_id, cm.platform, cm.account, cm.video_id,
               cm.views, cm.likes, cm.comments, cm.shares, cm.fetched_at
        FROM content_metrics cm
        WHERE {where}
        ORDER BY cm.fetched_at DESC
        LIMIT 500
        """,
        tuple(params),
    )
    tasks = [
        {
            "task_id": r["task_id"],
            "platform": r["platform"],
            "account": r.get("account"),
            "video_id": r.get("video_id"),
            "views": int(r.get("views") or 0),
            "likes": int(r.get("likes") or 0),
            "comments": int(r.get("comments") or 0),
            "shares": int(r.get("shares") or 0),
            "fetched_at": r.get("fetched_at"),
        }
        for r in rows
    ]
    return jsonify({"success": True, "data": {"tasks": tasks}})


@bp.post("/api/metrics/refresh")
def metrics_refresh():
    """Manually trigger a one-off metrics pull (capped, synchronous)."""
    pulled = 0
    rows = get_all_metrics_for_poll()[:500]
    for row in rows:
        try:
            if _fetch_metrics_for_task(
                row["task_id"], row["platform"],
                row.get("account"), row.get("video_id") or None,
            ):
                pulled += 1
        except Exception:
            continue
    return jsonify({
        "success": True,
        "data": {"scanned": len(rows), "updated": pulled,
                 "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
    })
