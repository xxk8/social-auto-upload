"""Tests for the Weibo (wb) crawler — selectors + mock-based core tests.

Coverage:

  1. **Selector helpers** (pure Python — no browser, no PG):
     - ``mid_from_url`` — extraction from ``/detail/<id>`` and
       ``weibo.com/{uid}/{mid}`` URLs.
     - ``parse_count`` — w/万/亿/--/numbers/empty/garbage.

  2. **Login module** (pure Python):
     - ``resolve_account_file`` — absolute path, relative name.

  3. **WeiboCrawler mock-based** (no Playwright browser, no PG):
     - Constructor wiring (platform_id, store, headless).
     - ``_validate_cookie`` — cookie freshness guard.
     - ``search`` / ``detail`` / ``comments`` — empty-keyword guard,
       max_count hardcapping.
     - Async coroutines (``_async_search`` / ``_async_detail`` /
       ``_async_comments``) with monkeypatched browser session
       and mocked page locators. ``_persist_content`` and
       ``_persist_comment`` are mocked to avoid DB dependency.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


# ──────────────────────────────────────────────────────────────────────
# Section 1: Selector helpers (pure Python)
# ──────────────────────────────────────────────────────────────────────


class TestSelectors:
    """``crawler.platforms.weibo.selectors`` pure-Python helpers."""

    # ── mid_from_url ─────────────────────────────────────────────────

    def test_mid_from_detail_url(self) -> None:
        from crawler.platforms.weibo.selectors import mid_from_url
        assert mid_from_url("/detail/5049871234567890") == "5049871234567890"

    def test_mid_from_weibo_com_url(self) -> None:
        from crawler.platforms.weibo.selectors import mid_from_url
        assert (
            mid_from_url("https://weibo.com/1234567890/5049871234567890")
            == "5049871234567890"
        )

    def test_mid_with_query_params(self) -> None:
        from crawler.platforms.weibo.selectors import mid_from_url
        assert (
            mid_from_url(
                "https://weibo.com/uid/5049871234567890?from=page_100505"
            )
            == "5049871234567890"
        )

    def test_mid_non_matching_path_returns_empty(self) -> None:
        from crawler.platforms.weibo.selectors import mid_from_url
        assert mid_from_url("/user/12345") == ""
        assert mid_from_url("/search?q=test") == ""

    def test_mid_empty_href_returns_empty(self) -> None:
        from crawler.platforms.weibo.selectors import mid_from_url
        assert mid_from_url("") == ""
        assert mid_from_url(None) == ""  # type: ignore[arg-type]

    def test_mid_short_url_does_not_match(self) -> None:
        from crawler.platforms.weibo.selectors import mid_from_url
        assert mid_from_url("/weibo.com/abc") == ""

    # ── parse_count ─────────────────────────────────────────────────

    def test_parse_count_plain_number(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("1234") == 1234

    def test_parse_count_with_commas(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("1,234") == 1234
        assert parse_count("12,345") == 12345

    def test_parse_count_w_suffix(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("1.2w") == 12000
        assert parse_count("999w") == 9_990_000

    def test_parse_count_wan_suffix(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("1.2万") == 12000
        assert parse_count("100万") == 1_000_000

    def test_parse_count_yi_suffix(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("1.2亿") == 120_000_000

    def test_parse_count_plus_suffix(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("9999+") == 9999

    def test_parse_count_dash_dash(self) -> None:
        """``--`` is Weibo's no-data placeholder."""
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("--") == 0

    def test_parse_count_empty_string(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("") == 0

    def test_parse_count_garbage_string(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("not-a-number") == 0
        assert parse_count("N/A") == 0

    def test_parse_count_leading_trailing_whitespace(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("  1234  ") == 1234
        assert parse_count("  1.2w  ") == 12000

    def test_parse_count_float_string(self) -> None:
        from crawler.platforms.weibo.selectors import parse_count
        assert parse_count("3.5") == 3  # int(float("3.5")) = 3


# ──────────────────────────────────────────────────────────────────────
# Section 2: Login helpers (pure Python)
# ──────────────────────────────────────────────────────────────────────


class TestLoginHelpers:
    """``crawler.platforms.weibo.login`` pure-Python helpers."""

    def test_resolve_account_file_with_absolute_path(
        self, tmp_path: Path
    ) -> None:
        """Absolute path + .json suffix returned as-is.

        Parent directory is created if it doesn't exist.
        """
        from crawler.platforms.weibo.login import resolve_account_file
        abs_path = str(tmp_path / "custom" / "path" / "cookies.json")
        result = resolve_account_file(abs_path)
        assert result == abs_path
        assert Path(abs_path).parent.exists()

    def test_resolve_account_file_relative_name(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Account name constructs ``cookies/weibo_{name}.json`` under BASE_DIR."""
        from crawler.platforms.weibo.login import resolve_account_file

        # ``resolve_account_file`` reads ``conf.BASE_DIR`` via ``from conf import BASE_DIR``
        monkeypatch.setattr("conf.BASE_DIR", str(tmp_path))
        result = resolve_account_file("test_user")
        expected = str(tmp_path / "cookies" / "weibo_test_user.json")
        assert result == expected
        assert (tmp_path / "cookies").exists()


# ──────────────────────────────────────────────────────────────────────
# Section 3: WeiboCrawler construction + guards (no browser)
# ──────────────────────────────────────────────────────────────────────


class TestWeiboCrawlerConstruction:
    def test_platform_id_is_wb(self) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        assert WeiboCrawler.platform_id == "wb"

    def test_constructor_sets_account_file(self) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        c = WeiboCrawler(account_file="/tmp/fake.json", headless=True)
        assert c._account_file == "/tmp/fake.json"
        assert c._headless is True

    def test_constructor_defaults(self) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        c = WeiboCrawler()
        assert c._account_file is None
        assert c._headless is True
        assert c._proxy_url is None
        assert c._store is not None


class TestValidateCookie:
    def test_no_account_file_logs_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        c = WeiboCrawler(account_file=None)
        with caplog.at_level("WARNING", logger="crawler.platforms.weibo.core"):
            c._validate_cookie()
        assert "account_file=None" in caplog.text

    def test_invalid_cookie_raises_runtime_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        monkeypatch.setattr(
            "crawler.platforms.weibo.core.weibo_cookie_check",
            AsyncMock(return_value=False),
        )
        c = WeiboCrawler(account_file="/tmp/fake.json")
        with pytest.raises(RuntimeError, match="missing or expired"):
            c._validate_cookie()

    def test_valid_cookie_passes_silently(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        monkeypatch.setattr(
            "crawler.platforms.weibo.core.weibo_cookie_check",
            AsyncMock(return_value=True),
        )
        c = WeiboCrawler(account_file="/tmp/fake.json")
        c._validate_cookie()


class TestSearchGuard:
    def test_empty_keyword_returns_empty_list(self) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        c = WeiboCrawler()
        assert c.search("") == []
        assert c.search("   ") == []
        assert c.search(None) == []  # type: ignore[arg-type]

    def test_max_count_hardcapped_at_100(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.weibo.core.weibo_cookie_check",
            AsyncMock(return_value=True),
        )
        c = WeiboCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_search", _fake_async_search)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.search("test", max_count=999)
        assert captured == [100]

    def test_max_count_minimum_is_1(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.weibo.core.weibo_cookie_check",
            AsyncMock(return_value=True),
        )
        c = WeiboCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_search", _fake_async_search)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.search("test", max_count=0)
        assert captured == [1]

    def test_whitespace_keyword_trimmed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        captured: list[str] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(keyword)
            return []

        monkeypatch.setattr(
            "crawler.platforms.weibo.core.weibo_cookie_check",
            AsyncMock(return_value=True),
        )
        c = WeiboCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_search", _fake_async_search)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.search("  hello  ", max_count=5)
        assert captured == ["hello"]


class TestDetailGuard:
    def test_empty_post_id_returns_none(self) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        c = WeiboCrawler()
        assert c.detail("") is None
        assert c.detail("   ") is None
        assert c.detail(None) is None  # type: ignore[arg-type]


class TestCommentsGuard:
    def test_empty_post_id_returns_empty_list(self) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        c = WeiboCrawler()
        assert c.comments("") == []
        assert c.comments("   ") == []
        assert c.comments(None) == []  # type: ignore[arg-type]

    def test_max_count_capped_at_base_config(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler
        from crawler.config import BASE_CONFIG

        captured: list[int] = []

        async def _fake_async_comments(post_id, *, max_count):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.weibo.core.weibo_cookie_check",
            AsyncMock(return_value=True),
        )
        c = WeiboCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_comments", _fake_async_comments)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.comments("mid1", max_count=9999)
        assert captured == [BASE_CONFIG.max_comments]


# ──────────────────────────────────────────────────────────────────────
# Section 4: Async methods with mock browser (no PG dependency)
# ──────────────────────────────────────────────────────────────────────


class TestAsyncSearchWithMockBrowser:
    """``_async_search`` with monkeypatched ``_open_browser_session``.

    ``_persist_content`` is mocked to avoid any DB dependency.
    """

    @staticmethod
    def _page_with_cards() -> MagicMock:
        """Build a ``page`` MagicMock with 3 search result cards.

        Cards 0/1 well-formed, card 2 has empty href (not skipped
        by per-card isolation — empty href doesn't raise).
        """
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()

        def _card(title: str, author: str, reply_cnt: str, href: str) -> MagicMock:
            card = MagicMock()
            m: dict[str, MagicMock] = {}

            def _loc(text: str) -> MagicMock:
                el = MagicMock()
                el.inner_text = AsyncMock(return_value=text)
                loc = MagicMock()
                loc.first = el
                return loc

            # Weibo search result link: ``a[href*='/detail/'], a[href*='weibo.com/']``
            link_el = MagicMock()
            link_el.get_attribute = AsyncMock(return_value=href)
            link_loc = MagicMock()
            link_loc.first = link_el
            m["a[href*='/detail/'], a[href*='weibo.com/']"] = link_loc

            # Title: ``[class*='title'], [class*='Title'], [class*='text']``
            m["[class*='title'], [class*='Title'], [class*='text']"] = _loc(title)
            # Author: ``[class*='name'], [class*='username'], [class*='author']``
            m["[class*='name'], [class*='username'], [class*='author']"] = _loc(author)
            # Reply count: ``[class*='reply'], [class*='comment'], [class*='act']``
            m["[class*='reply'], [class*='comment'], [class*='act']"] = _loc(reply_cnt)

            card.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            return card

        cards = [
            _card("今日热点新闻", "新闻记者", "1.2w", "/detail/5049871234567890"),
            _card("科技前沿资讯", "科技博主", "5,678", "https://weibo.com/uid/5049871234567891"),
            _card("美食分享", "美食达人", "999+", ""),  # empty href → post_id=""
        ]
        loc = MagicMock()
        loc.count = AsyncMock(return_value=len(cards))
        loc.nth.side_effect = lambda i: cards[i]
        page.locator.return_value = loc
        return page

    def test_async_search_returns_parsed_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        page = self._page_with_cards()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))

        rows = asyncio.run(c._async_search("热点", max_count=10, page_num=1))
        # 3 cards found; card 2 has empty href so post_id="" but the row
        # is still emitted (empty href doesn't raise an exception).
        assert len(rows) == 3
        assert rows[0]["post_id"] == "5049871234567890"
        assert rows[0]["title"] == "今日热点新闻"
        assert rows[0]["user"] == "新闻记者"
        assert rows[0]["liked_count"] == 12000
        assert rows[1]["post_id"] == "5049871234567891"
        assert rows[1]["liked_count"] == 5678
        assert rows[2]["post_id"] == ""  # malformed card: empty href
        assert rows[2]["title"] == "美食分享"

    def test_async_search_empty_page_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()
        loc = MagicMock()
        loc.count = AsyncMock(return_value=0)
        page.locator.return_value = loc

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("empty", max_count=10, page_num=1))
        assert rows == []

    def test_async_search_selector_timeout_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock(
            side_effect=Exception("timeout: element not found")
        )

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("timeout", max_count=10, page_num=1))
        assert rows == []


class TestAsyncDetailWithMockBrowser:
    """``_async_detail`` with monkeypatched browser session.

    ``_persist_content`` is mocked to avoid DB writes.

    Note: Weibo's ``_async_detail`` uses ``s.weibo.com/detail/{mid}``
    and scrapes the first ``SEARCH_RESULT_CARD`` (same selectors as search).
    """

    def _detail_page(self) -> MagicMock:
        """Build a page mock for ``s.weibo.com/detail/{mid}``.

        Weibo's ``_async_detail`` does:
            page.locator(SEARCH_RESULT_CARD).first → card
            card.locator(TITLE).first.inner_text()  → title

        So the mock must return a card object from ``.first``,
        and the card has its own ``.locator()`` method.
        """
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()

        card = MagicMock()

        def _loc(text: str) -> MagicMock:
            el = MagicMock()
            el.inner_text = AsyncMock(return_value=text)
            loc = MagicMock()
            loc.first = el
            return loc

        card.locator.side_effect = lambda sel: {
            "[class*='title'], [class*='Title'], [class*='text']": _loc("今日热点新闻"),
            "[class*='name'], [class*='username'], [class*='author']": _loc("新闻记者"),
            "[class*='reply'], [class*='comment'], [class*='act']": _loc("1.2万"),
        }.get(sel, _loc(""))

        # page.locator(SEARCH_RESULT_CARD) returns a locator;
        # .first on that locator returns the card
        page_loc = MagicMock()
        page_loc.first = card
        page.locator.return_value = page_loc
        return page

    def test_async_detail_returns_parsed_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        page = self._detail_page()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("5049871234567890"))
        assert row is not None
        assert row["post_id"] == "5049871234567890"
        assert row["title"] == "今日热点新闻"
        assert row["user"] == "新闻记者"
        assert row["liked_count"] == 12000

    def test_async_detail_field_extraction_failure_still_returns_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If a single field's extraction fails, other fields still populate."""
        from crawler.platforms.weibo.core import WeiboCrawler

        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()

        ok_el = MagicMock()
        ok_el.inner_text = AsyncMock(return_value="仅标题")
        ok_loc = MagicMock()
        ok_loc.first = ok_el

        fail_el = MagicMock()
        fail_el.inner_text = AsyncMock(side_effect=Exception("extraction failed"))
        fail_loc = MagicMock()
        fail_loc.first = fail_el

        card = MagicMock()
        # Only selectors containing "title" succeed
        card.locator.side_effect = lambda sel: ok_loc if "title" in sel else fail_loc

        # page.locator(SEARCH_RESULT_CARD) returns a locator;
        # .first on that locator returns the card
        page_loc = MagicMock()
        page_loc.first = card
        page.locator.return_value = page_loc

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("5049871234567890"))
        assert row is not None
        assert row["title"] == "仅标题"
        assert row["user"] == ""
        assert row["liked_count"] == 0

    def test_async_detail_selector_timeout_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock(
            side_effect=Exception("timeout")
        )

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("missing"))
        assert row is None


class TestAsyncCommentsWithMockBrowser:
    """``_async_comments`` with monkeypatched browser session.

    ``_persist_comment`` is mocked to avoid DB writes.

    Note: Weibo's ``_async_comments`` uses ``s.weibo.com/detail/{mid}``
    and parses subsequent SEARCH_RESULT_CARD elements as comments
    (skipping the first card which is the main content).
    """

    @staticmethod
    def _page_with_cards(total_cards: int) -> MagicMock:
        """Build a page with ``total_cards`` search result cards.

        Card[0] = main content (skipped). Cards[1..] = comments.
        """
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()
        page.evaluate = AsyncMock()

        # Build cards — first one is main content, rest are comments
        cards = []
        for i in range(total_cards):
            card = MagicMock()
            m: dict[str, MagicMock] = {}

            def _loc(text: str) -> MagicMock:
                el = MagicMock()
                el.inner_text = AsyncMock(return_value=text)
                loc = MagicMock()
                loc.first = el
                return loc

            if i == 0:
                # Main content card
                m["[class*='title'], [class*='Title'], [class*='text']"] = _loc("主内容")
                m["[class*='name'], [class*='username'], [class*='author']"] = _loc("作者")
            else:
                # Comment card
                m["[class*='title'], [class*='Title'], [class*='text']"] = _loc(f"评论内容 {i}")
                m["[class*='name'], [class*='username'], [class*='author']"] = _loc(f"用户{i}")

            card.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            cards.append(card)

        cards_loc = MagicMock()
        cards_loc.count = AsyncMock(return_value=len(cards))
        cards_loc.nth.side_effect = lambda i: cards[i]
        page.locator.return_value = cards_loc
        return page

    def test_async_comments_returns_parsed_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        page = self._page_with_cards(4)  # 1 main + 3 comments

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("5049871234567890", max_count=10))
        assert len(rows) == 3  # 4 total - 1 main = 3 comments
        assert rows[0]["text"] == "评论内容 1"
        assert rows[0]["user"] == "用户1"
        assert rows[0]["post_id"] == "5049871234567890"
        assert rows[1]["text"] == "评论内容 2"
        assert rows[1]["user"] == "用户2"
        assert rows[2]["text"] == "评论内容 3"

    def test_async_comments_respects_max_count(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.weibo.core import WeiboCrawler

        page = self._page_with_cards(10)  # 1 main + 9 comments

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("mid1", max_count=3))
        assert len(rows) == 3  # limited by max_count

    def test_async_comments_only_main_card_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Only the main content card exists (no comment cards)."""
        from crawler.platforms.weibo.core import WeiboCrawler

        page = self._page_with_cards(1)  # only main card

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = WeiboCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("mid1", max_count=10))
        assert rows == []  # skip main card, no comments left
