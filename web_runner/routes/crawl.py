"""Crawler Web API (openspec/changes/mediacrawler-integration).

Routes:

    POST /api/crawl/search     — start a search-by-keyword crawl
    POST /api/crawl/detail     — fetch a single post's full data
    POST /api/crawl/comments   — fetch a post's full comment tree
    GET  /api/crawl/status     — poll a crawl task's status
    GET  /api/crawl/data       — read rows from ``crawled_content``
    GET  /api/crawl/comments   — read rows from ``crawled_comments``
    POST /api/crawl/reply-suggest — manually re-run reply suggestion
    GET  /api/crawl/sentiment-summary — positive/negative/neutral/pending
                                          counts (for the dashboard chip)

Auth flow:
    The blueprint is registered under the default ``/api/*`` prefix,
    so :func:`web_runner.__init__._check_auth` will require a logged-in
    user unless the path is whitelisted. /api/crawl/* is NOT
    whitelisted — operators must log in first. This matches the
    existing ``/api/upload/video`` gate (silver bullet comment about
    uploads leaking credentials / triggering accidental platform
    auth).

Pattern: same as ``web_runner/routes/tasks.py`` — accept JSON, route
to :func:`crawler.create_crawl_task` for action endpoints (returns
202 Accepted + ``Location: /api/tasks?task_id=...`` + ``Retry-After``),
route directly to ``web_runner/db.get_database`` for read endpoints
(returns 200 + JSON).
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, Response, jsonify, request

# The shared ``_current_user_id`` helper is in the auth route
# module; importing it lazily here avoids a circular-import risk on
# app boot (since auth_bp imports routes/* lazily). Note: the
# original `noqa: F401` was added because the import looked unused
# in isolation, but the helper IS wired through `_user_id_or_unauth()`
# below so the linter shouldn't suppress it.
from web_runner.routes.auth import _current_user_id

_module_logger = logging.getLogger(__name__)

# Concurrency limit for the synchronous SSE streaming endpoint.
# Each open stream holds a slot until the generator finishes or the
# client disconnects. Default is conservative to avoid exhausting
# worker threads / DB connections under burst usage.
def _max_stream_crawls() -> int:
    raw = os.environ.get("SAU_STREAM_CONCURRENCY", "3")
    try:
        return max(1, int(raw))
    except ValueError:
        _module_logger.warning("SAU_STREAM_CONCURRENCY=%r is not an integer; using default 3", raw)
        return 3


_STREAM_SEMAPHORE = threading.Semaphore(_max_stream_crawls())

bp = Blueprint("crawl", __name__, url_prefix="/api/crawl")


def _user_id_or_unauth():
    """Return the current user id, or ``None`` if not signed in.

    The blueprint doesn't enforce auth itself (the create_app-level
    before_request hook in :mod:`web_runner.__init__` does) but
    does pass ``user_id`` through to :func:`crawler.create_crawl_task`
    so the row's ``account`` column can show the originating user.
    """
    return _current_user_id()


# ── Action endpoints (202 Accepted + Location + Retry-After) ─────

def _get_crawler_class(platform: str):
    """Return the crawler class for a platform short/long name."""
    from crawler import PLATFORM_REGISTRY
    return PLATFORM_REGISTRY.get(platform.lower())


# Map crawler short platform names to the platform names stored in
# ``account_authorizations.platform`` (which come from the publish-side
# platform registry, e.g. ``douyin``, ``xiaohongshu``).
_CRAWL_PLATFORM_TO_ACCOUNT_PLATFORM: dict[str, str] = {
    "xhs": "xiaohongshu",
    "dy": "douyin",
    "ks": "kuaishou",
    "bili": "bilibili",
    "wb": "weibo",
    "tieba": "tieba",
    "zhihu": "zhihu",
}


def _resolve_account_file(platform: str, account_group_name: str) -> str | None:
    """Resolve a cookie file path for the current user + platform + group.

    Looks up ``account_authorizations`` joined with ``account_groups``.
    Returns ``None`` if no matching authorization is found. When auth is
    disabled, the owner filter is skipped so CLI / single-user deployments
    can still use saved cookies.
    """
    from web_runner.db import get_database

    db = get_database()
    user_id = _user_id_or_unauth()
    account_platform = _CRAWL_PLATFORM_TO_ACCOUNT_PLATFORM.get(platform, platform)
    query = (
        "SELECT aa.cookie_file FROM account_authorizations aa "
        "JOIN account_groups ag ON aa.group_id = ag.id "
        "WHERE ag.name = ? AND aa.platform = ?"
    )
    params: list[Any] = [account_group_name, account_platform]
    if user_id is not None:
        query += " AND ag.owner_user_id = ?"
        params.append(user_id)
    row = db.fetch_one(query, tuple(params))
    return row["cookie_file"] if row else None


@bp.route("/search", methods=["POST"])
def crawl_search():
    """Enqueue a search-by-keyword crawl.

    Body JSON shape::

        {
          "platform": "xhs" | "dy" | "ks" | "bili" |
                      "wb" | "tieba" | "zhihu" |
                      "xiaohongshu" | "douyin" | "kuaishou" |
                      "bilibili" | "weibo",
          "keyword": "...",
          "max_count": 20,         # optional, default 20
          "page_num": 1            # optional, default 1
        }

    Returns ``202 Accepted`` + LOCATION header pointing at the task
    URL so the caller can poll status. Mirrors the response shape
    of :func:`web_runner.routes.upload.upload_video` so a single
    frontend client-side polling loop handles both publish and
    crawl.
    """
    body = request.get_json(silent=True) or {}
    platform = (body.get("platform") or "").strip()
    keyword = (body.get("keyword") or "").strip()
    if not platform or not keyword:
        return jsonify({
            "success": False,
            "message": "platform + keyword are required",
        }), 400
    try:
        from crawler import create_crawl_task
        task_id = create_crawl_task(
            user_id=_user_id_or_unauth(),
            platform=platform,
            action="search",
            params={
                "keyword": keyword,
                "max_count": int(body.get("max_count") or 20),
                "page_num": int(body.get("page_num") or 1),
            },
        )
    except ValueError as exc:
        # Unknown platform
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 400
    location = f"/api/tasks?task_id={task_id}"
    resp = jsonify({
        "success": True,
        "data": {"task_id": task_id, "status": "pending"},
    })
    resp.status_code = 202
    resp.headers["Location"] = location
    resp.headers["Retry-After"] = "2"
    return resp


@bp.route("/search-stream", methods=["POST"])
def crawl_search_stream():
    """Stream search results via SSE as they are scraped.

    This endpoint is intentionally synchronous (it holds the HTTP
    connection and streams rows). It bypasses the background task
    queue so results can be pushed to the client in real time. For
    other actions (detail/comments), the task-based endpoints remain
    the default. For platforms that have not overridden
    ``search_stream``, the base implementation streams the full
    ``search()`` result at the end.

    Note: ``AbstractCrawler.search_stream`` (base default at
    ``crawler/base/base_crawler.py``) yields from ``self.search()``,
    so the 6 non-douyin platforms (xhs/ks/bili/wb/tieba/zhihu) work
    out-of-the-box via inheritance — only ``DouyinCrawler`` overrides
    it for true incremental async streaming. See
    ``tests/test_crawler.py::TestAbstractCrawlerSubcontract::test_six_non_douyin_platforms_inherit_search_stream``
    for the lock-in test guarding this contract. The previous
    AttributeError concern (round-MC-2024 audit) was based on
    outdated info; the base default was added before this round.

    Request body::

        {
          "platform": "dy" | "douyin",
          "keyword": "...",
          "max_count": 20   # optional
        }

    SSE events emitted:

      * ``event: platform_result`` — one row dict per scraped result
      * ``event: done``            — crawl finished successfully
      * ``event: error``           — crawl failed
    """
    body = request.get_json(silent=True) or {}
    platform = (body.get("platform") or "").strip()
    keyword = (body.get("keyword") or "").strip()
    account_group_name = (body.get("account") or "").strip()
    if not platform or not keyword:
        return jsonify({
            "success": False,
            "message": "platform + keyword are required",
        }), 400

    CrawlerClass = _get_crawler_class(platform)
    if CrawlerClass is None:
        return jsonify({
            "success": False,
            "message": f"unknown crawler platform: {platform!r}",
        }), 400

    # search-stream requires an authorized account — without one
    # the crawler times out 15s at ``page.wait_for_selector`` and
    # surfaces a confusing "cookie 校验非 race 异常" warning. Fail
    # fast with 401 + ``code: missing_account`` + ``redirect_url``
    # so the UI can show a clear "add an account" message instead.
    if not account_group_name:
        return jsonify({
            "success": False,
            "code": "missing_account",
            "message": (
                f"search-stream requires an authorized account for platform "
                f"{platform!r}; please add one at /app/accounts and retry"
            ),
            "redirect_url": "/app/accounts",
        }), 401

    max_count = body.get("max_count", 20)
    try:
        max_count = int(max_count)
    except (TypeError, ValueError):
        max_count = 20
    max_count = max(1, min(max_count, 100))

    account_file: str | None = None
    if account_group_name:
        account_file = _resolve_account_file(platform, account_group_name)
        if account_file is None:
            return jsonify({
                "success": False,
                "code": "account_not_found",
                "message": (
                    f"account group {account_group_name!r} has no {platform!r} authorization; "
                    f"please login to {platform!r} at /app/accounts"
                ),
                "redirect_url": "/app/accounts",
            }), 400

    # Enforce server-side concurrency limit. If all slots are taken,
    # fail fast with 429 so the client can retry later.
    if not _STREAM_SEMAPHORE.acquire(blocking=False):
        return jsonify({
            "success": False,
            "message": "Too many concurrent streaming searches. Please try again later.",
        }), 429, {"Retry-After": "5"}

    def generate():
        try:
            from crawler.store.saulite_store import SauliteStore
            store = SauliteStore()
            crawler = CrawlerClass(account_file=account_file) if account_file else CrawlerClass()
            for row in crawler.search_stream(keyword, max_count=max_count):
                post_id = row.get("post_id") or ""
                # Persist each streamed row so it appears in the
                # Content tab (GET /api/crawl/data). Individual
                # persistence failures are logged but do not break
                # the stream — the user still sees live results.
                row_id: int | None = None
                try:
                    row_id = store.store_content(
                        platform=platform,
                        post_id=post_id,
                        raw_payload=row,
                    )
                except Exception as exc:  # pragma: no cover — defensive
                    _module_logger.warning("[crawler] failed to persist stream row: %s", exc)
                # Wrap the raw crawler row in the DB row shape so the
                # frontend can reuse CrawledContentItem helpers.
                payload = {
                    "id": row_id,
                    "raw_payload": row,
                    "platform": platform,
                    "post_id": post_id,
                    "crawled_at": None,
                }
                yield f"event: platform_result\ndata: {json.dumps(payload)}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as exc:
            _module_logger.warning("[crawler] search-stream error: %s", exc)
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
        finally:
            _STREAM_SEMAPHORE.release()

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@bp.route("/detail", methods=["POST"])
def crawl_detail():
    """Enqueue a single-post detail fetch.

    Body JSON shape::

        {
          "platform": "...",
          "post_id": "..."
        }
    """
    body = request.get_json(silent=True) or {}
    platform = (body.get("platform") or "").strip()
    post_id = (body.get("post_id") or "").strip()
    if not platform or not post_id:
        return jsonify({
            "success": False,
            "message": "platform + post_id are required",
        }), 400
    try:
        from crawler import create_crawl_task
        task_id = create_crawl_task(
            user_id=_user_id_or_unauth(),
            platform=platform,
            action="detail",
            params={"post_id": post_id},
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    location = f"/api/tasks?task_id={task_id}"
    resp = jsonify({
        "success": True,
        "data": {"task_id": task_id, "status": "pending"},
    })
    resp.status_code = 202
    resp.headers["Location"] = location
    resp.headers["Retry-After"] = "2"
    return resp


@bp.route("/comments", methods=["POST"])
def crawl_comments():
    """Enqueue a comments fetch.

    Body JSON shape::

        {
          "platform": "...",
          "post_id": "...",
          "max_count": 100                 # optional
        }
    """
    body = request.get_json(silent=True) or {}
    platform = (body.get("platform") or "").strip()
    post_id = (body.get("post_id") or "").strip()
    if not platform or not post_id:
        return jsonify({
            "success": False,
            "message": "platform + post_id are required",
        }), 400
    try:
        from crawler import create_crawl_task
        task_id = create_crawl_task(
            user_id=_user_id_or_unauth(),
            platform=platform,
            action="comments",
            params={
                "post_id": post_id,
                "max_count": int(body.get("max_count") or 100),
            },
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    location = f"/api/tasks?task_id={task_id}"
    resp = jsonify({
        "success": True,
        "data": {"task_id": task_id, "status": "pending"},
    })
    resp.status_code = 202
    resp.headers["Location"] = location
    resp.headers["Retry-After"] = "2"
    return resp


# ── Action sub-endpoints (single-task polling + manual triggers) ──
@bp.route("/status", methods=["GET"])
def crawl_status():
    """Return the current ``tasks`` row for a given crawl task_id.

    Polled by the Frontend's ``CrawlPage.tsx`` to drive the
    in-progress spinner. Returns ``404`` if the row doesn't exist
    (which includes the case where the task_id is from a different
    action verb or from the publish side).
    """
    task_id = (request.args.get("task_id") or "").strip()
    if not task_id:
        return jsonify({
            "success": False,
            "message": "task_id query parameter is required",
        }), 400
    from web_runner.db import get_database
    db = get_database()
    row = db.fetch_one(
        "SELECT task_id, status, platform, action, code, error, "
        "created, result FROM tasks WHERE task_id = ?",
        (task_id,),
    )
    if row is None:
        return jsonify({
            "success": False,
            "message": f"task {task_id!r} not found",
        }), 404
    return jsonify({"success": True, "data": row})


@bp.route("/reply-suggest", methods=["POST"])
def crawl_reply_suggest():
    """Manually re-run reply suggestion for one comment.

    Body JSON shape::

        {
          "platform": "...",
          "post_id": "...",
          "comment_id": 123,
          "comment_text": "...",
          "force": false              # optional; if true, bypass the
                                       # in-process reply cache.
        }

    Useful for the Frontend's "regenerate" button on a stale
    suggestion.

    Returns ``200`` + JSON ``{"ai_reply_suggestion": "..."}``, OR
    ``""`` (empty string) when the AI call failed (operator can
    then retry).
    """
    body = request.get_json(silent=True) or {}
    platform = (body.get("platform") or "").strip()
    comment_text = (body.get("comment_text") or "").strip()
    if not platform or not comment_text:
        return jsonify({
            "success": False,
            "message": "platform + comment_text are required",
        }), 400
    from crawler.ai.reply import generate_reply_suggestion
    post_id = (body.get("post_id") or "").strip()
    if body.get("force"):
        # Cache bypass — drop the entry from the in-process LRU so
        # the next call re-runs the LLM. Nuance: the cache lives in
        # crawler/ai/reply.py; we re-import here to dodge the
        # module-level cache check.
        try:
            from crawler.ai import reply as _reply_mod
            _reply_mod._REPLY_CACHE.pop((comment_text, platform), None)
        except Exception:
            pass
    suggestion = generate_reply_suggestion(
        comment_text=comment_text, platform=platform, post_id=post_id,
    )
    # If we got a comment_id, write the new suggestion back to the
    # DB so the UI can re-poll the row. Best-effort: operator can
    # always re-fetch via /api/crawl/comments if the write failed.
    comment_id_raw = body.get("comment_id")
    if suggestion and comment_id_raw is not None:
        try:
            from web_runner.db import get_database
            db = get_database()
            db.execute(
                "UPDATE crawled_comments SET ai_reply_suggestion = ? "
                "WHERE id = ?",
                (suggestion, int(comment_id_raw)),
            )
        except Exception as exc:  # pragma: no cover — defensive
            _module_logger.warning(
                "[crawler] reply-suggest write back failed for comment_id=%s: %s",
                comment_id_raw, type(exc).__name__,
            )
    return jsonify({
        "success": True,
        "data": {"ai_reply_suggestion": suggestion},
    })


# ── Read endpoints (200 OK + JSON rows) ───────────────────────────
@bp.route("/data", methods=["GET"])
def crawl_data():
    """List rows in ``crawled_content`` (optionally filtered).

    Query params:
        platform  — drill-down to one platform (default: all)
        limit     — row count cap (default 50, max 200)
        post_id   — optional exact match
    """
    platform = (request.args.get("platform") or "").strip() or None
    post_id = (request.args.get("post_id") or "").strip() or None
    try:
        limit = int(request.args.get("limit") or 50)
    except ValueError:
        return jsonify({"success": False, "message": "limit must be int"}), 400
    # Cap limit to 200 so a single request can't blast 10k rows
    # back to the UI (an accidentally-omitted LIMIT could OOM the
    # SPA's table renderer).
    limit = max(1, min(200, limit))
    from crawler.store.saulite_store import SauliteStore
    rows = SauliteStore().list_content(platform=platform, limit=limit)
    return jsonify({"success": True, "data": rows})


@bp.route("/comments", methods=["GET"])
def crawl_get_comments():
    """List rows in ``crawled_comments`` with optional filters.

    Query params:
        platform  — drill-down (default all)
        post_id   — drill-down to one post (common UX flow)
        sentiment — ``positive`` / ``negative`` / ``neutral`` / ``pending``
                    (note: ``pending`` = NULL rows in the DB)
        limit     — row count cap (default 50, max 200)
    """
    platform = (request.args.get("platform") or "").strip() or None
    post_id = (request.args.get("post_id") or "").strip() or None
    sentiment = (request.args.get("sentiment") or "").strip() or None
    try:
        limit = int(request.args.get("limit") or 50)
    except ValueError:
        return jsonify({"success": False, "message": "limit must be int"}), 400
    limit = max(1, min(200, limit))
    from crawler.store.saulite_store import SauliteStore
    rows = SauliteStore().list_comments(
        platform=platform, post_id=post_id,
        sentiment=sentiment, limit=limit,
    )
    return jsonify({"success": True, "data": rows})


@bp.route("/sentiment-summary", methods=["GET"])
def crawl_sentiment_summary():
    """Return ``{positive, negative, neutral, pending}`` comment counts.

    Used by the Frontend's dashboard chip (Task 11.5 — sentiment
    visualisation). ``pending`` is rows where ``ai_sentiment IS NULL``
    (LLM call still pending or failed).
    """
    platform = (request.args.get("platform") or "").strip() or None
    from crawler.store.saulite_store import SauliteStore
    counts = SauliteStore().count_by_sentiment(platform=platform)
    return jsonify({"success": True, "data": counts})


@bp.route("/health", methods=["GET"])
def crawl_health():
    """Lightweight health check for the crawler subsystem.

    Returns:
        - ``ok`` = True / False
        - ``crawled_content_rows`` = int (rough dataset size)
        - ``crawled_comments_rows`` = int
        - ``now`` = ISO-8601 timestamp (useful for the dashboard
          v2 functionality where the Frontend wants a "last refreshed"
          label)

    Used by :func:`sau crawl status --crawler-only` (CLI flag) and
    by the Frontend's "refresh" button ripple animation trigger.
    """
    from web_runner.db import get_database
    db = get_database()
    try:
        crawled_content_rows = int(
            db.fetch_one("SELECT COUNT(*) AS n FROM crawled_content")["n"]
        )
        crawled_comments_rows = int(
            db.fetch_one("SELECT COUNT(*) AS n FROM crawled_comments")["n"]
        )
        ok = True
    except Exception as exc:  # pragma: no cover — degraded DB
        _module_logger.warning(
            "[crawler] health check DB query failed: %s", type(exc).__name__,
        )
        crawled_content_rows = 0
        crawled_comments_rows = 0
        ok = False
    return jsonify({
        "success": True,
        "data": {
            "ok": ok,
            "crawled_content_rows": crawled_content_rows,
            "crawled_comments_rows": crawled_comments_rows,
            "now": datetime.now(timezone.utc).isoformat(),
        },
    })
