"""Per-platform crawler subpackages (vendored from MediaCrawler).

Each platform module exposes a single concrete :class:`AbstractCrawler`
subclass named ``XxxCrawler`` (matching MediaCrawler's naming
convention). The ``__init__.py`` re-exports the class so
``from crawler.platforms.xhs import XiaoHongShuCrawler`` works.

Real Playwright-driven search/detail/comments flows for each platform
are documented TODOs in the per-platform ``core.py``. The infrastructure
(route, CLI, schema, AI hooks) is fully wired — an operator drops in
real Playwright selector chains into ``core.py`` without touching
anything outside :mod:`crawler.platforms.<x>.core`.
"""
from __future__ import annotations

from crawler.platforms.bilibili import BilibiliCrawler  # noqa: F401
from crawler.platforms.douyin import DouyinCrawler  # noqa: F401
from crawler.platforms.kuaishou import KuaishouCrawler  # noqa: F401
from crawler.platforms.tieba import TiebaCrawler  # noqa: F401
from crawler.platforms.weibo import WeiboCrawler  # noqa: F401
from crawler.platforms.xhs import XiaoHongShuCrawler  # noqa: F401
from crawler.platforms.zhihu import ZhihuCrawler  # noqa: F401

__all__ = [
    "XiaoHongShuCrawler",
    "DouyinCrawler",
    "KuaishouCrawler",
    "BilibiliCrawler",
    "WeiboCrawler",
    "TiebaCrawler",
    "ZhihuCrawler",
]
