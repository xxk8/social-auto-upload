"""Douyin (抖音) crawler — REAL Playwright DOM-scraping impl.

Replaces the prior ``_not_implemented_log`` stub. Mirrors the
XiaoHongShuCrawler architecture from ``crawler/platforms/xhs/core.py``:

    * ``@asynccontextmanager`` for browser session lifecycle
      (cascading try/finally — MUST-HAVE #3 pattern).
    * DOM-scraping on ``www.douyin.com`` for search + detail + comments.
    * All rows persisted via inherited
      :meth:`AbstractCrawler._persist_content/_persist_comment`.

Douyin consumer-site structure (as of 2026):

    * **Search** (``/search/{keyword}``): renders a list of video cards
      with cover image, title, author, and play count. Each card links
      to ``/video/<aweme_id>``.
    * **Video detail** (``/video/{aweme_id}``): video player with
      description, author info, action buttons (like/comment/share),
      and the comment section below the fold.
    * **Comments**: loaded dynamically below the video player; need to
      scroll or wait for the comment container to appear.

Login approach:
    We reuse the same cookie file as the douyin uploader
    (``cookies/douyin_<account>.json``) because the cookie domain
    ``.douyin.com`` covers both ``creator.douyin.com`` (uploader) and
    ``www.douyin.com`` (consumer crawler). See
    :file:`crawler/platforms/douyin/login.py` for the thin wrapper
    around the uploader's ``douyin_setup``.

Sync / async contract:
    Same as XiaohongshuCrawler — the public methods are SYNC
    (``search`` / ``detail`` / ``comments``) and wrap async coroutines
    via :func:`asyncio.run`. Each call spins + tears down a fresh
    browser instance. Section 13.4 follow-up will swap to a
    worker-pinned event loop.

Constants and selectors:
    Per-page CSS selectors live in
    :file:`crawler/platforms/douyin/selectors.py::DouyinCrawlSelectors`.
    When ``www.douyin.com`` changes its DOM, update ONLY that file.
    The selectors are loose (attribute-based, ``[class*='...']``) to
    survive class-name hashing across builds.

IP proxy:
    Reads ``self._proxy_url`` (passed via ``AbstractCrawler.__init__``)
    and applies it via ``browser.new_context(proxy=...)`` — matches
    the XHS crawler and uploader patterns.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from crawler.base.base_crawler import AbstractCrawler
from crawler.config import BASE_CONFIG
from crawler.platforms.douyin import selectors as S
from crawler.platforms.douyin.login import dy_cookie_check

_module_logger = logging.getLogger(__name__)


class DouyinCrawler(AbstractCrawler):
    """抖音 crawler — Playwright DOM-scraping search/detail/comments.

    Dedicated browser session per method call (matches XHS pattern).
    """

    platform_id = "dy"

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
                    "douyin",
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

    def _run_async_gen(self, coro: Any) -> Any:
        """Drive an async generator on a fresh asyncio loop in this thread.

        Yields each produced value synchronously so a Flask SSE view
        can stream crawl rows as they are scraped.
        """
        loop = asyncio.new_event_loop()
        gen: Any = None
        try:
            asyncio.set_event_loop(loop)
            gen = coro.__aiter__()
            while True:
                try:
                    value = loop.run_until_complete(gen.__anext__())
                    yield value
                except StopAsyncIteration:
                    break
        finally:
            # Explicit asyncgen aclose BEFORE loop.close().
            #
            # Without this extra pass Python 3.12's
            # ``BaseEventLoop.close()`` auto-runs
            # ``run_until_complete(agen.aclose())`` on every pending
            # asyncgen we never explicitly closed. That races with
            # patchright's ``async_playwright()`` teardown and surfaces
            # as ``'Browser' object has no attribute 'aclose'`` (the
            # asyncgen holds a live ``Browser`` across the asyncio /
            # patchright boundary). Driving ``aclose()`` on a still-
            # running loop means our patchright cleanup is sequenced
            # correctly and Python's automatic sweep finds ``_asyncgens``
            # empty when ``loop.close()`` runs.
            if gen is not None and not loop.is_closed():
                try:
                    loop.run_until_complete(gen.aclose())
                except Exception as exc:
                    _module_logger.debug(
                        "asyncgen aclose raised during teardown: %s", exc,
                    )
            # Same Py3.12+ auto-asyncgen-sweep race as ``gen.aclose()``
            # above (see test docstring for full failure mode).
            try:
                loop.close()
            except Exception as exc:
                _module_logger.debug(
                    "event loop close raised during teardown: %s", exc,
                )

    def _validate_cookie(self) -> None:
        """Pre-launch cookie freshness probe.

        Raises RuntimeError if the cookie file is missing or expired,
        so we don't waste a Chromium launch on a doomed session.
        """
        if not self._account_file:
            _module_logger.warning(
                "[crawler] DouyinCrawler.search: account_file=None; "
                "proceeding without auth (most dy search pages require auth)."
            )
            return
        valid = asyncio.run(dy_cookie_check(self._account_file))
        if not valid:
            raise RuntimeError(
                f"Douyin cookie at {self._account_file!r} is missing or expired; "
                f"run `sau douyin login --account <name>` first, then "
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
        """Search Douyin by keyword on ``www.douyin.com/search/...``.

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

    def search_stream(
        self,
        keyword: str,
        *,
        max_count: int = 20,
        page_num: int = 1,
    ) -> Any:
        """Stream Douyin search results as they are scraped.

        Yields each row dict immediately after it is persisted, so
        callers can display results incrementally.
        """
        if not keyword or not keyword.strip():
            return
        max_count = max(1, min(max_count, 100))
        self._validate_cookie()
        yield from self._run_async_gen(
            self._async_search_stream(
                keyword.strip(),
                max_count=max_count,
                page_num=page_num,
            )
        )

    async def _async_search_stream(
        self, keyword: str, *, max_count: int, page_num: int
    ):
        """Async generator that yields each Douyin search row as it is scraped."""
        _module_logger.info(
            "[crawler] dy.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.DouyinCrawlSelectors.SEARCH_URL.format(keyword=keyword)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Wait for search result cards or the empty-state indicator.
                # Douyin's SPA may take a moment to hydrate the results.
                await page.wait_for_selector(
                    S.DouyinCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] dy.search selector wait failed: %s", exc
                )
                return

            cards = page.locator(S.DouyinCrawlSelectors.SEARCH_RESULT_CARD)
            count = await cards.count()
            for i in range(min(count, max_count)):
                card = cards.nth(i)
                try:
                    # Extract the aweme_id from the card's link href.
                    link = card.locator(
                        S.DouyinCrawlSelectors.SEARCH_RESULT_LINK
                    ).first
                    href = await link.get_attribute("href") or ""
                    aweme_id = S.aweme_id_from_href(href)

                    title = (
                        await card.locator(
                            S.DouyinCrawlSelectors.SEARCH_RESULT_TITLE
                        ).first.inner_text()
                    ).strip()

                    author = (
                        await card.locator(
                            S.DouyinCrawlSelectors.SEARCH_RESULT_AUTHOR
                        ).first.inner_text()
                    ).strip()

                    play_text = await card.locator(
                        S.DouyinCrawlSelectors.SEARCH_RESULT_PLAY_COUNT
                    ).first.inner_text()

                    row = {
                        "post_id": aweme_id,
                        "title": title,
                        "user": author,
                        "liked_count": S.parse_count(play_text),
                        "post_time": "",
                        "source_url": href,
                    }
                    self._persist_content(row)
                    yield row
                except Exception as exc:  # noqa: BLE001 — per-card isolation
                    _module_logger.debug(
                        "[crawler] dy.search skipping card #%d: %s", i, exc
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] dy.search done: up to %d rows yielded", max_count
            )

    async def _async_search(
        self, keyword: str, *, max_count: int, page_num: int
    ) -> list[dict[str, Any]]:
        """Backward-compatible wrapper that collects the async generator."""
        return [row async for row in self._async_search_stream(
            keyword, max_count=max_count, page_num=page_num
        )]

    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Fetch one Douyin video's full metadata from ``www.douyin.com/video/{id}``.

        Persists via :meth:`_persist_content` and returns the row dict.
        Returns ``None`` if the video is not found, deleted, or rate-limited.
        """
        if not post_id or not post_id.strip():
            return None
        self._validate_cookie()
        return self._run_async(self._async_detail(post_id.strip()))

    async def _async_detail(self, post_id: str) -> dict[str, Any] | None:
        _module_logger.info(
            "[crawler] dy.detail start: post_id=%s", post_id
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.DouyinCrawlSelectors.VIDEO_DETAIL_URL.format(
                aweme_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Wait for the video title or description to appear.
                await page.wait_for_selector(
                    f"{S.DouyinCrawlSelectors.VIDEO_DETAIL_TITLE}, "
                    f"{S.DouyinCrawlSelectors.VIDEO_DETAIL_DESC}",
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] dy.detail selector wait failed for %s: %s",
                    post_id, exc,
                )
                return None

            try:
                title = (
                    await page.locator(
                        S.DouyinCrawlSelectors.VIDEO_DETAIL_TITLE
                    ).first.inner_text()
                ).strip()
            except Exception:
                title = ""

            try:
                desc = (
                    await page.locator(
                        S.DouyinCrawlSelectors.VIDEO_DETAIL_DESC
                    ).first.inner_text()
                ).strip()
            except Exception:
                desc = ""

            try:
                author = (
                    await page.locator(
                        S.DouyinCrawlSelectors.VIDEO_DETAIL_AUTHOR
                    ).first.inner_text()
                ).strip()
            except Exception:
                author = ""

            try:
                likes_text = await page.locator(
                    S.DouyinCrawlSelectors.VIDEO_DETAIL_LIKES
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
                "[crawler] dy.detail done: post_id=%s title=%r",
                post_id, title,
            )
            return row

    def comments(
        self, post_id: str, *, max_count: int = 100
    ) -> list[dict[str, Any]]:
        """Walk one Douyin video's comments from the video detail page.

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
            "[crawler] dy.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.DouyinCrawlSelectors.VIDEO_DETAIL_URL.format(
                aweme_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Scroll down a bit to trigger the comment section to load,
                # then wait for the comment container to appear.
                await page.evaluate("window.scrollBy(0, 600)")
                await asyncio.sleep(1.0)
                await page.wait_for_selector(
                    S.DouyinCrawlSelectors.COMMENTS_CONTAINER,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] dy.comments container not found for %s: %s",
                    post_id, exc,
                )
                return []

            container = page.locator(
                S.DouyinCrawlSelectors.COMMENTS_CONTAINER
            ).first

            # Best-effort click "show more" up to 3 times.
            for _attempt in range(3):
                try:
                    more = container.locator(
                        S.DouyinCrawlSelectors.COMMENTS_SHOW_MORE
                    ).first
                    if await more.count():
                        await more.click()
                        await asyncio.sleep(min(0.5, BASE_CONFIG.request_delay))
                    else:
                        break
                except Exception:
                    break

            items = container.locator(S.DouyinCrawlSelectors.COMMENT_ITEM)
            item_count = await items.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(item_count, max_count)):
                item = items.nth(i)
                try:
                    text = (
                        await item.locator(
                            S.DouyinCrawlSelectors.COMMENT_ITEM_TEXT
                        ).first.inner_text()
                    ).strip()
                    author = (
                        await item.locator(
                            S.DouyinCrawlSelectors.COMMENT_ITEM_AUTHOR
                        ).first.inner_text()
                    ).strip()
                    likes_text = await item.locator(
                        S.DouyinCrawlSelectors.COMMENT_ITEM_LIKES
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
                        "[crawler] dy.comments skipping comment #%d: %s",
                        i, exc,
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] dy.comments done: post_id=%s %d rows persisted",
                post_id, len(rows),
            )
            return rows
