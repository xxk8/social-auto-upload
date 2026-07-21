"""Crawler-side Tieba (百度贴吧) login wrapper.

Like Zhihu, Tieba has NO dedicated uploader in this project
(``uploader/tieba_uploader`` was never vendored). This module implements
a standalone QR-code login flow via Baidu's unified passport:

    * ``tieba_login`` — navigates to ``passport.baidu.com/v2/?login``,
      extracts the QR-code image, polls for login completion, saves
      cookies as Playwright ``storage_state`` JSON.
    * ``tieba_cookie_check`` — probes ``tieba.baidu.com/`` to detect
      whether the login cookie is still valid.
    * ``resolve_account_file`` — returns
      ``cookies/tieba_{account_name}.json``.

Cookie domain: Baidu's passport cookies span ``.baidu.com``, so a
login at ``passport.baidu.com`` is valid across ``tieba.baidu.com``,
``zhidao.baidu.com``, ``wenku.baidu.com``, etc.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)

# Baidu passport login URL
BAIDU_PASSPORT_LOGIN_URL = "https://passport.baidu.com/v2/?login"
# Tieba home — used for cookie validation
TIEBA_HOME_URL = "https://tieba.baidu.com/"


async def tieba_login(
    account_file: str,
    *,
    qrcode_callback: Any | None = None,
    headless: bool = False,
) -> dict[str, Any]:
    """Run the Baidu/Tieba QR-code login flow and persist cookies.

    This is a standalone implementation that navigates to
    ``passport.baidu.com/v2/?login``, waits for the QR image to render,
    polls until the login completes (redirects away from passport),
    then saves the Playwright storage_state to the account file.

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
        "message": "Tieba login failed",
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
                BAIDU_PASSPORT_LOGIN_URL,
                wait_until="domcontentloaded",
                timeout=30000,
            )

            # Extract QR code image URL
            qrcode_src = ""
            try:
                # Baidu passport login page — QR tab
                qrcode_img = page.locator(
                    "#passport-login-qr img, "
                    "[class*='qrcode'] img, "
                    "img[class*='qr'], "
                    "img[alt*='扫码']"
                ).first
                await qrcode_img.wait_for(state="visible", timeout=15000)
                qrcode_src = await qrcode_img.get_attribute("src") or ""
            except Exception:
                _module_logger.warning(
                    "[crawler] tieba login: could not locate QR code element; "
                    "user may need to scan in the visible browser window."
                )

            qrcode_info: dict[str, str] = {"image_data_url": qrcode_src}
            if qrcode_callback and callable(qrcode_callback):
                await qrcode_callback(qrcode_info)
            result["qrcode"] = qrcode_info

            # Poll for login completion (redirect away from passport)
            _module_logger.info(
                "[crawler] tieba login: waiting for QR scan..."
            )
            for _ in range(100):
                await asyncio.sleep(3)
                current_url = page.url
                if "passport" not in current_url:
                    _module_logger.info(
                        "[crawler] tieba login: login detected at %s",
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
                        "message": "Tieba login successful",
                        "current_url": current_url,
                    })
                    return result
            else:
                result.update({
                    "status": "timeout",
                    "message": "Tieba login timeout: QR not scanned within 5 minutes",
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


async def tieba_cookie_check(account_file: str) -> bool:
    """Verify the Tieba cookie at ``account_file`` is still valid.

    Probes ``tieba.baidu.com/`` and checks whether the page redirects
    to passport (== invalid) or shows personal content (== valid).

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
                TIEBA_HOME_URL,
                wait_until="domcontentloaded",
                timeout=30000,
            )
            await asyncio.sleep(2)
            current_url = page.url
            # If we're on tieba.baidu.com (not redirected to passport), cookie is valid
            if "passport" in current_url or "login" in current_url:
                _module_logger.debug(
                    "[crawler] tieba cookie check: redirected to passport (expired)"
                )
                return False
            # Also check for the login button — if present, cookie may be invalid
            try:
                login_btn = page.locator(
                    "a[href*='passport'], a[href*='login']"
                ).first
                if await login_btn.is_visible(timeout=3000):
                    _module_logger.debug(
                        "[crawler] tieba cookie check: login button visible (expired)"
                    )
                    return False
            except Exception:
                pass
            return True
        except Exception as exc:
            _module_logger.debug(
                "[crawler] tieba cookie check error: %s", exc
            )
            return False
        finally:
            await browser.close()


def resolve_account_file(account_name: str) -> str:
    """Return absolute path to ``cookies/tieba_{account_name}.json``.

    Mirrors the pattern from other standalone-login platforms (zhihu).
    """
    from conf import BASE_DIR

    if os.path.isabs(account_name) and account_name.endswith(".json"):
        Path(account_name).parent.mkdir(parents=True, exist_ok=True)
        return account_name
    p = Path(BASE_DIR) / "cookies" / f"tieba_{account_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


__all__ = ["tieba_login", "tieba_cookie_check", "resolve_account_file"]
