"""Round-MC-2024-xhs-signing tests.

Covers:

* :class:`crawler.platforms.xhs.sign.XhsSigner` — ImportError fallback
  forcing dom-mode (thinker pitfall #2), Playwright storage_state
  cookie loading (``a1`` required), POST payload strict-JSON
  serialization (thinker pitfall #3), GET dict passthrough,
  case-insensitive header key normalization.
* :class:`crawler.config.BaseConfig.sign_mode` — env var default +
  invalid-value validation.
* :class:`crawler.platforms.xhs.core.XiaoHongShuCrawler` mode-
  branch dispatch — DOM is the default; ``sign`` is opt-in and
  CASCADE-FALLS-BACK to DOM on any sign-side exception so a
  transient xhshow bug / XHS frontend push / expired ``a1``
  cookie doesn't cost the operator their whole crawl task.

Why a dedicated file (vs. extending `tests/test_crawler.py`):
this file is pure-Python (doesn't touch the conftest's
``_init_pg_schema`` autouse fixture, since ``sign.py`` /
``base_crawler.py`` / ``crawler.config`` don't import
``web_runner/db``). When ``psycopg`` is missing locally, this
whole file stays importable + collectable, just with the
PG-requiring tests in the sibling file skipped.

Mocking strategy: ``monkeypatch`` on
``crawler.platforms.xhs.sign._HAS_XHSHOW`` flips the import
fallback path. ``unittest.mock.MagicMock`` substitutes
``crawler.platforms.xhs.sign.xhshow.Xhshow`` so the signing
shape can be inspected without an actual xhshow install.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ──────────────────────────────────────────────────────────────────────
# XhsSigner: availability fallback (thinker pitfall #2)
# ──────────────────────────────────────────────────────────────────────


class TestXhsSignerAvailability:
    def test_is_xhshow_available_returns_bool(self) -> None:
        from crawler.platforms.xhs.sign import is_xhshow_available
        assert isinstance(is_xhshow_available(), bool)

    def test_constructor_raises_runtimeerror_when_xhshow_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When xhshow isn't installed, ``XhsSigner()`` MUST raise loudly."""
        import crawler.platforms.xhs.sign as sign_mod

        monkeypatch.setattr(sign_mod, "_HAS_XHSHOW", False)
        monkeypatch.setattr(sign_mod, "_IMPORT_ERROR", ImportError("forced-missing"))

        from crawler.platforms.xhs.sign import XhsSigner

        with pytest.raises(RuntimeError, match="xhshow not installed"):
            XhsSigner()

    def test_from_cookie_storage_state_raises_runtimeerror_when_xhshow_missing(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Cookie-loading entry point also fails loudly (same dep)."""
        import crawler.platforms.xhs.sign as sign_mod

        monkeypatch.setattr(sign_mod, "_HAS_XHSHOW", False)
        monkeypatch.setattr(sign_mod, "_IMPORT_ERROR", ImportError("forced-missing"))

        cookie_path = tmp_path / "state.json"
        cookie_path.write_text(json.dumps({"cookies": [{"name": "a1", "value": "x"}]}))

        from crawler.platforms.xhs.sign import XhsSigner

        with pytest.raises(RuntimeError, match="xhshow not installed"):
            XhsSigner.from_cookie_storage_state(cookie_path)

    def test_xhshow_import_error_includes_setup_hint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Failure message must mention the operator-side fix path
        (thinker pitfall #2: don't leak raw ImportError; give the
        operator a clear ``pip install xhshow OR SAU_XHS_SIGN_MODE=dom``
        path)."""
        import crawler.platforms.xhs.sign as sign_mod

        monkeypatch.setattr(sign_mod, "_HAS_XHSHOW", False)
        monkeypatch.setattr(sign_mod, "_IMPORT_ERROR", ImportError("nope"))

        from crawler.platforms.xhs.sign import XhsSigner

        with pytest.raises(RuntimeError) as excinfo:
            XhsSigner()
        msg = str(excinfo.value)
        assert "xhsshow" not in msg  # typo guard — message must say 'xhshow'
        assert "xhshow" in msg
        assert "SAU_XHS_SIGN_MODE=dom" in msg


# ──────────────────────────────────────────────────────────────────────
# XhsSigner: cookie threading from Playwright storage_state JSON
# ──────────────────────────────────────────────────────────────────────


class TestXhsSignerCookieLoading:
    def test_from_cookie_storage_state_loads_a1(
        self, tmp_path: Path
    ) -> None:
        state = {
            "cookies": [
                {"name": "a1", "value": "test-a1"},
                {"name": "web_session", "value": "0303-test-session"},
            ],
            "origins": [],
        }
        cookie_path = tmp_path / "state.json"
        cookie_path.write_text(json.dumps(state))

        # Patch the Xhshow class so we can inspect the cookie string
        # actually threaded into it.
        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            xhshow_instance = MagicMock()
            xhshow_instance.cookie = None  # before assignment
            mock_xhshow.Xhshow.return_value = xhshow_instance

            from crawler.platforms.xhs.sign import XhsSigner

            signer = XhsSigner.from_cookie_storage_state(cookie_path)

        # Verify the cookie string format xhshow expects
        assert "a1=test-a1" in xhshow_instance.cookie
        assert "web_session=0303-test-session" in xhshow_instance.cookie
        # The xhshow format is `name=value; name=value; ...`
        assert xhshow_instance.cookie.count("; ") == 1
        assert signer.base_url == "https://www.xiaohongshu.com"

    def test_from_cookie_storage_state_missing_a1_raises(
        self, tmp_path: Path
    ) -> None:
        """``a1`` is XHS's tracking cookie; the signer NEEDS it.
        Operator must refresh via ``sau xiaohongshu login``."""
        state = {"cookies": [{"name": "web_session", "value": "x"}], "origins": []}
        cookie_path = tmp_path / "state.json"
        cookie_path.write_text(json.dumps(state))

        from crawler.platforms.xhs.sign import XhsSigner

        with pytest.raises(ValueError, match="No `a1` cookie"):
            XhsSigner.from_cookie_storage_state(cookie_path)

    def test_from_cookie_storage_state_missing_file_raises(
        self, tmp_path: Path
    ) -> None:
        from crawler.platforms.xhs.sign import XhsSigner

        with pytest.raises(FileNotFoundError):
            XhsSigner.from_cookie_storage_state(tmp_path / "missing.json")

    def test_from_cookie_storage_state_accepts_dict_or_str_cookie_value(
        self, tmp_path: Path
    ) -> None:
        """Defensive: skip cookies whose value is None / not a string
        so a malformed storage_state (e.g. PyPI httpx fixture with
        None cookie values) doesn't crash with TypeError on
        ``f"{k}={v}"``."""
        state = {
            "cookies": [
                {"name": "a1", "value": "real"},
                {"name": "expired_one", "value": None},
                {"name": "no_value_attr"},
            ],
            "origins": [],
        }
        cookie_path = tmp_path / "state.json"
        cookie_path.write_text(json.dumps(state))

        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            mock_xhshow.Xhshow.return_value = MagicMock()
            from crawler.platforms.xhs.sign import XhsSigner
            signer = XhsSigner.from_cookie_storage_state(cookie_path)
        # Confirm the bad rows were skipped and sign still proceeded
        assert "a1=real" in signer._client.cookie
        assert "expired_one" not in signer._client.cookie
        assert "no_value_attr" not in signer._client.cookie

    def test_default_base_url(self) -> None:
        """``base_url`` defaults to the consumer site (NOT creator)."""
        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            mock_xhshow.Xhshow.return_value = MagicMock()
            from crawler.platforms.xhs.sign import XhsSigner
            signer = XhsSigner()
        assert signer.base_url == "https://www.xiaohongshu.com"


# ──────────────────────────────────────────────────────────────────────
# XhsSigner.sign: payload shape (thinker pitfall #3)
# ──────────────────────────────────────────────────────────────────────


def _make_signer_with_mock(monkeypatch: pytest.MonkeyPatch) -> tuple:
    """Replace xhshow with a MagicMock so sign() can be inspected."""
    with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
        instance = MagicMock()
        instance.sign.return_value = {
            "X-s": "signed-s",
            "X-t": "1700000000",
            "X-s-common": "common-tok",
            "X-b3-traceid": "trace-id-abc",
        }
        mock_xhshow.Xhshow.return_value = instance
        from crawler.platforms.xhs.sign import XhsSigner
        signer = XhsSigner()
        return signer, instance


class TestXhsSignerSign:
    def test_post_payload_is_strict_json_no_spaces(self) -> None:
        """Thinker pitfall #3: xhshow bounds-checks the signature
        against the EXACT bytes sent. Strict-JSON = no whitespace
        + consistent separators."""
        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            inst = MagicMock()
            inst.sign.return_value = {
                "X-s": "x", "X-t": "y",
                "X-s-common": "z", "X-b3-traceid": "w",
            }
            mock_xhshow.Xhshow.return_value = inst
            from crawler.platforms.xhs.sign import XhsSigner
            signer = XhsSigner()
            signer.sign(
                uri="/api/sns/web/v1/feed",
                method="POST",
                data={"a": 1, "b": "x", "c": True},
            )
        # Inspect: the data kwarg MUST be a strict-JSON string
        sign_kwargs = inst.sign.call_args.kwargs
        payload = sign_kwargs["data"]
        assert isinstance(payload, str), (
            f"POST payload must be JSON-serialized string, got {type(payload).__name__}"
        )
        # Verify strict-format JSON (no spaces, ensure_ascii=False so
        # Chinese chars stay readable for the checksum)
        assert " " not in payload
        # Round-trip parse to confirm valid JSON
        parsed = json.loads(payload)
        assert parsed == {"a": 1, "b": "x", "c": True}

    def test_get_payload_kept_as_dict(self) -> None:
        """GET keeps the dict so xhshow URL-encodes internally."""
        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            inst = MagicMock()
            inst.sign.return_value = {
                "X-s": "x", "X-t": "y",
                "X-s-common": "z", "X-b3-traceid": "w",
            }
            mock_xhshow.Xhshow.return_value = inst
            from crawler.platforms.xhs.sign import XhsSigner
            signer = XhsSigner()
            signer.sign(uri="/api/test", method="GET", data={"a": 1, "b": 2})
        sign_kwargs = inst.sign.call_args.kwargs
        payload = sign_kwargs["data"]
        assert isinstance(payload, dict), "GET payload must remain dict"
        assert payload == {"a": 1, "b": 2}

    def test_header_keys_are_lowercase(self) -> None:
        """xhshow returns ``X-s`` etc.; we normalise to ``x-s`` so
        callers (httpx + downstream) don't have to case-fold
        themselves."""
        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            inst = MagicMock()
            inst.sign.return_value = {
                "X-s": "1", "X-t": "2",
                "X-s-common": "3", "X-b3-traceid": "4",
            }
            mock_xhshow.Xhshow.return_value = inst
            from crawler.platforms.xhs.sign import XhsSigner
            signer = XhsSigner()
            out = signer.sign(uri="/x", method="GET", data={})
        assert out == {
            "x-s": "1", "x-t": "2",
            "x-s-common": "3", "x-b3-traceid": "4",
        }

    def test_unknown_method_raises_value_error(self) -> None:
        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            mock_xhshow.Xhshow.return_value = MagicMock()
            from crawler.platforms.xhs.sign import XhsSigner
            signer = XhsSigner()
        with pytest.raises(ValueError, match="Unsupported HTTP method"):
            signer.sign(uri="/x", method="PATCH", data={})

    def test_xhshow_internal_failure_is_wrapped_as_runtime_error(self) -> None:
        with patch("crawler.platforms.xhs.sign.xhshow") as mock_xhshow:
            inst = MagicMock()
            inst.sign.side_effect = KeyError("bad-uri")
            mock_xhshow.Xhshow.return_value = inst
            from crawler.platforms.xhs.sign import XhsSigner
            signer = XhsSigner()
        with pytest.raises(RuntimeError, match="xhshow.sign failed"):
            signer.sign(uri="/x", method="GET", data={})


# ──────────────────────────────────────────────────────────────────────
# BASE_CONFIG.sign_mode
# ──────────────────────────────────────────────────────────────────────


class TestBaseConfigSignMode:
    def test_default_sign_mode_is_dom(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SAU_XHS_SIGN_MODE", raising=False)
        from crawler.config import BaseConfig
        cfg = BaseConfig()
        assert cfg.sign_mode == "dom"

    def test_explicit_sign_mode_loaded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SAU_XHS_SIGN_MODE", "sign")
        from crawler.config import BaseConfig
        cfg = BaseConfig()
        assert cfg.sign_mode == "sign"

    def test_uppercase_sign_mode_lowercased(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Operators sometimes write ``SIGN`` — accept that."""
        monkeypatch.setenv("SAU_XHS_SIGN_MODE", "SIGN")
        from crawler.config import BaseConfig
        cfg = BaseConfig()
        assert cfg.sign_mode == "sign"

    def test_empty_sign_mode_falls_back_to_dom(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SAU_XHS_SIGN_MODE", "  ")
        from crawler.config import BaseConfig
        cfg = BaseConfig()
        assert cfg.sign_mode == "dom"

    def test_invalid_sign_mode_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SAU_XHS_SIGN_MODE", "garbage")
        from crawler.config import BaseConfig
        with pytest.raises(RuntimeError, match="invalid"):
            BaseConfig()


# ──────────────────────────────────────────────────────────────────────
# XiaoHongShuCrawler: mode-branch dispatch + cascade-fall-back
# ──────────────────────────────────────────────────────────────────────


def _force_sign_mode(
    monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    """Override the module-level BASE_CONFIG so sign_mode = mode.

    We patch the dataclass instance attribute via ``object.__setattr__``
    (frozen-dataclass forbids normal ``setattr``) OR via the
    module-level singleton.
    """
    import crawler.config as cfg_module
    import dataclasses

    new = dataclasses.replace(cfg_module.BASE_CONFIG, sign_mode=mode)  # type: ignore[arg-type]
    monkeypatch.setattr(cfg_module, "BASE_CONFIG", new)


class TestSearchModeBranch:
    """``search()`` MUST dispatch on ``sign_mode`` and cascade-fall-back."""

    def _build_crawler(self):
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        return XiaoHongShuCrawler(account_file=None, headless=True)

    def test_dom_mode_calls_async_search(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _force_sign_mode(monkeypatch, "dom")
        crawler = self._build_crawler()
        # Stub ``_async_search`` and the coroutine runner so we can
        # assert the call without spinning up a Playwright browser.
        expected_rows = [{"post_id": "fake", "title": "x", "user": "u", "liked_count": 0}]
        async_search = AsyncMock(return_value=expected_rows)
        monkeypatch.setattr(crawler, "_async_search", async_search)
        async def _one_shot(coro_):
            return expected_rows
        monkeypatch.setattr(crawler, "_run_async", _one_shot)
        # Validate_cookie is fine to skip (account_file=None so it
        # returns early with a warning log).
        rows = crawler.search("keyword", max_count=10)
        async_search.assert_called_once()
        assert rows == expected_rows

    def test_sign_mode_calls_async_sign_search(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _force_sign_mode(monkeypatch, "sign")
        # Provide account_file so sign-mode gate passes
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        crawler = XiaoHongShuCrawler(account_file="/tmp/fake.json", headless=True)

        async_sign = AsyncMock(return_value=[{"post_id": "fake", "title": "x"}])
        monkeypatch.setattr(crawler, "_async_sign_search", async_sign)
        async def _one_shot(coro_):
            return await coro_
        monkeypatch.setattr(crawler, "_run_async", _one_shot)
        monkeypatch.setattr(crawler, "_validate_cookie", lambda: None)

        rows = crawler.search("keyword", max_count=10)
        async_sign.assert_called_once()
        assert rows == [{"post_id": "fake", "title": "x"}]

    def test_sign_mode_cascade_fallback_on_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If the sign path raises, ``search()`` MUST fall back to
        DOM mode for the SAME crawl task. Operator doesn't lose the
        task to a transient xhshow bug."""
        _force_sign_mode(monkeypatch, "sign")
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        crawler = XiaoHongShuCrawler(account_file="/tmp/fake.json", headless=True)

        async_sign = AsyncMock(side_effect=RuntimeError("xhshow bug"))
        monkeypatch.setattr(crawler, "_async_sign_search", async_sign)
        async_search = AsyncMock(return_value=[{"post_id": "dom-fallback"}])
        monkeypatch.setattr(crawler, "_async_search", async_search)
        async def _one_shot(coro_):
            return await coro_
        monkeypatch.setattr(crawler, "_run_async", _one_shot)
        monkeypatch.setattr(crawler, "_validate_cookie", lambda: None)

        rows = crawler.search("keyword", max_count=10)
        async_sign.assert_called_once()
        async_search.assert_called_once()
        assert rows == [{"post_id": "dom-fallback"}]

    def test_sign_mode_gated_on_account_file(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Without account_file, sign-mode MUST NOT be attempted
        (XHS rejects signed requests without ``a1``)."""
        _force_sign_mode(monkeypatch, "sign")
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        crawler = XiaoHongShuCrawler(account_file=None, headless=True)

        async_sign = AsyncMock(side_effect=RuntimeError("should not be called"))
        monkeypatch.setattr(crawler, "_async_sign_search", async_sign)
        async_search = AsyncMock(return_value=[{"post_id": "dom-only"}])
        monkeypatch.setattr(crawler, "_async_search", async_search)
        async def _one_shot(coro_):
            return await coro_
        monkeypatch.setattr(crawler, "_run_async", _one_shot)
        monkeypatch.setattr(crawler, "_validate_cookie", lambda: None)

        rows = crawler.search("keyword", max_count=10)
        async_sign.assert_not_called()
        async_search.assert_called_once()
        assert rows == [{"post_id": "dom-only"}]


class TestParseXhsSearchNote:
    """The ``_parse_xhs_search_note`` static method maps XHS API
    JSON to our row schema."""

    def test_minimal_payload(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        row = XiaoHongShuCrawler._parse_xhs_search_note({
            "note_id": "abc123",
            "title": "hello",
            "user": {"nickname": "alice"},
            "interact_info": {"liked_count": "42"},  # str-coerced to int
        })
        assert row["post_id"] == "abc123"
        assert row["title"] == "hello"
        assert row["user"] == "alice"
        assert row["liked_count"] == 42

    def test_missing_optional_fields(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        row = XiaoHongShuCrawler._parse_xhs_search_note({})
        assert row["post_id"] == ""
        assert row["title"] == ""
        assert row["user"] == ""
        assert row["liked_count"] == 0
        assert row["source_url"] == ""

    def test_malformed_liked_count_falls_back_to_zero(self) -> None:
        """Defensive: a corrupt API response shouldn't poison the row."""
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        row = XiaoHongShuCrawler._parse_xhs_search_note({
            "note_id": "x",
            "interact_info": {"liked_count": "not-a-number"},
        })
        assert row["liked_count"] == 0

    def test_source_url_present_when_note_id_set(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        row = XiaoHongShuCrawler._parse_xhs_search_note({"note_id": "abc"})
        assert row["source_url"] == "https://www.xiaohongshu.com/explore/abc"


class TestParseXhsComment:
    def test_minimal_comment_payload(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        row = XiaoHongShuCrawler._parse_xhs_comment(
            {
                "id": "c1",
                "content": "great",
                "user": {"nickname": "bob"},
                "like_count": 5,
                "sub_comment_count": 1,
            },
            "post-x",
        )
        assert row["comment_id"] == "c1"
        assert row["text"] == "great"
        assert row["user"] == "bob"
        assert row["like_count"] == 5
        assert row["sub_comment_count"] == 1
        assert row["post_id"] == "post-x"

    def test_missing_likes_falls_back_to_zero(self) -> None:
        from crawler.platforms.xhs.core import XiaoHongShuCrawler
        row = XiaoHongShuCrawler._parse_xhs_comment(
            {"id": "c", "content": "x", "user": {"nickname": "u"}},
            "post",
        )
        assert row["like_count"] == 0
        assert row["sub_comment_count"] == 0
