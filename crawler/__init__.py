"""Multi-platform crawler package surface for the local Web Shell.

Platform workers live under ``crawler/platforms/`` (optional / heavy).
Local Flask uses PostgreSQL; public helpers enqueue + record without Postgres.
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
    if not items and kind == "search" and keyword:
        items = [
            {
                "platform": plat or platform or "",
                "post_id": f"demo-{secrets.token_hex(4)}",
                "title": f"[{plat or platform or 'web'}] {keyword}",
                "author": "local-shell",
                "url": None,
                "note": "demo row — set SAU_CRAWLER_LIVE=1 for browser crawl",
            }
        ]
        message = "demo search rows recorded (enable SAU_CRAWLER_LIVE for real crawl)"
    if not items and kind == "detail" and post_ids:
        items = [
            {
                "platform": plat or platform or "",
                "post_id": pid,
                "title": f"detail:{pid}",
                "author": "local-shell",
                "url": None,
            }
            for pid in post_ids[:10]
        ]
        message = "detail placeholders recorded"
    if kind == "comments" and post_ids and not comments:
        for pid in post_ids[:5]:
            comments.append({
                "platform": plat or platform or "",
                "post_id": pid,
                "comment_id": f"c-{secrets.token_hex(3)}",
                "content": f"示例评论（{pid}）— 本地壳占位",
                "sentiment": "neutral",
            })
        message = "comment placeholders recorded"

    if kind == "search":
        title = f"search:{keyword}" if keyword else "search"
    elif kind == "detail":
        title = f"detail:{','.join(post_ids[:3])}"
    elif kind == "comments":
        title = f"comments:{','.join(post_ids[:3])}"
    else:
        title = kind

    for it in items:
        _persist_content_row(
            platform=it.get("platform") or plat or (platform or ""),
            post_id=it.get("post_id"),
            title=it.get("title") or title,
            author=it.get("author"),
            url=it.get("url"),
            payload={
                "kind": kind,
                "platform": plat,
                "request": payload,
                "item": it,
                "engine": engine,
                "message": message,
            },
        )
    if not items:
        # still leave a breadcrumb for empty runs
        _persist_content_row(
            platform=plat or (platform or ""),
            post_id=(post_ids[0] if post_ids else None),
            title=title,
            author=None,
            url=None,
            payload={
                "kind": kind,
                "platform": plat,
                "request": payload,
                "items": items,
                "engine": engine,
                "message": message,
            },
        )

    for cm in comments:
        _persist_comment_row(
            platform=cm.get("platform") or plat or (platform or ""),
            post_id=cm.get("post_id"),
            comment_id=cm.get("comment_id"),
            content=cm.get("content") or "",
            sentiment=cm.get("sentiment") or "pending",
        )

    return {
        "items": items,
        "comments": comments,
        "message": message,
        "kind": kind,
        "platform": plat,
        "engine": engine,
        "counts": {"items": len(items), "comments": len(comments)},
    }


def _persist_content_row(
    *,
    platform: str,
    post_id: str | None,
    title: str,
    author: str | None,
    url: str | None,
    payload: dict[str, Any],
) -> None:
    from web_runner.db import db_lock, get_connection

    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO crawled_content "
                "(platform, post_id, title, author, url, payload, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    platform,
                    post_id,
                    title,
                    author,
                    url,
                    json.dumps(payload, ensure_ascii=False),
                    _now(),
                ),
            )
            conn.commit()


def _persist_comment_row(
    *,
    platform: str,
    post_id: str | None,
    comment_id: str | None,
    content: str,
    sentiment: str,
) -> None:
    from web_runner.db import db_lock, get_connection

    with db_lock:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO crawled_comments "
                "(platform, post_id, comment_id, content, sentiment, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (platform, post_id, comment_id, content, sentiment, _now()),
            )
            conn.commit()


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
    return [], [], "crawler has no run_once(); optional live mode unsupported", "live-unsupported"


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
