"""Shared utility functions for all platform uploaders."""

from __future__ import annotations

import inspect

from patchright.async_api import Page


def _msg(emoji: str, text: str) -> str:
    return f"{emoji} {text}"


async def _emit_qrcode_callback(qrcode_callback, payload: dict):
    if not qrcode_callback:
        return

    callback_result = qrcode_callback(payload)
    if inspect.isawaitable(callback_result):
        await callback_result


def _build_login_result(
    success: bool,
    status: str,
    message: str,
    account_file: str,
    qrcode: dict | None = None,
    current_url: str = "",
) -> dict:
    return {
        "success": success,
        "status": status,
        "message": message,
        "account_file": str(account_file),
        "qrcode": qrcode,
        "current_url": current_url,
    }


async def _check_login_markers(page: Page, markers: list[str]) -> bool:
    """Check if any login-related text markers are visible on the page.

    Uses ``exact=True`` to avoid false positives from substring matches
    (the root cause of the Bilibili ``cookie_invalid`` bug).

    Intended for use in both ``cookie_auth()`` and ``_is_*_login_completed()``
    to keep login detection logic consistent across all platform uploaders.

    Returns ``True`` if at least one marker is visible on the page.
    """
    for text in markers:
        try:
            locator = page.get_by_text(text, exact=True).first
            if await locator.count() and await locator.is_visible():
                return True
        except Exception:
            continue
    return False


async def _all_login_markers_hidden(page: Page, markers: list[str]) -> bool:
    """Check that all login markers are absent or hidden.

    The inverse of ``_check_login_markers`` — returns ``True`` when none
    of the markers are visible, meaning the user has successfully logged
    in and entered an authenticated page.
    """
    for text in markers:
        try:
            locator = page.get_by_text(text, exact=True).first
            if await locator.count():
                try:
                    if await locator.is_visible():
                        return False
                except Exception:
                    continue
        except Exception:
            continue
    return True


async def _cdp_capture_screenshot(
    page: Page,
    clip: dict | None = None,
    capture_beyond_viewport: bool = False,
) -> str:
    """Capture at CDP level (``Page.captureScreenshot``), returning a data: URL.

    Returns ``"data:image/png;base64,<...>"`` ready for inline ``<img>`` rendering
    in the Web Shell or for PNG-on-disk writes. CDP's ``Page.captureScreenshot``
    already returns the image as a base64 string in ``result["data"]`` — no
    second ``b64encode`` needed — saving a CPU pass on a hot path that fires on
    every login flow.

    We open a fresh CDP session per call (~50-200 ms overhead) because the
    login flow captures at most twice (initial + QR refresh on expiry);
    carrying a long-lived session across plugin/script iterations adds
    detaching bookkeeping that isn't worth the marginal speedup.

    Shared by every uploader's ``_save_<platform>_qrcode`` helper to keep the
    SSE image_data_url emit path uniform. The earlier Playwright ``page.screenshot()``
    wrapper path was dropped because (a) it round-tripped through zxing/pil QR
    decode (unreliable for cropped screenshots — see ``tests/test_login_qrcode.py``
    for that fallback chain) before being re-rendered as ASCII in the terminal,
    and (b) it bypassed the inline data:URL stream that the Web Shell consumes
    via ``<img src={qrCodeUrl}>``.

    Args:
        page: patchright async ``Page``.
        clip: Optional CDP clip dict ``{x, y, width, height, scale}``.
            When omitted, takes the full viewport.
        capture_beyond_viewport: When ``True`` + ``clip`` is set, CDP will
            paint content outside the viewport to satisfy the clip region.
            Use this when the captured region (e.g. a centered login modal)
            may extend below the document fold on smaller viewports. Default
            ``False`` keeps viewport-bound semantics for the implicit
            full-viewport fallback path.
    """
    cdp = await page.context.new_cdp_session(page)
    try:
        params: dict = {"format": "png", "captureBeyondViewport": capture_beyond_viewport}
        if clip is not None:
            params["clip"] = {
                "x": clip["x"], "y": clip["y"],
                "width": clip["width"], "height": clip["height"],
                "scale": clip.get("scale", 1),
            }
        result = await cdp.send("Page.captureScreenshot", params)
        return "data:image/png;base64," + result["data"]
    finally:
        await cdp.detach()
