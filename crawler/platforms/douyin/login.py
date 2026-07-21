"""Crawler-side Douyin login wrapper.

Reuses the uploader-side ``douyin_setup`` QR-code login flow
because the cookie domain ``.douyin.com`` is shared between:

* consumer site ``www.douyin.com`` — what this crawler reads
* creator site ``creator.douyin.com`` — what the uploader writes to

A successful QR-code scan on the creator-side authenticates a cookie
scoped to the parent ``douyin.com`` domain, so the same
storage_state JSON works for both upload AND crawl flows.

Why not vendor MediaCrawler's dy/login.py: that file is keyed off
MediaCrawler's own context/stealth + QR-code-callback signature.
Reusing ours gives us consistent identity across the uploader +
crawler flows (same stealth flags, same logger convention).
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)


async def dy_login(
    account_file: str,
    *,
    qrcode_callback: Any | None = None,
    headless: bool = False,
) -> dict[str, Any]:
    """Run the Douyin QR-code login flow and persist cookies to ``account_file``.

    Returns the same shape as
    ``uploader.douyin_uploader.main.douyin_setup(return_detail=True)``:

        ``{"success": bool, "status": str, "message": str,
           "account_file": str, "qrcode": {"image_path": str, "image_data_url": str} | None,
           "current_url": str}``
    """
    Path(account_file).parent.mkdir(parents=True, exist_ok=True)
    # Lazy import so importing this module doesn't trigger the
    # uploader's heavy patchright/anti_detect import chain on hosts
    # that only use the CLI dispatcher path.
    from uploader.douyin_uploader.main import douyin_setup

    _module_logger.info(
        "[crawler] douyin login flow start; account_file=%s", account_file
    )
    return await douyin_setup(
        str(account_file),
        handle=True,
        return_detail=True,
        qrcode_callback=qrcode_callback,
        headless=headless,
    )


async def dy_cookie_check(account_file: str) -> bool:
    """Verify the Douyin cookie at ``account_file`` is still valid.

    Reuses ``uploader.douyin_uploader.main.cookie_auth`` which
    performs a Playwright probe of ``creator.douyin.com/creator-micro``
    — the same probe works because the cookie domain is shared with
    ``www.douyin.com`` (consumer site).

    Returns ``False`` if the cookie file is missing OR the probe
    redirects to the login page.
    """
    from uploader.douyin_uploader.main import cookie_auth

    if not os.path.exists(account_file):
        return False
    return await cookie_auth(account_file)


def resolve_account_file(account_name: str) -> str:
    """Return absolute path to ``cookies/douyin_<account_name>.json``.

    Mirrors ``cli/utils.py::resolve_account_file`` but is module-local
    so the crawler package doesn't gain a CLI dep.
    """
    from conf import BASE_DIR

    if os.path.isabs(account_name) and account_name.endswith(".json"):
        Path(account_name).parent.mkdir(parents=True, exist_ok=True)
        return account_name
    p = Path(BASE_DIR) / "cookies" / f"douyin_{account_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


__all__ = ["dy_login", "dy_cookie_check", "resolve_account_file"]
