"""Lightweight per-platform browser pool for patchright/Playwright.

The pool caches a single ``Browser`` instance per (platform, headless)
tuple. Each login still creates a fresh ``BrowserContext`` (with its own
cookies / storage state / anti-detect scripts) so session isolation is
preserved.

Why cache only the Browser, not the Context?
  * Launching Chromium is the expensive part (~1-3s on a warm machine,
    up to 5-8s on cold start). Creating a new context is cheap (~50ms).
  * Reusing contexts across accounts would leak cookies, localStorage,
    and anti-fingerprint state — a security/privacy bug.

Intended usage::

    from utils.browser_pool import browser_pool

    browser = await browser_pool.get_browser("douyin", headless=False)
    try:
        context = await browser.new_context(...)
        ...
    finally:
        await browser_pool.release_browser("douyin", headless=False)

The pool keeps a reference count; the browser is closed when the ref
count drops to zero or when ``close_all()`` is called.
"""
from __future__ import annotations

import asyncio
import weakref
from typing import Any

from patchright.async_api import Browser, Playwright, async_playwright

from utils.anti_detect.browser_profile import build_browser_launch_kwargs


class _BrowserPoolEntry:
    """Internal entry holding a launched browser and its reference count."""

    def __init__(self, browser: Browser, playwright: Playwright):
        self.browser = browser
        self.playwright = playwright
        self.ref_count = 0
        self.lock = asyncio.Lock()


class BrowserPool:
    """Singleton browser pool keyed by (platform, headless)."""

    def __init__(self) -> None:
        self._pool: dict[tuple[str, bool], _BrowserPoolEntry] = {}
        self._global_lock = asyncio.Lock()

    async def get_browser(self, platform: str, headless: bool = True) -> Browser:
        """Return a cached or newly launched Browser for the given platform."""
        key = (platform, headless)
        async with self._global_lock:
            entry = self._pool.get(key)
            if entry is None:
                entry = _BrowserPoolEntry(browser=None, playwright=None)  # type: ignore[arg-type]
                self._pool[key] = entry

        async with entry.lock:
            if entry.browser is None:
                playwright = await async_playwright().start()
                try:
                    browser = await playwright.chromium.launch(
                        **build_browser_launch_kwargs(headless=headless),
                    )
                except Exception:
                    await playwright.stop()
                    async with self._global_lock:
                        self._pool.pop(key, None)
                    raise
                entry.playwright = playwright
                entry.browser = browser
            entry.ref_count += 1
            return entry.browser

    async def release_browser(self, platform: str, headless: bool = True) -> None:
        """Decrement ref count and close the browser if no users remain."""
        key = (platform, headless)
        async with self._global_lock:
            entry = self._pool.get(key)
            if entry is None:
                return

        async with entry.lock:
            entry.ref_count = max(0, entry.ref_count - 1)
            if entry.ref_count == 0:
                if entry.browser is not None:
                    try:
                        await entry.browser.close()
                    except Exception:
                        pass
                    entry.browser = None  # type: ignore[assignment]
                if entry.playwright is not None:
                    try:
                        await entry.playwright.stop()
                    except Exception:
                        pass
                    entry.playwright = None
                async with self._global_lock:
                    self._pool.pop(key, None)

    async def close_all(self) -> None:
        """Close every cached browser and stop all playwright instances."""
        async with self._global_lock:
            entries = list(self._pool.values())
            self._pool.clear()

        for entry in entries:
            async with entry.lock:
                if entry.browser is not None:
                    try:
                        await entry.browser.close()
                    except Exception:
                        pass
                if entry.playwright is not None:
                    try:
                        await entry.playwright.stop()
                    except Exception:
                        pass


# Global singleton instance.
browser_pool: BrowserPool = BrowserPool()
