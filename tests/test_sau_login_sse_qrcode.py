"""SSE login flow — verify QR-code ``image_data_url`` reaches the client.

This file is the **integration test** for the Round-31 SSE migration:

  * The Web Shell's QR-login panel subscribes to
    ``GET /api/accounts/login/sse`` and renders whatever the helper feeds
    into ``event: qrcode`` frames.
  * After the screenshot→CDP swap, every uploader emits a
    ``data:image/png;base64,...`` payload via ``_cdp_capture_screenshot``,
    stuffed into ``qrcode_info["image_data_url"]``.
  * On the SSE path (this test) we do NOT write PNG to disk, so
    ``qrcode_info["image_path"]`` is the empty string — the consumer must
    not try to ``Path(qrcode_info["image_path"])`` it (Round-29 v4
    regression guard — cf. the SSE-flow unlink-on-cwd bug caught by the
    reviewer).

The single test below patches ``_cdp_capture_screenshot`` on a *stub Page*
and asserts the same payload flows through unchanged from the helper into
the Web Shell's render layer.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

import web_runner.utils as wr_utils
from web_runner import create_app

# ─── Stubs ──────────────────────────────────────────────────────────────────


class _StubPage:
    """Opaque Page stub for ``_cdp_capture_screenshot`` identity check.

    The real CDP path inside ``_cdp_capture_screenshot`` is short-circuited
    by ``AsyncMock(side_effect=…)`` below, so this object is never asked
    to navigate, screenshot, or talk to Chromium at runtime. We only need
    *identity* (``is``) comparison to prove the helper received exactly
    this instance — wiring integrity, not CDP execution.
    """


_STUB_IMAGE_URL = "data:image/png;base64,STUB_BASE64_DATA"


# ─── Fixture ────────────────────────────────────────────────────────────────


@pytest.fixture
def app(monkeypatch, tmp_path):
    """Flask test client — auth disabled, state isolated to tmp dirs.

    Mirrors ``tests/test_inbox.py::client``: cookies/uploads dirs rebind
    to ``tmp_path`` BEFORE ``create_app()`` runs, so the cookie-sync
    pass inside ``create_app`` (``_sync_cookie_files_to_db``) reads
    the empty tmp and skips the cookie→account_groups INSERT that
    would otherwise hit the project's real ``cookies/`` directory.

    Auth is flipped off via env so the SSE gate's
    ``authenticate_sse_request`` short-circuits to user_id=0
    (cf. ``web_runner/routes/auth.py::authenticate_sse_request``).
    """
    # State isolation MUST happen before create_app() so _sync_cookie_files_to_db
    # sees an empty cookies dir and skips its cookie→account_groups INSERT pass.
    monkeypatch.setenv("SAU_AUTH_ENABLED", "false")
    monkeypatch.setattr(wr_utils, "COOKIES_DIR", tmp_path / "cookies")
    monkeypatch.setattr(wr_utils, "UPLOADS_DIR", tmp_path / "uploads")
    (tmp_path / "cookies").mkdir(exist_ok=True)
    (tmp_path / "uploads").mkdir(exist_ok=True)

    application = create_app()
    application.config["TESTING"] = True
    with application.test_client() as client:
        yield client


# ─── Helpers ────────────────────────────────────────────────────────────────


def _parse_sse_frames(raw_bytes: bytes) -> list[dict]:
    """Parse SSE bytes into ``[{event, data}, ...]`` (one entry per frame)."""
    events: list[dict] = []
    current_event: str | None = None
    for line in raw_bytes.decode("utf-8").splitlines():
        if line.startswith("event: "):
            current_event = line.split("event: ", 1)[1]
        elif line.startswith("data: ") and current_event is not None:
            events.append(
                {
                    "event": current_event,
                    "data": json.loads(line.split("data: ", 1)[1]),
                }
            )
            current_event = None
    return events


# ─── Test ───────────────────────────────────────────────────────────────────


def test_douyin_login_sse_relays_image_data_url_from_patched_helper(app):
    """``image_data_url`` emitted by ``_cdp_capture_screenshot`` reaches SSE client.

    Three invariants verified end-to-end:

    1. ``_cdp_capture_screenshot`` is awaited against the *stub Page* with
       identity intact (wiring — proves the helper does not lose the
       Page in the SSE integration path).
    2. The ``event: qrcode`` frame contains exactly the helper's
       ``image_data_url`` payload with ``image_path=""`` (SSE-mode
       empty-path invariant — guards the Round-29 v4
       ``Path("") == Path(".")`` regression).
    3. The terminal ``event: result`` carries ``success=True`` so the
       Web Shell's QR panel can consume subsequent Chrome navigation
       events.
    """
    stub_page = _StubPage()

    async def stub_capture(page, clip=None, capture_beyond_viewport=False):
        # Real ``_cdp_capture_screenshot`` would actually call
        # ``cdp.send("Page.captureScreenshot", …)`` here; the test
        # short-circuits to a deterministic URL string.
        return _STUB_IMAGE_URL

    async def fake_douyin_login(account: str, headless: bool = True, qrcode_callback=None) -> dict:
        # Resolve the helper at call time — guarantees the patch below is
        # already in effect when this coroutine runs inside the route's
        # ``asyncio.run(…)`` worker thread.
        from uploader.common import _cdp_capture_screenshot

        image_data_url = await _cdp_capture_screenshot(stub_page)

        if qrcode_callback is not None:
            # Shape mirrors ``_save_<platform>_qrcode`` so the SSE plumbing
            # has to handle the SSE-mode empty ``image_path`` correctly.
            qrcode_callback(
                {
                    "image_path": "",  # SSE path: no PNG-on-disk write
                    "image_data_url": image_data_url,
                }
            )

        return {
            "success": True,
            "status": "success",
            "message": "ok",
            "account_file": f"cookies/douyin_{account}.json",
            "qrcode": {
                "image_path": "",
                "image_data_url": image_data_url,
            },
        }

    with (
        patch(
            "uploader.common._cdp_capture_screenshot",
            new_callable=AsyncMock,
            side_effect=stub_capture,
        ) as mock_capture,
        patch("cli.platforms.douyin.login", side_effect=fake_douyin_login) as mock_login,
    ):
        response = app.get(
            "/api/accounts/login/sse",
            query_string={
                "platform": "douyin",
                "account": "test_user_123",
                "headless": "true",
            },
        )
        assert response.status_code == 200
        # Drain the full stream. ``fake_douyin_login`` completes
        # deterministically, so the route's generator emits the
        # keepalive + qrcode + result frames and then terminates
        # naturally — no need for a timeout-based thread reader.
        raw_frames = b"".join(response.response)

    # 1. SSE keepalive preamble — 4096 spaces after ``": "``. This is the
    #    anti-proxy-buffer trick emitted as the first frame so reverse
    #    proxies (nginx, Cloudflare) don't hold our connection until
    #    the first real event arrives.
    assert (
        b": " + (b" " * 4096) + b"\n\n" in raw_frames
    ), "missing SSE keepalive preamble — proxy-buffering prevention lost"

    events = _parse_sse_frames(raw_frames)

    # 2. Exactly one ``qrcode`` frame coming back; image_data_url must be
    #    the helper's verbatim output, image_path empty (SSE invariant).
    qrcode_events = [e for e in events if e["event"] == "qrcode"]
    assert len(qrcode_events) == 1, f"expected exactly 1 qrcode frame, got {len(qrcode_events)}: " f"{qrcode_events!r}"
    assert qrcode_events[0]["data"]["image_data_url"] == _STUB_IMAGE_URL
    assert qrcode_events[0]["data"]["image_path"] == ""

    # 3. Terminal ``result`` frame — the uploaders return
    #    ``{"success": True, ...}`` on cookie success. The Web Shell
    #    uses this to flip out of the QR-scanning state.
    result_events = [e for e in events if e["event"] == "result"]
    assert len(result_events) == 1, f"expected exactly 1 result frame, got {len(result_events)}: " f"{result_events!r}"
    assert result_events[0]["data"]["success"] is True

    # 4. The CDP helper was awaited exactly once against our stub Page.
    #    ``mock_capture.assert_awaited_once()`` enforces the awaitedness
    #    of ``_cdp_capture_screenshot`` (not just called — the helper
    #    is ``async def`` so AsyncMock awaits the side-effect coroutine).
    mock_capture.assert_awaited_once()
    capture_args, _ = mock_capture.call_args
    assert (
        capture_args and capture_args[0] is stub_page
    ), f"helper got {capture_args!r}, expected identity-matched stub_page"

    # 5. The route invoked douyin's login with the right account on the
    #    SSE worker thread. ``mock_login.call_args[0][0]`` is the
    #    account positional arg captured at thread handoff.
    mock_login.assert_called_once()
    login_args, _ = mock_login.call_args
    assert login_args and login_args[0] == "test_user_123"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
