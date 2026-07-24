"""Crawler-side Weibo (微博) login wrapper.

Like Zhihu and Tieba, Weibo has NO dedicated uploader in this project
(``uploader/weibo_uploader`` was never built). This module implements
a standalone QR-code login flow via Weibo's passport:

    * ``weibo_login`` — navigates to ``https://passport.weibo.com/signin/login``,
      switches to QR tab (``?type=qrcode``), extracts the QR image,
      polls for login completion, saves cookies as Playwright
      ``storage_state`` JSON.
    * ``weibo_cookie_check`` — probes ``weibo.com/`` to detect
      whether the login cookie is still valid.
    * ``resolve_account_file`` — returns
      ``cookies/weibo_{account_name}.json``.

Cookie domain: ``.weibo.com`` — shared across all weibo subdomains
(``weibo.com``, ``s.weibo.com``, ``passport.weibo.com``).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)

# Weibo passport login URL
WEIBO_LOGIN_URL = "https://passport.weibo.com/signin/login?type=qrcode"
# Weibo home — used for cookie validation
WEIBO_HOME_URL = "https://weibo.com/"


async def weibo_login(
    account_file: str,
    *,
    qrcode_callback: Any | None = None,
    headless: bool = False,
) -> dict[str, Any]:
    """Run the Weibo QR-code login flow and persist cookies.

    This is a standalone implementation that navigates to
    ``passport.weibo.com/signin/login?type=qrcode``, waits for the
    QR image to render, polls until the login completes (redirects
    to weibo.com main feed), then saves the Playwright storage_state.

    Returns:
        ``{"success": bool, "status": str, "message": str,
          "account_file": str, "qrcode": {"image_data_url": str} | None,
          "current_url": str}``
    """
    Path(account_file).parent.mkdir(parents=True, exist_ok=True)
    from patchright.async_api import async_playwright

    result: dict[str, Any] = {
        "success": False,
        "status": "failed",
        "message": "Weibo login failed",
        "account_file": account_file,
        "qrcode": None,
        "current_url": "",
    }

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        try:
            context = await browser.new_context()
            page = await context.new_page()
            await page.goto(
                WEIBO_LOGIN_URL,
                wait_until="domcontentloaded",
                timeout=30000,
            )

            # Extract QR code image URL
            qrcode_src = ""
            try:
                qrcode_img = page.locator(
                    "[class*='qrcode'] img, "
                    "img[class*='qr'], "
                    "img[alt*='扫码'], "
                    "img[id*='qrcode']"
                ).first
                await qrcode_img.wait_for(state="visible", timeout=15000)
                qrcode_src = await qrcode_img.get_attribute("src") or ""
            except Exception:
                _module_logger.warning(
                    "[crawler] weibo login: could not locate QR code element; "
                    "user may need to scan in the visible browser window."
                )

            qrcode_info: dict[str, str] = {"image_data_url": qrcode_src}
            if qrcode_callback and callable(qrcode_callback):
                await qrcode_callback(qrcode_info)
            result["qrcode"] = qrcode_info

            # Poll for login completion (redirect away from passport)
            _module_logger.info(
                "[crawler] weibo login: waiting for QR scan..."
            )
            for _ in range(100):
                await asyncio.sleep(3)
                current_url = page.url
                if "passport" not in current_url:
                    _module_logger.info(
                        "[crawler] weibo login: login detected at %s",
                        current_url,
                    )
                    storage = await context.storage_state()
                    Path(account_file).write_text(
                        json.dumps(storage, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    result.update({
                        "success": True,
                        "status": "success",
                        "message": "Weibo login successful",
                        "current_url": current_url,
                    })
                    return result
            else:
                result.update({
                    "status": "timeout",
                    "message": "Weibo login timeout: QR not scanned within 5 minutes",
                    "current_url": page.url,
                })
        except Exception as exc:
            result.update({
                "status": "failed",
                "message": str(exc),
            })
        finally:
            await browser.close()

    return result


async def weibo_cookie_check(account_file: str) -> bool:
    """Verify the Weibo cookie at ``account_file`` is still valid.

    Probes ``weibo.com/`` and checks whether the page redirects
    to passport (== invalid) or shows the main feed (== valid).

    Returns ``False`` if the cookie file is missing, the probe
    redirects to passport, or any network error occurs.
    """
    if not os.path.exists(account_file):
        return False
    from patchright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context(storage_state=account_file)
            page = await context.new_page()
            await page.goto(
                WEIBO_HOME_URL,
                wait_until="domcontentloaded",
                timeout=30000,
            )
            await asyncio.sleep(2)
            current_url = page.url
            # If we're on weibo.com (not redirected to passport), cookie is valid
            if "passport" in current_url or "login" in current_url:
                _module_logger.debug(
                    "[crawler] weibo cookie check: redirected to passport (expired)"
                )
                return False
            return True
        except Exception as exc:
            _module_logger.debug(
                "[crawler] weibo cookie check error: %s", exc
            )
            return False
        finally:
            await browser.close()


def resolve_account_file(account_name: str) -> str:
    """Return absolute path to ``cookies/weibo_{account_name}.json``.

    Mirrors the pattern from other standalone-login platforms (zhihu, tieba).
    """
    from conf import BASE_DIR

    if os.path.isabs(account_name) and account_name.endswith(".json"):
        Path(account_name).parent.mkdir(parents=True, exist_ok=True)
        return account_name
    p = Path(BASE_DIR) / "cookies" / f"weibo_{account_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


__all__ = ["weibo_login", "weibo_cookie_check", "resolve_account_file"]
