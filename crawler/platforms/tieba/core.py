"""Tieba (百度贴吧) crawler — REAL Playwright DOM-scraping impl.

Replaces the prior ``_not_implemented_log`` stub. Mirrors the
ZhihuCrawler / DouyinCrawler / KuaishouCrawler architecture:

    * ``@asynccontextmanager`` for browser session lifecycle
      (cascading try/finally — MUST-HAVE #3 pattern).
    * DOM-scraping on ``tieba.baidu.com`` for forum search + thread
      detail + floor replies.
    * All rows persisted via inherited
      :meth:`AbstractCrawler._persist_content/_persist_comment`.

Tieba consumer-site structure (as of 2026):

    * **Forum page** (``tieba.baidu.com/f?kw=...&ie=utf-8``): a list
      of thread cards. Each card has a title (``a.j_th_tit``), author,
      reply count, and last-reply timestamp.
    * **Thread detail** (``tieba.baidu.com/p/{thread_id}``): the OP's
      content followed by reply floors (``div.l_post`` containers).
    * **Sub-comments (楼中楼)**: nested comments within a floor, loaded
      via expandable triggers.

Login approach:
    Tieba has NO dedicated uploader in this project. The login module
    (``crawler/platforms/tieba/login.py``) implements a standalone
    QR-code login flow via ``passport.baidu.com/v2/?login``. Cookies
    are stored as Playwright ``storage_state`` JSON at
    ``cookies/tieba_{account}.json``.

Sync / async contract:
    Same as all other crawlers — public methods are SYNC (``search`` /
    ``detail`` / ``comments``) and wrap async coroutines via
    :func:`asyncio.run`.

Constants and selectors:
    Per-page CSS selectors live in
    :file:`crawler/platforms/tieba/selectors.py::TiebaCrawlSelectors`.
    When ``tieba.baidu.com`` changes its DOM, update ONLY that file.

IP proxy:
    Reads ``self._proxy_url`` (passed via ``AbstractCrawler.__init__``)
    and applies it via ``browser.new_context(proxy=...)``.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from crawler.base.base_crawler import AbstractCrawler
from crawler.config import BASE_CONFIG
from crawler.platforms.tieba import selectors as S
from crawler.platforms.tieba.login import tieba_cookie_check

_module_logger = logging.getLogger(__name__)


class TiebaCrawler(AbstractCrawler):
    """百度贴吧 crawler — Playwright DOM-scraping forum/detail/comments.

    Dedicated browser session per method call (matches all other crawlers).
    """

    platform_id = "tieba"

    def __init__(
        self,
        *,
        account_file: str | None = None,
        headless: bool = True,
        proxy_url: str | None = None,
        store: Any | None = None,
    ) -> None:
        super().__init__(store=store, headless=headless, proxy_url=proxy_url)
        self._account_file = account_file

    # ── Async helpers (Playwright session lifecycle) ─────────────────────
    @asynccontextmanager
    async def _open_browser_session(self):
        """Launch patchright + anti-detect + yield a ``BrowserContext``.

        Cascading cleanup — two nested ``try`` / ``finally`` blocks
        ensure browser and context are both closed even on exception.
        Uses the ``tieba`` anti-detect profile registered in
        ``_PLATFORM_PRESETS``.
        """
        from patchright.async_api import async_playwright
        from utils.anti_detect import (
            apply_anti_detect,
            build_browser_context_options,
            build_browser_launch_kwargs,
        )

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                **build_browser_launch_kwargs(headless=self._headless)
            )
            try:
                ctx_kwargs = build_browser_context_options(
                    "tieba",
                    account_file=self._account_file,
                    headless=self._headless,
                )
                if BASE_CONFIG.enable_ip_proxy and (
                    self._proxy_url or BASE_CONFIG.static_proxy_url
                ):
                    ctx_kwargs["proxy"] = {
                        "server": self._proxy_url or BASE_CONFIG.static_proxy_url
                    }
                context = await browser.new_context(**ctx_kwargs)
                context = await apply_anti_detect(context)
                try:
                    yield context
                finally:
                    await context.close()
            finally:
                await browser.close()

    def _run_async(self, coro: Any) -> Any:
        """Drive an async coroutine on a fresh asyncio loop in this thread."""
        return asyncio.run(coro)

    def _validate_cookie(self) -> None:
        """Pre-launch cookie freshness probe.

        Raises RuntimeError if the cookie file is missing or expired.
        """
        if not self._account_file:
            _module_logger.warning(
                "[crawler] TiebaCrawler: account_file=None; "
                "proceeding without auth (search results may be limited)."
            )
            return
        valid = asyncio.run(tieba_cookie_check(self._account_file))
        if not valid:
            raise RuntimeError(
                f"Tieba cookie at {self._account_file!r} is missing or expired; "
                f"run `sau tieba login --account <name>` first, then "
                f"retry the crawl task."
            )

    # ── Public contract methods ─────────────────────────────────────────
    def search(
        self,
        keyword: str,
        *,
        max_count: int = 20,
        page_num: int = 1,
    ) -> list[dict[str, Any]]:
        """Search tieba by keyword on ``tieba.baidu.com/f?kw=...``.

        Returns a list of row dicts with at least:
            ``{"post_id", "title", "user", "liked_count",
              "post_time", "source_url"}``

        All rows are persisted via :meth:`_persist_content`.
        ``max_count`` is hardcapped at 100.
        """
        if not keyword or not keyword.strip():
            return []
        max_count = max(1, min(max_count, 100))
        self._validate_cookie()
        return self._run_async(
            self._async_search(keyword.strip(), max_count=max_count, page_num=page_num)
        )

    async def _async_search(
        self, keyword: str, *, max_count: int, page_num: int
    ) -> list[dict[str, Any]]:
        _module_logger.info(
            "[crawler] tieba.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.TiebaCrawlSelectors.FORUM_URL.format(keyword=keyword)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(
                    S.TiebaCrawlSelectors.THREAD_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] tieba.search selector wait failed: %s", exc
                )
                return []

            cards = page.locator(S.TiebaCrawlSelectors.THREAD_CARD)
            count = await cards.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(count, max_count)):
                card = cards.nth(i)
                try:
                    link = card.locator(
                        S.TiebaCrawlSelectors.THREAD_LINK
                    ).first
                    href = await link.get_attribute("href") or ""
                    thread_id = S.thread_id_from_url(href)

                    title = ""
                    try:
                        title = (
                            await card.locator(
                                S.TiebaCrawlSelectors.THREAD_TITLE
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    author = ""
                    try:
                        author = (
                            await card.locator(
                                S.TiebaCrawlSelectors.THREAD_AUTHOR
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    reply_text = ""
                    try:
                        reply_text = await card.locator(
                            S.TiebaCrawlSelectors.THREAD_REPLY_COUNT
                        ).first.inner_text()
                    except Exception:
                        pass

                    rows.append({
                        "post_id": thread_id,
                        "title": title,
                        "user": author,
                        "liked_count": S.parse_count(reply_text),
                        "post_time": "",
                        "source_url": href,
                    })
                    self._persist_content(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-card isolation
                    _module_logger.debug(
                        "[crawler] tieba.search skipping card #%d: %s", i, exc
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] tieba.search done: %d rows persisted", len(rows)
            )
            return rows

    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Fetch one Tieba thread's metadata.

        ``post_id`` is the numeric thread ID.

        Persists via :meth:`_persist_content` and returns the row dict.
        Returns ``None`` if the thread is not found or rate-limited.
        """
        if not post_id or not post_id.strip():
            return None
        self._validate_cookie()
        return self._run_async(self._async_detail(post_id.strip()))

    async def _async_detail(self, post_id: str) -> dict[str, Any] | None:
        _module_logger.info(
            "[crawler] tieba.detail start: post_id=%s", post_id
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.TiebaCrawlSelectors.THREAD_DETAIL_URL.format(
                thread_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(
                    S.TiebaCrawlSelectors.THREAD_TITLE,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] tieba.detail: page load failed for %s: %s",
                    post_id, exc,
                )
                return None

            try:
                title = (
                    await page.locator(
                        S.TiebaCrawlSelectors.THREAD_TITLE
                    ).first.inner_text()
                ).strip()
            except Exception:
                title = ""

            try:
                content = (
                    await page.locator(
                        S.TiebaCrawlSelectors.OP_CONTENT
                    ).first.inner_text()
                ).strip()
            except Exception:
                content = ""

            try:
                author = (
                    await page.locator(
                        S.TiebaCrawlSelectors.THREAD_AUTHOR_DETAIL
                    ).first.inner_text()
                ).strip()
            except Exception:
                author = ""

            try:
                post_time = (
                    await page.locator(
                        S.TiebaCrawlSelectors.THREAD_POST_TIME
                    ).first.inner_text()
                ).strip()
            except Exception:
                post_time = ""

            row = {
                "post_id": post_id,
                "title": title,
                "content": content,
                "user": author,
                "liked_count": 0,  # tieba doesn't show a like count on detail page
                "post_time": post_time,
                "source_url": url,
            }
            self._persist_content(row)

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] tieba.detail done: post_id=%s title=%r",
                post_id, title,
            )
            return row

    def comments(
        self, post_id: str, *, max_count: int = 100
    ) -> list[dict[str, Any]]:
        """Walk one Tieba thread's reply floors.

        Returns reply dicts with at least:
            ``{"post_id", "comment_id", "text", "user",
              "like_count", "sub_comment_count"}``

        All rows are persisted via :meth:`_persist_comment`.
        ``max_count`` is hardcapped at ``BASE_CONFIG.max_comments``.
        """
        if not post_id or not post_id.strip():
            return []
        max_count = max(1, min(max_count, BASE_CONFIG.max_comments))
        self._validate_cookie()
        return self._run_async(
            self._async_comments(post_id.strip(), max_count=max_count)
        )

    async def _async_comments(
        self, post_id: str, *, max_count: int
    ) -> list[dict[str, Any]]:
        _module_logger.info(
            "[crawler] tieba.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.TiebaCrawlSelectors.THREAD_DETAIL_URL.format(
                thread_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.evaluate("window.scrollBy(0, 600)")
                await asyncio.sleep(1)
                await page.wait_for_selector(
                    S.TiebaCrawlSelectors.REPLY_ITEM,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] tieba.comments: reply list not found "
                    "for %s: %s", post_id, exc,
                )
                return []

            items = page.locator(S.TiebaCrawlSelectors.REPLY_ITEM)
            item_count = await items.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(item_count, max_count)):
                item = items.nth(i)
                try:
                    text = (
                        await item.locator(
                            S.TiebaCrawlSelectors.REPLY_CONTENT
                        ).first.inner_text()
                    ).strip()

                    author = ""
                    try:
                        author = (
                            await item.locator(
                                S.TiebaCrawlSelectors.REPLY_AUTHOR
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    floor_num = ""
                    try:
                        floor_num = (
                            await item.locator(
                                S.TiebaCrawlSelectors.REPLY_FLOOR_NUM
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    comment_id = f"{post_id}:f{i}"
                    rows.append({
                        "post_id": post_id,
                        "comment_id": comment_id,
                        "text": text,
                        "user": author,
                        "like_count": 0,
                        "sub_comment_count": 0,
                        "floor": floor_num,
                        "source_url": url,
                    })
                    self._persist_comment(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-comment isolation
                    _module_logger.debug(
                        "[crawler] tieba.comments skipping floor #%d: %s",
                        i, exc,
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] tieba.comments done: post_id=%s %d rows persisted",
                post_id, len(rows),
            )
            return rows
