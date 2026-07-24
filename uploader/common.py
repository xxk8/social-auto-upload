# -*- coding: utf-8 -*-
"""Shared utility functions for all platform uploaders."""

from __future__ import annotations

import asyncio
import inspect
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from patchright.async_api import Error as PlaywrightError
from patchright.async_api import Page, async_playwright

from utils.base_social_media import set_init_script


def _msg(emoji: str, text: str) -> str:
    return f"{emoji} {text}"


async def _emit_qrcode_callback(qrcode_callback, payload: dict):
    if not qrcode_callback:
        return

    callback_result = qrcode_callback(payload)
    if inspect.isawaitable(callback_result):
        await callback_result


def _build_login_result(
    success: bool,
    status: str,
    message: str,
    account_file: str,
    qrcode: dict | None = None,
    current_url: str = "",
) -> dict:
    return {
        "success": success,
        "status": status,
        "message": message,
        "account_file": str(account_file),
        "qrcode": qrcode,
        "current_url": current_url,
    }


async def _check_login_markers(page: Page, markers: list[str]) -> bool:
    """Check if any login-related text markers are visible on the page.

    Uses ``exact=True`` to avoid false positives from substring matches
    (the root cause of the Bilibili ``cookie_invalid`` bug).

    Intended for use in both ``cookie_auth()`` and ``_is_*_login_completed()``
    to keep login detection logic consistent across all platform uploaders.

    Returns ``True`` if at least one marker is visible on the page.
    """
    for text in markers:
        try:
            locator = page.get_by_text(text, exact=True).first
            if await locator.count() and await locator.is_visible():
                return True
        except (PlaywrightError, OSError, asyncio.TimeoutError):
            continue
    return False


async def _all_login_markers_hidden(page: Page, markers: list[str]) -> bool:
    """Check that all login markers are absent or hidden.

    The inverse of ``_check_login_markers`` — returns ``True`` when none
    of the markers are visible, meaning the user has successfully logged
    in and entered an authenticated page.
    """
    for text in markers:
        try:
            locator = page.get_by_text(text, exact=True).first
            if await locator.count():
                try:
                    if await locator.is_visible():
                        return False
                except (PlaywrightError, OSError, asyncio.TimeoutError):
                    continue
        except (PlaywrightError, OSError, asyncio.TimeoutError):
            continue
    return True


async def _safe_close(closable: Any) -> None:
    """Close a browser/context resource, swallowing close-time errors."""
    if closable is None:
        return
    close = getattr(closable, "close", None)
    if close is None:
        return
    try:
        result = close()
        if inspect.isawaitable(result):
            await result
    except (PlaywrightError, OSError, asyncio.TimeoutError, RuntimeError):
        pass


def _build_launch_kwargs(
    headless: bool,
    *,
    channel: str | None = None,
    executable_path: str | None = None,
    launch_args: list[str] | None = None,
    proxy: dict[str, Any] | str | None = None,
    browser_engine: str = "chromium",
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"headless": headless}
    # Firefox does not support Chromium ``channel``; only pass when useful.
    if executable_path:
        kwargs["executable_path"] = executable_path
    elif channel and browser_engine == "chromium":
        kwargs["channel"] = channel
    if launch_args:
        kwargs["args"] = launch_args
    if proxy:
        kwargs["proxy"] = {"server": proxy} if isinstance(proxy, str) else proxy
    return kwargs


def _build_context_kwargs(
    account_file: str | None,
    storage_state: Any,
    permissions: list[str] | None,
    *,
    user_agent: str | None = None,
    viewport: dict[str, int] | None = None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    if storage_state is False:
        pass
    elif storage_state is None:
        if account_file is not None:
            kwargs["storage_state"] = account_file
    else:
        kwargs["storage_state"] = storage_state
    if permissions:
        kwargs["permissions"] = permissions
    if user_agent:
        kwargs["user_agent"] = user_agent
    if viewport:
        kwargs["viewport"] = viewport
    return kwargs


def _playwright_browser(playwright: Any, browser_engine: str) -> Any:
    engine = (browser_engine or "chromium").lower()
    if engine == "firefox":
        return playwright.firefox
    if engine == "webkit":
        return playwright.webkit
    return playwright.chromium


@asynccontextmanager
async def managed_browser(
    account_file: str | None = None,
    *,
    headless: bool = True,
    channel: str | None = "chrome",
    executable_path: str | None = None,
    launch_args: list[str] | None = None,
    storage_state: Any = None,
    permissions: list[str] | None = None,
    browser_engine: str = "chromium",
    proxy: dict[str, Any] | str | None = None,
    user_agent: str | None = None,
    viewport: dict[str, int] | None = None,
) -> AsyncIterator[Any]:
    """Launch a browser, load cookies, inject stealth, yield context.

    ``storage_state``:
    - ``None`` (default): use ``account_file`` when provided
    - ``False``: omit ``storage_state`` (no cookies)
    - other: pass through to ``browser.new_context``

    ``browser_engine``: ``chromium`` (default), ``firefox`` (TikTok), or ``webkit``.
    """
    browser = None
    context = None
    async with async_playwright() as playwright:
        launcher = _playwright_browser(playwright, browser_engine)
        browser = await launcher.launch(
            **_build_launch_kwargs(
                headless,
                channel=channel,
                executable_path=executable_path,
                launch_args=launch_args,
                proxy=proxy,
                browser_engine=browser_engine,
            )
        )
        try:
            context = await browser.new_context(
                **_build_context_kwargs(
                    account_file,
                    storage_state,
                    permissions,
                    user_agent=user_agent,
                    viewport=viewport,
                )
            )
            context = await set_init_script(context)
            yield context
        finally:
            await _safe_close(context)
            await _safe_close(browser)


@asynccontextmanager
async def managed_browser_for_login(
    *,
    headless: bool = True,
    channel: str | None = "chrome",
    executable_path: str | None = None,
    launch_args: list[str] | None = None,
    permissions: list[str] | None = None,
    browser_engine: str = "chromium",
    proxy: dict[str, Any] | str | None = None,
    user_agent: str | None = None,
    viewport: dict[str, int] | None = None,
) -> AsyncIterator[tuple[Any, Any]]:
    """Launch a browser without cookies; yield ``(context, browser)`` for login."""
    browser = None
    context = None
    async with async_playwright() as playwright:
        launcher = _playwright_browser(playwright, browser_engine)
        browser = await launcher.launch(
            **_build_launch_kwargs(
                headless,
                channel=channel,
                executable_path=executable_path,
                launch_args=launch_args,
                proxy=proxy,
                browser_engine=browser_engine,
            )
        )
        try:
            context = await browser.new_context(
                **_build_context_kwargs(
                    None,
                    False,
                    permissions,
                    user_agent=user_agent,
                    viewport=viewport,
                )
            )
            context = await set_init_script(context)
            yield context, browser
        finally:
            await _safe_close(context)
            await _safe_close(browser)
