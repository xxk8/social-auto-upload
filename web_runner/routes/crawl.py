"""Crawl API — PostgreSQL task queue + crawler package.

Front-end: ``sau_web/frontend/src/api/crawl.ts`` + ``CrawlPage.tsx``.

Contracts (post 0→1 fix):
  * Content/comments rows use ``raw_payload`` + ``crawled_at`` (with
    legacy column fallbacks when reading).
  * ``GET /health`` returns ``ok`` + row counts for the stats strip.
  * ``GET /sentiment-summary`` groups by ``ai_sentiment`` (or ``sentiment``).
  * ``POST /search-stream`` is a real SSE stream that emits
    ``platform_result`` then ``done`` (matches ``readSSEStream``).
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone

from flask import Blueprint, Response, jsonify, request, stream_with_context

from web_runner.db import db_lock, get_connection

bp = Blueprint("crawl", __name__)


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _new_id(prefix: str = "crawl") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _dict_rows(conn) -> None:
    conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}


def _parse_json_field(val):
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str) and val.strip():
        try:
            return json.loads(val)
        except Exception:
            return val
    return val


def _iso(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        try:
            return val.isoformat(timespec="seconds")  # type: ignore[call-arg]
        except TypeError:
            return val.isoformat()
    return str(val)


def _content_api_row(r: dict) -> dict:
    raw = _parse_json_field(r.get("raw_payload") if "raw_payload" in r else r.get("payload"))
    if not isinstance(raw, dict):
        raw = {"payload": raw} if raw is not None else {}
    for k in ("title", "author", "url", "desc"):
        if r.get(k) and k not in raw:
            raw[k] = r[k]
    return {
        "id": r["id"],
        "platform": r.get("platform"),
        "post_id": r.get("post_id"),
        "raw_payload": raw,
        "crawled_at": _iso(r.get("crawled_at") or r.get("created_at")),
    }


def _comment_api_row(r: dict) -> dict:
    raw = _parse_json_field(r.get("raw_payload") if "raw_payload" in r else None)
    if not isinstance(raw, dict):
        raw = {}
    if r.get("content") and "text" not in raw:
        raw["text"] = r["content"]
        raw["content"] = r["content"]
    if r.get("comment_id") and "comment_id" not in raw:
        raw["comment_id"] = r["comment_id"]
    sentiment = r.get("ai_sentiment") if r.get("ai_sentiment") is not None else r.get("sentiment")
    return {
        "id": r["id"],
        "platform": r.get("platform"),
        "post_id": r.get("post_id"),
        "raw_payload": raw,
        "ai_sentiment": sentiment,
        "ai_sentiment_confidence": r.get("ai_sentiment_confidence"),
        "ai_reply_suggestion": r.get("ai_reply_suggestion"),
        "crawled_at": _iso(r.get("crawled_at") or r.get("created_at")),
    }


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _insert_task(kind: str, platform: str | None, payload: dict) -> str:
    task_id = _new_id(kind)
    now = _now()
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO crawl_tasks "
                "(task_id, kind, status, platform, payload, created_at, updated_at) "
                "VALUES (?, ?, 'pending', ?, ?, ?, ?)",
                (task_id, kind, platform, json.dumps(payload, ensure_ascii=False), now, now),
            )
            conn.commit()
    threading.Thread(
        target=_run_crawl_task,
        args=(task_id,),
        name=f"crawl-{task_id}",
        daemon=True,
    ).start()
    return task_id


def _run_crawl_task(task_id: str) -> None:
    with db_lock:
        with get_connection() as conn:
            _dict_rows(conn)
            row = conn.execute(
                "SELECT * FROM crawl_tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
            if not row:
                return
            conn.execute(
                "UPDATE crawl_tasks SET status = 'running', updated_at = ? WHERE task_id = ?",
                (_now(), task_id),
            )
            conn.commit()
            kind = row["kind"]
            platform = row.get("platform")
            try:
                payload = json.loads(row["payload"] or "{}")
            except json.JSONDecodeError:
                payload = {}

    result: dict = {"items": [], "message": "no crawler backend"}
    status = "success"
    error = None
    try:
        from crawler import run_crawl

        result = (
            run_crawl(
                kind=kind,
                platform=platform,
                payload=payload,
            )
            or result
        )
        status = "success"
    except ImportError:
        result = {
            "items": [],
            "message": "crawler package missing run_crawl; task recorded only",
            "kind": kind,
            "payload": payload,
        }
        status = "success"
    except Exception as exc:
        status = "failed"
        error = f"{type(exc).__name__}: {exc}"
        result = {"items": [], "error": error}
    finally:
        with db_lock:
            with get_connection() as conn:
                conn.execute(
                    "UPDATE crawl_tasks SET status = ?, result = ?, error = ?, updated_at = ? "
                    "WHERE task_id = ?",
                    (
                        status,
                        json.dumps(result, ensure_ascii=False, default=str),
                        error,
                        _now(),
                        task_id,
                    ),
                )
                conn.commit()


@bp.post("/api/crawl/search")
def crawl_search():
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform")
    keyword = payload.get("keyword") or payload.get("keywords")
    if not keyword:
        return jsonify({"success": False, "message": "keyword is required"}), 400
    task_id = _insert_task("search", platform, payload)
    return jsonify({
        "success": True,
        "data": {"task_id": task_id, "status": "pending"},
    }), 202


@bp.post("/api/crawl/search-stream")
def crawl_search_stream():
    """SSE: run search now and stream ``platform_result`` rows then ``done``.

    Account is optional — without cookies / LIVE mode the crawler writes
    demo rows so the UI is usable 0→1.
    """
    payload = request.get_json(silent=True) or {}
    platform = payload.get("platform") or "xhs"
    keyword = payload.get("keyword") or payload.get("keywords")
    if not keyword:
        return jsonify({"success": False, "message": "keyword is required"}), 400

    task_id = _new_id("search")
    now = _now()
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO crawl_tasks "
                "(task_id, kind, status, platform, payload, created_at, updated_at) "
                "VALUES (?, ?, 'running', ?, ?, ?, ?)",
                (
                    task_id,
                    "search",
                    platform,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            conn.commit()

    def generate():
        yield _sse("data", {"content": f"开始采集「{keyword}」…", "task_id": task_id})
        status = "success"
        error = None
        result: dict = {}
        try:
            from crawler import run_crawl

            result = run_crawl(kind="search", platform=platform, payload=payload) or {}
            items = result.get("items") or []
            for item in items:
                # UI expects CrawledContentItem shape.
                yield _sse("platform_result", item if isinstance(item, dict) else {"raw_payload": item})
            msg = result.get("message") or "done"
            yield _sse("data", {"content": msg})
            yield _sse(
                "done",
                {
                    "content": msg,
                    "task_id": task_id,
                    "counts": result.get("counts") or {"items": len(items)},
                    "engine": result.get("engine"),
                },
            )
        except Exception as exc:
            status = "failed"
            error = f"{type(exc).__name__}: {exc}"
            yield _sse("error", {"message": error, "code": "crawl_failed"})
        finally:
            with db_lock:
                with get_connection() as conn:
                    conn.execute(
                        "UPDATE crawl_tasks SET status=?, result=?, error=?, updated_at=? "
                        "WHERE task_id=?",
                        (
                            status,
                            json.dumps(result, ensure_ascii=False, default=str),
                            error,
                            _now(),
                            task_id,
                        ),
                    )
                    conn.commit()

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            # Do NOT set Connection: keep-alive — Waitress rejects hop-by-hop headers.
        },
    )


@bp.post("/api/crawl/detail")
def crawl_detail():
    payload = request.get_json(silent=True) or {}
    if not payload.get("post_id") and not payload.get("post_ids"):
        return jsonify({"success": False, "message": "post_id is required"}), 400
    task_id = _insert_task("detail", payload.get("platform"), payload)
    return jsonify({
        "success": True,
        "data": {"task_id": task_id, "status": "pending"},
    }), 202


@bp.post("/api/crawl/comments")
def crawl_comments_start():
    payload = request.get_json(silent=True) or {}
    if not payload.get("post_id") and not payload.get("post_ids"):
        return jsonify({"success": False, "message": "post_id is required"}), 400
    task_id = _insert_task("comments", payload.get("platform"), payload)
    return jsonify({
        "success": True,
        "data": {"task_id": task_id, "status": "pending"},
    }), 202


@bp.get("/api/crawl/status")
def crawl_status():
    task_id = request.args.get("task_id")
    if not task_id:
        return jsonify({"success": False, "message": "task_id required"}), 400
    with get_connection() as conn:
        _dict_rows(conn)
        row = conn.execute(
            "SELECT * FROM crawl_tasks WHERE task_id = ?", (task_id,)
        ).fetchone()
    if not row:
        return jsonify({"success": False, "message": "not found"}), 404
    result = None
    if row.get("result"):
        try:
            result = json.loads(row["result"])
        except json.JSONDecodeError:
            result = row["result"]
    return jsonify({
        "success": True,
        "data": {
            "task_id": row["task_id"],
            "kind": row["kind"],
            "status": row["status"],
            "platform": row.get("platform"),
            "action": row.get("kind"),
            "result": result,
            "error": row.get("error"),
            "created": row.get("created_at"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "code": None,
        },
    })


@bp.get("/api/crawl/data")
def crawl_data():
    platform = request.args.get("platform")
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    limit = max(1, min(limit or 50, 200))
    offset = max(0, offset or 0)
    sql = "SELECT * FROM crawled_content"
    params: list = []
    if platform:
        sql += " WHERE platform = ?"
        params.append(platform)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with get_connection() as conn:
        _dict_rows(conn)
        rows = conn.execute(sql, params).fetchall()
    return jsonify({
        "success": True,
        "data": [_content_api_row(r) for r in rows],
    })


@bp.get("/api/crawl/comments")
def crawl_comments_list():
    platform = request.args.get("platform")
    post_id = request.args.get("post_id")
    sentiment = request.args.get("sentiment")
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    limit = max(1, min(limit or 50, 200))
    offset = max(0, offset or 0)
    sql = "SELECT * FROM crawled_comments WHERE 1=1"
    params: list = []
    if platform:
        sql += " AND platform = ?"
        params.append(platform)
    if post_id:
        sql += " AND post_id = ?"
        params.append(post_id)
    if sentiment and sentiment != "pending":
        # Prefer ai_sentiment; also match legacy ``sentiment`` if present.
        sql += " AND (ai_sentiment = ? OR sentiment = ?)"
        params.extend([sentiment, sentiment])
    elif sentiment == "pending":
        sql += " AND (ai_sentiment IS NULL AND (sentiment IS NULL OR sentiment = '' OR sentiment = 'pending'))"
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    try:
        with get_connection() as conn:
            _dict_rows(conn)
            rows = conn.execute(sql, params).fetchall()
    except Exception:
        # Retry without sentiment filters if legacy schema lacks columns.
        sql2 = "SELECT * FROM crawled_comments WHERE 1=1"
        params2: list = []
        if platform:
            sql2 += " AND platform = ?"
            params2.append(platform)
        if post_id:
            sql2 += " AND post_id = ?"
            params2.append(post_id)
        sql2 += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params2.extend([limit, offset])
        with get_connection() as conn:
            _dict_rows(conn)
            rows = conn.execute(sql2, params2).fetchall()
    return jsonify({
        "success": True,
        "data": [_comment_api_row(r) for r in rows],
    })


@bp.post("/api/crawl/reply-suggest")
def crawl_reply_suggest():
    payload = request.get_json(silent=True) or {}
    text = payload.get("content") or payload.get("text") or payload.get("comment_text") or ""
    text = str(text).strip()
    suggestion = (
        f"谢谢你的反馈：「{text[:40]}」我们会认真参考～"
        if text
        else "感谢留言，我们会持续优化。"
    )
    return jsonify({
        "success": True,
        "data": {
            "ai_reply_suggestion": suggestion,
            "suggestions": [
                suggestion,
                "你好，已收到你的留言，稍后回复你～",
            ],
        },
    })


@bp.get("/api/crawl/sentiment-summary")
def crawl_sentiment_summary():
    platform = request.args.get("platform")
    bucket = {"positive": 0, "negative": 0, "neutral": 0, "pending": 0}

    def _fill(rows, key_name: str) -> None:
        for r in rows:
            key = (r.get(key_name) or "pending")
            if isinstance(key, str):
                key = key.lower()
            else:
                key = "pending"
            if key not in bucket:
                key = "pending"
            bucket[key] += int(r.get("cnt") or 0)

    with get_connection() as conn:
        _dict_rows(conn)
        tried = False
        for col in ("ai_sentiment", "sentiment"):
            try:
                sql = f"SELECT {col} AS s, COUNT(*) AS cnt FROM crawled_comments"
                params: list = []
                if platform:
                    sql += " WHERE platform = ?"
                    params.append(platform)
                sql += f" GROUP BY {col}"
                rows = conn.execute(sql, params).fetchall()
                # Map s → bucket
                for r in rows:
                    key = (r.get("s") or "pending")
                    if isinstance(key, str):
                        key = key.lower()
                    else:
                        key = "pending"
                    if key not in bucket:
                        key = "pending"
                    bucket[key] += int(r.get("cnt") or 0)
                tried = True
                break
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
                continue
        if not tried:
            try:
                sql = "SELECT COUNT(*) AS cnt FROM crawled_comments"
                params = []
                if platform:
                    sql += " WHERE platform = ?"
                    params.append(platform)
                row = conn.execute(sql, params).fetchone()
                bucket["pending"] = int((row or {}).get("cnt") or 0)
            except Exception:
                pass

    return jsonify({"success": True, "data": bucket})


@bp.get("/api/crawl/health")
def crawl_health():
    content_n = 0
    comment_n = 0
    with get_connection() as conn:
        _dict_rows(conn)
        try:
            content_n = int(
                (conn.execute("SELECT COUNT(*) AS c FROM crawled_content").fetchone() or {}).get("c")
                or 0
            )
        except Exception:
            content_n = 0
        try:
            comment_n = int(
                (conn.execute("SELECT COUNT(*) AS c FROM crawled_comments").fetchone() or {}).get("c")
                or 0
            )
        except Exception:
            comment_n = 0

    available = False
    message = "crawler unavailable"
    try:
        from crawler import run_crawl  # noqa: F401

        available = True
        message = "run_crawl ready (demo rows by default; SAU_CRAWLER_LIVE=1 for browser crawl)"
    except ImportError:
        available = False
        message = "crawler.run_crawl missing; tasks still queued"

    return jsonify({
        "success": True,
        "data": {
            "ok": available,
            "available": available,
            "message": message,
            "queue": "postgres:crawl_tasks",
            "crawled_content_rows": content_n,
            "crawled_comments_rows": comment_n,
            "now": _now(),
        },
    })
