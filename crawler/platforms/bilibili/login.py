"""Crawler-side Bilibili login wrapper.

Reuses the uploader-side ``bilibili_setup`` QR-code login flow
because the cookie domain ``.bilibili.com`` is shared across:

* consumer site ``www.bilibili.com`` — what this crawler reads
* search site ``search.bilibili.com`` — search results
* creator site ``member.bilibili.com`` — what the uploader writes to
* passport ``passport.bilibili.com`` — where authentication happens

A successful QR-code scan on the passport side authenticates a cookie
scoped to the parent ``bilibili.com`` domain, so the same cookie file
works for both upload AND crawl flows.

Cookie format note:
    Bilibili's uploader stores cookies in **biliup format** (a list of
    cookie dicts with ``name`` / ``value`` / ``domain`` / ``path`` /
    ``expires`` keys), NOT as Playwright ``storage_state`` JSON. The
    ``_open_browser_session`` in ``core.py`` handles the conversion
    using ``_convert_biliup_cookies_to_storage_state`` from the uploader.

Cookie file naming convention: ``cookies/bilibili_{account_name}.json``
(matches ``cli/platforms/bilibili.py`` convention).
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)


async def bili_login(
    account_file: str,
    *,
    qrcode_callback: Any | None = None,
    headless: bool = False,
) -> dict[str, Any]:
    """Run the Bilibili QR-code login flow and persist cookies to ``account_file``.

    Returns the same shape as
    ``uploader.bilibili_uploader.main.bilibili_setup(return_detail=True)``:

        ``{"success": bool, "status": str, "message": str,
           "account_file": str, "qrcode": {"image_path": str, "image_data_url": str} | None,
           "current_url": str}``

    The Web Shell uses ``qrcode["image_data_url"]`` to render the
    QR inline in the dashboard.
    """
    Path(account_file).parent.mkdir(parents=True, exist_ok=True)
    # Lazy import so importing this module doesn't trigger the
    # uploader's heavy patchright/anti_detect import chain on hosts
    # that only use the CLI dispatcher path.
    from uploader.bilibili_uploader.main import bilibili_setup

    _module_logger.info(
        "[crawler] bilibili login flow start; account_file=%s", account_file
    )
    return await bilibili_setup(
        str(account_file),
        handle=True,
        return_detail=True,
        qrcode_callback=qrcode_callback,
        headless=headless,
    )


async def bili_cookie_check(account_file: str) -> bool:
    """Verify the Bilibili cookie at ``account_file`` is still valid.

    Reuses ``uploader.bilibili_uploader.main.bilibili_cookie_auth`` which
    calls the official Bilibili nav API (``api.bilibili.com/x/web-interface/nav``)
    and checks ``data.isLogin`` — faster and more reliable than DOM probing.

    Returns ``False`` if the cookie file is missing, the API returns
    not-logged-in, or any network error occurs.
    """
    from uploader.bilibili_uploader.main import bilibili_cookie_auth

    if not os.path.exists(account_file):
        return False
    return await bilibili_cookie_auth(account_file)


def resolve_account_file(account_name: str) -> str:
    """Return absolute path to ``cookies/bilibili_{account_name}.json``.

    Mirrors ``cli/utils.py::resolve_account_file`` but is module-local
    so the crawler package doesn't gain a CLI dep.
    """
    from conf import BASE_DIR

    if os.path.isabs(account_name) and account_name.endswith(".json"):
        Path(account_name).parent.mkdir(parents=True, exist_ok=True)
        return account_name
    p = Path(BASE_DIR) / "cookies" / f"bilibili_{account_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


__all__ = ["bili_login", "bili_cookie_check", "resolve_account_file"]
