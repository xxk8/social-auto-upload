"""Tests for the Tieba (百度贴吧) crawler — selectors + mock-based core tests.

Coverage:

  1. **Selector helpers** (pure Python — no browser, no PG):
     - ``thread_id_from_url`` — extraction from ``/p/<digits>`` URLs.
     - ``parse_count`` — w/万/亿/--/numbers/empty/garbage.

  2. **Login module** (pure Python):
     - ``resolve_account_file`` — absolute path, relative name.

  3. **TiebaCrawler mock-based** (no Playwright browser, no PG):
     - Constructor wiring (platform_id, store, headless).
     - ``_validate_cookie`` — cookie freshness guard.
     - ``search`` / ``detail`` / ``comments`` — empty-keyword guard,
       max_count hardcapping.
     - Async coroutines (``_async_search`` / ``_async_detail`` /
       ``_async_comments``) with monkeypatched browser session
       and mocked page locators.
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
    """``crawler.platforms.tieba.selectors`` pure-Python helpers."""

    # ── thread_id_from_url ─────────────────────────────────────────

    def test_thread_id_from_standard_url(self) -> None:
        from crawler.platforms.tieba.selectors import thread_id_from_url
        assert thread_id_from_url("/p/9876543210") == "9876543210"

    def test_thread_id_from_zero(self) -> None:
        from crawler.platforms.tieba.selectors import thread_id_from_url
        assert thread_id_from_url("/p/0") == "0"

    def test_thread_id_with_query_params(self) -> None:
        from crawler.platforms.tieba.selectors import thread_id_from_url
        assert (
            thread_id_from_url("/p/1234567890?pn=2&ie=utf-8")
            == "1234567890"
        )

    def test_thread_id_non_matching_path_returns_empty(self) -> None:
        from crawler.platforms.tieba.selectors import thread_id_from_url
        assert thread_id_from_url("/other/12345") == ""

    def test_thread_id_empty_href_returns_empty(self) -> None:
        from crawler.platforms.tieba.selectors import thread_id_from_url
        assert thread_id_from_url("") == ""
        assert thread_id_from_url(None) == ""  # type: ignore[arg-type]

    def test_thread_id_search_url_does_not_match(self) -> None:
        from crawler.platforms.tieba.selectors import thread_id_from_url
        assert thread_id_from_url("/f?kw=美食") == ""

    # ── parse_count ─────────────────────────────────────────────────

    def test_parse_count_plain_number(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("1234") == 1234

    def test_parse_count_with_commas(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("1,234") == 1234
        assert parse_count("12,345") == 12345

    def test_parse_count_w_suffix(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("1.2w") == 12000
        assert parse_count("999w") == 9_990_000

    def test_parse_count_wan_suffix(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("1.2万") == 12000
        assert parse_count("100万") == 1_000_000

    def test_parse_count_yi_suffix(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("1.2亿") == 120_000_000

    def test_parse_count_plus_suffix(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("9999+") == 9999

    def test_parse_count_dash_dash(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("--") == 0

    def test_parse_count_empty_string(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("") == 0

    def test_parse_count_garbage_string(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("not-a-number") == 0
        assert parse_count("N/A") == 0

    def test_parse_count_leading_trailing_whitespace(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("  1234  ") == 1234
        assert parse_count("  1.2w  ") == 12000

    def test_parse_count_float_string(self) -> None:
        from crawler.platforms.tieba.selectors import parse_count
        assert parse_count("3.5") == 3


# ──────────────────────────────────────────────────────────────────────
# Section 2: Login helpers (pure Python)
# ──────────────────────────────────────────────────────────────────────


class TestLoginHelpers:
    """``crawler.platforms.tieba.login`` pure-Python helpers."""

    def test_resolve_account_file_with_absolute_path(
        self, tmp_path: Path
    ) -> None:
        from crawler.platforms.tieba.login import resolve_account_file
        abs_path = str(tmp_path / "custom" / "path" / "cookies.json")
        result = resolve_account_file(abs_path)
        assert result == abs_path
        assert Path(abs_path).parent.exists()

    def test_resolve_account_file_relative_name(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        from crawler.platforms.tieba.login import resolve_account_file
        monkeypatch.setattr("conf.BASE_DIR", str(tmp_path))
        result = resolve_account_file("test_user")
        expected = str(tmp_path / "cookies" / "tieba_test_user.json")
        assert result == expected
        assert (tmp_path / "cookies").exists()


# ──────────────────────────────────────────────────────────────────────
# Section 3: TiebaCrawler construction + guards (no browser)
# ──────────────────────────────────────────────────────────────────────


class TestTiebaCrawlerConstruction:
    def test_platform_id_is_tieba(self) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        assert TiebaCrawler.platform_id == "tieba"

    def test_constructor_sets_account_file(self) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        c = TiebaCrawler(account_file="/tmp/fake.json", headless=True)
        assert c._account_file == "/tmp/fake.json"
        assert c._headless is True

    def test_constructor_defaults(self) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        c = TiebaCrawler()
        assert c._account_file is None
        assert c._headless is True
        assert c._proxy_url is None
        assert c._store is not None


class TestValidateCookie:
    def test_no_account_file_logs_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        c = TiebaCrawler(account_file=None)
        with caplog.at_level("WARNING", logger="crawler.platforms.tieba.core"):
            c._validate_cookie()
        assert "account_file=None" in caplog.text

    def test_invalid_cookie_raises_runtime_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        monkeypatch.setattr(
            "crawler.platforms.tieba.core.tieba_cookie_check",
            AsyncMock(return_value=False),
        )
        c = TiebaCrawler(account_file="/tmp/fake.json")
        with pytest.raises(RuntimeError, match="missing or expired"):
            c._validate_cookie()

    def test_valid_cookie_passes_silently(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        monkeypatch.setattr(
            "crawler.platforms.tieba.core.tieba_cookie_check",
            AsyncMock(return_value=True),
        )
        c = TiebaCrawler(account_file="/tmp/fake.json")
        c._validate_cookie()


class TestSearchGuard:
    def test_empty_keyword_returns_empty_list(self) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        c = TiebaCrawler()
        assert c.search("") == []
        assert c.search("   ") == []
        assert c.search(None) == []  # type: ignore[arg-type]

    def test_max_count_hardcapped_at_100(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler

        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.tieba.core.tieba_cookie_check",
            AsyncMock(return_value=True),
        )
        c = TiebaCrawler(account_file="/tmp/fake.json")
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
        from crawler.platforms.tieba.core import TiebaCrawler
        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.tieba.core.tieba_cookie_check",
            AsyncMock(return_value=True),
        )
        c = TiebaCrawler(account_file="/tmp/fake.json")
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
        from crawler.platforms.tieba.core import TiebaCrawler
        captured: list[str] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(keyword)
            return []

        monkeypatch.setattr(
            "crawler.platforms.tieba.core.tieba_cookie_check",
            AsyncMock(return_value=True),
        )
        c = TiebaCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_search", _fake_async_search)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.search("  hello  ", max_count=5)
        assert captured == ["hello"]


class TestDetailGuard:
    def test_empty_post_id_returns_none(self) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        c = TiebaCrawler()
        assert c.detail("") is None
        assert c.detail("   ") is None
        assert c.detail(None) is None  # type: ignore[arg-type]


class TestCommentsGuard:
    def test_empty_post_id_returns_empty_list(self) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        c = TiebaCrawler()
        assert c.comments("") == []
        assert c.comments("   ") == []
        assert c.comments(None) == []  # type: ignore[arg-type]

    def test_max_count_capped_at_base_config(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        from crawler.config import BASE_CONFIG
        captured: list[int] = []

        async def _fake_async_comments(post_id, *, max_count):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.tieba.core.tieba_cookie_check",
            AsyncMock(return_value=True),
        )
        c = TiebaCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_comments", _fake_async_comments)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.comments("tid1", max_count=9999)
        assert captured == [BASE_CONFIG.max_comments]


# ──────────────────────────────────────────────────────────────────────
# Section 4: Async methods with mock browser (no PG dependency)
# ──────────────────────────────────────────────────────────────────────


class TestAsyncSearchWithMockBrowser:
    @staticmethod
    def _page_with_cards() -> MagicMock:
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()

        def _card(title: str, author: str, reply: str, href: str) -> MagicMock:
            card = MagicMock()
            m: dict[str, MagicMock] = {}

            def _loc(text: str) -> MagicMock:
                el = MagicMock()
                el.inner_text = AsyncMock(return_value=text)
                loc = MagicMock()
                loc.first = el
                return loc

            link_el = MagicMock()
            link_el.get_attribute = AsyncMock(return_value=href)
            link_loc = MagicMock()
            link_loc.first = link_el
            m["a[href*='/p/']"] = link_loc

            # NOTE: TiebaCrawlSelectors has a naming collision — THREAD_TITLE
            # is defined under both FORUM and DETAIL sections. The detail
            # definition shadows the forum one. This mock matches the
            # actual runtime value of THREAD_TITLE (detail version).
            m[".core_title, [class*='core-title'], [class*='thread-title'], h1[class*='title'], h3[class*='title']"] = _loc(title)
            m["span.frs-author-name, a[class*='author'], [class*='threadlist_author'], [class*='author-name']"] = _loc(author)
            m["span.threadlist_rep_num, [class*='reply-num'], [class*='reply_count'], [class*='rep-count']"] = _loc(reply)

            card.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            return card

        cards = [
            _card("美食推荐", "美食博主", "1.2w", "/p/1234567890"),
            _card("旅游攻略", "旅行家小明", "5,678", "/p/1234567891"),
            _card("摄影技巧", "摄影师王", "999+", ""),
        ]
        loc = MagicMock()
        loc.count = AsyncMock(return_value=len(cards))
        loc.nth.side_effect = lambda i: cards[i]
        page.locator.return_value = loc
        return page

    def test_async_search_returns_parsed_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        page = self._page_with_cards()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("美食", max_count=10, page_num=1))
        assert len(rows) == 3
        assert rows[0]["post_id"] == "1234567890"
        assert rows[0]["title"] == "美食推荐"
        assert rows[0]["user"] == "美食博主"
        assert rows[0]["liked_count"] == 12000
        assert rows[1]["liked_count"] == 5678
        assert rows[2]["post_id"] == ""

    def test_async_search_empty_page_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
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

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("empty", max_count=10, page_num=1))
        assert rows == []

    def test_async_search_selector_timeout_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
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

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("timeout", max_count=10, page_num=1))
        assert rows == []


class TestAsyncDetailWithMockBrowser:
    def _detail_page(self) -> MagicMock:
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()

        def _loc(text: str) -> MagicMock:
            el = MagicMock()
            el.inner_text = AsyncMock(return_value=text)
            loc = MagicMock()
            loc.first = el
            return loc

        page.locator.side_effect = lambda sel: {
            ".core_title, [class*='core-title'], [class*='thread-title'], h1[class*='title'], h3[class*='title']": _loc("精华帖标题"),
            "div.p_content, div.d_post_content, [class*='post_content'], [class*='post-content'], [class*='d_post']": _loc("这是帖子正文内容。"),
            "a.p_author_name, [class*='author-name'], [class*='poster-name'], a[class*='username']": _loc("楼主"),
            "span.p_date, [class*='post-date'], [class*='date_']": _loc("2026-01-15"),
        }.get(sel, _loc(""))
        return page

    def test_async_detail_returns_parsed_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        page = self._detail_page()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("1234567890"))
        assert row is not None
        assert row["post_id"] == "1234567890"
        assert row["title"] == "精华帖标题"
        assert row["content"] == "这是帖子正文内容。"
        assert row["user"] == "楼主"
        assert row["post_time"] == "2026-01-15"
        assert row["liked_count"] == 0  # tieba detail has no like count

    def test_async_detail_field_extraction_failure_still_returns_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
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

        page.locator.side_effect = lambda sel: ok_loc if "title" in sel else fail_loc

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("1234567890"))
        assert row is not None
        assert row["title"] == "仅标题"
        assert row["content"] == ""
        assert row["user"] == ""

    def test_async_detail_selector_timeout_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
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

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("missing"))
        assert row is None


class TestAsyncCommentsWithMockBrowser:
    @staticmethod
    def _page_with_replies(count: int) -> MagicMock:
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()
        page.evaluate = AsyncMock()

        items = []
        for i in range(count):
            item = MagicMock()
            m: dict[str, MagicMock] = {}

            def _loc(text: str) -> MagicMock:
                el = MagicMock()
                el.inner_text = AsyncMock(return_value=text)
                loc = MagicMock()
                loc.first = el
                return loc

            m["div.d_post_content, [class*='post-content'], [class*='post_content'], div.p_content"] = _loc(f"回复内容 {i}")
            m["a.p_author_name, [class*='author-name'], [class*='poster-name']"] = _loc(f"用户{i}")
            m["span.floor_num, [class*='floor'], a[class*='floor']"] = _loc(f"{i + 2}楼")

            item.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            items.append(item)

        replies_loc = MagicMock()
        replies_loc.count = AsyncMock(return_value=len(items))
        replies_loc.nth.side_effect = lambda i: items[i]
        page.locator.return_value = replies_loc
        return page

    def test_async_comments_returns_parsed_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        page = self._page_with_replies(3)

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("1234567890", max_count=10))
        assert len(rows) == 3
        assert rows[0]["text"] == "回复内容 0"
        assert rows[0]["user"] == "用户0"
        assert rows[0]["post_id"] == "1234567890"
        assert rows[1]["text"] == "回复内容 1"
        assert rows[1]["user"] == "用户1"

    def test_async_comments_respects_max_count(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        page = self._page_with_replies(10)

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("tid1", max_count=3))
        assert len(rows) == 3

    def test_async_comments_container_timeout_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.tieba.core import TiebaCrawler
        page = MagicMock()
        page.goto = AsyncMock()
        page.evaluate = AsyncMock()
        page.wait_for_selector = AsyncMock(
            side_effect=Exception("timeout: replies not found")
        )

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = TiebaCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("tid1", max_count=10))
        assert rows == []
