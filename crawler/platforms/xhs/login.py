"""Crawler-side Xiaohongshu login wrapper.

Reuses the uploader-side ``xiaohongshu_setup`` QR-code login flow
because the cookie domain ``.xiaohongshu.com`` is shared between:

* consumer site ``www.xiaohongshu.com`` — what this crawler reads
* creator site ``creator.xiaohongshu.com`` — what the uploader writes to

A successful QR-code scan on the creator-side authenticates a cookie
scoped to the parent ``xiaohongshu.com`` domain, so the same
storage_state JSON works for both upload AND crawl flows. This is the
single-source-of-truth reason we don't re-implement the login on the
crawler side — the existing uploader-side flow already covers every
account the user has saved in ``cookies/xiaohongshu_<account>.json``.

Why not vendor MediaCrawler's xhs/login.py: that file is keyed off
*MediaCrawler's own context/stealth* + *its own qrcode_callback
signature*. Reusing ours gives us consistent identity across the
uploader + crawler flows (same stealth flags, same ``xiaohongshu_logger``
emoji lines, same image-data-url payload format), and reuses the
logic that has been hardened against XHS-side modal animation
breakage (cf. ``uploader/xiaohongshu_uploader/main.py::_open_xhs_qrcode_panel``).
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)


async def xhs_login(
    account_file: str,
    *,
    qrcode_callback: Any | None = None,
    headless: bool = False,
) -> dict[str, Any]:
    """Run the XHS QR-code login flow and persist cookies to ``account_file``.

    Returns the same shape as ``uploader.xiaohongshu_uploader.xiaohongshu_setup(return_detail=True)``:

        ``{"success": bool, "status": str, "message": str,
           "account_file": str, "qrcode": {"image_path": str, "image_data_url": str} | None,
           "current_url": str}``

    The Web Shell uses ``qrcode["image_data_url"]`` to render the
    QR inline in the dashboard (round-OPT-acct-qr 2026-07-10
    removed the local PNG round-trip). CLI direct-path callers
    receive ``image_data_url`` over the stdout-printed result.
    """
    Path(account_file).parent.mkdir(parents=True, exist_ok=True)
    # Lazy import so importing this module doesn't trigger the
    # uploader's heavy patchright/anti_detect import chain on hosts
    # that only use the CLI dispatcher path.
    from uploader.xiaohongshu_uploader.main import xiaohongshu_setup

    _module_logger.info(
        "[crawler] xiaohongshu login flow start; account_file=%s", account_file
    )
    return await xiaohongshu_setup(
        str(account_file),
        handle=True,
        return_detail=True,
        qrcode_callback=qrcode_callback,
        headless=headless,
    )


async def xhs_cookie_check(account_file: str) -> bool:
    """Verify the XHS cookie at ``account_file`` is still valid.

    Reuses ``uploader.xiaohongshu_uploader.main.cookie_auth`` which
    performs a Playwright probe of ``creator.xiaohongshu.com/publish``
    — same probe works because the cookie domain is shared with
    ``www.xiaohongshu.com`` (consumer site).

    Returns ``False`` if the cookie file is missing OR the probe
    redirects to ``/login``.
    """
    from uploader.xiaohongshu_uploader.main import cookie_auth

    if not os.path.exists(account_file):
        return False
    return await cookie_auth(account_file)


def resolve_account_file(account_name: str) -> str:
    """Return absolute path to ``cookies/xiaohongshu_<account_name>.json``.

    Mirrors ``cli/utils.py::resolve_account_file`` but is module-local
    so the crawler package doesn't gain a CLI dep.
    """
    from conf import BASE_DIR

    if os.path.isabs(account_name) and account_name.endswith(".json"):
        Path(account_name).parent.mkdir(parents=True, exist_ok=True)
        return account_name
    p = Path(BASE_DIR) / "cookies" / f"xiaohongshu_{account_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


# Tiny helper: keep this module's exports predictable so a `from
# crawler.platforms.xhs.login import ...` works for downstream callers.
__all__ = ["xhs_login", "xhs_cookie_check", "resolve_account_file"]
