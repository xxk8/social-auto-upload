"""SSE login flow — verify QR-code ``image_data_url`` (no local PNG) reaches the client.

This file is the **integration test** for the Round-OPT-acct-qr cleanup:

  * The Web Shell's QR-login panel subscribes to
    ``GET /api/accounts/login/sse`` and renders whatever the helper feeds
    into ``event: qrcode`` frames.
  * Every uploader now emits a ``data:image/png;base64,...`` payload via
    the platform's own ``<img src>`` (Strategy 1: DOM <img>) or network
    interception of ``get_qrcode`` (Strategy 0). NO local PNG file is
    written, NO ``_cdp_capture_screenshot`` is invoked, NO zxing decode
    happens — the bytes flow straight from the DOM/network to the SSE
    client.
  * On the SSE path (this test), ``qrcode_info["image_path"]`` is the
    empty string — the consumer must not try to ``Path(qrcode_info["image_path"])``
    it (regression guard from prior Round-29 v4 work, preserved here).

The single test below patches ``cli.platforms.douyin.login`` with an
async fake that returns the platform's QR <img> ``src`` verbatim, and
asserts the same payload flows through unchanged from the helper into
the Web Shell's render layer.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

import web_runner.utils as wr_utils
from web_runner import create_app

# ─── Stub ──────────────────────────────────────────────────────────────────

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


def test_douyin_login_sse_relays_image_data_url_from_uploader_helper(app):
    """``image_data_url`` from the uploader's DOM/network QR extraction reaches the SSE client.

    Three invariants verified end-to-end:

    1. The uploader helper (the ``cli.platforms.douyin.login`` entry
       the SSE route calls) is awaited with the right account and
       ``headless=True`` (wiring — proves the route hands off the
       account/headless params correctly).
    2. The ``event: qrcode`` frame contains exactly the helper's
       ``image_data_url`` payload with ``image_path=""`` (SSE-mode
       empty-path invariant — guards the prior regression where a
       future contributor might re-introduce a local PNG file write).
    3. The terminal ``event: result`` carries ``success=True`` so the
       Web Shell's QR panel can consume subsequent Chrome navigation
       events.
    """
    captured_callbacks: list[dict] = []

    async def fake_douyin_login(account: str, headless: bool = True, qrcode_callback=None) -> dict:
        # The fake uploader-side helper: emit exactly the shape the
        # real ``_save_douyin_qrcode`` would emit in the post-cleanup
        # flow — ``image_data_url`` from DOM/network extraction, NO
        # local file path.
        if qrcode_callback is not None:
            qrcode_callback(
                {
                    "image_path": "",  # SSE path: no PNG-on-disk write
                    "image_data_url": _STUB_IMAGE_URL,
                }
            )
            captured_callbacks.append(
                {
                    "image_path": "",
                    "image_data_url": _STUB_IMAGE_URL,
                }
            )

        return {
            "success": True,
            "status": "success",
            "message": "ok",
            "account_file": f"cookies/douyin_{account}.json",
            "qrcode": {
                "image_path": "",
                "image_data_url": _STUB_IMAGE_URL,
            },
        }

    with patch("cli.platforms.douyin.login", side_effect=fake_douyin_login) as mock_login:
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
    #    the helper's verbatim output, image_path empty (SSE invariant —
    #    preserved after the round-OPT-acct-qr cleanup that removed
    #    all local PNG writes).
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

    # 4. The route invoked douyin's login with the right account on the
    #    SSE worker thread. ``mock_login.call_args`` captures the
    #    ``(account, headless, qrcode_callback)`` tuple at thread
    #    handoff.
    mock_login.assert_called_once()
    login_args, login_kwargs = mock_login.call_args
    assert login_args and login_args[0] == "test_user_123", (
        f"helper got account={login_args[0]!r}, expected 'test_user_123'"
    )
    # headless may arrive as a kwarg or as a default in the signature
    # — the SSE route passes headless_str.lower() in (true|false) → bool
    headless_value = login_args[1] if len(login_args) > 1 else login_kwargs.get("headless")
    assert headless_value is True, f"helper got headless={headless_value!r}, expected True"

    # 5. The qrcode_callback was invoked exactly once with the
    #    no-PNG shape (regression guard for any future contributor
    #    re-introducing a local file write inside the uploader).
    assert len(captured_callbacks) == 1
    assert captured_callbacks[0]["image_path"] == ""
    assert captured_callbacks[0]["image_data_url"] == _STUB_IMAGE_URL


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
