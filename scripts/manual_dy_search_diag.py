"""Operational diagnostic: confirm the ``'Browser' object has no
attribute 'aclose'`` bug is fixed.

Two surfaces:

1. **Surgical smoke test (always works)**: drives the patched
   ``_run_async_gen`` with a fake asyncgen that opens a fake
   ``Browser``-like object, yields one row, then closes the fake
   ``Browser`` on cleanup -- mirrors the production cleanup chain
   ``_async_search_stream`` runs through ``_open_browser_session``.
   Pulls one row mid-flight then ``.close()``s the sync gen to
   simulate the SSE client disconnect that triggered the bug.
   Exit 0 = clean; exit 1 = regression.

2. **Headed live crawl (operator-controlled)**: launch Chromium
   with ``headless=False`` so the operator can interact with any
   CAPTCHA / QR login / age gate Douyin serves.  Saves the rendered
   DOM to ``.sau-logs/last_dy_search.html`` for offline grep.  This
   surface is provided as a callable function for the operator to
   invoke from ``python -i``; the auto ``__main__`` block below
   intentionally does NOT run it (requires live browser + cookies).

Run the smoke test::

    .venv/bin/python scripts/manual_dy_search_diag.py

Exit codes (smoke test only): ``0`` = patch intact, ``1`` =
regression surfaced.  Headed-crawl-only exit code (``2``) is reserved
for a future revision that auto-detects a headed Chromium path.
"""
from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Ensure project root is on ``sys.path`` so ``from crawler...`` works
# when this script is invoked from any directory.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from crawler.platforms.douyin.core import DouyinCrawler  # noqa: E402

LOG_DIR = _PROJECT_ROOT / ".sau-logs"


# ── 1. Surgical smoke test on the patched _run_async_gen ────────────


def probe_patched_path() -> bool:
    """Sync probe of the patched ``_run_async_gen`` -- no asyncio.run
    wrapper needed because ``_run_async_gen`` is itself sync-over-async
    (``asyncio.new_event_loop()`` inside it).
    """
    class FakeBrowser:
        async def close(self) -> None:
            pass

    async def probe_gen():
        browser = FakeBrowser()
        try:
            yield {"_browser": browser}
            yield {"_browser": browser}
        finally:
            await browser.close()

    crawler = DouyinCrawler()
    sync_stream = crawler._run_async_gen(probe_gen())

    # Pull one row mid-flight, then close -- simulates the SSE
    # client-disconnect scenario.
    next(sync_stream)
    try:
        sync_stream.close()
    except AttributeError as exc:
        if "aclose" in str(exc):
            print(
                f"[diag] REGRESSED: AttributeError surfaced: {exc}",
                file=sys.stderr,
            )
            return False
        raise
    print("[diag] OK: patched _run_async_gen completes cleanly on disconnect")
    return True


# ── 2. Optional: headed live crawl with DOM dump ───────────────────


@asynccontextmanager
async def _fake_browser_session_for_diag():
    """Tiny stand-in for ``_open_browser_session`` that yields a
    Chromium page -- lets the operator interact with the live DOM in
    headed mode if they need to solve a CAPTCHA locally.

    Uses patchright directly; no uploader-stack stealth, so the
    operator can observe raw Douyin server responses.
    """
    from patchright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        try:
            context = await browser.new_context()
            page = await context.new_page()
            yield page
        finally:
            await browser.close()


async def live_dump_search_html() -> int:
    """Headed crawl: navigate to the search URL with the operator's
    keyword, sleep so they can interact with the page, then dump
    the final HTML.  Returns the count of ``SEARCH_RESULT_CARD``
    selectors found in the rendered DOM."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    out = LOG_DIR / "last_dy_search.html"

    keyword = "峰哥亡命天涯"
    from crawler.platforms.douyin.selectors import DouyinCrawlSelectors

    async with _fake_browser_session_for_diag() as page:
        url = DouyinCrawlSelectors.SEARCH_URL.format(keyword=keyword)
        print(f"[diag] navigating to {url} ... (operator can interact)")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # Give the operator 30 seconds to interact with any CAPTCHA /
        # QR / age gate that the anti-bot wall serves.
        await asyncio.sleep(30)
        html = await page.content()
        out.write_text(html, encoding="utf-8")
        print(f"[diag] wrote rendered HTML to {out}")
        card_count = await page.locator(
            DouyinCrawlSelectors.SEARCH_RESULT_CARD
        ).count()
        print(
            f"[diag] {card_count} search-result cards rendered; "
            f"if 0 check the saved HTML for login walls / age gates"
        )
        return card_count


if __name__ == "__main__":
    # ``probe_patched_path`` is sync (its inner ``_run_async_gen``
    # already manages its own asyncio loop), so we don't wrap in
    # ``asyncio.run`` -- that would create a second loop and trigger
    # ``RuntimeError: Cannot run the event loop while another loop is
    # running``.
    ok = probe_patched_path()
    sys.exit(0 if ok else 1)
