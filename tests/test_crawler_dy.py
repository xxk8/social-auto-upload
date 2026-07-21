"""Tests for the Douyin (dy) crawler — selectors + mock-based core tests.

Coverage:

  1. **Selector helpers** (pure Python — no browser, no PG):
     - ``aweme_id_from_href`` — extraction from ``/video/<id>`` URLs.
     - ``parse_count`` — w/万/亿/numbers/empty/garbage.

  2. **Login module** (pure Python):
     - ``resolve_account_file`` — absolute path, relative name.

  3. **DouyinCrawler mock-based** (no Playwright browser, no PG):
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
    """``crawler.platforms.douyin.selectors`` pure-Python helpers."""

    # ── aweme_id_from_href ──────────────────────────────────────────

    def test_aweme_id_from_standard_video_url(self) -> None:
        from crawler.platforms.douyin.selectors import aweme_id_from_href
        assert aweme_id_from_href("/video/7451234567890123456") == "7451234567890123456"

    def test_aweme_id_with_query_params(self) -> None:
        from crawler.platforms.douyin.selectors import aweme_id_from_href
        assert (
            aweme_id_from_href("/video/7451234567890123456?share_token=abc")
            == "7451234567890123456"
        )

    def test_aweme_id_from_full_url(self) -> None:
        from crawler.platforms.douyin.selectors import aweme_id_from_href
        assert (
            aweme_id_from_href("https://www.douyin.com/video/7451234567890123456")
            == "7451234567890123456"
        )

    def test_aweme_id_non_video_path_returns_empty_string(self) -> None:
        from crawler.platforms.douyin.selectors import aweme_id_from_href
        assert aweme_id_from_href("/user/12345") == ""

    def test_aweme_id_empty_href_returns_empty(self) -> None:
        from crawler.platforms.douyin.selectors import aweme_id_from_href
        assert aweme_id_from_href("") == ""
        assert aweme_id_from_href(None) == ""  # type: ignore[arg-type]

    def test_aweme_id_search_url_does_not_match(self) -> None:
        from crawler.platforms.douyin.selectors import aweme_id_from_href
        assert aweme_id_from_href("/search/美食") == ""

    # ── parse_count ─────────────────────────────────────────────────

    def test_parse_count_plain_number(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("1234") == 1234

    def test_parse_count_with_commas(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("1,234") == 1234
        assert parse_count("12,345") == 12345

    def test_parse_count_w_suffix(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("1.2w") == 12000
        assert parse_count("999w") == 9_990_000

    def test_parse_count_wan_suffix(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("1.2万") == 12000
        assert parse_count("100万") == 1_000_000

    def test_parse_count_yi_suffix(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("1.2亿") == 120_000_000

    def test_parse_count_plus_suffix(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("9999+") == 9999

    def test_parse_count_empty_string(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("") == 0

    def test_parse_count_garbage_string(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("not-a-number") == 0
        assert parse_count("N/A") == 0

    def test_parse_count_leading_trailing_whitespace(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("  1234  ") == 1234
        assert parse_count("  1.2w  ") == 12000

    def test_parse_count_float_string(self) -> None:
        from crawler.platforms.douyin.selectors import parse_count
        assert parse_count("3.5") == 3  # int(float("3.5")) = 3


# ──────────────────────────────────────────────────────────────────────
# Section 2: Login helpers (pure Python)
# ──────────────────────────────────────────────────────────────────────


class TestLoginHelpers:
    """``crawler.platforms.douyin.login`` pure-Python helpers."""

    def test_resolve_account_file_with_absolute_path(
        self, tmp_path: Path
    ) -> None:
        """Absolute path + .json suffix returned as-is.

        Parent directory is created if it doesn't exist.
        """
        from crawler.platforms.douyin.login import resolve_account_file
        abs_path = str(tmp_path / "custom" / "path" / "cookies.json")
        result = resolve_account_file(abs_path)
        assert result == abs_path
        assert Path(abs_path).parent.exists()

    def test_resolve_account_file_relative_name(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Account name constructs ``cookies/douyin_{name}.json`` under BASE_DIR."""
        from crawler.platforms.douyin.login import resolve_account_file

        # ``resolve_account_file`` reads ``conf.BASE_DIR`` via ``from conf import BASE_DIR``
        monkeypatch.setattr("conf.BASE_DIR", str(tmp_path))
        result = resolve_account_file("test_user")
        expected = str(tmp_path / "cookies" / "douyin_test_user.json")
        assert result == expected
        assert (tmp_path / "cookies").exists()


# ──────────────────────────────────────────────────────────────────────
# Section 3: DouyinCrawler construction + guards (no browser)
# ──────────────────────────────────────────────────────────────────────


class TestDouyinCrawlerConstruction:
    def test_platform_id_is_dy(self) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        assert DouyinCrawler.platform_id == "dy"

    def test_constructor_sets_account_file(self) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        c = DouyinCrawler(account_file="/tmp/fake.json", headless=True)
        assert c._account_file == "/tmp/fake.json"
        assert c._headless is True

    def test_constructor_defaults(self) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        c = DouyinCrawler()
        assert c._account_file is None
        assert c._headless is True
        assert c._proxy_url is None
        assert c._store is not None


class TestValidateCookie:
    def test_no_account_file_logs_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        c = DouyinCrawler(account_file=None)
        with caplog.at_level("WARNING", logger="crawler.platforms.douyin.core"):
            c._validate_cookie()
        assert "account_file=None" in caplog.text

    def test_invalid_cookie_raises_runtime_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        monkeypatch.setattr(
            "crawler.platforms.douyin.core.dy_cookie_check",
            AsyncMock(return_value=False),
        )
        c = DouyinCrawler(account_file="/tmp/fake.json")
        with pytest.raises(RuntimeError, match="missing or expired"):
            c._validate_cookie()

    def test_valid_cookie_passes_silently(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        monkeypatch.setattr(
            "crawler.platforms.douyin.core.dy_cookie_check",
            AsyncMock(return_value=True),
        )
        c = DouyinCrawler(account_file="/tmp/fake.json")
        c._validate_cookie()


class TestSearchGuard:
    def test_empty_keyword_returns_empty_list(self) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        c = DouyinCrawler()
        assert c.search("") == []
        assert c.search("   ") == []
        assert c.search(None) == []  # type: ignore[arg-type]

    def _capture_result(self, captured: list) -> None:
        """Replace _run_async with this method to capture async method calls."""

        def _run_async_stub(self_obj, coro):
            return asyncio.run(coro)
        return _run_async_stub

    def test_max_count_hardcapped_at_100(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.douyin.core.dy_cookie_check",
            AsyncMock(return_value=True),
        )
        c = DouyinCrawler(account_file="/tmp/fake.json")
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
        from crawler.platforms.douyin.core import DouyinCrawler

        captured: list[int] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.douyin.core.dy_cookie_check",
            AsyncMock(return_value=True),
        )
        c = DouyinCrawler(account_file="/tmp/fake.json")
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
        from crawler.platforms.douyin.core import DouyinCrawler

        captured: list[str] = []

        async def _fake_async_search(keyword, *, max_count, page_num):
            captured.append(keyword)
            return []

        monkeypatch.setattr(
            "crawler.platforms.douyin.core.dy_cookie_check",
            AsyncMock(return_value=True),
        )
        c = DouyinCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_search", _fake_async_search)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.search("  hello  ", max_count=5)
        assert captured == ["hello"]


class TestDetailGuard:
    def test_empty_post_id_returns_none(self) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        c = DouyinCrawler()
        assert c.detail("") is None
        assert c.detail("   ") is None
        assert c.detail(None) is None  # type: ignore[arg-type]


class TestCommentsGuard:
    def test_empty_post_id_returns_empty_list(self) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        c = DouyinCrawler()
        assert c.comments("") == []
        assert c.comments("   ") == []
        assert c.comments(None) == []  # type: ignore[arg-type]

    def test_max_count_capped_at_base_config(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler
        from crawler.config import BASE_CONFIG

        captured: list[int] = []

        async def _fake_async_comments(post_id, *, max_count):
            captured.append(max_count)
            return []

        monkeypatch.setattr(
            "crawler.platforms.douyin.core.dy_cookie_check",
            AsyncMock(return_value=True),
        )
        c = DouyinCrawler(account_file="/tmp/fake.json")
        monkeypatch.setattr(c, "_async_comments", _fake_async_comments)
        monkeypatch.setattr(
            c, "_run_async",
            lambda coro: asyncio.run(coro),
        )
        c.comments("vid1", max_count=9999)
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

        def _card(title, author, play_count, href):
            card = MagicMock()
            m: dict[str, MagicMock] = {}

            def _loc(text):
                el = MagicMock()
                el.inner_text = AsyncMock(return_value=text)
                loc = MagicMock()
                loc.first = el
                return loc

            link_el = MagicMock()
            link_el.get_attribute = AsyncMock(return_value=href)
            link_loc = MagicMock()
            link_loc.first = link_el
            m["a[href*='/video/']"] = link_loc

            m["[class*='title'], [class*='Title'], p[class*='title']"] = _loc(title)
            m["[class*='author'], [class*='nickname'], [class*='creator-name']"] = _loc(author)
            m["[class*='play-count'], [class*='view-count'], [class*='number']"] = _loc(play_count)

            card.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            return card

        cards = [
            _card("美食推荐", "美食博主", "1.2w", "/video/7451234567890123450"),
            _card("旅游攻略", "旅行家小明", "5,678", "/video/7451234567890123451"),
            _card("摄影技巧", "摄影师王", "999+", ""),  # empty href → post_id=""
        ]
        loc = MagicMock()
        loc.count = AsyncMock(return_value=len(cards))
        loc.nth.side_effect = lambda i: cards[i]
        page.locator.return_value = loc
        return page

    def test_async_search_returns_parsed_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

        page = self._page_with_cards()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))

        rows = asyncio.run(c._async_search("美食", max_count=10, page_num=1))
        # 3 cards found; card 2 has empty href so post_id="" but the row
        # is still emitted (empty href doesn't raise an exception).
        assert len(rows) == 3
        assert rows[0]["post_id"] == "7451234567890123450"
        assert rows[0]["title"] == "美食推荐"
        assert rows[0]["user"] == "美食博主"
        assert rows[0]["liked_count"] == 12000
        assert rows[1]["post_id"] == "7451234567890123451"
        assert rows[1]["liked_count"] == 5678
        assert rows[2]["post_id"] == ""  # malformed card: empty href
        assert rows[2]["title"] == "摄影技巧"

    def test_async_search_empty_page_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

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

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("empty", max_count=10, page_num=1))
        assert rows == []

    def test_async_search_selector_timeout_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

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

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        rows = asyncio.run(c._async_search("timeout", max_count=10, page_num=1))
        assert rows == []


class TestAsyncDetailWithMockBrowser:
    """``_async_detail`` with monkeypatched browser session.

    ``_persist_content`` is mocked to avoid DB writes.
    """

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
            "[class*='video-info-title'], [class*='detail-title'], h1[class*='title']": _loc("测试视频"),
            "[class*='video-info-desc'], [class*='desc-text'], [class*='description']": _loc("这是一个测试视频的描述"),
            "[class*='author-info'], [class*='user-info'], [class*='creator-name']": _loc("测试作者"),
            "[class*='digg-count'], [class*='like-count'], [class*='action-item']:has-text('赞')": _loc("1.2w"),
        }.get(sel, _loc(""))
        return page

    def test_async_detail_returns_parsed_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

        page = self._detail_page()

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("7451234567890123450"))
        assert row is not None
        assert row["post_id"] == "7451234567890123450"
        assert row["title"] == "测试视频"
        assert row["content"] == "这是一个测试视频的描述"
        assert row["user"] == "测试作者"
        assert row["liked_count"] == 12000

    def test_async_detail_field_extraction_failure_still_returns_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If a single field's extraction fails, other fields still populate."""
        from crawler.platforms.douyin.core import DouyinCrawler

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

        # Only selectors containing "title" succeed
        page.locator.side_effect = lambda sel: ok_loc if "title" in sel else fail_loc

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("BVtest"))
        assert row is not None
        assert row["title"] == "仅标题"
        assert row["user"] == ""
        assert row["liked_count"] == 0

    def test_async_detail_selector_timeout_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

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

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_content", MagicMock(return_value=1))
        row = asyncio.run(c._async_detail("missing"))
        assert row is None


class TestAsyncCommentsWithMockBrowser:
    """``_async_comments`` with monkeypatched browser session.

    ``_persist_comment`` is mocked to avoid DB writes.
    """

    @staticmethod
    def _page_with_comments(count: int) -> MagicMock:
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_selector = AsyncMock()
        page.evaluate = AsyncMock()

        # Build comment items
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

            m["[class*='comment-text'], [class*='CommentText'], [class*='content']"] = _loc(f"评论内容 {i}")
            m["[class*='comment-author'], [class*='CommentAuthor'], [class*='user-name']"] = _loc(f"用户{i}")
            m["[class*='comment-like'], [class*='CommentDigg'], [class*='digg']"] = _loc(f"{i * 10}")

            item.locator.side_effect = lambda sel, _m=m: _m.get(sel, MagicMock())
            items.append(item)

        comments_loc = MagicMock()
        comments_loc.count = AsyncMock(return_value=len(items))
        comments_loc.nth.side_effect = lambda i: items[i]

        # Comment container — must have .first = self so the chain
        # ``page.locator(CONTAINER_SEL).first`` works correctly.
        container = MagicMock()
        container.first = container  # critical: .first returns self

        # "Show more" button (not present)
        show_more = MagicMock()
        show_more.first.count = AsyncMock(return_value=0)
        container.locator.side_effect = lambda sel: (
            show_more if "show" in sel or "load" in sel or "more" in sel
            else comments_loc
        )

        page.locator.side_effect = lambda sel: (
            container if "comment-container" in sel or "CommentContainer" in sel or "comment-list" in sel
            else comments_loc
        )
        return page

    def test_async_comments_returns_parsed_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

        page = self._page_with_comments(3)

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("7451234567890123450", max_count=10))
        assert len(rows) == 3
        assert rows[0]["text"] == "评论内容 0"
        assert rows[0]["user"] == "用户0"
        assert rows[0]["like_count"] == 0
        assert rows[0]["post_id"] == "7451234567890123450"
        assert rows[1]["text"] == "评论内容 1"
        assert rows[1]["like_count"] == 10

    def test_async_comments_respects_max_count(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

        page = self._page_with_comments(10)

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("video1", max_count=3))
        assert len(rows) == 3  # limited by max_count, not 10

    def test_async_comments_container_timeout_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.platforms.douyin.core import DouyinCrawler

        page = MagicMock()
        page.goto = AsyncMock()
        page.evaluate = AsyncMock()
        page.wait_for_selector = AsyncMock(
            side_effect=Exception("timeout: comments not found")
        )

        @asynccontextmanager
        async def _fake_browser():
            ctx = MagicMock()
            ctx.new_page = AsyncMock(return_value=page)
            yield ctx

        c = DouyinCrawler(account_file=None)
        monkeypatch.setattr(c, "_open_browser_session", _fake_browser)
        monkeypatch.setattr(c, "_persist_comment", MagicMock(return_value=1))
        rows = asyncio.run(c._async_comments("video1", max_count=10))
        assert rows == []
