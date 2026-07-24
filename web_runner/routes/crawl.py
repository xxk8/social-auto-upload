"""Crawl API — local SQLite task queue + optional crawler package.

Front-end: ``sau_web/frontend/src/api/crawl.ts``

When ``crawler`` package is unavailable, endpoints still return a stable
envelope so the UI does not hard-crash; workers can be filled in later.
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from web_runner.db import db_lock, get_connection

bp = Blueprint("crawl", __name__)


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _new_id(prefix: str = "crawl") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


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
    # Fire-and-forget best-effort worker
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
            conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
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
            try:
                payload = json.loads(row["payload"] or "{}")
            except json.JSONDecodeError:
                payload = {}

    result: dict = {"items": [], "message": "no crawler backend"}
    status = "success"
    error = None
    try:
        try:
            from crawler import run_crawl

            result = (
                run_crawl(
                    kind=kind,
                    platform=row.get("platform"),
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
        except Exception as exc:  # strict-exceptions: allow worker
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
                        json.dumps(result, ensure_ascii=False),
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
    return jsonify({"success": True, "data": {"task_id": task_id}}), 202


@bp.post("/api/crawl/search-stream")
def crawl_search_stream():
    """Non-SSE fallback: start task and return id (UI may poll status)."""
    return crawl_search()


@bp.post("/api/crawl/detail")
def crawl_detail():
    payload = request.get_json(silent=True) or {}
    if not payload.get("post_id") and not payload.get("post_ids"):
        return jsonify({"success": False, "message": "post_id is required"}), 400
    task_id = _insert_task("detail", payload.get("platform"), payload)
    return jsonify({"success": True, "data": {"task_id": task_id}}), 202


@bp.post("/api/crawl/comments")
def crawl_comments_start():
    payload = request.get_json(silent=True) or {}
    if not payload.get("post_id") and not payload.get("post_ids"):
        return jsonify({"success": False, "message": "post_id is required"}), 400
    task_id = _insert_task("comments", payload.get("platform"), payload)
    return jsonify({"success": True, "data": {"task_id": task_id}}), 202


@bp.get("/api/crawl/status")
def crawl_status():
    task_id = request.args.get("task_id")
    if not task_id:
        return jsonify({"success": False, "message": "task_id required"}), 400
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
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
            "result": result,
            "error": row.get("error"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        },
    })


@bp.get("/api/crawl/data")
def crawl_data():
    platform = request.args.get("platform")
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    sql = "SELECT * FROM crawled_content"
    params: list = []
    if platform:
        sql += " WHERE platform = ?"
        params.append(platform)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(sql, params).fetchall()
    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "platform": r.get("platform"),
            "post_id": r.get("post_id"),
            "title": r.get("title"),
            "author": r.get("author"),
            "url": r.get("url"),
            "created_at": r.get("created_at"),
            "payload": r.get("payload"),
        })
    return jsonify({"success": True, "data": items})


@bp.get("/api/crawl/comments")
def crawl_comments_list():
    platform = request.args.get("platform")
    post_id = request.args.get("post_id")
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    sql = "SELECT * FROM crawled_comments WHERE 1=1"
    params: list = []
    if platform:
        sql += " AND platform = ?"
        params.append(platform)
    if post_id:
        sql += " AND post_id = ?"
        params.append(post_id)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(sql, params).fetchall()
    return jsonify({"success": True, "data": rows})


@bp.post("/api/crawl/reply-suggest")
def crawl_reply_suggest():
    payload = request.get_json(silent=True) or {}
    text = payload.get("content") or payload.get("text") or ""
    return jsonify({
        "success": True,
        "data": {
            "suggestions": [
                f"感谢分享：{text[:40]}" if text else "感谢反馈，我们会持续优化。",
                "你好，已收到你的留言～",
            ],
        },
    })


@bp.get("/api/crawl/sentiment-summary")
def crawl_sentiment_summary():
    platform = request.args.get("platform")
    sql = "SELECT sentiment, COUNT(*) AS cnt FROM crawled_comments"
    params: list = []
    if platform:
        sql += " WHERE platform = ?"
        params.append(platform)
    sql += " GROUP BY sentiment"
    with get_connection() as conn:
        conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}
        rows = conn.execute(sql, params).fetchall()
    bucket = {"positive": 0, "negative": 0, "neutral": 0, "pending": 0}
    for r in rows:
        key = (r.get("sentiment") or "pending").lower()
        if key not in bucket:
            key = "pending"
        bucket[key] += int(r.get("cnt") or 0)
    return jsonify({"success": True, "data": bucket})


@bp.get("/api/crawl/health")
def crawl_health():
    try:
        from crawler import run_crawl  # noqa: F401

        available = True
        message = "run_crawl ready (sqlite record; set SAU_CRAWLER_LIVE=1 for browser crawlers)"
    except ImportError:
        available = False
        message = "crawler.run_crawl missing; tasks still queued"
    return jsonify({
        "success": True,
        "data": {
            "available": available,
            "message": message,
            "queue": "sqlite:crawl_tasks",
        },
    })
