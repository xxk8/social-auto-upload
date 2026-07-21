"""Xiaohongshu (小红书) crawler — REAL browser + signed-API dual-mode impl.

Replaces the prior ``_not_implemented_log`` stub. Round-MC-2024-xhs-realization
landed the DOM-scraping path; round-MC-2024-xhs-signing adds a parallel signed-API
path that operators A/B via ``SAU_XHS_SIGN_MODE=dom|sign``. Both paths return the
same row schema so downstream consumers (SauliteStore + JSONB INSERT) don't have
to branch on which one produced the data.

Two paths, on purpose:

  * **DOM scraping** (default ``dom``) — Playwright browser launch, navigate
    ``www.xiaohongshu.com/search_result?keyword=…``, read rendered cards,
    parse ``liked_count`` text via ``selectors.parse_count``. Slow
    (one Chromium render per keyword page) but doesn't need the
    X-Bogus/X-S signature — robust across frontend pushes because
    no client-side crypto is involved.

  * **Signed API** (opt-in ``sign``) — via XhsSigner + ``httpx``. Calls
    the same JSON endpoints MediaCrawler calls
    (``/api/sns/web/v1/search/notes``, ``/api/sns/web/v1/feed``,
    ``/api/sns/web/v2/comment/page``) with xhshow-generated signature
    headers. Fast (no Chromium launch) but brittle — XHS regenerates
    the signing algorithm on every frontend push, after which
    signatures fail en masse and we cascade back to ``dom``.

Both modes honor ``SAU_CRAWLER_REQUEST_DELAY`` (doubled for the ``sign``
path because httpx is roughly 10× faster than Chromium navigation and
will hit XHS rate-limits much more aggressively — thinker-with-files-
gemini pitfall #1).

Architecture:

    * **Login** is NOT implemented here — we reuse
      ``crawler/platforms/xhs/login.py::xhs_login`` which delegates
      to ``uploader/xiaohongshu_uploader/xiaohongshu_setup`` (the
      cookie domain ``.xiaohongshu.com`` is shared between creator
      + consumer sites). The signed-API path additionally reads
      ``COOKIES_DIR/xiaohongshu_<account>.json`` (Playwright
      ``storage_state`` JSON) via ``XhsSigner.from_cookie_storage_state``
      for the ``a1`` cookie the signing checksum needs.

    * **Browser construction** is delegated to
      ``utils/anti_detect/browser_profile.py::build_browser_*``
      so the platform-aware stealth profile ("xiaohongshu" key in
      ``_PLATFORM_PRESETS``) is reused without forking. Only
      applies to the ``dom`` path.

    * **Persistence** is delegated to the inherited
      :meth:`AbstractCrawler._persist_content/_persist_comment`
      helpers so the JSONB INSERTs go through our
      :class:`crawler.store.saulite_store.SauliteStore`. Both
      ``dom`` and ``sign`` paths produce the same row dicts.

Sync / async contract:
    :class:`AbstractCrawler` declares ``search``/``detail``/``comments``
    as SYNC methods (caller contract — see :file:`web_runner/utils.py`
    ``_run_crawl`` which calls these on a ThreadPoolExecutor worker).
    We wrap the async coroutines (Playwright for ``dom``, httpx for
    ``sign``) via :func:`asyncio.run` inside each public method. The
    cost: each method spins its own asyncio loop and tears it down
    on return. Acceptable for v1 since each crawl is one-shot per
    task.

Future optimization (Section 13.4 follow-up): replace ``asyncio.run``
with a persistent event loop pinned to a worker thread, so multiple
sequential ``search`` calls share a Chromium instance + a linked
httpx connection pool. For now we launch fresh per call.

Constants and selectors:
    Per-page CSS selectors live in
    :file:`crawler/platforms/xhs/selectors.py::XhsCrawlSelectors`.
    When ``www.xiaohongshu.com`` changes its DOM, update ONLY that
    file. The selectors are loose (RobustToA/B-test) — they use
    stable data-test attributes and propagated text patterns
    rather than webpack-hashed class names. Only the ``dom`` path
    touches selectors.

Signing logic:
    X-S / X-T / X-S-Common / X-B3-Traceid generation lives in
    :file:`crawler/platforms/xhs/sign.py::XhsSigner`. That module
    is a thin shim over the ``xhshow`` library (Cloxl/xhshow on
    PyPI, ~replaces upstream MediaCrawler's deprecated mbd.js).
    See ``sign.py`` for the library rationale and the import-time
    fallback contract.

Page navigation:
    We honor ``crawler.config.BASE_CONFIG.request_delay`` between
    page navigations to avoid XHS rate-limits. Operators tune
    via ``SAU_CRAWLER_REQUEST_DELAY`` env var (default 1.0s).
    The ``sign`` path multiplies by 2.0 to compensate for the
    faster httpx round-trip.

IP proxy:
    The constructor reads ``self._proxy_url`` (passed via
    ``AbstractCrawler.__init__``) and applies it via
    ``browser.new_context(proxy=...)`` on each launch — matches the
    publish-side ``uploader.base_video`` pattern. Only the ``dom``
    path uses a browser proxy; the ``sign`` path can use a proxy
    via ``BASE_CONFIG.static_proxy_url`` if the operator wires
    it through ``httpx.AsyncClient`` proxies map (TODO).
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from crawler.base.base_crawler import AbstractCrawler
from crawler.config import BASE_CONFIG
from crawler.platforms.xhs import selectors as S
from crawler.platforms.xhs.login import xhs_cookie_check
from crawler.platforms.xhs.sign import XhsSigner

_module_logger = logging.getLogger(__name__)


class XiaoHongShuCrawler(AbstractCrawler):
    """小红书 crawler — DOM + signed-API dual-mode search/detail/comments.

    ``SAU_XHS_SIGN_MODE=dom`` (default): Playwright DOM scraping.
    ``SAU_XHS_SIGN_MODE=sign`` (opt-in): XhsSigner + httpx against
    XHS's signed JSON endpoints. Failures cascade back to ``dom``
    with a warning.
    """

    platform_id = "xhs"

    def __init__(
        self,
        *,
        account_file: str | None = None,
        headless: bool = True,
        proxy_url: str | None = None,
        store: Any | None = None,
    ) -> None:
        # ``AbstractCrawler.__init__`` accepts (store, headless, proxy_url)
        # and lazily creates a SauliteStore if None. We forward
        # kwargs explicitly so callers can override the store for tests.
        super().__init__(store=store, headless=headless, proxy_url=proxy_url)
        # ``account_file`` is crawler-side state — the cookie storage
        # we use to authenticate Playwright context (dom) AND signed
        # requests (sign). AbstractCrawler doesn't know about it;
        # we add it here.
        self._account_file = account_file

    # ── Async helpers (Playwright loop body) ─────────────────────────────
    @asynccontextmanager
    async def _open_browser_session(self):
        """Launch patchright + apply anti-detect + yield a Playwright ``BrowserContext``.

        Used as::

            async with self._open_browser_session() as context:
                page = await context.new_page()
                ...

        Cascading cleanup — two nested ``try`` / ``finally`` blocks
        ensure browser and context are both closed even on exception::

            ┌ browser.close()  ← outer finally
            │   ┌ context.close()  ← inner finally
            │   │   ▒ yield context  ← caller body
            │   └ context.close()
            └ browser.close()

        ``async_playwright()`` itself is closed automatically via
        ``async with``. The previously-leaky manual pattern
        (``__aenter__`` + ad-hoc ``__aexit__`` in a separate
        ``_close_browser`` method) is folded into a single
        ``@asynccontextmanager`` decorator with cascading try/finally
        inside.

        Trade-off: each ``search`` / ``detail`` / ``comments`` call
        spins + tears down a fresh Chromium driver. Acceptable for
        v1 since each crawl task is one-shot. Section 13.4 follow-up
        will swap to a worker-pinned event loop. The key invariant:
        ``async_playwright()`` enters/exits via Python's standard
        ``async with`` protocol — no driver subprocess leaks.

        Round-MC-2024-xhs-realization MUST-HAVE #3 — replaces the
        prior manual ``__aenter__()`` + leak-prone
        ``_close_browser`` pattern with the canonical Python
        ``@asynccontextmanager`` + nested try/finally cascade.
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
                    "xiaohongshu",
                    account_file=self._account_file,
                    headless=self._headless,
                )
                # ``browser.new_context`` accepts a ``proxy=`` kwarg
                # that takes ``{"server": "...", "username": "...",
                # "password": "..."}``. We only set ``server`` here
                # because the create_ip_pool helper currently
                # returns nothing more.
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

    # ── Sync wrappers around async playwright loop ───────────────────────
    def _run_async(self, coro: Any) -> Any:
        """Drive an async coroutine on a fresh asyncio loop in this thread.

        Each public method calls this exactly once per invocation, so
        Chromium spawn/teardown is one-shot per search/detail/comments
        call (matches MediaCrawler's per-call pattern).
        """
        return asyncio.run(coro)

    def _validate_cookie(self) -> None:
        """Pre-launch cookie freshness probe.

        If ``_account_file`` is missing or cookie_auth fails,
        raise ``RuntimeError`` early so we don't waste a Chromium
        launch on a doomed session. Operators can pre-emptively
        resolve by running ``cli.platforms.xiaohongshu.setup`` (the
        existing QR-code login flow), which populates the same file.
        """
        if not self._account_file:
            _module_logger.warning(
                "[crawler] XiaoHongShuCrawler.search required account_file"
                "=None — proceeding without a Playwright cookie (most"
                " XHS search pages require auth). Pass account_file=..."
                " to opt into authed scraping."
            )
            return
        # Use asyncio.run for the cookie probe (also async due to
        # uploader-side cookie_auth). Synchronous wrapper to make
        # this transparent to callers of search()/detail().
        valid = asyncio.run(xhs_cookie_check(self._account_file))
        if not valid:
            raise RuntimeError(
                f"XHS cookie at {self._account_file!r} is missing or expired; "
                f"run `sau xiaohongshu login --account <name>` first, then "
                f"retry the crawl task."
            )

    # ── Public contract methods (override stubs) ────────────────────────
    def search(
        self,
        keyword: str,
        *,
        max_count: int = 20,
        page_num: int = 1,
    ) -> list[dict[str, Any]]:
        """Search XHS by keyword.

        Two execution paths (round-MC-2024-xhs-signing):

          * ``SAU_XHS_SIGN_MODE=dom`` (default) — Playwright DOM
            scraping.
          * ``SAU_XHS_SIGN_MODE=sign`` — MediaCrawler-style signed
            API path via :mod:`crawler.platforms.xhs.sign` +
            ``httpx``. Faster (no Chromium launch) but brittle:
            XHS regenerates the signing algo on every frontend
            push, so failures cascade back to ``dom`` with a
            warning.

        Both paths return row dicts of shape
        ``{"post_id", "title", "user", "liked_count",
        "post_time", "source_url"}`` + persist via
        :meth:`AbstractCrawler._persist_content`.

        ``max_count`` is hardcapped at 100 either way (rate-limit
        + cold-cookie-window hygiene).
        """
        if not keyword or not keyword.strip():
            return []
        max_count = max(1, min(max_count, 100))
        self._validate_cookie()
        # Sign-mode is opt-in and REQUIRES ``_account_file`` because
        # XHS rejects signed requests without a valid ``a1`` cookie.
        if BASE_CONFIG.sign_mode == "sign" and self._account_file:
            try:
                return self._run_async(
                    self._async_sign_search(
                        keyword.strip(),
                        max_count=max_count,
                        page_num=page_num,
                    )
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] xhs.search sign-mode failed (%s: %s); "
                    "cascading-fall-back to DOM mode",
                    type(exc).__name__,
                    exc,
                )
                # Fall through to DOM mode below.
        return self._run_async(
            self._async_search(keyword.strip(), max_count=max_count, page_num=page_num)
        )

    async def _async_search(
        self, keyword: str, *, max_count: int, page_num: int
    ) -> list[dict[str, Any]]:
        _module_logger.info(
            "[crawler] xhs.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.XhsCrawlSelectors.SEARCH_URL.format(keyword=keyword)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Wait for the grid to render or the empty-state marker
                await page.wait_for_selector(
                    f"{S.XhsCrawlSelectors.SEARCH_RESULT_CARD}, "
                    f"text={S.XhsCrawlSelectors.SEARCH_NO_RESULTS_TEXT}",
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning("[crawler] xhs.search selector wait failed: %s", exc)
                return []

            cards = page.locator(S.XhsCrawlSelectors.SEARCH_RESULT_CARD)
            count = await cards.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(count, max_count)):
                card = cards.nth(i)
                try:
                    link = card.locator(S.XhsCrawlSelectors.SEARCH_RESULT_LINK).first
                    href = await link.get_attribute("href") or ""
                    note_id = S.note_id_from_url(href)
                    title = (await card.locator(S.XhsCrawlSelectors.SEARCH_RESULT_TITLE).first.inner_text()).strip()
                    author = (await card.locator(S.XhsCrawlSelectors.SEARCH_RESULT_AUTHOR).first.inner_text()).strip()
                    likes_text = await card.locator(S.XhsCrawlSelectors.SEARCH_RESULT_LIKES).first.inner_text()
                    rows.append({
                        "post_id": note_id,
                        "title": title,
                        "user": author,
                        "liked_count": S.parse_count(likes_text),
                        "post_time": "",
                        "source_url": href,
                    })
                    # Persist each row to PG.
                    self._persist_content(rows[-1])
                except Exception as exc:  # noqa: BLE001 — per-card isolation
                    _module_logger.debug(
                        "[crawler] xhs.search skipping card #%d: %s", i, exc
                    )
                    continue

            # Honor request-delay between next-page cycle.
            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] xhs.search done: %d rows persisted", len(rows)
            )
            # ``context`` + ``browser`` + playwright-CM auto-closed at
            # ``async with`` exit — see ``_open_browser_session``.
            return rows

    # ── Sign-mode async helpers (round-MC-2024-xhs-signing) ────────────────
    async def _async_sign_search(
        self, keyword: str, *, max_count: int, page_num: int
    ) -> list[dict[str, Any]]:
        """Sign-mode equivalent of :meth:`_async_search`.

        Drives :mod:`crawler.platforms.xhs.sign` for X-S/X-T/X-S-Common/
        X-B3-Traceid header generation + ``httpx`` for the actual
        HTTP request. Bypasses Chromium entirely.

        Pitfall #1 (thinker-with-files-gemini): the httpx path is
        roughly 10× faster than Chromium navigation, so the
        per-call ``request_delay`` is doubled (``2×``) to compensate
        for hitting XHS rate-limits more aggressively.
        """
        _module_logger.info(
            "[crawler] xhs.sign.search start: keyword=%r max_count=%d page_num=%d",
            keyword, max_count, page_num,
        )
        signer = XhsSigner.from_cookie_storage_state(self._account_file)
        payload = await self._async_sign_request(
            signer,
            uri="/api/sns/web/v1/search/notes",
            method="GET",
            params={
                "keyword": keyword,
                "page": str(page_num),
                "page_size": str(max_count),
                "sort": "general",
            },
        )
        notes = (payload.get("data") or {}).get("notes", []) or []
        rows = [
            self._parse_xhs_search_note(n)
            for n in notes[:max_count]
            if isinstance(n, dict)
        ]
        for row in rows:
            self._persist_content(row)
        # Rate-limit discipline for the fast path.
        delay = BASE_CONFIG.request_delay * 2.0
        if delay > 0:
            await asyncio.sleep(delay)
        _module_logger.info(
            "[crawler] xhs.sign.search done: %d rows persisted", len(rows),
        )
        return rows

    @staticmethod
    async def _async_sign_request(
        signer: "XhsSigner", *, uri: str, method: str,
        params: dict | None = None, json_body: dict | None = None,
    ) -> dict:
        """Drive one signed XHS request via ``httpx``.

        Lazy-imports ``httpx`` so the module stays importable on
        machines where httpx isn't installed (e.g. operators still
        on ``SAU_XHS_SIGN_MODE=dom``). The user only pays the
        import cost on the first sign-mode request.

        Pitfall #3 (thinker-with-files-gemini — payload shape):
        xhshow bounds-checks the signature against the EXACT bytes
        sent. We sign with the same dict we hand to httpx so the two
        paths can't drift on whitespace or key ordering.
        """
        import httpx
        method_upper = method.upper()
        if method_upper == "POST":
            sign_data = json_body or {}
        else:
            sign_data = params or {}
        headers = signer.sign(uri=uri, method=method_upper, data=sign_data)
        # Browser-like UA + the four signed headers. Some XHS
        # endpoints reject requests with a bare ``python-httpx``
        # UA; mirroring a current Chrome desktop UA is the lowest-
        # friction way to look authentic.
        browser_like_ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method_upper,
                f"{signer.base_url}{uri}",
                params=params if method_upper == "GET" else None,
                json=json_body if method_upper == "POST" else None,
                headers={"User-Agent": browser_like_ua, **headers},
            )
        response.raise_for_status()
        return response.json()

    @staticmethod
    def _parse_xhs_search_note(note: dict) -> dict:
        """Map ``/api/sns/web/v1/search/notes`` JSON to our row schema.

        Field shape (XHS API, post-decode)::

            {
              "note_id": "...",
              "title": "...",
              "user": {"nickname": "..."},
              "interact_info": {"liked_count": 12345}
            }

        Output matches the DOM-scraping row shape so downstream
        consumers (SauliteStore + JSONB INSERT) don't have to
        special-case either path.
        """
        note_id = note.get("note_id") or note.get("id") or ""
        title = (note.get("title") or note.get("display_title") or "").strip()
        user = ((note.get("user") or {}).get("nickname") or "").strip()
        interact = note.get("interact_info") or {}
        try:
            liked_count = int(interact.get("liked_count") or 0)
        except (TypeError, ValueError):
            liked_count = 0
        return {
            "post_id": note_id,
            "title": title,
            "user": user,
            "liked_count": liked_count,
            "post_time": "",
            "source_url": (
                f"https://www.xiaohongshu.com/explore/{note_id}"
                if note_id else ""
            ),
        }

    def detail(self, post_id: str) -> dict[str, Any] | None:
        """Fetch one XHS note's full content + metadata.

        Two execution paths (round-MC-2024-xhs-signing): DOM (default)
        or signed API (opt-in). Failures cascade back to DOM.

        Persists via :meth:`_persist_content` and returns the row dict.
        Returns ``None`` if the post is not found, deleted, or rate-limited.
        """
        if not post_id or not post_id.strip():
            return None
        self._validate_cookie()
        if BASE_CONFIG.sign_mode == "sign" and self._account_file:
            try:
                return self._run_async(
                    self._async_sign_detail(post_id.strip())
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] xhs.detail sign-mode failed (%s: %s); "
                    "cascading-fall-back to DOM mode",
                    type(exc).__name__,
                    exc,
                )
                # Fall through to DOM mode below.
        return self._run_async(self._async_detail(post_id.strip()))

    async def _async_detail(self, post_id: str) -> dict[str, Any] | None:
        _module_logger.info("[crawler] xhs.detail start: post_id=%s", post_id)
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.XhsCrawlSelectors.NOTE_DETAIL_URL.format(
                note_id=post_id, **S.XhsCrawlSelectors.URL_KWARGS_DEFAULT
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(S.XhsCrawlSelectors.NOTE_DETAIL_TITLE, timeout=15000)
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] xhs.detail selector wait failed for %s: %s",
                    post_id, exc,
                )
                return None

            try:
                title = (await page.locator(S.XhsCrawlSelectors.NOTE_DETAIL_TITLE).first.inner_text()).strip()
                desc = (await page.locator(S.XhsCrawlSelectors.NOTE_DETAIL_DESC).first.inner_text()).strip()
                author = (await page.locator(S.XhsCrawlSelectors.NOTE_DETAIL_AUTHOR).first.inner_text()).strip()
                likes_text = await page.locator(S.XhsCrawlSelectors.NOTE_DETAIL_LIKES).first.inner_text()
                tags_locator = page.locator(S.XhsCrawlSelectors.NOTE_DETAIL_TAGS)
                tags_count = await tags_locator.count()
                tags: list[str] = []
                for i in range(tags_count):
                    tag_text = (await tags_locator.nth(i).inner_text()).strip()
                    if tag_text:
                        tags.append(tag_text)
            except Exception as exc:
                _module_logger.warning("[crawler] xhs.detail extraction failed: %s", exc)
                return None

            row = {
                "post_id": post_id,
                "title": title,
                "content": desc,
                "user": author,
                "liked_count": S.parse_count(likes_text),
                "tags": tags,
                "source_url": url,
            }
            self._persist_content(row)
            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] xhs.detail done: post_id=%s title=%r", post_id, title
            )
            return row

    async def _async_sign_detail(self, post_id: str) -> dict[str, Any] | None:
        """Sign-mode equivalent of :meth:`_async_detail`."""
        _module_logger.info(
            "[crawler] xhs.sign.detail start: post_id=%s", post_id,
        )
        signer = XhsSigner.from_cookie_storage_state(self._account_file)
        # POST because XHS's feed endpoint is documented as POST in
        # MediaCrawler upstream (body = {"source_note_id": "..."}).
        payload = await self._async_sign_request(
            signer,
            uri="/api/sns/web/v1/feed",
            method="POST",
            json_body={"source_note_id": post_id},
        )
        items = (payload.get("data") or {}).get("items", []) or []
        if not items:
            _module_logger.info(
                "[crawler] xhs.sign.detail done: post_id=%s not_found_or_deleted",
                post_id,
            )
            return None
        # XHS wraps everything in a `note_card` field on the items list.
        note_card = items[0].get("note_card") or items[0] if isinstance(items[0], dict) else {}
        row = self._parse_xhs_detail_note(note_card, post_id)
        self._persist_content(row)
        delay = BASE_CONFIG.request_delay * 2.0
        if delay > 0:
            await asyncio.sleep(delay)
        _module_logger.info(
            "[crawler] xhs.sign.detail done: post_id=%s title=%r",
            post_id, row.get("title"),
        )
        return row

    @staticmethod
    def _parse_xhs_detail_note(note: dict, post_id: str) -> dict:
        """Map ``/api/sns/web/v1/feed`` JSON to our detail row schema."""
        title = (note.get("title") or note.get("display_title") or "").strip()
        desc = (note.get("desc") or note.get("description") or "").strip()
        user = ((note.get("user") or {}).get("nickname") or "").strip()
        interact = note.get("interact_info") or {}
        try:
            liked_count = int(interact.get("liked_count") or 0)
        except (TypeError, ValueError):
            liked_count = 0
        tags_raw = note.get("tag_list") or note.get("tags") or []
        tags = [
            (t.get("name") if isinstance(t, dict) else str(t)).strip()
            for t in tags_raw
            if (isinstance(t, dict) and t.get("name")) or (isinstance(t, str) and t.strip())
        ]
        return {
            "post_id": post_id,
            "title": title,
            "content": desc,
            "user": user,
            "liked_count": liked_count,
            "tags": tags,
            "source_url": (
                f"https://www.xiaohongshu.com/explore/{post_id}" if post_id else ""
            ),
        }

    def comments(self, post_id: str, *, max_count: int = 100) -> list[dict[str, Any]]:
        """Walk one XHS note's comment tree (top-level + 1st-level replies).

        Two execution paths (round-MC-2024-xhs-signing): DOM (default)
        or signed API (opt-in). Failures cascade back to DOM.

        Returns comment dicts with at least:
            ``{"post_id", "comment_id", "text", "user", "like_count", "sub_comment_count"}``

        All rows are persisted to ``crawled_comments`` via
        :meth:`AbstractCrawler._persist_comment` — the store layer's
        :meth:`SauliteStore.store_comment` then triggers the async
        AI-augmentation thread (sentiment + reply suggestion).
        ``max_count`` is hardcapped at 100 per the executor's
        MAX_POST_IDS reasoning (Task 13.2 follow-up halves this).
        """
        if not post_id or not post_id.strip():
            return []
        max_count = max(1, min(max_count, BASE_CONFIG.max_comments))
        self._validate_cookie()
        if BASE_CONFIG.sign_mode == "sign" and self._account_file:
            try:
                return self._run_async(
                    self._async_sign_comments(post_id.strip(), max_count=max_count)
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] xhs.comments sign-mode failed (%s: %s); "
                    "cascading-fall-back to DOM mode",
                    type(exc).__name__,
                    exc,
                )
                # Fall through to DOM mode below.
        return self._run_async(self._async_comments(post_id.strip(), max_count=max_count))

    async def _async_comments(
        self, post_id: str, *, max_count: int
    ) -> list[dict[str, Any]]:
        _module_logger.info(
            "[crawler] xhs.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        async with self._open_browser_session() as context:
            page = await context.new_page()
            url = S.XhsCrawlSelectors.NOTE_DETAIL_URL.format(
                note_id=post_id, **S.XhsCrawlSelectors.URL_KWARGS_DEFAULT
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector(
                    S.XhsCrawlSelectors.COMMENTS_CONTAINER,
                    timeout=15000,
                )
            except Exception as exc:
                _module_logger.warning(
                    "[crawler] xhs.comments container not found for %s: %s",
                    post_id, exc,
                )
                return []

            container = page.locator(S.XhsCrawlSelectors.COMMENTS_CONTAINER).first
            # Best-effort click "show more" up to 3 times, in case XHS paginates.
            for _attempt in range(3):
                try:
                    more = container.locator(S.XhsCrawlSelectors.COMMENTS_SHOW_MORE).first
                    if await more.count():
                        await more.click()
                        await asyncio.sleep(min(0.5, BASE_CONFIG.request_delay))
                    else:
                        break
                except Exception:
                    break

            items = container.locator(S.XhsCrawlSelectors.COMMENT_ITEM)
            item_count = await items.count()
            rows: list[dict[str, Any]] = []
            for i in range(min(item_count, max_count)):
                item = items.nth(i)
                try:
                    text = (await item.locator(S.XhsCrawlSelectors.COMMENT_ITEM_TEXT).first.inner_text()).strip()
                    author = (await item.locator(S.XhsCrawlSelectors.COMMENT_ITEM_AUTHOR).first.inner_text()).strip()
                    likes_text = await item.locator(S.XhsCrawlSelectors.COMMENT_ITEM_LIKES).first.inner_text()
                    # Build a synthetic comment_id from post_id + index.
                    # XHS uses opaque comment hashes we can't easily
                    # extract; index-based dedup is sufficient for
                    # one-time crawls.
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
                        "[crawler] xhs.comments skipping comment #%d: %s", i, exc
                    )
                    continue

            if BASE_CONFIG.request_delay > 0:
                await asyncio.sleep(BASE_CONFIG.request_delay)
            _module_logger.info(
                "[crawler] xhs.comments done: post_id=%s %d rows persisted",
                post_id, len(rows),
            )
            return rows

    async def _async_sign_comments(
        self, post_id: str, *, max_count: int
    ) -> list[dict[str, Any]]:
        """Sign-mode equivalent of :meth:`_async_comments`.

        Note: only top-level comments on this round; sub-comment
        pagination (``/api/sns/web/v2/comment/sub/page``) is a
        follow-up. Section 13.X tasks.md.
        """
        _module_logger.info(
            "[crawler] xhs.sign.comments start: post_id=%s max_count=%d",
            post_id, max_count,
        )
        signer = XhsSigner.from_cookie_storage_state(self._account_file)
        payload = await self._async_sign_request(
            signer,
            uri="/api/sns/web/v2/comment/page",
            method="GET",
            params={
                "note_id": post_id,
                "cursor": "",
                "top_comment_id": "",
                "count": str(min(max_count, 20)),
            },
        )
        comments = (payload.get("data") or {}).get("comments", []) or []
        rows = [
            self._parse_xhs_comment(c, post_id)
            for c in comments[:max_count]
            if isinstance(c, dict)
        ]
        for row in rows:
            self._persist_comment(row)
        delay = BASE_CONFIG.request_delay * 2.0
        if delay > 0:
            await asyncio.sleep(delay)
        _module_logger.info(
            "[crawler] xhs.sign.comments done: post_id=%s %d rows",
            post_id, len(rows),
        )
        return rows

    @staticmethod
    def _parse_xhs_comment(c: dict, post_id: str) -> dict:
        """Map ``/api/sns/web/v2/comment/page`` JSON to our row schema.

        XHS comment JSON shape (post-decode)::

            {
              "id": "...",
              "content": "...",
              "user": {"nickname": "..."},
              "like_count": 12,
              "sub_comment_count": 0
            }
        """
        comment_id = c.get("id") or c.get("comment_id") or ""
        text = (c.get("content") or c.get("text") or "").strip()
        user = ((c.get("user") or {}).get("nickname") or "").strip()
        try:
            like_count = int(c.get("like_count") or 0)
        except (TypeError, ValueError):
            like_count = 0
        try:
            sub_comment_count = int(c.get("sub_comment_count") or 0)
        except (TypeError, ValueError):
            sub_comment_count = 0
        source_url = (
            f"https://www.xiaohongshu.com/explore/{post_id}" if post_id else ""
        )
        return {
            "post_id": post_id,
            "comment_id": comment_id,
            "text": text,
            "user": user,
            "like_count": like_count,
            "sub_comment_count": sub_comment_count,
            "source_url": source_url,
        }
