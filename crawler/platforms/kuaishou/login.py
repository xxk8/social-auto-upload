"""Crawler-side Kuaishou login wrapper.

Reuses the uploader-side ``ks_setup`` QR-code login flow
because the cookie domain ``kuaishou.com`` is shared between:

* consumer site ``www.kuaishou.com`` — what this crawler reads
* creator site ``cp.kuaishou.com`` — what the uploader writes to
* passport host ``passport.kuaishou.com`` — where authentication happens

A successful QR-code scan on the creator-side authenticates a cookie
scoped to the parent ``kuaishou.com`` domain, so the same
storage_state JSON works for both upload AND crawl flows.

Cookie file naming convention: ``cookies/ks_<account_name>.json``
(matches ``seed_fake_data.py`` and the CLI dispatcher).
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)


async def ks_login(
    account_file: str,
    *,
    qrcode_callback: Any | None = None,
    headless: bool = False,
) -> dict[str, Any]:
    """Run the Kuaishou QR-code login flow and persist cookies to ``account_file``.

    Returns the same shape as
    ``uploader.ks_uploader.main.ks_setup(return_detail=True)``:

        ``{"success": bool, "status": str, "message": str,
           "account_file": str, "qrcode": {"image_path": str, "image_data_url": str} | None,
           "current_url": str}``

    The Web Shell uses ``qrcode["image_data_url"]`` to render the
    QR inline in the dashboard. CLI direct-path callers receive
    ``image_data_url`` over the stdout-printed result.
    """
    Path(account_file).parent.mkdir(parents=True, exist_ok=True)
    # Lazy import so importing this module doesn't trigger the
    # uploader's heavy patchright/anti_detect import chain on hosts
    # that only use the CLI dispatcher path.
    from uploader.ks_uploader.main import ks_setup

    _module_logger.info(
        "[crawler] kuaishou login flow start; account_file=%s", account_file
    )
    return await ks_setup(
        str(account_file),
        handle=True,
        return_detail=True,
        qrcode_callback=qrcode_callback,
        headless=headless,
    )


async def ks_cookie_check(account_file: str) -> bool:
    """Verify the Kuaishou cookie at ``account_file`` is still valid.

    Reuses ``uploader.ks_uploader.main.cookie_auth`` which
    performs a Playwright probe of ``cp.kuaishou.com/article/publish/video``
    — the same probe works because the cookie domain is shared with
    ``www.kuaishou.com`` (consumer site).

    Returns ``False`` if the cookie file is missing OR the probe
    detects a cookie-invalid state.
    """
    from uploader.ks_uploader.main import cookie_auth

    if not os.path.exists(account_file):
        return False
    return await cookie_auth(account_file)


def resolve_account_file(account_name: str) -> str:
    """Return absolute path to ``cookies/ks_<account_name>.json``.

    Mirrors ``cli/utils.py::resolve_account_file`` but is module-local
    so the crawler package doesn't gain a CLI dep.
    """
    from conf import BASE_DIR

    if os.path.isabs(account_name) and account_name.endswith(".json"):
        Path(account_name).parent.mkdir(parents=True, exist_ok=True)
        return account_name
    p = Path(BASE_DIR) / "cookies" / f"ks_{account_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


__all__ = ["ks_login", "ks_cookie_check", "resolve_account_file"]
