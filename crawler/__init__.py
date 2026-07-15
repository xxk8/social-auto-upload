"""Multi-platform crawler (openspec/changes/mediacrawler-integration).

Public surface:
    - ``AbstractCrawler`` from :mod:`crawler.base.base_crawler` — the
      contract every platform-specific crawler must implement.
    - ``SauliteStore`` from :mod:`crawler.store.saulite_store` — the
      PG-backed persistence layer that replaces MediaCrawler's original
      JSON / SQLite storage with this project's PostgreSQL backbone.
    - ``BaseConfig`` from :mod:`crawler.config` — runtime knobs (proxy,
      save-data option, request delay) read from env at import-time.
    - ``create_crawl_task`` — a thin helper used by both the Web API
      (``web_runner/routes/crawl.py``) and the CLI dispatcher
      (``cli/dispatchers.py::dispatch_crawl``) so they share the same
      enqueue path into the ``tasks`` table.

Vendor strategy (tasks 1.2 + 2.x):
    The 7 platform subpackages under :mod:`crawler.platforms` mirror
    MediaCrawler's structure (``media_platform/<x>/core.py``). Import
    paths were rewritten from MediaCrawler's bare ``import config`` /
    ``from media_platform`` form to the namespaced ``from crawler import
    config`` form (D4 of design.md). This eliminates name collisions
    with the existing ``uploader/xiaohongshu_uploader`` tree.
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

# Re-exports — keep at module top so `from crawler import X` works
# even if a downstream module only needs the type, not the value.
from crawler.base.base_crawler import AbstractCrawler  # noqa: F401
from crawler.config import BaseConfig  # noqa: F401
from crawler.store.saulite_store import SauliteStore  # noqa: F401

__all__ = [
    "AbstractCrawler",
    "BaseConfig",
    "SauliteStore",
    "create_crawl_task",
    "PLATFORM_REGISTRY",
]


def create_crawl_task(
    *,
    user_id: int | None,
    platform: str,
    action: str,
    params: dict[str, Any],
) -> str:
    """Enqueue a crawler task into the same ``tasks`` table the publish
    side uses.

    Returns the freshly created ``task_id`` (caller can poll
    :func:`web_runner.routes.tasks.get_single_task` or
    ``GET /api/crawl/status?task_id=...`` for status).

    Why share the ``tasks`` table instead of inventing a separate
    ``crawl_tasks`` table:
        * The existing :class:`PlatformExecutor` already drains the
          ``tasks`` table on boot (``load_pending_tasks``) — reusing
          it means a crawler task survives a Flask restart with no
          extra wiring (design.md Risk 2 mitigation: "异步上下文" 兜底).
        * ``usage_logs.action='studio_render'`` already shows the
          pattern of widening the action enum. Adding
          ``action='crawl_search'`` etc. follows the same precedent —
          see ``web_runner/db.py`` ALTER block for the studio_render
          widening migration.

    Two notes:
        * Inserts use ``status='pending'`` (NOT ``scheduled``) so
          :class:`PlatformExecutor` picks the task up immediately on
          its next loop tick. Scheduled crawl is NOT in scope of this
          change (a future round could add a ``scheduled_at`` column
          and a ``load_scheduled_tasks`` equivalent).
        * ``action`` is set to ``crawl_<op>`` (``crawl_search`` /
          ``crawl_detail`` / ``crawl_comments``). This prefix matches
          existing task-row convention where ``action`` carries the
          verb (``publish`` / ``studio_render`` etc.), so a future
          PhaseExecutor branch can distinguish crawl from upload.
        * The ``argv`` column stores the JSON-serialized ``params``
          dict so an executor worker can reconstruct ``(platform,
          action, keyword/post_ids)`` without a separate state table.
    """
    from web_runner.db import get_database

    db = get_database()
    task_id = f"crawl-{action}-{secrets.token_hex(6)}"
    created = datetime.now(timezone.utc).isoformat()
    verb = f"crawl_{action}"  # e.g. crawl_search
    # JSON-serialize the params so a worker can rehydrate them
    # without losing types. PG JSONB would be cleaner but the
    # ``tasks`` table is plain TEXT for historical reasons (see
    # `web_runner/db.py` tasks CREATE TABLE).
    argv_text = json.dumps(
        {
            "kind": "crawl",
            "platform": platform,
            "action": action,
            **params,
        },
        ensure_ascii=False,
    )
    owner = str(user_id) if user_id is not None else "anonymous"
    # 11 columns in the tasks table; we set 6 placeholders + 5 literals.
    # The trailing ``publish_detail=NULL`` column is intentionally
    # NULL — crawl rows don't carry publish-step details.
    db.execute(
        "INSERT INTO tasks ("
        "task_id, status, platform, action, account, created, "
        "code, error, argv, result, publish_detail"
        ") VALUES (?, 'pending', ?, ?, ?, ?, 0, NULL, ?, NULL, NULL)",
        (task_id, platform, verb, owner, created, argv_text),
    )
    return task_id


# Provide a lazy PLATFORM_REGISTRY that fills in the live Crawler
# classes on first access (PEP 562 module-level __getattr__ hook) —
# keeps ``from crawler import PLATFORM_REGISTRY`` working without
# forcing eager imports of every per-platform module at
# package-init time.


def __getattr__(name: str) -> Any:
    """PEP 562 module-level ``__getattr__``: lazy attribute lookup.

    Used to expose :data:`PLATFORM_REGISTRY` without eagerly
    importing every per-platform module at package-init time
    (which would drag playwright deps even when the operator is
    running only CLI bookkeeping).
    """
    if name == "PLATFORM_REGISTRY":
        from crawler.platforms import (
            bilibili,
            douyin,
            kuaishou,
            tieba,
            weibo,
            xhs,
            zhihu,
        )

        mapping: dict[str, type[AbstractCrawler]] = {
            "xhs": xhs.XiaoHongShuCrawler,
            "dy": douyin.DouyinCrawler,
            "ks": kuaishou.KuaishouCrawler,
            "bili": bilibili.BilibiliCrawler,
            "wb": weibo.WeiboCrawler,
            "tieba": tieba.TiebaCrawler,
            "zhihu": zhihu.ZhihuCrawler,
            "xiaohongshu": xhs.XiaoHongShuCrawler,
            "douyin": douyin.DouyinCrawler,
            "kuaishou": kuaishou.KuaishouCrawler,
            "bilibili": bilibili.BilibiliCrawler,
            "weibo": weibo.WeiboCrawler,
        }
        return mapping
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
