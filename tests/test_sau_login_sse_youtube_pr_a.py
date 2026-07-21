"""Stage 1b PR-A: YouTube interactive + QR-family integrity tests.

Verifies the dispatch branching in
``web_runner/routes/accounts.py::_run_login`` after PR-A:

  *   ``youtube`` is now a recognized SSE login target — does NOT 400
      at the existing ``platform not in _QR_LOGIN_PLATFORMS`` gate.
  *   YouTube login_fn receives ``headless=False`` (forced) +
      ``challenge_callback`` plumbed, but NO ``qrcode_callback``.
  *   YouTube SSE stream yields ``headed_chrome_ready`` as the FIRST
      named event (PR-B LoginProgressModal listens for this).
  *   YouTube login_fn's return value flows through to a final
      ``result`` event with ``success=True``.
  *   QR-family platform (bilibili) still receives ``qrcode_callback``
      in the dispatched call — confirms the QR branch is untouched.

Mocking strategy uses ``monkeypatch.setattr`` (auto-restored on test
teardown) rather than manual ``try/finally`` module-attribute swap.
``_run_login`` re-imports ``cli.platforms.{plat}`` per request, so a
``monkeypatch.setattr(youtube_module, "login", fake)`` before the
request patches the next call's attribute access correctly.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from web_runner import create_app


# ---------------------------------------------------------------------------
#  Helpers — pair with the same SSE event parser used by sibling tests
# ---------------------------------------------------------------------------


def _parse_sse(response) -> list[dict]:
    """Tokenize a Flask streamed SSE response into ``[{event, data}]``.

    Splits body on ``\\n\\n`` and walks each chunk for ``event:`` /
    ``data:`` tokens. Mirrors the prior SSE test pattern in
    ``tests/test_sau_login_sse_qrcode.py``.
    """
    events: list[dict] = []
    body = response.get_data(as_text=True)
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if not chunk:
            continue
        event_name = None
        data_lines: list[str] = []
        for line in chunk.split("\n"):
            line = line.strip()
            if line.startswith("event:"):
                event_name = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
        if event_name is None:
            continue
        try:
            parsed = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            parsed = "\n".join(data_lines)
        events.append({"event": event_name, "data": parsed})
    return events


def _fake_login_success() -> dict:
    """Mirror ``uploader.youtube_uploader.main._build_login_result``."""
    return {
        "success": True,
        "status": "logged_in",
        "message": "登录成功",
        "account_file": "/tmp/yt_test.json",
        "current_url": "https://studio.youtube.com/channel/UCfake",
    }


# ---------------------------------------------------------------------------
#  Fixture — auth-off, cookies tmp, mock-bypass neutralized
# ---------------------------------------------------------------------------


@pytest.fixture
def app(monkeypatch):
    """Flask test client mirroring ``tests/test_sau_web_account_groups::app``.

    * SAU_AUTH_ENABLED=false (SSE auth gate skip)
    * SAU_MOCK_AUTHORIZE unset (production ``_run_login`` branch exercised)
    * COOKIES_DIR rebind to temp
    * monkeypatch fixture inherited by all test methods for auto-restore
    """
    import web_runner.utils as wr_utils

    monkeypatch.setenv("SAU_AUTH_ENABLED", "false")
    monkeypatch.delenv("SAU_MOCK_AUTHORIZE", raising=False)

    application = create_app()
    application.config["TESTING"] = True
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        cookies_dir = tmp / "cookies"
        cookies_dir.mkdir(exist_ok=True)
        monkeypatch.setattr(wr_utils, "COOKIES_DIR", cookies_dir)

        with application.test_client() as client:
            yield client


# ===========================================================================
#  PRINT 1: Interactive family — YouTube
# ===========================================================================


class TestYoutubeInteractiveBranch:
    """PR-A contract: ``platform=youtube`` reaches login_fn dispatch,
    gets headed-Chrome forced, emits ``headed_chrome_ready`` event,
    closes with ``result`` event whose ``success=True``.
    """

    def test_youtube_sse_returns_200_with_event_stream(
        self, app, monkeypatch
    ):
        """The 400-gate was widened: YouTube now passes through."""
        import cli.platforms.youtube as youtube_module

        async def _fake_login(account_name, *, headless=True, challenge_callback=None):
            return _fake_login_success()

        monkeypatch.setattr(youtube_module, "login", _fake_login)

        resp = app.get(
            "/api/accounts/login/sse?platform=youtube&account=test_yt&headless=true",
        )
        assert resp.status_code == 200, (
            f"YouTube login SSE must reach login dispatch; got HTTP {resp.status_code}"
        )
        assert resp.mimetype == "text/event-stream"

    def test_youtube_login_fn_called_with_headless_false(
        self, app, monkeypatch
    ):
        """PR-A forces headed-Chrome: YouTube receives ``headless=False``
        even when caller passes ``?headless=true``."""
        import cli.platforms.youtube as youtube_module

        captured: list[dict] = []

        async def _fake_login(account_name, *, headless=True, challenge_callback=None):
            captured.append({"headless": headless, "had_challenge_cb": challenge_callback is not None})
            return _fake_login_success()

        monkeypatch.setattr(youtube_module, "login", _fake_login)
        app.get(
            "/api/accounts/login/sse?platform=youtube&account=test_yt&headless=true",
        )

        assert len(captured) == 1, "login_fn must be dispatched exactly once"
        assert captured[0]["headless"] is False, (
            "YouTube must always be headed-Chrome (headless=False); "
            "the URL ?headless=true must be overridden."
        )
        assert captured[0]["had_challenge_cb"] is True, (
            "challenge_callback must be plumbed to YouTube.login signature"
        )

    def test_youtube_login_fn_does_not_receive_qrcode_callback(
        self, app, monkeypatch
    ):
        """Stage 1a removed qrcode_callback from cli/platforms/youtube.py:login.
        PR-A's backward-compat assertion: dispatcher MUST NOT pass it."""
        import cli.platforms.youtube as youtube_module
        import inspect

        captured_kwargs: dict = {}

        async def _fake_login(**kwargs):
            captured_kwargs.update(kwargs)
            return _fake_login_success()

        monkeypatch.setattr(youtube_module, "login", _fake_login)
        app.get(
            "/api/accounts/login/sse?platform=youtube&account=test_yt&headless=true",
        )

        assert "qrcode_callback" not in captured_kwargs, (
            "qrcode_callback MUST NOT be passed to YouTube.login "
            "(Stage 1a signature has no such param — caller would TypeError)."
        )

    def test_youtube_sse_stream_yields_headed_chrome_ready_first(
        self, app, monkeypatch
    ):
        """First named event must be ``headed_chrome_ready``."""
        import cli.platforms.youtube as youtube_module

        async def _fake_login(account_name, *, headless=True, challenge_callback=None):
            return _fake_login_success()

        monkeypatch.setattr(youtube_module, "login", _fake_login)
        resp = app.get(
            "/api/accounts/login/sse?platform=youtube&account=test_yt&headless=true",
        )
        events = _parse_sse(resp)
        # Filter out heartbeat pings — they are no-ops in the dispatch path.
        named = [ev for ev in events if ev["event"] not in ("ping",)]
        assert named, "expected at least one named SSE event for YouTube login"
        assert named[0]["event"] == "headed_chrome_ready", (
            f"first SSE event for YouTube must be 'headed_chrome_ready'; "
            f"got {named[0]['event']}"
        )
        assert named[0]["data"]["platform"] == "youtube"
        assert named[0]["data"]["account"] == "test_yt"

    def test_youtube_sse_stream_terminates_with_result_success(
        self, app, monkeypatch
    ):
        """Last named event must be ``result`` with success=True."""
        import cli.platforms.youtube as youtube_module

        async def _fake_login(account_name, *, headless=True, challenge_callback=None):
            return _fake_login_success()

        monkeypatch.setattr(youtube_module, "login", _fake_login)
        resp = app.get(
            "/api/accounts/login/sse?platform=youtube&account=test_yt&headless=true",
        )
        events = _parse_sse(resp)
        named = [ev for ev in events if ev["event"] not in ("ping",)]
        last = named[-1]
        assert last["event"] == "result"
        assert last["data"]["success"] is True


# ===========================================================================
#  PRINT 2: QR-family integrity — bilibili still receives qrcode_callback
# ===========================================================================


class TestQrFamilyDispatchIntegrity:
    """PR-A is additive on the interactive branch. The QR branch MUST
    continue to plumb ``qrcode_callback`` so the existing 7-platform
    SSE flow doesn't regress."""

    def test_bilibili_login_fn_receives_qrcode_callback(
        self, app, monkeypatch
    ):
        """Spot-check: bilibili still receives qrcode_callback kwargs."""
        import cli.platforms.bilibili as bili_module

        captured: list[dict] = []

        async def _fake_login(account_name, *, headless=True,
                             qrcode_callback=None, challenge_callback=None):
            captured.append({
                "qrcode_cb_present": qrcode_callback is not None,
                "challenge_cb_present": challenge_callback is not None,
            })
            return {"success": True}

        monkeypatch.setattr(bili_module, "login", _fake_login)
        resp = app.get(
            "/api/accounts/login/sse?platform=bilibili&account=test_bili&headless=true",
        )
        assert resp.status_code == 200
        assert resp.mimetype == "text/event-stream"
        assert len(captured) == 1
        assert captured[0]["qrcode_cb_present"] is True, (
            "bilibili (QR-family) MUST continue to receive qrcode_callback "
            "after PR-A — diff accidentally moved it to interactive branch?"
        )
        assert captured[0]["challenge_cb_present"] is True


# ===========================================================================
#  PRINT 3: Forbidden-platform gates (well-known non-YouTube strings)
# ===========================================================================


class TestForbiddenPlatformGate:
    """A platform that is NOT in either login family must still 400.
    Confirms the new gate (``_QR_LOGIN_PLATFORMS | _INTERACTIVE_LOGIN_PLATFORMS``)
    hasn't lost its 400-rejection for genuine non-login platforms."""

    def test_unknown_platform_returns_400(self, app, monkeypatch):
        resp = app.get(
            "/api/accounts/login/sse?platform=some-non-existent-platform&account=t",
        )
        assert resp.status_code == 400, (
            f"unknown platform must 400; got {resp.status_code}"
        )
        body = resp.get_json()
        assert body["success"] is False
        assert "Web-Shell login" in body["message"], (
            "the 400 message must mention Web-Shell (post-PR-A wording)"
        )
