"""Multi-platform crawler package surface for the local Web Shell.

Platform workers live under ``crawler/platforms/`` (optional / heavy).
Default path records demo rows into PostgreSQL so the UI is 0→1 usable
without ``SAU_CRAWLER_LIVE``. Real browser crawl: set
``SAU_CRAWLER_LIVE=1`` and provide platform cookies.
"""
from __future__ import annotations

import json
import secrets
import threading
from datetime import datetime, timezone
from typing import Any

__all__ = [
    "run_crawl",
    "create_crawl_task",
    "PLATFORM_ALIASES",
    "PLATFORM_REGISTRY",
]

PLATFORM_ALIASES: dict[str, str] = {
    "douyin": "dy",
    "dy": "dy",
    "xiaohongshu": "xhs",
    "xhs": "xhs",
    "kuaishou": "ks",
    "ks": "ks",
    "bilibili": "bili",
    "bili": "bili",
    "weibo": "wb",
    "wb": "wb",
    "tieba": "tieba",
    "zhihu": "zhihu",
    "tencent": "tencent",
    "tiktok": "tiktok",
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _normalize_platform(platform: str | None) -> str:
    if not platform:
        return ""
    key = platform.strip().lower()
    return PLATFORM_ALIASES.get(key, key)


def run_crawl(
    *,
    kind: str,
    platform: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = dict(payload or {})
    plat = _normalize_platform(platform or payload.get("platform"))
    keyword = payload.get("keyword") or payload.get("keywords") or ""
    if isinstance(keyword, list):
        keyword = " ".join(str(k) for k in keyword)
    post_ids = payload.get("post_ids") or payload.get("post_id") or ""
    if isinstance(post_ids, str) and post_ids:
        post_ids = [p.strip() for p in post_ids.replace(" ", ",").split(",") if p.strip()]
    elif not isinstance(post_ids, list):
        post_ids = []

    items: list[dict[str, Any]] = []
    comments: list[dict[str, Any]] = []
    message = "recorded"
    engine = "pg-record"

    import os

    if os.environ.get("SAU_CRAWLER_LIVE", "").lower() in ("1", "true", "yes"):
        try:
            items, comments, message, engine = _try_live_crawl(kind, plat, payload)
        except Exception as exc:
            message = f"live crawl failed: {type(exc).__name__}: {exc}"
            engine = "live-error"

    # Scaffold demo rows so the UI has something to show without live mode.
    max_count = int(payload.get("max_count") or payload.get("limit") or 5)
    max_count = max(1, min(max_count, 20))

    if not items and kind == "search" and keyword:
        items = [
            {
                "platform": plat or platform or "",
                "post_id": f"demo-{secrets.token_hex(4)}",
                "title": f"[{plat or platform or 'web'}] {keyword} · 示例 {i + 1}",
                "desc": f"本地演示数据（关键词：{keyword}）。开启 SAU_CRAWLER_LIVE=1 并配置账号 cookie 可抓取真实内容。",
                "author": "local-shell-demo",
                "url": None,
                "note": "demo row — set SAU_CRAWLER_LIVE=1 for browser crawl",
            }
            for i in range(min(3, max_count))
        ]
        message = "demo search rows recorded (enable SAU_CRAWLER_LIVE for real crawl)"
        engine = "demo"
    if not items and kind == "detail" and post_ids:
        items = [
            {
                "platform": plat or platform or "",
                "post_id": pid,
                "title": f"详情占位 · {pid}",
                "desc": f"本地壳对 post_id={pid} 的详情占位。",
                "author": "local-shell-demo",
                "url": None,
            }
            for pid in post_ids[:10]
        ]
        message = "detail placeholders recorded"
        engine = "demo"
    if kind == "comments" and post_ids and not comments:
        sentiments = ("positive", "neutral", "negative")
        for i, pid in enumerate(post_ids[:5]):
            for j in range(min(3, max_count)):
                comments.append({
                    "platform": plat or platform or "",
                    "post_id": pid,
                    "comment_id": f"c-{secrets.token_hex(3)}",
                    "content": f"示例评论 {j + 1}（{pid}）— 本地壳占位",
                    "text": f"示例评论 {j + 1}（{pid}）— 本地壳占位",
                    "sentiment": sentiments[j % 3],
                })
        message = "comment placeholders recorded"
        engine = "demo"

    stored_items: list[dict[str, Any]] = []
    for it in items:
        row = _persist_content_row(
            platform=str(it.get("platform") or plat or (platform or "")),
            post_id=it.get("post_id"),
            raw_payload={
                "kind": kind,
                "platform": plat,
                "engine": engine,
                "message": message,
                "title": it.get("title"),
                "desc": it.get("desc") or it.get("note"),
                "author": it.get("author"),
                "url": it.get("url"),
                "note": it.get("note"),
                "item": it,
                "request": {
                    "keyword": keyword,
                    "post_ids": post_ids,
                    "account": payload.get("account"),
                },
            },
        )
        if row:
            stored_items.append(row)

    if not items and not comments:
        # Breadcrumb for empty runs so operators can see the attempt.
        row = _persist_content_row(
            platform=plat or (platform or ""),
            post_id=(post_ids[0] if post_ids else None),
            raw_payload={
                "kind": kind,
                "platform": plat,
                "engine": engine,
                "message": message,
                "title": f"{kind}:empty",
                "request": payload,
            },
        )
        if row:
            stored_items.append(row)

    stored_comments: list[dict[str, Any]] = []
    for cm in comments:
        row = _persist_comment_row(
            platform=str(cm.get("platform") or plat or (platform or "")),
            post_id=cm.get("post_id"),
            raw_payload={
                "comment_id": cm.get("comment_id"),
                "text": cm.get("text") or cm.get("content") or "",
                "content": cm.get("content") or cm.get("text") or "",
                "engine": engine,
            },
            sentiment=str(cm.get("sentiment") or "neutral"),
        )
        if row:
            stored_comments.append(row)

    return {
        "items": stored_items,
        "comments": stored_comments,
        "message": message,
        "kind": kind,
        "platform": plat,
        "engine": engine,
        "counts": {"items": len(stored_items), "comments": len(stored_comments)},
    }


def _parse_json_field(val: Any) -> Any:
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


def _iso(val: Any) -> str | None:
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        try:
            return val.isoformat(timespec="seconds")  # type: ignore[call-arg]
        except TypeError:
            return val.isoformat()
    return str(val)


def _content_api_row(r: dict) -> dict[str, Any]:
    raw = _parse_json_field(r.get("raw_payload") if "raw_payload" in r else r.get("payload"))
    if not isinstance(raw, dict):
        raw = {"payload": raw} if raw is not None else {}
    # Promote flat columns into raw_payload for the UI extractor.
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


def _comment_api_row(r: dict) -> dict[str, Any]:
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


def _dict_rows(conn) -> None:
    conn.row_factory = lambda c, r: {col[0]: r[i] for i, col in enumerate(c.description)}


def _persist_content_row(
    *,
    platform: str,
    post_id: str | None,
    raw_payload: dict[str, Any],
) -> dict[str, Any] | None:
    from web_runner.db import db_lock, get_connection

    now = _now()
    payload_json = json.dumps(raw_payload, ensure_ascii=False)
    with db_lock:
        with get_connection() as conn:
            _dict_rows(conn)
            # Preferred schema (matches frontend + SauliteStore docs).
            try:
                cur = conn.execute(
                    "INSERT INTO crawled_content "
                    "(platform, post_id, raw_payload, crawled_at) "
                    "VALUES (?, ?, ?::jsonb, ?) RETURNING *",
                    (platform, post_id, payload_json, now),
                )
                row = cur.fetchone()
                conn.commit()
                return _content_api_row(row) if row else None
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
            # Legacy scaffold columns (title/author/url/payload/created_at).
            try:
                cur = conn.execute(
                    "INSERT INTO crawled_content "
                    "(platform, post_id, title, author, url, payload, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
                    (
                        platform,
                        post_id,
                        raw_payload.get("title"),
                        raw_payload.get("author"),
                        raw_payload.get("url"),
                        payload_json,
                        now,
                    ),
                )
                row = cur.fetchone()
                conn.commit()
                return _content_api_row(row) if row else None
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
                raise


def _persist_comment_row(
    *,
    platform: str,
    post_id: str | None,
    raw_payload: dict[str, Any],
    sentiment: str = "neutral",
) -> dict[str, Any] | None:
    from web_runner.db import db_lock, get_connection

    now = _now()
    payload_json = json.dumps(raw_payload, ensure_ascii=False)
    text = (
        raw_payload.get("text")
        or raw_payload.get("content")
        or raw_payload.get("comment")
        or ""
    )
    # Simple local "AI" suggestion so the comments tab is not empty.
    suggestion = f"感谢反馈：{str(text)[:40]}" if text else "感谢留言，我们会持续关注。"
    conf = 0.72 if sentiment in ("positive", "negative", "neutral") else None

    with db_lock:
        with get_connection() as conn:
            _dict_rows(conn)
            try:
                cur = conn.execute(
                    "INSERT INTO crawled_comments "
                    "(platform, post_id, raw_payload, ai_sentiment, "
                    "ai_sentiment_confidence, ai_reply_suggestion, crawled_at) "
                    "VALUES (?, ?, ?::jsonb, ?, ?, ?, ?) RETURNING *",
                    (platform, post_id, payload_json, sentiment, conf, suggestion, now),
                )
                row = cur.fetchone()
                conn.commit()
                return _comment_api_row(row) if row else None
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
            try:
                cur = conn.execute(
                    "INSERT INTO crawled_comments "
                    "(platform, post_id, comment_id, content, sentiment, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
                    (
                        platform,
                        post_id,
                        raw_payload.get("comment_id"),
                        text,
                        sentiment,
                        now,
                    ),
                )
                row = cur.fetchone()
                conn.commit()
                return _comment_api_row(row) if row else None
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
                raise


def _try_live_crawl(
    kind: str,
    platform: str,
    payload: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str]:
    registry = PLATFORM_REGISTRY
    cls = registry.get(platform)
    if cls is None:
        return [], [], f"no crawler class for platform={platform!r}", "live-miss"
    crawler = cls()  # type: ignore[call-arg]
    # Prefer the SauliteStore path when available (already writes raw_payload).
    if hasattr(crawler, kind):
        method = getattr(crawler, kind)
        try:
            if kind == "search":
                result = method(payload.get("keyword") or "")
            elif kind == "detail":
                pids = payload.get("post_ids") or payload.get("post_id") or []
                if isinstance(pids, str):
                    pids = [pids]
                result = method(pids[0] if pids else "")
            elif kind == "comments":
                pids = payload.get("post_ids") or payload.get("post_id") or []
                if isinstance(pids, str):
                    pids = [pids]
                result = method(pids[0] if pids else "")
            else:
                result = None
            if isinstance(result, dict):
                return (
                    list(result.get("items") or []),
                    list(result.get("comments") or []),
                    "live ok",
                    "live",
                )
            if isinstance(result, list):
                return result, [], "live ok", "live"
        except Exception as exc:
            return [], [], f"live method failed: {type(exc).__name__}: {exc}", "live-error"
    if hasattr(crawler, "run_once"):
        result = crawler.run_once(kind=kind, **payload)  # type: ignore[attr-defined]
        if isinstance(result, dict):
            return (
                list(result.get("items") or []),
                list(result.get("comments") or []),
                "live ok",
                "live",
            )
        if isinstance(result, list):
            return result, [], "live ok", "live"
    return [], [], "crawler has no usable entrypoint for live mode", "live-unsupported"


def create_crawl_task(
    *,
    user_id: int | None = None,
    platform: str,
    action: str,
    params: dict[str, Any] | None = None,
) -> str:
    from web_runner.db import db_lock, get_connection

    params = dict(params or {})
    task_id = f"crawl-{action}-{secrets.token_hex(6)}"
    now = _now()
    payload = {"kind": action, "platform": platform, "user_id": user_id, **params}
    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO crawl_tasks "
                "(task_id, kind, status, platform, payload, created_at, updated_at) "
                "VALUES (?, ?, 'pending', ?, ?, ?, ?)",
                (task_id, action, platform, json.dumps(payload, ensure_ascii=False), now, now),
            )
            conn.commit()

    def _worker() -> None:
        try:
            result = run_crawl(kind=action, platform=platform, payload=payload)
            status, err = "success", None
            result_s = json.dumps(result, ensure_ascii=False)
        except Exception as exc:
            status, err = "failed", f"{type(exc).__name__}: {exc}"
            result_s = json.dumps({"error": err}, ensure_ascii=False)
        with db_lock:
            with get_connection() as conn:
                conn.execute(
                    "UPDATE crawl_tasks SET status=?, result=?, error=?, updated_at=? WHERE task_id=?",
                    (status, result_s, err, _now(), task_id),
                )
                conn.commit()

    threading.Thread(target=_worker, name=f"crawl-{task_id}", daemon=True).start()
    return task_id


def __getattr__(name: str) -> Any:
    if name == "PLATFORM_REGISTRY":
        mapping: dict[str, type] = {}
        try:
            from crawler.platforms import bilibili, douyin, kuaishou, tieba, weibo, xhs, zhihu

            for code, mod, attr in (
                ("xhs", xhs, "XiaoHongShuCrawler"),
                ("dy", douyin, "DouyinCrawler"),
                ("ks", kuaishou, "KuaishouCrawler"),
                ("bili", bilibili, "BilibiliCrawler"),
                ("wb", weibo, "WeiboCrawler"),
                ("tieba", tieba, "TieBaCrawler"),
                ("zhihu", zhihu, "ZhihuCrawler"),
            ):
                cls = getattr(mod, attr, None)
                if cls is not None:
                    mapping[code] = cls
        except Exception:
            mapping = {}
        globals()["PLATFORM_REGISTRY"] = mapping
        return mapping
    raise AttributeError(name)
