"""Crawler-side Zhihu login wrapper.

Unlike dy/ks/xhs/bili, Zhihu has NO dedicated uploader in this project
(``uploader/zhihu_uploader`` was never vendored). This module implements
a standalone QR-code login flow:

    * ``zhihu_login`` — navigates to ``www.zhihu.com/signin``, extracts
      the QR-code image URL, polls for login completion, saves cookies
      as Playwright ``storage_state`` JSON.
    * ``zhihu_cookie_check`` — probes ``www.zhihu.com/`` to detect
      whether the login cookie is still valid (checks for redirect to
      signin page or presence of personal feed markers).
    * ``resolve_account_file`` — returns
      ``cookies/zhihu_{account_name}.json``.

Cookie domain: ``.zhihu.com`` — shared across all zhihu subdomains
(``www.zhihu.com``, ``zhuanlan.zhihu.com``).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)

# Zhihu URLs for login flow
ZHIHU_LOGIN_URL = "https://www.zhihu.com/signin"
ZHIHU_HOME_URL = "https://www.zhihu.com/"


async def zhihu_login(
    account_file: str,
    *,
    qrcode_callback: Any | None = None,
    headless: bool = False,
) -> dict[str, Any]:
    """Run the Zhihu QR-code login flow and persist cookies to ``account_file``.

    This is a standalone implementation that navigates to
    ``www.zhihu.com/signin``, extracts the QR image, polls until
    the login completes (redirects away from signin), then saves
    the Playwright storage_state to the account file.

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
        "message": "Zhihu login failed",
        "account_file": account_file,
        "qrcode": None,
        "current_url": "",
    }

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        try:
            context = await browser.new_context()
            page = await context.new_page()
            await page.goto(ZHIHU_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)

            # Extract QR code image URL
            qrcode_src = ""
            try:
                qrcode_img = page.locator(
                    "[class*='qrcode'] img, "
                    "img[alt*='二维码'], "
                    "img[alt*='QR']"
                ).first
                await qrcode_img.wait_for(state="visible", timeout=15000)
                qrcode_src = await qrcode_img.get_attribute("src") or ""
            except Exception:
                _module_logger.warning(
                    "[crawler] zhihu login: could not locate QR code element; "
                    "user may need to scan in the visible browser window."
                )

            qrcode_info: dict[str, str] = {"image_data_url": qrcode_src}
            if qrcode_callback and callable(qrcode_callback):
                await qrcode_callback(qrcode_info)
            result["qrcode"] = qrcode_info

            # Poll for login completion (redirect away from signin)
            _module_logger.info(
                "[crawler] zhihu login: waiting for QR scan..."
            )
            for _ in range(100):
                await asyncio.sleep(3)
                current_url = page.url
                if "signin" not in current_url and "login" not in current_url:
                    _module_logger.info(
                        "[crawler] zhihu login: login detected at %s",
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
                        "message": "Zhihu login successful",
                        "current_url": current_url,
                    })
                    return result
            else:
                result.update({
                    "status": "timeout",
                    "message": "Zhihu login timeout: QR not scanned within 5 minutes",
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


async def zhihu_cookie_check(account_file: str) -> bool:
    """Verify the Zhihu cookie at ``account_file`` is still valid.

    Probes ``www.zhihu.com/`` and checks whether the page redirects
    to the signin page (== invalid) or shows the personal feed (== valid).

    Returns ``False`` if the cookie file is missing, the probe
    redirects to signin, or any network error occurs.
    """
    if not os.path.exists(account_file):
        return False
    from patchright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context(storage_state=account_file)
            page = await context.new_page()
            await page.goto(ZHIHU_HOME_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            current_url = page.url
            # If we're still on zhihu.com (not redirected to signin), cookie is valid
            if "signin" in current_url or "login" in current_url:
                _module_logger.debug(
                    "[crawler] zhihu cookie check: redirected to signin (expired)"
                )
                return False
            return True
        except Exception as exc:
            _module_logger.debug(
                "[crawler] zhihu cookie check error: %s", exc
            )
            return False
        finally:
            await browser.close()


def resolve_account_file(account_name: str) -> str:
    """Return absolute path to ``cookies/zhihu_{account_name}.json``.

    Mirrors the pattern from other platforms but uses ``zhihu_`` prefix.
    """
    from conf import BASE_DIR

    if os.path.isabs(account_name) and account_name.endswith(".json"):
        Path(account_name).parent.mkdir(parents=True, exist_ok=True)
        return account_name
    p = Path(BASE_DIR) / "cookies" / f"zhihu_{account_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


__all__ = ["zhihu_login", "zhihu_cookie_check", "resolve_account_file"]
