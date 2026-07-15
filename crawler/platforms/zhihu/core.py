"""Zhihu (知乎) crawler — REAL Playwright DOM-scraping impl.

Replaces the prior ``_not_implemented_log`` stub. Mirrors the
DouyinCrawler / KuaishouCrawler / BilibiliCrawler architecture:

    * ``@asynccontextmanager`` for browser session lifecycle
      (cascading try/finally — MUST-HAVE #3 pattern).
    * DOM-scraping on ``www.zhihu.com`` for search + detail + comments.
    * All rows persisted via inherited
      :meth:`AbstractCrawler._persist_content/_persist_comment`.

Zhihu consumer-site structure (as of 2026):

    * **Search** (``www.zhihu.com/search?type=content&q=...``): renders a
      list of content cards (questions, articles, videos). Each card has
      a title, excerpt, vote count, and a link to the content.
    * **Content detail** (``www.zhihu.com/question/{id}`` or
      ``zhuanlan.zhihu.com/p/{id}``): question + answers or article with
      comments section below the fold.
    * **Comments**: loaded dynamically; may require scrolling.

Login approach:
    Zhihu has NO dedicated uploader in this project. The login module
    (``crawler/platforms/zhihu/login.py``) implements a standalone
    QR-code login flow via ``www.zhihu.com/signin``. Cookies are
    stored as Playwright ``storage_state`` JSON at
    ``cookies/zhihu_{account}.json``.

Sync / async contract:
    Same as all other crawlers — public methods are SYNC (``search`` /
    ``detail`` / ``comments``) and wrap async coroutines via
    :func:`asyncio.run`.

Constants and selectors:
    Per-page CSS selectors live in
    :file:`crawler/platforms/zhihu/selectors.py::ZhihuCrawlSelectors`.
    When ``www.zhihu.com`` changes its DOM, update ONLY that file.

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
from crawler.platforms.zhihu import selectors as S
from crawler.platforms.zhihu.login import zhihu_cookie_check

_module_logger = logging.getLogger(__name__)


class ZhihuCrawler(AbstractCrawler):
    """知乎 crawler — Playwright DOM-scraping search/detail/comments.

    Dedicated browser session per method call (matches all other crawlers).
    """

    platform_id = "zhihu"

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
        Uses the ``zhihu`` anti-detect profile registered in
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
                    "zhihu",
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
                "[crawler] ZhihuCrawler: account_file=None; "
                "proceeding without auth (search results may be limited)."
            )
            return
        valid = asyncio.run(zhihu_cookie_check(self._account_file))
        if not valid:
            raise RuntimeError(
                f"Zhihu cookie at {self._account_file!r} is missing or expired; "
                f"run `sau zhihu login --account <name>` first, then "
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
        """Search Zhihu by keyword on ``www.zhihu.com/search``.

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
            "[crawler] zhihu.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.ZhihuCrawlSelectors.SEARCH_URL.format(keyword=keyword)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(
                    S.ZhihuCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] zhihu.search selector wait failed: %s", exc
                )
                return []

            cards = page.locator(S.ZhihuCrawlSelectors.SEARCH_RESULT_CARD)
            count = await cards.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(count, max_count)):
                card = cards.nth(i)
                try:
                    link = card.locator(
                        S.ZhihuCrawlSelectors.SEARCH_RESULT_LINK
                    ).first
                    href = await link.get_attribute("href") or ""
                    content_id = S.content_id_from_url(href)

                    title = (
                        await card.locator(
                            S.ZhihuCrawlSelectors.SEARCH_RESULT_TITLE
                        ).first.inner_text()
                    ).strip()

                    author = ""
                    try:
                        author = (
                            await card.locator(
                                S.ZhihuCrawlSelectors.SEARCH_RESULT_AUTHOR
                            ).first.inner_text()
                        ).strip()
                    except Exception:
                        pass

                    vote_text = ""
                    try:
                        vote_text = await card.locator(
                            S.ZhihuCrawlSelectors.SEARCH_RESULT_VOTE_COUNT
                        ).first.inner_text()
                    except Exception:
                        pass

                    rows.append({
                        "post_id": content_id,
                        "title": title,
                        "user": author,
                        "liked_count": S.parse_count(vote_text),
                        "post_time": "",
                        "source_url": href,
                    })
                    self._persist_content(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-card isolation
                    _module_logger.debug(
                        "[crawler] zhihu.search skipping card #%d: %s", i, exc
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] zhihu.search done: %d rows persisted", len(rows)
            )
            return rows

    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Fetch one Zhihu content's metadata.

        ``post_id`` can be a question ID (numeric) or article slug.

        Persists via :meth:`_persist_content` and returns the row dict.
        Returns ``None`` if the content is not found or rate-limited.
        """
        if not post_id or not post_id.strip():
            return None
        self._validate_cookie()
        return self._run_async(self._async_detail(post_id.strip()))

    async def _async_detail(self, post_id: str) -> dict[str, Any] | None:
        _module_logger.info(
            "[crawler] zhihu.detail start: post_id=%s", post_id
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            # Try question URL first, fall back to article URL
            url = S.ZhihuCrawlSelectors.QUESTION_DETAIL_URL.format(
                question_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(
                    S.ZhihuCrawlSelectors.CONTENT_TITLE,
                    timeout=15000,
                )
            except Exception:
                # Fall back to article URL
                url = S.ZhihuCrawlSelectors.ARTICLE_DETAIL_URL.format(
                    article_id=post_id
                )
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_selector(
                        S.ZhihuCrawlSelectors.CONTENT_TITLE,
                        timeout=15000,
                    )
                except Exception as exc:
                    _module_logger.warning(
                        "[crawler] zhihu.detail: both question + article URLs "
                        "failed for %s: %s", post_id, exc,
                    )
                    return None

            try:
                title = (
                    await page.locator(
                        S.ZhihuCrawlSelectors.CONTENT_TITLE
                    ).first.inner_text()
                ).strip()
            except Exception:
                title = ""

            try:
                body = (
                    await page.locator(
                        S.ZhihuCrawlSelectors.CONTENT_BODY
                    ).first.inner_text()
                ).strip()
            except Exception:
                body = ""

            try:
                author = (
                    await page.locator(
                        S.ZhihuCrawlSelectors.CONTENT_AUTHOR
                    ).first.inner_text()
                ).strip()
            except Exception:
                author = ""

            try:
                vote_text = await page.locator(
                    S.ZhihuCrawlSelectors.CONTENT_VOTE_COUNT
                ).first.inner_text()
                vote_count = S.parse_count(vote_text)
            except Exception:
                vote_count = 0

            row = {
                "post_id": post_id,
                "title": title,
                "content": body,
                "user": author,
                "liked_count": vote_count,
                "source_url": url,
            }
            self._persist_content(row)

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] zhihu.detail done: post_id=%s title=%r",
                post_id, title,
            )
            return row

    def comments(
        self, post_id: str, *, max_count: int = 100
    ) -> list[dict[str, Any]]:
        """Walk one Zhihu content's comments.

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
            "[crawler] zhihu.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            # Try question URL first
            url = S.ZhihuCrawlSelectors.QUESTION_DETAIL_URL.format(
                question_id=post_id
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.evaluate("window.scrollBy(0, 800)")
                await asyncio.sleep(1.5)
                await page.wait_for_selector(
                    S.ZhihuCrawlSelectors.COMMENTS_CONTAINER,
                    timeout=15000,
                )
            except Exception:
                # Fall back to article URL
                url = S.ZhihuCrawlSelectors.ARTICLE_DETAIL_URL.format(
                    article_id=post_id
                )
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    await page.evaluate("window.scrollBy(0, 800)")
                    await asyncio.sleep(1.5)
                    await page.wait_for_selector(
                        S.ZhihuCrawlSelectors.COMMENTS_CONTAINER,
                        timeout=15000,
                    )
                except Exception as exc:
                    _module_logger.warning(
                        "[crawler] zhihu.comments: container not found "
                        "for %s: %s", post_id, exc,
                    )
                    return []

            container = page.locator(
                S.ZhihuCrawlSelectors.COMMENTS_CONTAINER
            ).first

            # Best-effort click "show more" up to 3 times
            for _attempt in range(3):
                try:
                    more = container.locator(
                        S.ZhihuCrawlSelectors.COMMENTS_SHOW_MORE
                    ).first
                    if await more.count():
                        await more.click()
                        await asyncio.sleep(min(0.5, BASE_CONFIG.request_delay))
                    else:
                        break
                except Exception:
                    break

            items = container.locator(S.ZhihuCrawlSelectors.COMMENT_ITEM)
            item_count = await items.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(item_count, max_count)):
                item = items.nth(i)
                try:
                    text = (
                        await item.locator(
                            S.ZhihuCrawlSelectors.COMMENT_ITEM_TEXT
                        ).first.inner_text()
                    ).strip()
                    author = (
                        await item.locator(
                            S.ZhihuCrawlSelectors.COMMENT_ITEM_AUTHOR
                        ).first.inner_text()
                    ).strip()
                    likes_text = await item.locator(
                        S.ZhihuCrawlSelectors.COMMENT_ITEM_LIKES
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
                        "[crawler] zhihu.comments skipping comment #%d: %s",
                        i, exc,
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] zhihu.comments done: post_id=%s %d rows persisted",
                post_id, len(rows),
            )
            return rows
