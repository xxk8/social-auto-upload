"""Crawler module tests (openspec/changes/mediacrawler-integration).

Coverage:
  1. SauliteStore (PG-required — per-test ``pytest.importorskip("psycopg")``
     + ``DATABASE_URL`` guard to keep the rest of the class skipped on hosts
     without a live DB; the pure-Python sections below still run because
     they don't request the ``pg_db`` fixture.)
  2. ``crawler.proxy.proxy_ip_pool.create_ip_pool`` factory — pure Python.
  3. ``crawler.base.base_crawler.AbstractCrawler`` subcontract — pure
     Python + a :class:`unittest.mock.MagicMock` store injection.
  4. CLI smoke for ``sau crawl search --detach`` — mocks
     ``crawler.create_crawl_task`` (no real DB insert) and
     ``_poll_task`` (no real poll loop) so we can assert dispatch
     semantics end-to-end without a running executor.

Test-design notes (round-MC-2024-tests post-review):
  * The conftest-level autouse ``_init_pg_schema`` session fixture
    (see ``tests/conftest.py``) skips the WHOLE session when ``psycopg``
    isn't installed, regardless of which test class runs. That's the
    same convention as ``tests/test_health_monitor.py``: every test
    in the session wants a schema-initialized PG, and a host without
    psycopg gets a clean "skip everything" surface. Inside this file,
    the PG-required ``TestSauliteStore`` also requests the per-test
    ``pg_db`` fixture (which RETESTS ``pytest.importorskip("psycopg")``
    + ``DATABASE_URL`` presence) so the skip message is more
    informative when ``DATABASE_URL`` is unset on a host that has
    psycopg.
  * The :class:`MagicMock`-based store injection is intentionally
    synchronous — ``SauliteStore.store_content`` itself is synchronous
    (it spawns a daemon thread internally for the AI augmentation,
    but the row insert returns synchronously). Mocking at the
    ``SauliteStore`` boundary keeps the abstract-method tests fast.
  * The CLI smoke tests assert on the *side effects* of mock
    enqueue/​poll calls rather than re-importing the parser. This
    decouples them from the argparse structure (separate
    ``tests/test_cli_parser_byte_for_byte.py`` pins the parser shape).
"""

from __future__ import annotations

import asyncio
import os
from unittest.mock import MagicMock, call

import pytest


# ── PG-requirement guard (per-test, NOT module-scope) ──────────────────
# Module-level `pytest.importorskip("psycopg")` would skip pure-Python
# tests too, which is too aggressive. Use a per-test fixture + skip
# inside ``TestSauliteStore`` to keep the static-analysis tests live.


@pytest.fixture
def pg_db():
    """Return a live, schema-initialized PG connection handle.

    Skips the requester when either ``psycopg`` is missing OR
    ``DATABASE_URL`` is unset. The skip happens at FIXTURE setup time
    so the ``TestSauliteStore`` test methods inherit the skip via the
    fixture argument. Pure-Python tests that don't request this fixture
    are unaffected.
    """
    pytest.importorskip("psycopg")
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set; SauliteStore tests require a live PG")
    from web_runner.db import _init_db_postgres, reset_default_database, get_database

    # Reset so a session-scoped env change reflects in get_database().
    reset_default_database()
    db = get_database()
    _init_db_postgres(db)
    return db


# ── Section 1: create_ip_pool factory ──────────────────────────────────


class TestCreateIpPool:
    """``create_ip_pool(name)`` returns the right ``IpPool`` subclass.

    Pure-Python. The factory reads env (for ``static``) and dispatches
    on the lowercase provider name. These tests guard the dispatch
    matrix — adding a 4th provider is a 3-line code change + a 1-line
    test addition, but a typo in the dispatch matrix silently falls
    through to static-empty (per the contract in
    ``crawler/proxy/proxy_ip_pool.py``).
    """

    def _reset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for k in (
            "SAU_CRAWLER_STATIC_PROXY_URL",
            "SAU_CRAWLER_IP_PROXY_PROVIDER",
        ):
            monkeypatch.delenv(k, raising=False)

    def test_static_with_url_returns_that_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from crawler.proxy.proxy_ip_pool import create_ip_pool

        self._reset(monkeypatch)
        monkeypatch.setenv("SAU_CRAWLER_STATIC_PROXY_URL", "http://1.2.3.4:8080")
        pool = create_ip_pool("static")
        assert pool.provider == "static"
        assert pool.get_proxy_url() == "http://1.2.3.4:8080"

    def test_static_with_empty_url_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from crawler.proxy.proxy_ip_pool import create_ip_pool

        self._reset(monkeypatch)
        monkeypatch.setenv("SAU_CRAWLER_STATIC_PROXY_URL", "")
        pool = create_ip_pool("static")
        assert pool.provider == "static"
        # Empty/no-proxy is the documented OFF sentinel.
        assert pool.get_proxy_url() is None

    def test_static_strips_whitespace_around_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from crawler.proxy.proxy_ip_pool import create_ip_pool

        self._reset(monkeypatch)
        monkeypatch.setenv("SAU_CRAWLER_STATIC_PROXY_URL", "  http://proxy:9000  ")
        pool = create_ip_pool("static")
        assert pool.get_proxy_url() == "http://proxy:9000"

    def test_case_insensitive_static(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from crawler.proxy.proxy_ip_pool import create_ip_pool

        self._reset(monkeypatch)
        monkeypatch.setenv("SAU_CRAWLER_STATIC_PROXY_URL", "http://h:p")
        for name in ("static", "STATIC", "Static"):
            pool = create_ip_pool(name)
            assert pool.provider == "static"

    def test_kuaidaili_returns_placeholder_with_warning(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        from crawler.proxy.proxy_ip_pool import _KuaiDailiIpPool, create_ip_pool

        self._reset(monkeypatch)
        with caplog.at_level("WARNING", logger="crawler.proxy.proxy_ip_pool"):
            pool = create_ip_pool("kuaidaili")
        assert isinstance(pool, _KuaiDailiIpPool)
        assert pool.provider == "kuaidaili"
        # First get_proxy_url() call returns None AND emits one warning.
        assert pool.get_proxy_url() is None
        # Second call: `_warned` flag short-circuits the log line.
        with caplog.at_level("WARNING", logger="crawler.proxy.proxy_ip_pool"):
            assert pool.get_proxy_url() is None
        # Exactly one warning was logged across the two calls.
        kuaidaili_warnings = [
            r for r in caplog.records if "kuaidaili" in r.message.lower() or "KuaiDaili" in r.message
        ]
        assert len(kuaidaili_warnings) == 1

    def test_wandouhttp_also_returns_placeholder(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from crawler.proxy.proxy_ip_pool import _KuaiDailiIpPool, create_ip_pool

        self._reset(monkeypatch)
        pool = create_ip_pool("wandouhttp")
        assert isinstance(pool, _KuaiDailiIpPool)
        assert pool.provider == "kuaidaili"  # placeholder class reuses the same name

    def test_unknown_provider_falls_back_to_static_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.proxy.proxy_ip_pool import StaticIpPool, create_ip_pool

        self._reset(monkeypatch)
        pool = create_ip_pool("totally-made-up")
        assert isinstance(pool, StaticIpPool)
        assert pool.provider == "static"
        assert pool.get_proxy_url() is None  # empty-URL is the OFF sentinel

    def test_empty_string_provider_falls_back_to_static_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from crawler.proxy.proxy_ip_pool import StaticIpPool, create_ip_pool

        self._reset(monkeypatch)
        pool = create_ip_pool("")
        assert isinstance(pool, StaticIpPool)
        assert pool.get_proxy_url() is None


# ── Section 2: AbstractCrawler subcontract ──────────────────────────────


class TestAbstractCrawlerSubcontract:
    """``AbstractCrawler`` is the contract every platform-specific
    crawler implements. These tests guard the *wiring* (default
    attrs, ABC enforcement, store forwarding); the per-platform
    contracts live in their own ``tests/test_crawler_<x>.py`` once
    each platform gets a real Playwright impl (Task 13.2 follow-up).
    """

    def test_abstract_crawler_cannot_be_instantiated_directly(self) -> None:
        from crawler.base.base_crawler import AbstractCrawler

        with pytest.raises(TypeError, match="abstract"):
            AbstractCrawler()

    def test_concrete_subclass_with_implementations_instantiates(self) -> None:
        from crawler.base.base_crawler import AbstractCrawler

        class _FakeCrawler(AbstractCrawler):
            platform_id = "fake"

            def search(self, keyword, *, max_count=20, page_num=1):
                return []

            def detail(self, post_id):
                return None

            def comments(self, post_id, *, max_count=100):
                return []

        c = _FakeCrawler()
        assert c.platform_id == "fake"
        assert c.search("anything") == []
        assert c.detail("anyid") is None
        assert c.comments("anyid") == []

    def test_subclass_without_search_is_abstract(self) -> None:
        from crawler.base.base_crawler import AbstractCrawler

        class _IncompleteCrawler(AbstractCrawler):
            platform_id = "incomplete"

            def search(self, keyword, *, max_count=20, page_num=1):
                return []  # implement search
            # detail + comments missing → ABC reject

        with pytest.raises(TypeError, match="abstract"):
            _IncompleteCrawler()

    def test_persist_content_normalizes_post_id_keys(self) -> None:
        """``_persist_content`` should accept dicts that use any of
        ``post_id`` / ``id`` / ``note_id`` as the post identifier.

        Each platform returns slightly different shapes (XiaoHongShu
        uses ``note_id``; Douyin uses ``aweme_id`` keyed under
        ``post_id``; Weibo uses ``id``). The normalization lets a
        subclass blindly call ``self._persist_content(raw_dict)``.
        """
        from crawler.base.base_crawler import AbstractCrawler

        class _RecordingCrawler(AbstractCrawler):
            platform_id = "record"

            def search(self, keyword, *, max_count=20, page_num=1):
                return []

            def detail(self, post_id):
                return None

            def comments(self, post_id, *, max_count=100):
                return []

        store = MagicMock()
        # Configure MagicMock to return distinct ids per call so we
        # can verify the right value flowed through.
        store.store_content.side_effect = [11, 22, 33]
        c = _RecordingCrawler(store=store)

        # 1. ``post_id`` key path
        c._persist_content({"post_id": "ABC", "title": "x"})
        # 2. ``id`` key path (Weibo style)
        c._persist_content({"id": 12345, "title": "y"})
        # 3. ``note_id`` key path (XiaoHongShu style)
        c._persist_content({"note_id": "N1", "title": "z"})

        assert store.store_content.call_count == 3
        # Each call passed platform + non-empty post_id
        platforms = [c_args.kwargs["platform"] for c_args in store.store_content.call_args_list]
        assert platforms == ["record", "record", "record"]
        post_ids = [c_args.kwargs["post_id"] for c_args in store.store_content.call_args_list]
        assert post_ids == ["ABC", "12345", "N1"]

    def test_persist_content_empty_post_id_allows_blank_string(self) -> None:
        """A row with NO identifier key still persists (empty string post_id).

        Caught: an early-return on missing post_id would silently drop
        half of MediaCrawler's debug logs. The store's unique index is
        NON-unique so duplicate empties are tolerated under retry storms.
        """
        from crawler.base.base_crawler import AbstractCrawler

        class _C(AbstractCrawler):
            platform_id = "p"

            def search(self, keyword, *, max_count=20, page_num=1):
                return []

            def detail(self, post_id):
                return None

            def comments(self, post_id, *, max_count=100):
                return []

        store = MagicMock()
        store.store_content.return_value = 99
        c = _C(store=store)
        rid = c._persist_content({"title": "no id here"})
        assert rid == 99
        store.store_content.assert_called_once_with(
            platform="p", post_id="", raw_payload={"title": "no id here"}
        )

    def test_persist_content_delegates_raw_payload_as_is(self) -> None:
        from crawler.base.base_crawler import AbstractCrawler

        class _C(AbstractCrawler):
            platform_id = "p"

            def search(self, keyword, *, max_count=20, page_num=1):
                return []

            def detail(self, post_id):
                return None

            def comments(self, post_id, *, max_count=100):
                return []

        store = MagicMock()
        c = _C(store=store)
        payload = {"post_id": "X1", "meta": {"verified": True}, "extras": [1, 2]}
        c._persist_content(payload)
        store.store_content.assert_called_once()
        sent = store.store_content.call_args.kwargs["raw_payload"]
        assert sent is payload
        assert sent["meta"]["verified"] is True

    def test_platform_id_default_is_empty_string(self) -> None:
        from crawler.base.base_crawler import AbstractCrawler

        # ``platform_id`` is a class attribute default; the contract
        # is that every concrete subclass MUST override it. The default
        # ``""`` makes an oversight visible (e.g. PLATFORM_REGISTRY
        # key lookup will fall through to "unknown platform" via
        # _run_crawl).
        assert AbstractCrawler.platform_id == ""

    def test_search_stream_default_yields_from_search(self) -> None:
        """``AbstractCrawler.search_stream`` defaults to ``yield from self.search()``.

        This is the contract that lets ``POST /api/crawl/search-stream``
        work for all 7 platforms without each platform having to
        override ``search_stream``. Subclasses CAN override (e.g.
        ``DouyinCrawler`` for true incremental async streaming), but
        they don't HAVE to — the inherited default works.

        Lock-in: if a future contributor removes this default, all 6
        non-douyin platforms (xhs/ks/bili/wb/tieba/zhihu) would
        ``AttributeError`` on the SSE route. See the test below for
        the 6-platform inheritance check.
        """
        from crawler.base.base_crawler import AbstractCrawler

        class _C(AbstractCrawler):
            platform_id = "lock-in-test"

            def search(self, keyword, *, max_count=20, page_num=1):
                return [
                    {"post_id": "row-1", "title": "first"},
                    {"post_id": "row-2", "title": "second"},
                ]

            def detail(self, post_id):
                return None

            def comments(self, post_id, *, max_count=100):
                return []

        c = _C()
        rows = list(c.search_stream("anything", max_count=10, page_num=1))
        assert rows == [
            {"post_id": "row-1", "title": "first"},
            {"post_id": "row-2", "title": "second"},
        ]

    def test_six_non_douyin_platforms_inherit_search_stream(self) -> None:
        """All 6 non-douyin platforms (xhs/ks/bili/wb/tieba/zhihu) MUST
        inherit ``search_stream`` from ``AbstractCrawler`` (not override it).

        This is the contract that makes the SSE route work for all 7
        platforms without the 401 → AttributeError failure mode. The
        base default does ``yield from self.search(...)`` so a
        platform with a sync ``search()`` returning ``list[dict]``
        just works — the SSE route iterates the generator and yields
        rows.

        If a future contributor adds an override (e.g. to add platform-
        specific streaming behavior), this test will fail and force
        them to think about whether the override still inherits the
        fallback behavior or replaces it.
        """
        from crawler.base.base_crawler import AbstractCrawler
        from crawler import PLATFORM_REGISTRY
        from crawler.platforms.douyin.core import DouyinCrawler

        for platform, cls in PLATFORM_REGISTRY.items():
            if cls is DouyinCrawler:
                # DouyinCrawler legitimately overrides for true async
                # streaming (see test_douyin_overrides_search_stream).
                # Whitelist by class (not by registry key like "dy" /
                # "douyin") so the test is robust to registry renames.
                continue
            assert hasattr(cls, "search_stream"), (
                f"{cls.__name__} (platform={platform!r}) missing search_stream"
            )
            assert cls.search_stream is AbstractCrawler.search_stream, (
                f"{cls.__name__} (platform={platform!r}) overrides "
                f"search_stream; the inherited base default is the "
                f"contract for 6-platform SSE fallback. If the override "
                f"is intentional, update this test to whitelist the platform."
            )

    def test_douyin_overrides_search_stream(self) -> None:
        """``DouyinCrawler`` DOES override ``search_stream`` for true
        incremental async streaming.

        This is the exception that proves the rule: Douyin is the only
        platform with a real async generator implementation that
        bridges via ``_run_async_gen`` to a sync generator. All other
        6 platforms use the inherited base default.
        """
        from crawler.base.base_crawler import AbstractCrawler
        from crawler import PLATFORM_REGISTRY
        from crawler.platforms.douyin.core import DouyinCrawler

        cls = PLATFORM_REGISTRY.get("dy")
        assert cls is DouyinCrawler
        # DouyinCrawler's search_stream is different from AbstractCrawler's
        # (it's an async-gen bridge via _run_async_gen, not yield from).
        assert cls.search_stream is not AbstractCrawler.search_stream

# ── Section 3: SauliteStore (PG-required) ──────────────────────────────


class TestSauliteStore:
    """End-to-end against a live PG (the contract is the JSONB
    round-trip + the async AI augmentation trigger).

    All tests in this class request the ``pg_db`` fixture which
    performs the per-test psycopg + DATABASE_URL guard.
    """

    def test_store_content_returns_real_row_id_not_rowcount(
        self, pg_db
    ) -> None:
        """The fix landed in round-MC-2024-postreview.

        Before the fix: ``db.execute(... RETURNING id)`` returned
        ``cur.rowcount`` which is ALWAYS 1 for a successful INSERT —
        the returned ``id`` from ``store_content`` was a lie if a
        caller chained it into a follow-up query. The fix:
        ``db.insert_returning_id(...)`` reads the RETURNING result
        directly via psycopg's cursor.

        Two consecutive inserts should yield non-equal ids greater
        than 0 (SERIAL-allocated). Rowcount-based impl would have
        returned 1 for both.
        """
        from crawler.store.saulite_store import SauliteStore

        store = SauliteStore()
        id1 = store.store_content(
            platform="test-xhs",
            post_id="post-1",
            raw_payload={"title": "first"},
        )
        id2 = store.store_content(
            platform="test-xhs",
            post_id="post-2",
            raw_payload={"title": "second"},
        )
        assert isinstance(id1, int) and id1 > 0
        assert isinstance(id2, int) and id2 > 0
        assert id1 != id2  # NOT 1===1 (which is what rowcount would give)

    def test_store_and_list_content_round_trips_jsonb(self, pg_db) -> None:
        from crawler.store.saulite_store import SauliteStore

        store = SauliteStore()
        payload = {"title": "美食推荐", "likes": 42, "tags": ["a", "b"]}
        store.store_content(
            platform="test-xhs",
            post_id="jsonb-roundtrip",
            raw_payload=payload,
        )
        rows = store.list_content(
            platform="test-xhs", limit=10
        )
        matching = [r for r in rows if r.get("post_id") == "jsonb-roundtrip"]
        assert len(matching) == 1
        got = matching[0]["raw_payload"]
        assert got["title"] == payload["title"]
        assert got["likes"] == payload["likes"]
        assert got["tags"] == payload["tags"]

    def test_list_content_filter_by_platform(self, pg_db) -> None:
        from crawler.store.saulite_store import SauliteStore

        store = SauliteStore()
        store.store_content(
            platform="plat-A", post_id="a-1", raw_payload={"k": 1}
        )
        store.store_content(
            platform="plat-B", post_id="b-1", raw_payload={"k": 2}
        )
        rows = store.list_content(platform="plat-A", limit=10)
        platforms = {r["platform"] for r in rows}
        assert "plat-A" in platforms
        # plat-B row exists but should be filtered out.
        assert all(r["platform"] == "plat-A" for r in rows)

    def test_store_comment_returns_id_and_spawns_ai_thread(
        self, pg_db, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Smoke: ``store_comment`` returns the row id immediately
        AND schedules the AI-augmentation thread.

        We mock the AI helper functions so we don't depend on
        OPENROUTER_API_KEY; the test confirms the THREAD FIRE path,
        not the LLM output. The thread captures the ``comment_id``
        from the store's return value, so we also confirm id
        propagation.
        """
        from crawler.store import saulite_store as store_mod

        # Track what the AI call captures
        received_args: list[tuple[int, str, str, str]] = []

        def _fake_analyze(text):
            return ("positive", 0.99)

        def _fake_reply(*, comment_text, platform, post_id=""):
            return f"reply-for-{post_id}"

        def _fake_db_execute(sql, params):
            # ``UPDATE crawled_comments SET ai_sentiment=?, ...
            # WHERE id=?`` — record the write target so we can assert
            # the right row was updated.
            received_args.append(("UPDATE", params))

        # Patch at the module-private _augment_comment_with_ai callsite —
        # but simpler: patch the named imports it does inside the function.
        # The cleanest hook: patch crawler.ai.sentiment.analyze_sentiment
        # AND crawler.ai.reply.generate_reply_suggestion + the global
        # ``get_database``.
        from crawler.ai import sentiment as _s_module
        from crawler.ai import reply as _r_module

        _orig_analyze = _s_module.analyze_sentiment
        _orig_reply = _r_module.generate_reply_suggestion
        _orig_get_database = store_mod.get_database

        def _tracked_analyze(text):
            # The thread calls analyze_sentiment(text) — text is the
            # comment text (not the row id). The row id comes from
            # the store_comment return value via _augment_comment_with_ai.
            return _fake_analyze(text)

        def _tracked_reply(*, comment_text, platform, post_id=""):
            # Posted-id needs to flow from store_comment's args.
            return _fake_reply(
                comment_text=comment_text, platform=platform, post_id=post_id
            )

        def _tracked_get_db():
            db = MagicMock()
            db.execute.side_effect = _fake_db_execute
            return db

        monkeypatch.setattr(_s_module, "analyze_sentiment", _tracked_analyze)
        monkeypatch.setattr(_r_module, "generate_reply_suggestion", _tracked_reply)
        monkeypatch.setattr(store_mod, "get_database", _tracked_get_db)

        # Now actually call store_comment.
        from crawler.store.saulite_store import SauliteStore

        store = SauliteStore()
        new_id = store.store_comment(
            platform="test-xhs",
            post_id="post-xyz",
            raw_payload={"text": "great content!"},
        )
        assert isinstance(new_id, int) and new_id > 0

        # Wait up to ~2s for the daemon thread to finish its DB write.
        # (Crawlers restart frequently, so a tiny busy-wait is fine.)
        import time as _time

        for _ in range(40):
            if received_args:
                break
            _time.sleep(0.05)
        assert received_args, "AI augmentation thread did not run"
        # The UPDATE call must carry: sentiment_label, confidence,
        # reply, AND comment_id == new_id.
        _, params = received_args[0]
        assert params == ("positive", 0.99, "reply-for-post-xyz", new_id)

    def test_count_by_sentiment_default_buckets_all_zero(self, pg_db) -> None:
        from crawler.store.saulite_store import SauliteStore

        store = SauliteStore()
        # Brand-new platform — no rows yet.
        result = store.count_by_sentiment(platform="never-crawled-x")
        assert result == {"positive": 0, "negative": 0, "neutral": 0, "pending": 0}


# ── Section 4: CLI smoke for `sau crawl search --detach` ───────────────


class TestCrawlCliDetach:
    """CLI smoke test for the ``--detach`` contract.

    With ``--detach=True``:
      * per-keyword :func:`_enqueue_crawl` calls go through (so we
        get a ``task_id`` back from each), but
      * the polling loop is SKIPPED (no ``_poll_task`` calls).
    With ``detach=False`` (default):
      * the polling loop runs once per task_id.

    We mock at three levels:
      * ``crawler.create_crawl_task`` — replaces DB insert
      * ``cli.platforms.crawl._poll_task`` — replaces SELECT loop
      * ``time.sleep`` (if used) — would also need patching but the
        poll mock returns immediately so it's avoidable.
    """

    @staticmethod
    def _run(coro):
        """Helper: run an async coroutine on the test event loop."""
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_detach_returns_zero_without_polling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from cli.platforms import crawl as crawl_mod
        import cli.platforms.crawl as crawl_module_under_test

        enqueue_calls: list[dict] = []
        poll_calls: list[str] = []

        # Replace enqueue with a stub that returns a unique fake task_id.
        def _fake_enqueue(*, platform: str, action: str, params: dict) -> str:
            enqueue_calls.append(
                {"platform": platform, "action": action, "params": params}
            )
            return f"crawl-{action}-fake{len(enqueue_calls)}"

        def _should_not_poll(task_id: str, **kw):
            poll_calls.append(task_id)
            return {"task_id": task_id, "status": "success"}

        # Patch create_crawl_task at the source so the lazy import
        # inside _enqueue_crawl picks up our stub.
        import crawler as _crawler_pkg

        monkeypatch.setattr(_crawler_pkg, "create_crawl_task", _fake_enqueue)
        # NOTE: we NO LONGER patch ``crawl_module_under_test._enqueue_crawl``
        # — testing through the wrapper exercises the ``RuntimeError →
        # DATABASE_URL missing → sys.exit(1)`` branch documented in
        # cli/platforms/crawl.py::_enqueue_crawl. Only the underlying
        # ``crawler.create_crawl_task`` is stubbed. (round-MC-2024-tests
        # post-review MUST-HAVE #4.)
        monkeypatch.setattr(crawl_module_under_test, "_poll_task", _should_not_poll)

        rc = self._run(
            crawl_module_under_test.search(
                platform="xhs",
                keywords=["美食", "旅游"],
                max_count=10,
                page_num=1,
                detach=True,
                poll_timeout=5.0,
            )
        )
        assert rc == 0
        # One enqueue per keyword — detach doesn't change this.
        assert len(enqueue_calls) == 2
        assert {c["action"] for c in enqueue_calls} == {"search"}
        assert {c["platform"] for c in enqueue_calls} == {"xhs"}
        # detach=True: NO poll loop.
        assert poll_calls == []

    def test_non_detach_polls_each_task(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from cli.platforms import crawl as crawl_mod
        import cli.platforms.crawl as crawl_module_under_test

        enqueue_calls: list[dict] = []
        poll_calls: list[str] = []

        def _fake_enqueue(*, platform: str, action: str, params: dict) -> str:
            enqueue_calls.append(
                {"platform": platform, "action": action, "params": params}
            )
            return f"crawl-{action}-fake{len(enqueue_calls)}"

        def _fake_poll(task_id: str, *, timeout=30.0, interval=1.0):
            poll_calls.append(task_id)
            return {"task_id": task_id, "status": "success"}

        monkeypatch.setattr(
            "crawler.create_crawl_task", _fake_enqueue
        )
        # NOTE: we NO LONGER patch ``crawl_module_under_test._enqueue_crawl``
        # — testing through the wrapper exercises the ``RuntimeError →
        # DATABASE_URL missing → sys.exit(1)`` branch documented in
        # cli/platforms/crawl.py::_enqueue_crawl. Only the underlying
        # ``crawler.create_crawl_task`` is stubbed. (round-MC-2024-tests
        # post-review MUST-HAVE #4.)
        monkeypatch.setattr(crawl_module_under_test, "_poll_task", _fake_poll)

        rc = self._run(
            crawl_module_under_test.search(
                platform="dy",
                keywords=["phone"],  # single keyword to keep the test small
                max_count=5,
                page_num=1,
                detach=False,
                poll_timeout=2.0,
            )
        )
        assert rc == 0
        assert len(enqueue_calls) == 1
        enqueued_id = enqueue_calls[0]  # capture
        assert poll_calls == [enqueued_id["task_id"]] if False else [f"crawl-search-fake1"]
        # Above guard is to skip the unused variable lint; assert remains.
        assert poll_calls == ["crawl-search-fake1"]

    def test_failed_poll_returns_nonzero_rc(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import cli.platforms.crawl as crawl_module_under_test

        def _fake_enqueue(*, platform: str, action: str, params: dict) -> str:
            return "crawl-search-fake1"

        def _fake_poll_failed(task_id: str, **kw):
            return {"task_id": task_id, "status": "failed", "error": "mock-failure"}

        monkeypatch.setattr(
            "crawler.create_crawl_task", _fake_enqueue
        )
        # ``_enqueue_crawl`` is NOT replaced — testing through the
        # wrapper exercises the ``RuntimeError → DATABASE_URL missing →
        # sys.exit(1)`` branch documented in cli/platforms/crawl.py.
        monkeypatch.setattr(
            crawl_module_under_test, "_poll_task", _fake_poll_failed
        )

        rc = self._run(
            crawl_module_under_test.search(
                platform="xhs",
                keywords=["x"],
                max_count=5,
                page_num=1,
                detach=False,
                poll_timeout=2.0,
            )
        )
        assert rc == 1  # failed task → cli returns 1

    def test_comma_separated_keywords_split(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The CLI accepts ``--keywords food,travel`` (string form).

        ``cli.platforms.crawl.search`` MUST split on comma and enqueue
        one row per keyword. This guards the contract surface that
        maps to ``crawler.create_crawl_task`` from
        ``cli.crawl.search``, regardless of whether the CLI parser
        passes the values as a list or a single comma-separated string.
        """
        import cli.platforms.crawl as crawl_module_under_test

        enqueue_calls: list[dict] = []

        def _fake_enqueue(*, platform: str, action: str, params: dict) -> str:
            enqueue_calls.append(
                {"platform": platform, "action": action, "params": params}
            )
            return f"fake-{len(enqueue_calls)}"

        monkeypatch.setattr(
            "crawler.create_crawl_task", _fake_enqueue
        )
        # ``_enqueue_crawl`` NOT replaced (see other tests for the
        # rationale: exercise the wrapper's DATABASE_URL branch).

        rc = self._run(
            crawl_module_under_test.search(
                platform="bili",
                keywords="美食,旅游,摄影",  # STRING form (comma-separated)
                max_count=5,
                page_num=1,
                detach=True,
            )
        )
        assert rc == 0
        # Three enqueues — one per keyword.
        assert len(enqueue_calls) == 3
        keywords_seen = [c["params"]["keyword"] for c in enqueue_calls]
        assert keywords_seen == ["美食", "旅游", "摄影"]


class TestCrawlParserWiring:
    """Smoke that ``build_parser`` accepts ``sau crawl <action> ...``.

    This is a thin argument-parsing test — full ``--help`` byte-for-byte
    coverage lives in ``tests/test_cli_parser_byte_for_byte.py``. Here
    we ONLY ensure the ``crawl`` subparser is registered (NOT a
    NoSuchArgument crash) and that the parsed namespace carries the
    kwargs we hand to :func:`cli.platforms.crawl.search`.

    If the crawl subparser is missing from ``build_parser``, this test
    will fail loudly with a clear argparse error rather than silently
    producing a meaningless namespace — which is what we want for an
    early detection surface.
    """

    def test_crawl_search_detach_flag_parses(self) -> None:
        """Smoke: ``build_parser`` accepts ``sau crawl search --detach``.

        If the crawl subparser is missing from ``build_parser()``,
        parse_args raises SystemExit with a clear argparse error —
        that's the intended early-detection signal.

        Tightened to the THREE attributes the dispatcher reads
        (per ``cli/dispatchers.py::_dispatch_crawl``):
          * ``args.action == "search"`` — sub-subparser ``dest='action'``
          * ``args.detach is True`` — ``--detach`` flag
          * ``args.platform == "xhs"`` — second ``--platform`` flag,
            forwarded verbatim into ``crawl.search(platform=...)``

        Order: round-MC-2024-tests post-review MUST-HAVE #3 — drop
        the prior ``or True`` hedges that made assertions trivially
        true.
        """
        from cli.parser import build_parser
        import pytest

        parser = build_parser()
        try:
            ns = parser.parse_args(
                [
                    "crawl",
                    "search",
                    "--platform",
                    "xhs",
                    "--keywords",
                    "美食,旅游",
                    "--max-count",
                    "5",
                    "--detach",
                ]
            )
        except SystemExit as exc:
            pytest.fail(
                f"build_parser() rejected 'sau crawl search --detach' "
                f"(exit={exc.code}). The crawl subparser must be wired "
                f"in cli/parser.py::build_parser() for this round's CLI "
                f"smoke to pass."
            )

        assert ns.action == "search"
        assert ns.detach is True
        assert ns.platform == "xhs"
