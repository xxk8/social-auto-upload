"""XHS X-Bogus / X-S / X-T / X-S-Common / X-B3-Traceid header signing.

Wraps the ``xhshow`` library (Cloxl/xhshow on PyPI, the canonical
pure-Python replacement for MediaCrawler's deprecated ``mbd.js``
JavaScript helper). The vendoring decision is recorded in
``requirements.txt`` — we depend on the library rather than copying
the upstream ``xhs_sign.py`` because MediaCrawler itself migrated
away from mbd.js to xhshow, the upstream maintainers ship the
break-fix churn, and bundling the JS would force us to add Node.js
to a Python-only Docker image.

Round-MC-2024-xhs-signing. This module is the entry point for the
``SAU_XHS_SIGN_MODE=sign`` opt-in path. The complementary default
fall-back path (``SAU_XHS_SIGN_MODE=dom``, the Playwright DOM
scraping from round-MC-2024-xhs-realization) lives in
:file:`crawler/platforms/xhs/core.py` unchanged.

Failure mode (thinker-with-files-gemini pitfall #2 — missing
dependency): if ``xhshow`` is not installed at runtime, ALL
:class:`XhsSigner` constructors raise ``RuntimeError(unavailable)``.
Imports happen at module top so a missing package fails loudly on
``import crawler.platforms.xhs.sign`` — the caller is responsible
for catching and falling back to ``"dom"``. There is no silent
degradation to a half-broken signer; that path produced bugs in
History of the codebase.

Trade-off obsolescence risk (thinker pitfall #1 — rate limits):
the ``"sign"`` path is much faster than DOM mode (no Chromium
launch, no DOM rendering), so it will hit XHS rate-limits
approximately 10× faster. Per-call delay is computed as
``2 × SAU_CRAWLER_REQUEST_DELAY`` in
:mod:`crawler.platforms.xhs.core` to compensate. Operators tuning
for throughput should monitor the XHS 429-response rate and bump
the multiplier if needed.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

_module_logger = logging.getLogger(__name__)


# Module-level availability probe — failure is loud (thinker pitfall 2).
# Tests monkeypatch ``_HAS_XHSHOW`` to force the missing-dep path.
try:
    import xhshow  # type: ignore[import]
    _HAS_XHSHOW = True
    _IMPORT_ERROR: Exception | None = None
except ImportError as exc:  # pragma: no cover — environment without xhshow
    _HAS_XHSHOW = False
    _IMPORT_ERROR = exc
    xhshow = None  # type: ignore[assignment]


def is_xhshow_available() -> bool:
    """True iff the ``xhshow`` library is importable in this env."""
    return _HAS_XHSHOW


def xhshow_import_error() -> Exception | None:
    """Original ``ImportError`` if xhshow is missing, else ``None``.

    Surfaced so an operator sees a clear fix-path message: "install
    xhshow OR set ``SAU_XHS_SIGN_MODE=dom``".
    """
    return _IMPORT_ERROR


DEFAULT_BASE_URL = "https://www.xiaohongshu.com"


class XhsSigner:
    """Wraps ``xhshow.Xhshow`` to produce signed request headers.

    Construct via :meth:`from_cookie_storage_state` for normal
    user-account flows; raw ``XhsSigner()`` is only for tests /
    synthetic cookie injection. Both constructors raise
    ``RuntimeError`` if xhshow is unavailable — see
    :func:`is_xhshow_available` for the precondition check.
    """

    def __init__(self, base_url: str = DEFAULT_BASE_URL) -> None:
        if not _HAS_XHSHOW:
            raise RuntimeError(
                f"xhshow not installed ({xhshow_import_error()}); cannot "
                f"sign requests. Either `pip install xhshow` OR set "
                f"SAU_XHS_SIGN_MODE=dom to bypass signing."
            )
        self._base_url = base_url
        self._client = xhshow.Xhshow()

    @property
    def base_url(self) -> str:
        return self._base_url

    @classmethod
    def from_cookie_storage_state(
        cls,
        cookie_storage_state_path: str | Path,
        base_url: str = DEFAULT_BASE_URL,
    ) -> "XhsSigner":
        """Build a signer from a Playwright ``storage_state`` JSON.

        XHS's signing algorithm requires the ``a1`` cookie (XHS's
        browser-side tracking token). If missing, raise
        :class:`ValueError` so the operator sees a clear fix-path:
        ``sau xiaohongshu login --account <name>`` to refresh.

        The cookie string format xhshow expects is
        ``"name=value; name=value; ..."`` — assembled from ALL cookies
        in the storage_state so ``web_session``, ``a1``, etc. are all
        available to the signing checksum.
        """
        if not _HAS_XHSHOW:
            raise RuntimeError(
                f"xhshow not installed ({xhshow_import_error()}); cannot "
                f"sign requests. Either `pip install xhshow` OR set "
                f"SAU_XHS_SIGN_MODE=dom."
            )
        path = Path(cookie_storage_state_path)
        if not path.exists():
            raise FileNotFoundError(f"cookie storage_state file not found: {path}")
        with path.open("r", encoding="utf-8") as f:
            state = json.load(f)
        cookies = state.get("cookies", []) if isinstance(state, dict) else []
        cookie_dict = {
            c["name"]: c["value"]
            for c in cookies
            if isinstance(c, dict) and c.get("name") and c.get("value") is not None
        }
        if "a1" not in cookie_dict:
            raise ValueError(
                f"No `a1` cookie in {path}; XHS signing requires it. "
                f"Run `sau xiaohongshu login --account <name>` to refresh "
                f"the cookie file."
            )
        # Bypass ``__init__`` (which would re-check xhshow + create a
        # second Xhshow instance) and inject the cookie string directly.
        signer = cls.__new__(cls)
        signer._base_url = base_url
        signer._client = xhshow.Xhshow()
        signer._client.cookie = "; ".join(f"{k}={v}" for k, v in cookie_dict.items())
        return signer

    def sign(
        self,
        *,
        uri: str,
        method: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        """Generate signed headers for one XHS request.

        Args:
            uri: API path, e.g. ``/api/sns/web/v1/search/notes``.
            method: HTTP method (``"GET"`` | ``"POST"``).
            data: For ``GET``, query params (dict). For ``POST``, the
                JSON body (dict).

        Returns:
            Header dict with keys ``x-s``, ``x-t``, ``x-s-common``,
            ``x-b3-traceid``. xhshow returns uppercase variants
            (``X-s`` etc.); we normalize to lowercase to match what
            XHS actually inspects on the wire.

        Raises:
            ValueError: if ``method`` is unrecognized.
            RuntimeError: if ``xhshow.sign`` fails mid-call (e.g. bad
                payload shape, xhshow bug).
        """
        method_upper = method.upper()
        if method_upper == "GET":
            # xhshow wants the GET query dict as-is; it URL-encodes internally.
            payload: Any = data or {}
        elif method_upper == "POST":
            # xhshow wants STRICT JSON for POST payloads (thinker pitfall 3:
            # no spaces, deterministic key order, ensure_ascii=False so
            # Chinese chars stay readable for the checksum).
            payload = json.dumps(data or {}, separators=(",", ":"), ensure_ascii=False)
        else:
            raise ValueError(f"Unsupported HTTP method for XHS signing: {method!r}")
        try:
            signed = self._client.sign(
                uri=uri,
                data=payload,
                method=method_upper,
            )
        except Exception as exc:
            raise RuntimeError(
                f"xhshow.sign failed for {method_upper} {uri}: {exc}"
            ) from exc
        # Lowercase-normalize so callers can probe with HTTP/1.1's
        # case-insensitive header expectations without first
        # case-folding every key.
        return {
            "x-s": signed.get("X-s", signed.get("x-s", "")),
            "x-t": signed.get("X-t", signed.get("x-t", "")),
            "x-s-common": signed.get("X-s-common", signed.get("x-s-common", "")),
            "x-b3-traceid": signed.get("X-b3-traceid", signed.get("x-b3-traceid", "")),
        }
