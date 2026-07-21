"""Tests for the Xiaohongshu (xhs) crawler — selectors + mock-based core tests.

Coverage:

  1. **Selector helpers** (pure Python — no browser, no PG):
     - ``note_id_from_url`` — extraction from ``/explore/<hex>`` URL.
     - ``parse_count`` — w/万/亿/numbers/empty/garbage.

  2. **Login module** (pure Python):
     - ``resolve_account_file`` — absolute path, relative name.

  3. **XiaoHongShuCrawler mock-based** (no Playwright browser, no PG):
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
    """``crawler.platforms.xhs.selectors`` pure-Python helpers."""

    # ── note_id_from_url ────────────────────────────────────────────

    def test_note_id_from_explore_url(self) -> None:
        from crawler.platforms.xhs.selectors import note_id_from_url
        assert note_id_from_url("/explore/abcdef1234567890") == "abcdef1234567890"

    def test_note_id_with_query_params(self) -> None:
        from crawler.platforms.xhs.selectors import note_id_from_url
        assert (
            note_id_from_url("/explore/abcdef1234567890?xsec_token=abc")
            == "abcdef1234567890"
        )

    def test_note_id_non_matching_path_returns_empty(self) -> None:
        from crawler.platforms.xhs.selectors import note_id_from_url
        assert note_id_from_url("/search_result?keyword=美食") == ""

    def test_note_id_empty_href_returns_empty(self) -> None:
        from crawler.platforms.xhs.selectors import note_id_from_url
        assert note_id_from_url("") == ""
        assert note_id_from_url(None) == ""  # type: ignore[arg-type]

    def test_note_id_short_hex_does_not_match(self) -> None:
        from crawler.platforms.xhs.selectors import note_id_from_url
        assert note_id_from_url("/explore/abc") == ""

    def test_note_id_longer_path_still_matches(self) -> None:
        from crawler.platforms.xhs.selectors import note_id_from_url
        assert (
            note_id_from_url("/explore/abcdef1234567890abcdef12")
            == "abcdef1234567890abcdef12"
        )

    # ── parse_count ─────────────────────────────────────────────────

    def test_parse_count_plain_number(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("1234") == 1234

    def test_parse_count_with_commas(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("1,234") == 1234
        assert parse_count("12,345") == 12345

    def test_parse_count_wan_suffix(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("1.2万") == 12000
        assert parse_count("100万") == 1_000_000

    def test_parse_count_yi_suffix(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("1.2亿") == 120_000_000

    def test_parse_count_plus_suffix(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("9999+") == 9999

    def test_parse_count_empty_string(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("") == 0

    def test_parse_count_garbage_string(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("not-a-number") == 0
        assert parse_count("N/A") == 0

    def test_parse_count_leading_trailing_whitespace(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("  1234  ") == 1234
        assert parse_count("  1.2万  ") == 12000

    def test_parse_count_float_string(self) -> None:
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("3.5") == 3

    def test_parse_count_wan_uppercase(self) -> None:
        """XHS uses 万 (lowercase only)."""
        from crawler.platforms.xhs.selectors import parse_count
        assert parse_count("1.2W") == 0  # uppercase W not recognized


# ──────────────────────────────────────────────────────────────────────
# Section 2: Login helpers (pure Python)
# ──────────────────────────────────────────────────────────────────────


class TestLoginHelpers:
    """``crawler.platforms.xhs.login`` pure-Python helpers."""

    def test_resolve_account_file_with_absolute_path(
        self, tmp_path: Path
    ) -> None:
        from crawler.platforms.xhs.login import resolve_account_file
        abs_path = str(tmp_path / "custom" / "path" / "cookies.json")
        result = resolve_account_file(abs_path)
        assert result == abs_path
        assert Path(abs_path).parent.exists()

    def test_resolve_account_file_relative_name(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        from crawler.platforms.xhs.login import resolve_account_file
        monkeypatch.setattr("conf.BASE_DIR", str(tmp_path))
        result = resolve_account_file("test_user")
        expected = str(tmp_path / "cookies" / "xiaohongshu_test_user.json")
        assert result == expected
        assert (tmp_path / "cookies").exists()


# ──────────────────────────────────────────────────────────────────────
# Section 3: XiaoHongShuCrawler construction + guards (no browser)
# ──────────────────────────────────────────────────────────────────────


class TestXiaohongshuCrawlerConstruction:
    def test_platform_id_is_xhs(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        assert XiaoHongShuCrawler.platform_id == "xhs"

    def test_constructor_sets_account_file(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        c = XiaoHongShuCrawler(account_file="/tmp/fake.json", headless=True)
        assert c._account_file == "/tmp/fake.json"
        assert c._headless is True

    def test_constructor_defaults(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        c = XiaoHongShuCrawler()
        assert c._account_file is None
        assert c._headless is True
        assert c._proxy_url is None
        assert c._store is not None


class TestValidateCookie:
    def test_no_account_file_logs_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        c = XiaoHongShuCrawler(account_file=None)
        with caplog.at_level("WARNING", logger="crawler.platforms.xhs.core"):
            c._validate_cookie()
        assert "account_file=None" in caplog.text

    def test_invalid_cookie_raises_runtime_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        monkeypatch.setattr(
            "crawler.platforms.xhs.core.xhs_cookie_check",
            AsyncMock(return_value=False),
        )
        c = XiaoHongShuCrawler(account_file="/tmp/fake.json")
        with pytest.raises(RuntimeError, match="missing or expired"):
            c._validate_cookie()

    def test_valid_cookie_passes_silently(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        monkeypatch.setattr(
            "crawler.platforms.xhs.core.xhs_cookie_check",
            AsyncMock(return_value=True),
        )
        c = XiaoHongShuCrawler(account_file="/tmp/fake.json")
        c._validate_cookie()


class TestSearchGuard:
    def test_empty_keyword_returns_empty_list(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        c = XiaoHongShuCrawler()
        assert c.search("") == []
        assert c.search("   ") == []
        assert c.search(None) == []  # type: ignore[arg-type]

    def test_max_count_hardcapped_at_100(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.xhs.core.xhs_cookie_check",
            AsyncMock(return_value=True),
        )
        c = XiaoHongShuCrawler(account_file="/tmp/fake.json")
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
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.xhs.core.xhs_cookie_check",
            AsyncMock(return_value=True),
        )
        c = XiaoHongShuCrawler(account_file="/tmp/fake.json")
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
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        captured: list[str] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(keyword)
            return []

        monkeypatch.setattr(
            "crawler.platforms.xhs.core.xhs_cookie_check",
            AsyncMock(return_value=True),
        )
        c = XiaoHongShuCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_search", _fake_async_search)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.search("  hello  ", max_count=5)
        assert captured == ["hello"]


class TestDetailGuard:
    def test_empty_post_id_returns_none(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        c = XiaoHongShuCrawler()
        assert c.detail("") is None
        assert c.detail("   ") is None
        assert c.detail(None) is None  # type: ignore[arg-type]


class TestCommentsGuard:
    def test_empty_post_id_returns_empty_list(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        c = XiaoHongShuCrawler()
        assert c.comments("") == []
        assert c.comments("   ") == []
        assert c.comments(None) == []  # type: ignore[arg-type]

    def test_max_count_capped_at_base_config(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        from crawler.config import BASE_CONFIG
        captured: list[int] = []

        async def _fake_async_comments(post_id, *, max_count):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.xhs.core.xhs_cookie_check",
            AsyncMock(return_value=True),
        )
        c = XiaoHongShuCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_comments", _fake_async_comments)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.comments("nid1", max_count=9999)
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

        def _card(title: str, author: str, likes: str, href: str) -> MagicMock:
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
            m["a.cover"] = link_loc
            m["span.title"] = _loc(title)
            m["span.author"] = _loc(author)
            m["span.like-count, span.interact-count"] = _loc(likes)

            card.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            return card

        cards = [
            _card("美食推荐", "美食博主", "1.2万", "/explore/abcdef1234567890"),
            _card("旅游攻略", "旅行家小明", "5,678", "/explore/abcdef1234567891"),
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
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        page = self._page_with_cards()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("美食", max_count=10, page_num=1))
        assert len(rows) == 3
        assert rows[0]["post_id"] == "abcdef1234567890"
        assert rows[0]["title"] == "美食推荐"
        assert rows[0]["user"] == "美食博主"
        assert rows[0]["liked_count"] == 12000
        assert rows[1]["liked_count"] == 5678
        assert rows[2]["post_id"] == ""

    def test_async_search_empty_page_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
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

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("empty", max_count=10, page_num=1))
        assert rows == []

    def test_async_search_selector_timeout_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
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

        c = XiaoHongShuCrawler(account_file=None)
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
            "#detail-title": _loc("笔记标题"),
            "#detail-desc": _loc("这是笔记的正文描述内容。"),
            ".author-wrapper .username": _loc("笔记作者"),
            ".interaction-info .like-wrapper .count": _loc("1.2万"),
            ".tag-container a.tag": _loc(""),  # fallback for tags (iterable)
        }.get(sel, _loc(""))

        # tags need special handling: iterable locator with count=nth
        # The code calls ``tags_locator.nth(i).inner_text()`` (NOT `.first.inner_text()`).
        tags_loc = MagicMock()
        tags_loc.count = AsyncMock(return_value=2)

        def _tag_item(text: str) -> MagicMock:
            el = MagicMock()
            el.inner_text = AsyncMock(return_value=text)
            return el

        tags_loc.nth.side_effect = lambda i: _tag_item(["美食", "教程"][i] if i < 2 else "")

        original_side = page.locator.side_effect
        def _side(sel):
            if ".tag-container a.tag" in sel:
                return tags_loc
            return original_side(sel)
        page.locator.side_effect = _side

        return page

    def test_async_detail_returns_parsed_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        page = self._detail_page()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("abcdef1234567890"))
        assert row is not None
        assert row["post_id"] == "abcdef1234567890"
        assert row["title"] == "笔记标题"
        assert row["content"] == "这是笔记的正文描述内容。"
        assert row["user"] == "笔记作者"
        assert row["liked_count"] == 12000
        assert row["tags"] == ["美食", "教程"]

    def test_async_detail_field_extraction_failure_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """XHS detail extraction is NOT per-field — a single failure returns None."""
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()

        fail_el = MagicMock()
        fail_el.inner_text = AsyncMock(side_effect=Exception("extraction failed"))
        fail_loc = MagicMock()
        fail_loc.first = fail_el

        page.locator.return_value = fail_loc

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("abcdef1234567890"))
        assert row is None

    def test_async_detail_selector_timeout_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
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

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("missing"))
        assert row is None


class TestAsyncCommentsWithMockBrowser:
    @staticmethod
    def _page_with_comments(count: int) -> MagicMock:
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

            m[".comment-content .content, .comment-content"] = _loc(f"评论内容 {i}")
            m[".comment-content .author, .comment .info .author"] = _loc(f"用户{i}")
            m[".comment-content .like-count, .comment .info .like"] = _loc(f"{i * 10}")

            item.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            items.append(item)

        comments_loc = MagicMock()
        comments_loc.count = AsyncMock(return_value=len(items))
        comments_loc.nth.side_effect = lambda i: items[i]

        container = MagicMock()
        container.first = container

        show_more = MagicMock()
        show_more_first = MagicMock()
        show_more_first.count = AsyncMock(return_value=0)
        show_more.first = show_more_first
        container.locator.side_effect = lambda sel: (
            show_more if "more" in sel or "load" in sel else comments_loc
        )

        page.locator.side_effect = lambda sel: (
            container if "comments-container" in sel or "note-comments" in sel
            else comments_loc
        )
        return page

    def test_async_comments_returns_parsed_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        page = self._page_with_comments(3)

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("abcdef1234567890", max_count=10))
        assert len(rows) == 3
        assert rows[0]["text"] == "评论内容 0"
        assert rows[0]["user"] == "用户0"
        assert rows[0]["like_count"] == 0
        assert rows[0]["post_id"] == "abcdef1234567890"
        assert rows[1]["like_count"] == 10

    def test_async_comments_respects_max_count(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        page = self._page_with_comments(10)

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("nid1", max_count=3))
        assert len(rows) == 3

    def test_async_comments_container_timeout_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock(
            side_effect=Exception("timeout: comments not found")
        )

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = XiaoHongShuCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("nid1", max_count=10))
        assert rows == []
