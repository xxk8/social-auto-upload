"""Kuaishou (快手) crawler — REAL Playwright DOM-scraping impl.

Replaces the prior ``_not_implemented_log`` stub. Mirrors the
XiaoHongShuCrawler / DouyinCrawler architecture:

    * ``@asynccontextmanager`` for browser session lifecycle
      (cascading try/finally — MUST-HAVE #3 pattern).
    * DOM-scraping on ``www.kuaishou.com`` for search + detail + comments.
    * All rows persisted via inherited
      :meth:`AbstractCrawler._persist_content/_persist_comment`.

Kuaishou consumer-site structure (as of 2026):

    * **Search** (``www.kuaishou.com/search/visionnew?keyword=...``):
      renders a waterfall grid of video cards with cover image, title,
      author, and view count. Each card links to
      ``/short-video/<photo_id>``.
    * **Video detail** (``www.kuaishou.com/short-video/{id}``):
      video player with description, author info, action buttons
      (like/comment/share), and the comment section below the fold.
    * **Comments**: loaded dynamically below the video player; need to
      scroll or wait for the comment container to appear.

Login approach:
    We reuse the same cookie file as the kuaishou uploader
    (``cookies/ks_<account>.json``) because the cookie domain
    ``kuaishou.com`` covers both ``cp.kuaishou.com`` (uploader) and
    ``www.kuaishou.com`` (consumer crawler). See
    :file:`crawler/platforms/kuaishou/login.py` for the thin wrapper
    around the uploader's ``ks_setup``.

Sync / async contract:
    Same as DouyinCrawler / XiaoHongShuCrawler — the public methods
    are SYNC (``search`` / ``detail`` / ``comments``) and wrap async
    coroutines via :func:`asyncio.run`. Each call spins + tears down
    a fresh browser instance. Section 13.4 follow-up will swap to a
    worker-pinned event loop.

Constants and selectors:
    Per-page CSS selectors live in
    :file:`crawler/platforms/kuaishou/selectors.py::KsCrawlSelectors`.
    When ``www.kuaishou.com`` changes its DOM, update ONLY that file.
    The selectors are loose (attribute-based, ``[class*='...']``) to
    survive class-name hashing across builds.

IP proxy:
    Reads ``self._proxy_url`` (passed via ``AbstractCrawler.__init__``)
    and applies it via ``browser.new_context(proxy=...)`` — matches
    the XHS and Douyin crawler patterns.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from crawler.base.base_crawler import AbstractCrawler
from crawler.config import BASE_CONFIG
from crawler.platforms.kuaishou import selectors as S
from crawler.platforms.kuaishou.login import ks_cookie_check

_module_logger = logging.getLogger(__name__)


class KuaishouCrawler(AbstractCrawler):
    """快手 crawler — Playwright DOM-scraping search/detail/comments.

    Dedicated browser session per method call (matches XHS/Douyin pattern).
    """

    platform_id = "ks"

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
        Matches the MUST-HAVE #3 pattern from the XHS implementation
        (``@asynccontextmanager`` + cascading try/finally).
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
                    "kuaishou",
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

        Raises RuntimeError if the cookie file is missing or expired,
        so we don't waste a Chromium launch on a doomed session.
        """
        if not self._account_file:
            _module_logger.warning(
                "[crawler] KuaishouCrawler.search: account_file=None; "
                "proceeding without auth (most ks pages require auth)."
            )
            return
        valid = asyncio.run(ks_cookie_check(self._account_file))
        if not valid:
            raise RuntimeError(
                f"Kuaishou cookie at {self._account_file!r} is missing or expired; "
                f"run `sau kuaishou login --account <name>` first, then "
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
        """Search Kuaishou by keyword on ``www.kuaishou.com/search/visionnew``.

        Returns a list of row dicts with at least:
            ``{"post_id", "title", "user", "liked_count",
              "post_time", "source_url"}``

        All rows are persisted to ``crawled_content`` via
        :meth:`AbstractCrawler._persist_content`.

        ``max_count`` is hardcapped at 100 (rate-limit + session
        freshness hygiene).
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
            "[crawler] ks.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.KsCrawlSelectors.SEARCH_URL.format(keyword=keyword)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Wait for search result cards to render.
                # Kuaishou's SPA may take a moment to hydrate the grid.
                await page.wait_for_selector(
                    S.KsCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] ks.search selector wait failed: %s", exc
                )
                return []

            cards = page.locator(S.KsCrawlSelectors.SEARCH_RESULT_CARD)
            count = await cards.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(count, max_count)):
                card = cards.nth(i)
                try:
                    # Extract the photo_id from the card's link href.
                    link = card.locator(
                        S.KsCrawlSelectors.SEARCH_RESULT_LINK
                    ).first
                    href = await link.get_attribute("href") or ""
                    photo_id = S.photo_id_from_url(href)

                    title = (
                        await card.locator(
                            S.KsCrawlSelectors.SEARCH_RESULT_TITLE
                        ).first.inner_text()
                    ).strip()

                    author = (
                        await card.locator(
                            S.KsCrawlSelectors.SEARCH_RESULT_AUTHOR
                        ).first.inner_text()
                    ).strip()

                    play_text = await card.locator(
                        S.KsCrawlSelectors.SEARCH_RESULT_PLAY_COUNT
                    ).first.inner_text()

                    rows.append({
                        "post_id": photo_id,
                        "title": title,
                        "user": author,
                        "liked_count": S.parse_count(play_text),
                        "post_time": "",
                        "source_url": href,
                    })
                    self._persist_content(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-card isolation
                    _module_logger.debug(
                        "[crawler] ks.search skipping card #%d: %s", i, exc
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] ks.search done: %d rows persisted", len(rows)
            )
            return rows

    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Fetch one Kuaishou video's full metadata from ``www.kuaishou.com/short-video/{id}``.

        Persists via :meth:`_persist_content` and returns the row dict.
        Returns ``None`` if the video is not found, deleted, or rate-limited.
        """
        if not post_id or not post_id.strip():
            return None
        self._validate_cookie()
        return self._run_async(self._async_detail(post_id.strip()))

    async def _async_detail(self, post_id: str) -> dict[str, Any] | None:
        _module_logger.info(
            "[crawler] ks.detail start: post_id=%s", post_id
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.KsCrawlSelectors.VIDEO_DETAIL_URL.format(
                photo_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Wait for the video title or description to appear.
                await page.wait_for_selector(
                    f"{S.KsCrawlSelectors.VIDEO_DETAIL_TITLE}, "
                    f"{S.KsCrawlSelectors.VIDEO_DETAIL_DESC}",
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] ks.detail selector wait failed for %s: %s",
                    post_id, exc,
                )
                return None

            try:
                title = (
                    await page.locator(
                        S.KsCrawlSelectors.VIDEO_DETAIL_TITLE
                    ).first.inner_text()
                ).strip()
            except Exception:
                title = ""

            try:
                desc = (
                    await page.locator(
                        S.KsCrawlSelectors.VIDEO_DETAIL_DESC
                    ).first.inner_text()
                ).strip()
            except Exception:
                desc = ""

            try:
                author = (
                    await page.locator(
                        S.KsCrawlSelectors.VIDEO_DETAIL_AUTHOR
                    ).first.inner_text()
                ).strip()
            except Exception:
                author = ""

            try:
                likes_text = await page.locator(
                    S.KsCrawlSelectors.VIDEO_DETAIL_LIKES
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
                "[crawler] ks.detail done: post_id=%s title=%r",
                post_id, title,
            )
            return row

    def comments(
        self, post_id: str, *, max_count: int = 100
    ) -> list[dict[str, Any]]:
        """Walk one Kuaishou video's comments from the video detail page.

        Returns comment dicts with at least:
            ``{"post_id", "comment_id", "text", "user",
              "like_count", "sub_comment_count"}``

        All rows are persisted to ``crawled_comments`` via
        :meth:`AbstractCrawler._persist_comment` — the store layer's
        :meth:`SauliteStore.store_comment` then triggers the async
        AI-augmentation thread (sentiment + reply suggestion).

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
            "[crawler] ks.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.KsCrawlSelectors.VIDEO_DETAIL_URL.format(
                photo_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Scroll down a bit to trigger the comment section to load,
                # then wait for the comment container to appear.
                await page.evaluate("window.scrollBy(0, 600)")
                await asyncio.sleep(1.0)
                await page.wait_for_selector(
                    S.KsCrawlSelectors.COMMENTS_CONTAINER,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] ks.comments container not found for %s: %s",
                    post_id, exc,
                )
                return []

            container = page.locator(
                S.KsCrawlSelectors.COMMENTS_CONTAINER
            ).first

            # Best-effort click "show more" up to 3 times.
            for _attempt in range(3):
                try:
                    more = container.locator(
                        S.KsCrawlSelectors.COMMENTS_SHOW_MORE
                    ).first
                    if await more.count():
                        await more.click()
                        await asyncio.sleep(min(0.5, BASE_CONFIG.request_delay))
                    else:
                        break
                except Exception:
                    break

            items = container.locator(S.KsCrawlSelectors.COMMENT_ITEM)
            item_count = await items.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(item_count, max_count)):
                item = items.nth(i)
                try:
                    text = (
                        await item.locator(
                            S.KsCrawlSelectors.COMMENT_ITEM_TEXT
                        ).first.inner_text()
                    ).strip()
                    author = (
                        await item.locator(
                            S.KsCrawlSelectors.COMMENT_ITEM_AUTHOR
                        ).first.inner_text()
                    ).strip()
                    likes_text = await item.locator(
                        S.KsCrawlSelectors.COMMENT_ITEM_LIKES
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
                        "[crawler] ks.comments skipping comment #%d: %s",
                        i, exc,
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] ks.comments done: post_id=%s %d rows persisted",
                post_id, len(rows),
            )
            return rows
