"""One-off headless diagnostic: run ``SEARCH_URL`` +
``SEARCH_RESULT_CARD`` selector on Douyin with the operator's saved
cookies + production stealth stack, so a sandboxed agent (no GUI
display) can capture real DOM evidence on macOS.

Why this script exists separately from
``scripts/manual_dy_search_diag.py``:

* The diagnostic's ``live_dump_search_html`` is operator-driven
  headed Chromium (manual CAPTCHA / QR-login), and cannot run from
  a sandboxed agent on macOS because there's no WindowServer access.
* Adding headless / cookie-loading parameters to ``manual_dy_search_diag.py``
  would broaden its single-purpose API for a one-off need -- keeping
  the surgical refactor isolated to this file.

Production parity: this script reuses the EXACT
``_open_browser_session`` call surface that production
:py:meth:`crawler.platforms.douyin.core.DouyinCrawler._open_browser_session`
uses:

* ``utils.anti_detect.build_browser_launch_kwargs(headless=True)`` for
  ``pw.chromium.launch(**kwargs)``.
* ``utils.anti_detect.build_browser_context_options("douyin",
  account_file=<cookie>, headless=True)`` so the operator's cookie
  file is loaded at context-construction time via Playwright's
  ``storage_state`` pipeline.  That's the same path production takes,
  so cookies + matching UA/fingerprint patterns come from a single
  source -- no manual ``add_cookies`` mismatch against the helper's
  generic UA.
* ``utils.anti_detect.apply_anti_detect(context)`` for canvas/WebGL/
  AudioContext fingerprint masking, in the same order production
  applies it.
* ``wait_for_selector(SEARCH_RESULT_CARD, timeout=15s)`` instead of a
  fixed timeout -- matches production's SPA-handling contract so we
  don't dump pre-hydration DOM.

Usage::

    .venv/bin/python scripts/_dy_headless_probe.py [--keywords "峰哥亡命天涯"]

Exit codes: ``0`` = probe captured DOM (with or without cards);
``1`` = probe crashed.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from patchright.async_api import (  # noqa: E402
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)
from utils.anti_detect import (  # noqa: E402
    apply_anti_detect,
    build_browser_context_options,
    build_browser_launch_kwargs,
)

from crawler.platforms.douyin.selectors import (  # noqa: E402
    DouyinCrawlSelectors,
)


LOG_DIR = _PROJECT_ROOT / ".sau-logs"
DEFAULT_COOKIE = _PROJECT_ROOT / "cookies" / "douyin_test.json"
DEFAULT_KEYWORD = "峰哥亡命天涯"
NAVIGATION_TIMEOUT_MS = 30_000
CARD_WAIT_TIMEOUT_MS = 15_000


async def probe(keyword: str, cookie_path: Path) -> int:
    """Headless Chromium dump with production-stealth parity.

    Returns the count of ``SEARCH_RESULT_CARD`` selectors matched in
    the rendered DOM (after ``wait_for_selector`` confirms the SPA
    hydrated them).
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    out = LOG_DIR / f"last_dy_search_headless_{keyword}.html"

    if not cookie_path.exists():
        print(f"[diag] WARNING: cookie file {cookie_path} not found; "
              f"running unauthenticated (login-wall expected)")

    # Production parity: launch + context kwargs both come from
    # utils.anti_detect (the helpers production's
    # ``_open_browser_session`` itself uses).  Passing the cookie as
    # ``account_file`` causes ``build_browser_context_options`` to load
    # cookies via ``storage_state`` -- matching the operator's browser
    # fingerprint context, not a generic Chrome/126 UA.
    launch_kwargs = build_browser_launch_kwargs(headless=True)
    context_kwargs = build_browser_context_options(
        "douyin",
        account_file=str(cookie_path) if cookie_path.exists() else None,
        headless=True,
    )

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**launch_kwargs)
        try:
            context = await browser.new_context(**context_kwargs)
            context = await apply_anti_detect(context)
            page = await context.new_page()

            url = DouyinCrawlSelectors.SEARCH_URL.format(keyword=keyword)
            print(f"[diag] navigating to {url}")
            await page.goto(
                url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS
            )

            # Production's ``_async_search_stream`` does bare
            # ``page.wait_for_selector(SEARCH_RESULT_CARD,
            # timeout=15000)`` -- default Playwright ``state`` is
            # ``"visible"``.  We mirror that exact contract here so
            # ``count()`` after the wait returns the same set of cards
            # production's ``crawler.search()`` would have iterated.
            try:
                await page.wait_for_selector(
                    DouyinCrawlSelectors.SEARCH_RESULT_CARD,
                    timeout=CARD_WAIT_TIMEOUT_MS,
                )
                print("[diag] SEARCH_RESULT_CARD selector visible")
            except PlaywrightTimeoutError:
                # Selector-timeout: not necessarily a bug -- Douyin's
                # anti-bot often keeps the page scaffolding alive while
                # serving a CAPTCHA iframe or empty client-side state.
                # narrower exception class keeps unrelated errors
                # (closed context, anti-detect init failure, etc.)
                # visible so they aren't masked.
                print("[diag] SEARCH_RESULT_CARD never visible: "
                      "TimeoutError (likely anti-bot block, not bug)")

            html = await page.content()
            out.write_text(html, encoding="utf-8")
            print(f"[diag] HTML written to {out} ({len(html):,} bytes)")

            cards = await page.locator(
                DouyinCrawlSelectors.SEARCH_RESULT_CARD
            ).count()
            print(f"[diag] SEARCH_RESULT_CARD count: {cards}")

            page_title = await page.title()
            body_text = (await page.locator("body").inner_text())[:500]
            print(f"[diag] <title>: {page_title!r}")
            print(f"[diag] body[:500]: {body_text!r}")

            login_wall_markers = (
                "登录后查看",
                "扫码登录",
                "人脸验证",
                "滑块验证",
                "登录抖音",
            )
            for marker in login_wall_markers:
                if marker in html:
                    print(f"[diag] login-wall marker detected: {marker!r}")

            return cards
        finally:
            await browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keywords",
        default=DEFAULT_KEYWORD,
        help=f"Douyin search keyword (default: {DEFAULT_KEYWORD!r})",
    )
    parser.add_argument(
        "--cookie",
        type=Path,
        default=DEFAULT_COOKIE,
        help=f"Playwright cookie JSON (default: {DEFAULT_COOKIE})",
    )
    args = parser.parse_args()

    try:
        cards = asyncio.run(probe(args.keywords, args.cookie))
    except Exception as exc:
        print(f"[diag] probe crashed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    verdict = "cards rendered" if cards > 0 else "anti-bot login wall -- see HTML"
    print(f"[diag] OK: {cards} {verdict} for keyword {args.keywords!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
