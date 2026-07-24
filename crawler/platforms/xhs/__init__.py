"""Xiaohongshu crawler (real implementation, replaces the prior stub).

Public surface:

* :class:`XiaoHongShuCrawler` — the contract implementation.
* :func:`xhs_login` — entry point for CLI/Web to run the QR-code
  cookie-refresh flow.
* :func:`xhs_cookie_check` — fast-path cookie freshness check.
* :class:`XhsCrawlSelectors` — CSS selectors for ``www.xiaohongshu.com``;
  see :mod:`crawler.platforms.xhs.selectors`.

CLI/Web entrypoints call :func:`xhs_login` to obtain the QR image
data URL + finalize the cookie file, then construct a
:class:`XiaoHongShuCrawler` passing that account_file path so the
Playwright context picks up the cookies automatically.
"""
from __future__ import annotations

from crawler.platforms.xhs.core import XiaoHongShuCrawler
from crawler.platforms.xhs.login import (
    resolve_account_file,
    xhs_cookie_check,
    xhs_login,
)
from crawler.platforms.xhs.selectors import (
    XhsCrawlSelectors,
    note_id_from_url,
    parse_count,
)

__all__ = [
    "XiaoHongShuCrawler",
    "XhsCrawlSelectors",
    "xhs_login",
    "xhs_cookie_check",
    "resolve_account_file",
    "note_id_from_url",
    "parse_count",
]
