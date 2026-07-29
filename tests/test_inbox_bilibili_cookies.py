"""Unit tests for inbox Bilibili cookie support.

Tests cover:

* ``_is_platform_url()`` — YouTube / Bilibili URL detection
* ``_find_platform_cookie_file()`` — cookie file discovery with various formats
* ``_storage_state_to_netscape_cookies()`` — Playwright JSON → Netscape text
* ``_write_temp_cookiefile()`` — temp file creation in COOKIES_DIR
* ``_needs_auth_download()`` — auth error pattern matching
* ``inbox_download()`` — Bilibili download branch (mocked yt-dlp)
* ``_convert_biliup_cookies_to_storage_state`` integration
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import web_runner.utils as wr_utils

# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_cookies_dir(monkeypatch):
    """Swap ``COOKIES_DIR`` to an isolated temp dir for each test.

    Patches both ``wr_utils.COOKIES_DIR`` and the locally-imported
    ``web_runner.routes.inbox.COOKIES_DIR`` so helper functions like
    ``_find_platform_cookie_file`` see the temp directory.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        monkeypatch.setattr("web_runner.routes.inbox.COOKIES_DIR", tmp_path)
        monkeypatch.setattr(wr_utils, "COOKIES_DIR", tmp_path)
        yield tmp_path


# ── Test: _is_platform_url ────────────────────────────────────────────


class TestIsPlatformUrl:
    def _import(self):
        from web_runner.routes.inbox import _is_platform_url
        return _is_platform_url

    # -- YouTube --

    def test_youtube_www(self):
        fn = self._import()
        assert fn("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube") is True

    def test_youtube_short(self):
        fn = self._import()
        assert fn("https://youtu.be/dQw4w9WgXcQ", "youtube") is True

    def test_youtube_music(self):
        fn = self._import()
        assert fn("https://music.youtube.com/watch?v=xxx", "youtube") is True

    def test_youtube_mobile(self):
        fn = self._import()
        assert fn("https://m.youtube.com/watch?v=xxx", "youtube") is True

    # -- Bilibili --

    def test_bilibili_www(self):
        fn = self._import()
        assert fn("https://www.bilibili.com/video/BV1GJ411x7f7", "bilibili") is True

    def test_bilibili_short(self):
        fn = self._import()
        assert fn("https://b23.tv/abc123", "bilibili") is True

    def test_bilibili_mobile(self):
        fn = self._import()
        assert fn("https://m.bilibili.com/video/BV1xx", "bilibili") is True

    def test_bilibili_bare_domain(self):
        fn = self._import()
        assert fn("https://bilibili.com/video/BV1xx", "bilibili") is True

    # -- Negative cases --

    def test_not_youtube(self):
        fn = self._import()
        assert fn("https://vimeo.com/12345", "youtube") is False

    def test_not_bilibili(self):
        fn = self._import()
        assert fn("https://www.douyin.com/video/123", "bilibili") is False

    def test_invalid_url(self):
        fn = self._import()
        assert fn("not-a-url", "youtube") is False
        assert fn("", "bilibili") is False

    def test_unknown_platform(self):
        fn = self._import()
        assert fn("https://example.com", "nonexistent") is False

    def test_cross_platform_no_false_positive(self):
        """YouTube URL should NOT match bilibili, and vice versa."""
        fn = self._import()
        assert fn("https://www.bilibili.com/video/BV1xx", "youtube") is False
        assert fn("https://youtu.be/abc123", "bilibili") is False


# ── Test: _find_platform_cookie_file ──────────────────────────────────


class TestFindPlatformCookieFile:
    def _import(self):
        from web_runner.routes.inbox import _find_platform_cookie_file
        return _find_platform_cookie_file

    # -- No cookies dir --

    def test_no_cookies_dir(self, monkeypatch):
        fn = self._import()
        # Point COOKIES_DIR to a non-existent path
        monkeypatch.setattr(wr_utils, "COOKIES_DIR", Path("/nonexistent/cookies"))
        assert fn("bilibili_*.json") is None

    def test_empty_cookies_dir(self, _isolated_cookies_dir):
        fn = self._import()
        assert _isolated_cookies_dir.is_dir()
        assert fn("bilibili_*.json") is None

    # -- Valid cookie files --

    def test_finds_bilibili_storage_state_dict(self, _isolated_cookies_dir):
        """Bilibili cookie as storage_state dict (with cookies key)."""
        cookie = {
            "cookies": [{"name": "SESSDATA", "value": "abc123"}],
            "origins": [],
        }
        path = _isolated_cookies_dir / "bilibili_test.json"
        path.write_text(json.dumps(cookie), encoding="utf-8")

        fn = self._import()
        result = fn("bilibili_*.json")
        assert result is not None
        assert result.name == "bilibili_test.json"

    def test_finds_bilibili_raw_array(self, _isolated_cookies_dir):
        """Bilibili cookie as raw biliup array."""
        cookie = [
            {"name": "SESSDATA", "value": "abc123", "domain": ".bilibili.com"},
        ]
        path = _isolated_cookies_dir / "bilibili_test.json"
        path.write_text(json.dumps(cookie), encoding="utf-8")

        fn = self._import()
        result = fn("bilibili_*.json")
        assert result is not None
        assert result.name == "bilibili_test.json"

    def test_finds_youtube_storage_state(self, _isolated_cookies_dir):
        cookie = {
            "cookies": [{"name": "SSID", "value": "abc"}],
            "origins": [],
        }
        path = _isolated_cookies_dir / "youtube_main.json"
        path.write_text(json.dumps(cookie), encoding="utf-8")

        fn = self._import()
        result = fn("youtube_*.json")
        assert result is not None
        assert result.name == "youtube_main.json"

    # -- Invalid / unparseable files --

    def test_skips_empty_json(self, _isolated_cookies_dir):
        (_isolated_cookies_dir / "bilibili_empty.json").write_text("{}")
        fn = self._import()
        assert fn("bilibili_*.json") is None

    def test_skips_invalid_json(self, _isolated_cookies_dir):
        (_isolated_cookies_dir / "bilibili_bad.json").write_text("not json")
        fn = self._import()
        assert fn("bilibili_*.json") is None

    def test_skips_dict_without_cookies_key(self, _isolated_cookies_dir):
        cookie = {"not_cookies": [], "origins": []}
        path = _isolated_cookies_dir / "bilibili_no_cookies.json"
        path.write_text(json.dumps(cookie), encoding="utf-8")
        fn = self._import()
        assert fn("bilibili_*.json") is None

    def test_skips_empty_array(self, _isolated_cookies_dir):
        (_isolated_cookies_dir / "bilibili_empty_arr.json").write_text("[]")
        fn = self._import()
        assert fn("bilibili_*.json") is None

    # -- Sorting by mtime --

    def test_returns_newest_file(self, _isolated_cookies_dir):
        cookie = {"cookies": [{"name": "SESSDATA", "value": "abc"}]}
        old = _isolated_cookies_dir / "bilibili_old.json"
        old.write_text(json.dumps(cookie), encoding="utf-8")
        # Touch old mtime back 1 hour
        old_mtime = old.stat().st_mtime - 3600
        old.touch()

        new = _isolated_cookies_dir / "bilibili_new.json"
        cookie2 = {"cookies": [{"name": "SESSDATA", "value": "newer"}]}
        new.write_text(json.dumps(cookie2), encoding="utf-8")

        fn = self._import()
        result = fn("bilibili_*.json")
        assert result is not None
        assert result.name == "bilibili_new.json"


# ── Test wrappers: _find_youtube_cookie_file / _find_bilibili_cookie_file ─


class TestFindPlatformWrappers:
    def test_find_youtube_cookie_file(self, _isolated_cookies_dir, monkeypatch):
        cookie = {"cookies": [{"name": "SSID", "value": "x"}]}
        (_isolated_cookies_dir / "youtube_main.json").write_text(
            json.dumps(cookie), encoding="utf-8"
        )

        from web_runner.routes.inbox import _find_youtube_cookie_file
        result = _find_youtube_cookie_file()
        assert result is not None
        assert "youtube" in result.name

    def test_find_youtube_cookie_file_none(self, _isolated_cookies_dir):
        from web_runner.routes.inbox import _find_youtube_cookie_file
        assert _find_youtube_cookie_file() is None

    def test_find_bilibili_cookie_file(self, _isolated_cookies_dir):
        cookie = [{"name": "SESSDATA", "value": "x"}]
        (_isolated_cookies_dir / "bilibili_test.json").write_text(
            json.dumps(cookie), encoding="utf-8"
        )

        from web_runner.routes.inbox import _find_bilibili_cookie_file
        result = _find_bilibili_cookie_file()
        assert result is not None
        assert "bilibili" in result.name

    def test_find_bilibili_cookie_file_none(self, _isolated_cookies_dir):
        from web_runner.routes.inbox import _find_bilibili_cookie_file
        assert _find_bilibili_cookie_file() is None


# ── Test: _storage_state_to_netscape_cookies ──────────────────────────


class TestStorageStateToNetscapeCookies:
    def _import(self):
        from web_runner.routes.inbox import _storage_state_to_netscape_cookies
        return _storage_state_to_netscape_cookies

    def test_basic_conversion(self):
        fn = self._import()
        storage_state = {
            "cookies": [
                {
                    "name": "SESSDATA",
                    "value": "abc123",
                    "domain": ".bilibili.com",
                    "path": "/",
                    "expires": 1769999999,
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "Lax",
                },
            ],
            "origins": [],
        }
        result = fn(storage_state)
        lines = result.split("\n")
        assert lines[0] == "# Netscape HTTP Cookie File"
        # Cookie line: domain, includeSubdomain, path, secure, expires, name, value
        cookie_line = lines[2]
        assert ".bilibili.com" in cookie_line
        assert "TRUE" in cookie_line  # includeSubdomain (domain starts with .)
        assert "TRUE" in cookie_line  # secure
        assert "1769999999" in cookie_line
        assert "SESSDATA" in cookie_line
        assert "abc123" in cookie_line

    def test_secure_false(self):
        fn = self._import()
        storage_state = {
            "cookies": [
                {
                    "name": "TEST",
                    "value": "x",
                    "domain": "example.com",
                    "path": "/",
                    "expires": 0,
                    "secure": False,
                    "httpOnly": False,
                },
            ],
        }
        result = fn(storage_state)
        # domain without leading dot → includeSubdomain = FALSE
        # secure = FALSE
        assert "FALSE" in result  # at least for includeSubdomain
        cookies_line = result.split("\n")[2]
        parts = cookies_line.split("\t")
        assert parts[1] == "FALSE"  # includeSubdomain
        assert parts[3] == "FALSE"  # secure

    def test_empty_cookies_list(self):
        fn = self._import()
        result = fn({"cookies": [], "origins": []})
        lines = result.strip().split("\n")
        assert len(lines) == 2  # header only
        assert lines[0] == "# Netscape HTTP Cookie File"

    def test_missing_expires_defaults_to_0(self):
        fn = self._import()
        storage_state = {
            "cookies": [
                {
                    "name": "session",
                    "value": "x",
                    "domain": ".example.com",
                    "path": "/",
                    # no expires key
                },
            ],
        }
        result = fn(storage_state)
        assert "0" in result

    def test_multiple_cookies(self):
        fn = self._import()
        storage_state = {
            "cookies": [
                {"name": "a", "value": "1", "domain": ".a.com", "path": "/"},
                {"name": "b", "value": "2", "domain": ".b.com", "path": "/"},
            ],
        }
        result = fn(storage_state)
        lines = [l for l in result.split("\n") if l and not l.startswith("#")]
        assert len(lines) == 2
        assert "a" in lines[0] and "1" in lines[0]
        assert "b" in lines[1] and "2" in lines[1]

    def test_expires_none_treated_as_0(self):
        fn = self._import()
        storage_state = {
            "cookies": [
                {
                    "name": "test",
                    "value": "x",
                    "domain": ".x.com",
                    "path": "/",
                    "expires": None,
                },
            ],
        }
        result = fn(storage_state)
        assert "\t0\t" in result  # expired


# ── Test: _write_temp_cookiefile ──────────────────────────────────────


class TestWriteTempCookiefile:
    def _import(self):
        from web_runner.routes.inbox import _write_temp_cookiefile
        return _write_temp_cookiefile

    def test_writes_file_and_returns_path(self, _isolated_cookies_dir):
        fn = self._import()
        netscape_text = "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tname\tvalue"
        result = fn(netscape_text)
        assert result is not None
        assert result.parent == _isolated_cookies_dir
        assert result.suffix == ".txt"
        assert "_ytdlp_temp_" in result.name
        assert result.is_file()
        assert result.read_text(encoding="utf-8") == netscape_text

    def test_returns_none_on_write_error(self, _isolated_cookies_dir, monkeypatch):
        fn = self._import()
        monkeypatch.setattr(Path, "write_text", MagicMock(side_effect=OSError("read-only")))
        result = fn("# test")
        assert result is None

    def test_unique_filenames(self, _isolated_cookies_dir):
        fn = self._import()
        path1 = fn("# cookie 1")
        path2 = fn("# cookie 2")
        assert path1 is not None and path2 is not None
        assert path1.name != path2.name


# ── Test: _needs_auth_download ────────────────────────────────────────


class TestNeedsAuthDownload:
    def _import(self):
        from web_runner.routes.inbox import _needs_auth_download
        return _needs_auth_download

    # -- Positive matches --

    @pytest.mark.parametrize("msg", [
        "Sign in to confirm you're not a bot",
        "sign in required",
        "Login required to access this video",
        "Authentication required. Use --cookies-from-browser",
        "This video requires authentication",
        "You need to sign in",
        "Upload a cookie file: cookies are required",
        "Bot detected",
        "This is a private video",
        "age-gate: this content is age restricted",
    ])
    def test_matches_auth_errors(self, msg):
        fn = self._import()
        assert fn(msg) is True

    # -- Negative cases --

    @pytest.mark.parametrize("msg", [
        "HTTP Error 404: Not Found",
        "Video unavailable",
        "Timeout while downloading",
        "Connection refused",
        "Invalid URL",
        "",
        None,
    ])
    def test_non_auth_errors(self, msg):
        fn = self._import()
        assert fn(msg) is False


# ── Test: inbox_download — Bilibili branch (mocked yt-dlp) ─────────────


@pytest.fixture
def _inbox_app(_isolated_cookies_dir):
    """Flask test client with isolated cookies dir for inbox download tests."""
    from web_runner import create_app
    application = create_app()
    application.config["TESTING"] = True
    application.config["PROPAGATE_EXCEPTIONS"] = True
    with application.test_client() as client:
        yield client


class TestInboxDownloadBilibiliBranch:
    """Test the /api/inbox/download endpoint with Bilibili URLs.

    We mock ``yt_dlp.YoutubeDL`` to avoid actual downloads, and test
    that cookie files are detected and passed to yt-dlp correctly.
    We avoid ``patch.object(Path, ...)`` because ``pathlib.Path.exists``
    mocks interact poorly with ``path.rename`` inside the download handler.
    Instead, ``prepare_filename`` points at real files within INBOX_DIR.
    """

    def _mock_ydl(self, monkeypatch, inbox_dir: Path, filename: str = "test_video.mp4"):
        """Mock yt_dlp.YoutubeDL.

        Creates a real file at ``inbox_dir / filename`` so the download
        handler can ``path.rename`` it without hitting OSError.
        Uses ``MagicMock`` for the class so ``MockYDL.call_args`` captures
        the ``ydl_opts`` dict (including ``cookiefile``).
        """
        mock_ydl = MagicMock()
        info = {"title": "My Test Video", "_type": "video"}
        mock_ydl.extract_info.return_value = info

        dest = inbox_dir / filename
        dest.write_text("fake video content", encoding="utf-8")
        mock_ydl.prepare_filename.return_value = str(dest)

        # MagicMock factory: ``MockYDL(opts)`` returns ``ctx_mgr`` whose
        # ``__enter__`` returns the pre-built ``mock_ydl``.
        MockYDL = MagicMock()
        ctx_mgr = MagicMock()
        ctx_mgr.__enter__.return_value = mock_ydl
        MockYDL.return_value = ctx_mgr

        monkeypatch.setattr("yt_dlp.YoutubeDL", MockYDL)
        return mock_ydl, MockYDL, dest

    def test_bilibili_with_biliup_array_cookie(self, monkeypatch, _isolated_cookies_dir, _inbox_app):
        """Bilibili URL + biliup-format cookie → yt-dlp receives cookiefile."""
        from web_runner.routes.inbox import INBOX_DIR
        INBOX_DIR.mkdir(parents=True, exist_ok=True)

        biliup_cookies = [
            {"name": "SESSDATA", "value": "abc123", "domain": ".bilibili.com", "path": "/"},
            {"name": "bili_jct", "value": "token456", "domain": ".bilibili.com", "path": "/"},
        ]
        (_isolated_cookies_dir / "bilibili_main.json").write_text(
            json.dumps(biliup_cookies), encoding="utf-8"
        )

        mock_ydl, MockYDL, _dest = self._mock_ydl(monkeypatch, INBOX_DIR)

        resp = _inbox_app.post(
            "/api/inbox/download",
            data=json.dumps({"url": "https://www.bilibili.com/video/BV1GJ411x7f7"}),
            content_type="application/json",
        )

        data = resp.get_json()
        assert data["success"] is True, f"Failed: {data.get('message', data)}"

        ydl_opts = MockYDL.call_args[0][0] if MockYDL.call_args else {}
        assert "cookiefile" in ydl_opts
        cookie_path = Path(ydl_opts["cookiefile"])
        assert cookie_path.exists() is False
        assert "_ytdlp_temp_" in str(cookie_path)

    def test_bilibili_no_cookie(self, monkeypatch, _inbox_app):
        """Bilibili URL without any cookie file → yt-dlp called without cookiefile."""
        from web_runner.routes.inbox import INBOX_DIR
        INBOX_DIR.mkdir(parents=True, exist_ok=True)
        mock_ydl, MockYDL, _dest = self._mock_ydl(monkeypatch, INBOX_DIR)

        resp = _inbox_app.post(
            "/api/inbox/download",
            data=json.dumps({"url": "https://b23.tv/abc123"}),
            content_type="application/json",
        )

        data = resp.get_json()
        assert data["success"] is True, f"Failed: {data.get('message', data)}"
        ydl_opts = MockYDL.call_args[0][0] if MockYDL.call_args else {}
        assert "cookiefile" not in ydl_opts

    def test_bilibili_auth_required_without_cookie(self, monkeypatch, _inbox_app):
        """Bilibili URL + yt-dlp auth error + no cookie → auth_required response."""
        mock_ydl = MagicMock()
        mock_ydl.extract_info.side_effect = Exception(
            "ERROR: Sign in to confirm you're not a bot"
        )

        class MockYDL:
            def __init__(self, opts=None):
                self.opts = opts or {}

            def __enter__(self):
                return mock_ydl

            def __exit__(self, *args):
                pass

        monkeypatch.setattr("yt_dlp.YoutubeDL", MockYDL)

        resp = _inbox_app.post(
            "/api/inbox/download",
            data=json.dumps({"url": "https://www.bilibili.com/video/BV1GJ411x7f7"}),
            content_type="application/json",
        )
        data = resp.get_json()
        assert data["success"] is False
        assert data.get("auth_required") is True
        assert data.get("platform") == "bilibili"
        assert "Bilibili" in data["message"]
        assert "账号管理" in data["message"]

    def test_bilibili_auth_required_with_expired_cookie(self, monkeypatch, _isolated_cookies_dir, _inbox_app):
        """Bilibili URL + yt-dlp auth error + expired cookie → prompt to re-authorize."""
        biliup_cookies = [
            {"name": "SESSDATA", "value": "expired", "domain": ".bilibili.com"},
        ]
        (_isolated_cookies_dir / "bilibili_main.json").write_text(
            json.dumps(biliup_cookies), encoding="utf-8"
        )

        mock_ydl = MagicMock()
        mock_ydl.extract_info.side_effect = Exception(
            "Sign in to confirm you're not a bot"
        )

        class MockYDL:
            def __init__(self, opts=None):
                self.opts = opts or {}

            def __enter__(self):
                return mock_ydl

            def __exit__(self, *args):
                pass

        monkeypatch.setattr("yt_dlp.YoutubeDL", MockYDL)

        resp = _inbox_app.post(
            "/api/inbox/download",
            data=json.dumps({"url": "https://b23.tv/abc123"}),
            content_type="application/json",
        )
        data = resp.get_json()
        assert data["success"] is False
        assert data.get("auth_required") is True
        assert data.get("platform") == "bilibili"
        assert "过期" in data["message"]

    def test_bilibili_with_storage_state_dict_cookie(self, monkeypatch, _isolated_cookies_dir, _inbox_app):
        """Bilibili URL + storage_state dict cookie (not biliup array)."""
        from web_runner.routes.inbox import INBOX_DIR
        INBOX_DIR.mkdir(parents=True, exist_ok=True)

        storage_state = {
            "cookies": [
                {"name": "SESSDATA", "value": "abc", "domain": ".bilibili.com", "path": "/"},
            ],
            "origins": [{"origin": "https://member.bilibili.com", "localStorage": []}],
        }
        (_isolated_cookies_dir / "bilibili_main.json").write_text(
            json.dumps(storage_state), encoding="utf-8"
        )

        mock_ydl, MockYDL, _dest = self._mock_ydl(monkeypatch, INBOX_DIR)

        resp = _inbox_app.post(
            "/api/inbox/download",
            data=json.dumps({"url": "https://www.bilibili.com/video/BV1xx"}),
            content_type="application/json",
        )

        data = resp.get_json()
        assert data["success"] is True, f"Failed: {data.get('message', data)}"
        ydl_opts = MockYDL.call_args[0][0] if MockYDL.call_args else {}
        assert "cookiefile" in ydl_opts

    def test_non_bilibili_url_does_not_load_bilibili_cookie(self, monkeypatch, _isolated_cookies_dir, _inbox_app):
        """Non-bilibili, non-youtube URL should NOT load any cookie file."""
        from web_runner.routes.inbox import INBOX_DIR
        INBOX_DIR.mkdir(parents=True, exist_ok=True)

        (_isolated_cookies_dir / "bilibili_main.json").write_text(
            json.dumps([{"name": "SESSDATA", "value": "x"}]),
            encoding="utf-8",
        )

        mock_ydl, MockYDL, _dest = self._mock_ydl(monkeypatch, INBOX_DIR)

        resp = _inbox_app.post(
            "/api/inbox/download",
            data=json.dumps({"url": "https://vimeo.com/12345"}),
            content_type="application/json",
        )

        data = resp.get_json()
        assert data["success"] is True, f"Failed: {data.get('message', data)}"
        ydl_opts = MockYDL.call_args[0][0] if MockYDL.call_args else {}
        assert "cookiefile" not in ydl_opts

    def test_cookiefile_cleaned_up_on_error(self, monkeypatch, _isolated_cookies_dir, _inbox_app):
        """Temp cookiefile should be deleted even when download fails."""
        (_isolated_cookies_dir / "bilibili_main.json").write_text(
            json.dumps([{"name": "SESSDATA", "value": "x"}]),
            encoding="utf-8",
        )

        mock_ydl = MagicMock()
        mock_ydl.extract_info.side_effect = Exception("Network error")

        class MockYDL:
            def __init__(self, opts=None):
                self.opts = opts or {}

            def __enter__(self):
                return mock_ydl

            def __exit__(self, *args):
                pass

        monkeypatch.setattr("yt_dlp.YoutubeDL", MockYDL)

        resp = _inbox_app.post(
            "/api/inbox/download",
            data=json.dumps({"url": "https://www.bilibili.com/video/BV1xx"}),
            content_type="application/json",
        )
        data = resp.get_json()
        assert data["success"] is False
        temp_files = list(_isolated_cookies_dir.glob("_ytdlp_temp_*"))
        assert len(temp_files) == 0


# ── Test: _convert_biliup_cookies_to_storage_state integration ─────────


class TestBiliupCookieIntegration:
    """Test that _convert_biliup_cookies_to_storage_state produces output
    compatible with _storage_state_to_netscape_cookies."""

    def _import_convert(self):
        from uploader.bilibili_uploader.note import _convert_biliup_cookies_to_storage_state
        return _convert_biliup_cookies_to_storage_state

    def _import_netscape(self):
        from web_runner.routes.inbox import _storage_state_to_netscape_cookies
        return _storage_state_to_netscape_cookies

    def test_biliup_to_netscape_roundtrip(self, _isolated_cookies_dir):
        """Biliup array → storage_state → Netscape produces valid output."""
        biliup_cookies = [
            {"name": "SESSDATA", "value": "abc123", "domain": ".bilibili.com", "path": "/"},
            {"name": "bili_jct", "value": "token456", "domain": ".bilibili.com", "path": "/"},
            {"name": "DedeUserID", "value": "12345", "domain": ".bilibili.com", "path": "/"},
        ]
        cookie_path = _isolated_cookies_dir / "bilibili_test.json"
        cookie_path.write_text(json.dumps(biliup_cookies), encoding="utf-8")

        to_ss = self._import_convert()
        storage_state = to_ss(str(cookie_path))

        # Check storage_state shape
        assert "cookies" in storage_state
        assert len(storage_state["cookies"]) == 3
        assert storage_state["cookies"][0]["name"] == "SESSDATA"
        assert storage_state["cookies"][0]["value"] == "abc123"

        # Convert to Netscape
        netscape = self._import_netscape()(storage_state)
        lines = [l for l in netscape.split("\n") if l and not l.startswith("#")]
        assert len(lines) == 3
        # Each line should be tab-separated with 7 fields
        for line in lines:
            parts = line.split("\t")
            assert len(parts) == 7
        assert any("SESSDATA" in l for l in lines)
        assert any("bili_jct" in l for l in lines)

    def test_biliup_negative_expires_not_included(self, _isolated_cookies_dir):
        """Biliup cookies with expires=-1 (session) should not have expires in storage_state."""
        biliup = [
            {"name": "SESSDATA", "value": "x", "domain": ".bilibili.com", "path": "/", "expires": -1},
        ]
        cookie_path = _isolated_cookies_dir / "bilibili_test.json"
        cookie_path.write_text(json.dumps(biliup), encoding="utf-8")

        to_ss = self._import_convert()
        storage_state = to_ss(str(cookie_path))
        cookie = storage_state["cookies"][0]
        # expires <= 0 should be omitted (session cookie)
        assert "expires" not in cookie or cookie.get("expires", -1) <= 0

    def test_biliup_valid_expires_preserved(self, _isolated_cookies_dir):
        """Biliup cookies with positive expires should preserve the value."""
        biliup = [
            {"name": "SESSDATA", "value": "x", "domain": ".bilibili.com", "path": "/", "expires": 1769999999},
        ]
        cookie_path = _isolated_cookies_dir / "bilibili_test.json"
        cookie_path.write_text(json.dumps(biliup), encoding="utf-8")

        to_ss = self._import_convert()
        storage_state = to_ss(str(cookie_path))
        assert storage_state["cookies"][0]["expires"] == 1769999999
