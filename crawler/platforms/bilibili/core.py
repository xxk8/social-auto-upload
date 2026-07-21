"""Bilibili (B站) crawler — REAL Playwright DOM-scraping impl.

Replaces the prior ``_not_implemented_log`` stub. Mirrors the
DouyinCrawler / KuaishouCrawler architecture:

    * ``@asynccontextmanager`` for browser session lifecycle
      (cascading try/finally — MUST-HAVE #3 pattern).
    * DOM-scraping on ``search.bilibili.com`` + ``www.bilibili.com``
      for search / detail / comments.
    * All rows persisted via inherited
      :meth:`AbstractCrawler._persist_content/_persist_comment`.

Bilibili consumer-site structure (as of 2026):

    * **Search** (``search.bilibili.com/all?keyword=...``): renders a
      list of video result cards with thumbnail, title, UP主 name, play
      count, and a link to ``/video/BV...``.
    * **Video detail** (``www.bilibili.com/video/{bv_id}``): video player
      with title, UP主 info, action buttons (like/coin/collect/share),
      and a comment section loaded dynamically below the fold.
    * **Comments**: rendered by a sub-app (``#commentapp``) on the video
      page, may require scrolling to load.

Login approach:
    We reuse the same cookie file as the bilibili uploader
    (``cookies/bilibili_{name}.json``) because the cookie domain
    ``.bilibili.com`` covers all Bilibili subdomains (consumer, creator,
    passport). See :file:`crawler/platforms/bilibili/login.py`.

Cookie format note:
    Unlike other platforms, Bilibili stores cookies in **biliup format**
    (list of cookie dicts), NOT Playwright ``storage_state`` JSON.
    :meth:`_open_browser_session` converts the format using the
    uploader's ``_convert_biliup_cookies_to_storage_state`` before
    passing to ``browser.new_context``.

Sync / async contract:
    Same as DouyinCrawler — public methods are SYNC (``search`` /
    ``detail`` / ``comments``) and wrap async coroutines via
    :func:`asyncio.run`.

Constants and selectors:
    Per-page CSS selectors live in
    :file:`crawler/platforms/bilibili/selectors.py::BiliCrawlSelectors`.
    When Bilibili's consumer DOM changes, update ONLY that file.
    The selectors are loose (attribute-based, ``[class*='...']``) to
    survive class-name hashing across builds.

IP proxy:
    Reads ``self._proxy_url`` (passed via ``AbstractCrawler.__init__``)
    and applies it via ``browser.new_context(proxy=...)`` — matches
    all other crawler implementations.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from crawler.base.base_crawler import AbstractCrawler
from crawler.config import BASE_CONFIG
from crawler.platforms.bilibili import selectors as S
from crawler.platforms.bilibili.login import bili_cookie_check

_module_logger = logging.getLogger(__name__)


class BilibiliCrawler(AbstractCrawler):
    """B站 crawler — Playwright DOM-scraping search/detail/comments.

    Dedicated browser session per method call (matches XHS/Douyin/Kuaishou
    pattern).
    """

    platform_id = "bili"

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
        Matches the MUST-HAVE #3 pattern from the XHS implementation.

        Cookie format conversion:
            Bilibili stores cookies in biliup format (list of dicts).
            We convert to Playwright ``storage_state`` via the uploader's
            ``_convert_biliup_cookies_to_storage_state`` helper before
            passing to ``new_context``.
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
                # Build context options WITHOUT storage_state first,
                # then handle biliup-to-storage_state conversion.
                ctx_kwargs = build_browser_context_options(
                    "bilibili",
                    account_file=None,  # handled separately below
                    headless=self._headless,
                )
                if BASE_CONFIG.enable_ip_proxy and (
                    self._proxy_url or BASE_CONFIG.static_proxy_url
                ):
                    ctx_kwargs["proxy"] = {
                        "server": self._proxy_url or BASE_CONFIG.static_proxy_url
                    }
                # Convert biliup-format cookie to Playwright storage_state.
                if self._account_file:
                    from uploader.bilibili_uploader.note import (
                        _convert_biliup_cookies_to_storage_state,
                    )
                    storage_state = _convert_biliup_cookies_to_storage_state(
                        self._account_file
                    )
                    if storage_state:
                        ctx_kwargs["storage_state"] = storage_state
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

        Uses Bilibili's official nav API (via the uploader's
        ``bilibili_cookie_auth``) which is faster and more reliable
        than DOM probing.

        Raises RuntimeError if the cookie file is missing or expired.
        """
        if not self._account_file:
            _module_logger.warning(
                "[crawler] BilibiliCrawler: account_file=None; "
                "proceeding without auth (search may return limited results)."
            )
            return
        valid = asyncio.run(bili_cookie_check(self._account_file))
        if not valid:
            raise RuntimeError(
                f"Bilibili cookie at {self._account_file!r} is missing or expired; "
                f"run `sau bilibili login --account <name>` first, then "
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
        """Search Bilibili by keyword on ``search.bilibili.com/all``.

        Returns a list of row dicts with at least:
            ``{"post_id", "title", "user", "liked_count",
              "post_time", "source_url"}``

        All rows are persisted to ``crawled_content`` via
        :meth:`AbstractCrawler._persist_content`.

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
            "[crawler] bili.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.BiliCrawlSelectors.SEARCH_URL.format(keyword=keyword)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Wait for search result cards to render.
                # Bilibili's search SPA may take a moment to hydrate.
                await page.wait_for_selector(
                    S.BiliCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] bili.search selector wait failed: %s", exc
                )
                return []

            cards = page.locator(S.BiliCrawlSelectors.SEARCH_RESULT_CARD)
            count = await cards.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(count, max_count)):
                card = cards.nth(i)
                try:
                    # Extract the BV id from the card's link href.
                    link = card.locator(
                        S.BiliCrawlSelectors.SEARCH_RESULT_LINK
                    ).first
                    href = await link.get_attribute("href") or ""
                    bv_id = S.bv_id_from_url(href)

                    title = (
                        await card.locator(
                            S.BiliCrawlSelectors.SEARCH_RESULT_TITLE
                        ).first.inner_text()
                    ).strip()

                    author = (
                        await card.locator(
                            S.BiliCrawlSelectors.SEARCH_RESULT_AUTHOR
                        ).first.inner_text()
                    ).strip()

                    play_text = await card.locator(
                        S.BiliCrawlSelectors.SEARCH_RESULT_PLAY_COUNT
                    ).first.inner_text()

                    rows.append({
                        "post_id": bv_id,
                        "title": title,
                        "user": author,
                        "liked_count": S.parse_count(play_text),
                        "post_time": "",
                        "source_url": href,
                    })
                    self._persist_content(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-card isolation
                    _module_logger.debug(
                        "[crawler] bili.search skipping card #%d: %s", i, exc
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] bili.search done: %d rows persisted", len(rows)
            )
            return rows

    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Fetch one Bilibili video's metadata from ``www.bilibili.com/video/{id}``.

        ``post_id`` should be a BV id (e.g. ``BV1GJ411x7h7``).

        Persists via :meth:`_persist_content` and returns the row dict.
        Returns ``None`` if the video is not found, deleted, or rate-limited.
        """
        if not post_id or not post_id.strip():
            return None
        self._validate_cookie()
        return self._run_async(self._async_detail(post_id.strip()))

    async def _async_detail(self, post_id: str) -> dict[str, Any] | None:
        _module_logger.info(
            "[crawler] bili.detail start: post_id=%s", post_id
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.BiliCrawlSelectors.VIDEO_DETAIL_URL.format(
                bv_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Wait for the video title to appear (the most reliable
                # indicator that the page has hydrated).
                await page.wait_for_selector(
                    S.BiliCrawlSelectors.VIDEO_DETAIL_TITLE,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] bili.detail selector wait failed for %s: %s",
                    post_id, exc,
                )
                return None

            try:
                title = (
                    await page.locator(
                        S.BiliCrawlSelectors.VIDEO_DETAIL_TITLE
                    ).first.inner_text()
                ).strip()
            except Exception:
                title = ""

            try:
                desc = (
                    await page.locator(
                        S.BiliCrawlSelectors.VIDEO_DETAIL_DESC
                    ).first.inner_text()
                ).strip()
            except Exception:
                desc = ""

            try:
                author = (
                    await page.locator(
                        S.BiliCrawlSelectors.VIDEO_DETAIL_AUTHOR
                    ).first.inner_text()
                ).strip()
            except Exception:
                author = ""

            try:
                likes_text = await page.locator(
                    S.BiliCrawlSelectors.VIDEO_DETAIL_LIKES
                ).first.inner_text()
                liked_count = S.parse_count(likes_text)
            except Exception:
                liked_count = 0

            row = {
                "post_id": post_id,
                "title": title,
                "content": desc,
                "user": author,
                "liked_count": liked_count,
                "source_url": url,
            }
            self._persist_content(row)

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] bili.detail done: post_id=%s title=%r",
                post_id, title,
            )
            return row

    def comments(
        self, post_id: str, *, max_count: int = 100
    ) -> list[dict[str, Any]]:
        """Walk one Bilibili video's comments from the video detail page.

        Returns comment dicts with at least:
            ``{"post_id", "comment_id", "text", "user",
              "like_count", "sub_comment_count"}``

        All rows are persisted to ``crawled_comments`` via
        :meth:`AbstractCrawler._persist_comment`.

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
            "[crawler] bili.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.BiliCrawlSelectors.VIDEO_DETAIL_URL.format(
                bv_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Scroll down to trigger the comment sub-app to load.
                await page.evaluate("window.scrollBy(0, 800)")
                await asyncio.sleep(1.5)
                await page.wait_for_selector(
                    S.BiliCrawlSelectors.COMMENTS_CONTAINER,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] bili.comments container not found for %s: %s",
                    post_id, exc,
                )
                return []

            container = page.locator(
                S.BiliCrawlSelectors.COMMENTS_CONTAINER
            ).first

            # Best-effort click "show more" up to 3 times.
            for _attempt in range(3):
                try:
                    more = container.locator(
                        S.BiliCrawlSelectors.COMMENTS_SHOW_MORE
                    ).first
                    if await more.count():
                        await more.click()
                        await asyncio.sleep(min(0.5, BASE_CONFIG.request_delay))
                    else:
                        break
                except Exception:
                    break

            items = container.locator(S.BiliCrawlSelectors.COMMENT_ITEM)
            item_count = await items.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(item_count, max_count)):
                item = items.nth(i)
                try:
                    text = (
                        await item.locator(
                            S.BiliCrawlSelectors.COMMENT_ITEM_TEXT
                        ).first.inner_text()
                    ).strip()
                    author = (
                        await item.locator(
                            S.BiliCrawlSelectors.COMMENT_ITEM_AUTHOR
                        ).first.inner_text()
                    ).strip()
                    likes_text = await item.locator(
                        S.BiliCrawlSelectors.COMMENT_ITEM_LIKES
                    ).first.inner_text()
                    comment_id = f"{post_id}:c{i}"

                    rows.append({
                        "post_id": post_id,
                        "comment_id": comment_id,
                        "text": text,
                        "user": author,
                        "like_count": S.parse_count(likes_text),
                        "sub_comment_count": 0,
                        "source_url": url,
                    })
                    self._persist_comment(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-comment isolation
                    _module_logger.debug(
                        "[crawler] bili.comments skipping comment #%d: %s",
                        i, exc,
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] bili.comments done: post_id=%s %d rows persisted",
                post_id, len(rows),
            )
            return rows
