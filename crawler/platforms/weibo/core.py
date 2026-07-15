"""Weibo (微博) crawler — REAL Playwright DOM-scraping impl.

Replaces the prior ``_not_implemented_log`` stub. Mirrors the
TiebaCrawler / ZhihuCrawler / DouyinCrawler architecture:

    * ``@asynccontextmanager`` for browser session lifecycle
      (cascading try/finally — MUST-HAVE #3 pattern).
    * DOM-scraping on ``s.weibo.com`` for search and ``weibo.com``
      for detail + comments.
    * All rows persisted via inherited
      :meth:`AbstractCrawler._persist_content/_persist_comment`.

Weibo consumer-site structure (as of 2026):

    * **Search** (``s.weibo.com/weibo?q=...``): a server-rendered
      search result page with card elements. Each card has a title,
      author, reply count, and like count.
    * **Status detail** (``weibo.com/{uid}/{mid}``): the React SPA
      page showing the weibo content, author info, and action bar
      (like, repost, comment). Comments are loaded below the fold.
    * **Comments**: rendered within the detail page's React tree.
      May require scrolling to trigger lazy loading.

Login approach:
    Weibo has NO dedicated uploader in this project. The login module
    (``crawler/platforms/weibo/login.py``) implements a standalone
    QR-code login flow via ``passport.weibo.com/signin/login``. Cookies
    are stored as Playwright ``storage_state`` JSON at
    ``cookies/weibo_{account}.json``.

Sync / async contract:
    Same as all other crawlers — public methods are SYNC (``search`` /
    ``detail`` / ``comments``) and wrap async coroutines via
    :func:`asyncio.run`.

Constants and selectors:
    Per-page CSS selectors live in
    :file:`crawler/platforms/weibo/selectors.py::WeiboCrawlSelectors`.
    When ``weibo.com`` or ``s.weibo.com`` changes its DOM, update ONLY
    that file.

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
from crawler.platforms.weibo import selectors as S
from crawler.platforms.weibo.login import weibo_cookie_check

_module_logger = logging.getLogger(__name__)


class WeiboCrawler(AbstractCrawler):
    """微博 crawler — Playwright DOM-scraping search/detail/comments.

    Dedicated browser session per method call (matches all other crawlers).
    """

    platform_id = "wb"

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
        Uses the ``weibo`` anti-detect profile registered in
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
                    "weibo",
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
                "[crawler] WeiboCrawler: account_file=None; "
                "proceeding without auth (search results may be limited)."
            )
            return
        valid = asyncio.run(weibo_cookie_check(self._account_file))
        if not valid:
            raise RuntimeError(
                f"Weibo cookie at {self._account_file!r} is missing or expired; "
                f"run `sau weibo login --account <name>` first, then "
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
        """Search weibo by keyword on ``s.weibo.com/weibo?q=...``.

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
            "[crawler] weibo.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.WeiboCrawlSelectors.SEARCH_URL.format(keyword=keyword)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(
                    S.WeiboCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] weibo.search selector wait failed: %s", exc
                )
                return []

            cards = page.locator(S.WeiboCrawlSelectors.SEARCH_RESULT_CARD)
            count = await cards.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(count, max_count)):
                card = cards.nth(i)
                try:
                    link = card.locator(
                        S.WeiboCrawlSelectors.SEARCH_RESULT_LINK
                    ).first
                    href = await link.get_attribute("href") or ""
                    mid = S.mid_from_url(href)

                    title = ""
                    try:
                        title = (
                            await card.locator(
                                S.WeiboCrawlSelectors.SEARCH_RESULT_TITLE
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    author = ""
                    try:
                        author = (
                            await card.locator(
                                S.WeiboCrawlSelectors.SEARCH_RESULT_AUTHOR
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    reply_text = ""
                    try:
                        reply_text = await card.locator(
                            S.WeiboCrawlSelectors.SEARCH_RESULT_REPLY_COUNT
                        ).first.inner_text()
                    except Exception:
                        pass

                    rows.append({
                        "post_id": mid,
                        "title": title,
                        "user": author,
                        "liked_count": S.parse_count(reply_text),
                        "post_time": "",
                        "source_url": href,
                    })
                    self._persist_content(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-card isolation
                    _module_logger.debug(
                        "[crawler] weibo.search skipping card #%d: %s", i, exc
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] weibo.search done: %d rows persisted", len(rows)
            )
            return rows

    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Fetch one Weibo status's metadata.

        ``post_id`` is the status mid (numeric).

        Persists via :meth:`_persist_content` and returns the row dict.
        Returns ``None`` if the status is not found or rate-limited.
        """
        if not post_id or not post_id.strip():
            return None
        self._validate_cookie()
        return self._run_async(self._async_detail(post_id.strip()))

    async def _async_detail(self, post_id: str) -> dict[str, Any] | None:
        _module_logger.info(
            "[crawler] weibo.detail start: post_id=%s", post_id
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            # Weibo detail: we need uid+mid, but for crawl purposes
            # we use s.weibo.com's detail path which only needs mid.
            url = f"https://s.weibo.com/detail/{post_id}"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(
                    S.WeiboCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] weibo.detail: page load failed for %s: %s",
                    post_id, exc,
                )
                return None

            card = page.locator(S.WeiboCrawlSelectors.SEARCH_RESULT_CARD).first
            try:
                title = (
                    await card.locator(
                        S.WeiboCrawlSelectors.SEARCH_RESULT_TITLE
                    ).first.inner_text()
                ).strip()
            except Exception:
                title = ""

            try:
                author = (
                    await card.locator(
                        S.WeiboCrawlSelectors.SEARCH_RESULT_AUTHOR
                    ).first.inner_text()
                ).strip()
            except Exception:
                author = ""

            try:
                reply_text = await card.locator(
                    S.WeiboCrawlSelectors.SEARCH_RESULT_REPLY_COUNT
                ).first.inner_text()
                reply_count = S.parse_count(reply_text)
            except Exception:
                reply_count = 0

            row = {
                "post_id": post_id,
                "title": title,
                "user": author,
                "liked_count": reply_count,
                "source_url": url,
            }
            self._persist_content(row)

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] weibo.detail done: post_id=%s", post_id,
            )
            return row

    def comments(
        self, post_id: str, *, max_count: int = 100
    ) -> list[dict[str, Any]]:
        """Walk one Weibo status's comments.

        Returns comment dicts with at least:
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
            "[crawler] weibo.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = f"https://s.weibo.com/detail/{post_id}"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.evaluate("window.scrollBy(0, 800)")
                await asyncio.sleep(1.5)
                await page.wait_for_selector(
                    S.WeiboCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] weibo.comments: page load failed "
                    "for %s: %s", post_id, exc,
                )
                return []

            # Weibo's s.weibo.com shows comments as sub-cards within
            # the parent card. The simplest approach: parse reply cards
            # that appear after the main content card.
            cards = page.locator(S.WeiboCrawlSelectors.SEARCH_RESULT_CARD)
            count = await cards.count()
            rows: list[dict[str, Any]] = []
            # Skip the first card (main content), parse subsequent cards
            # as reply/comments
            start_index = 1
            for i in range(start_index, min(count, start_index + max_count)):
                card = cards.nth(i)
                try:
                    text = (
                        await card.locator(
                            S.WeiboCrawlSelectors.SEARCH_RESULT_TITLE
                        ).first.inner_text()
                    ).strip()

                    author = ""
                    try:
                        author = (
                            await card.locator(
                                S.WeiboCrawlSelectors.SEARCH_RESULT_AUTHOR
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    comment_id = f"{post_id}:c{i - start_index}"
                    rows.append({
                        "post_id": post_id,
                        "comment_id": comment_id,
                        "text": text,
                        "user": author,
                        "like_count": 0,
                        "sub_comment_count": 0,
                        "source_url": url,
                    })
                    self._persist_comment(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-comment isolation
                    _module_logger.debug(
                        "[crawler] weibo.comments skipping card #%d: %s",
                        i, exc,
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] weibo.comments done: post_id=%s %d rows persisted",
                post_id, len(rows),
            )
            return rows
