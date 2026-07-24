# -*- coding: utf-8 -*-
"""Unit tests for uploader.common managed_browser helpers (mocked patchright)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uploader.common import managed_browser, managed_browser_for_login


def _make_playwright_stack():
    context = AsyncMock(name="context")
    context.close = AsyncMock()
    browser = AsyncMock(name="browser")
    browser.new_context = AsyncMock(return_value=context)
    browser.close = AsyncMock()
    chromium = MagicMock()
    chromium.launch = AsyncMock(return_value=browser)
    playwright = MagicMock()
    playwright.chromium = chromium

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=playwright)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm, playwright, browser, context


def test_managed_browser_yields_context_and_closes():
    cm, _playwright, browser, context = _make_playwright_stack()

    async def _run():
        with (
            patch("uploader.common.async_playwright", return_value=cm),
            patch("uploader.common.set_init_script", new_callable=AsyncMock) as set_init,
        ):
            set_init.side_effect = lambda ctx: ctx
            async with managed_browser("cookies.json", headless=True) as yielded:
                assert yielded is context

            set_init.assert_awaited_once_with(context)
            context.close.assert_awaited()
            browser.close.assert_awaited()

    asyncio.run(_run())


def test_managed_browser_closes_when_body_raises():
    cm, _playwright, browser, context = _make_playwright_stack()

    async def _run():
        with (
            patch("uploader.common.async_playwright", return_value=cm),
            patch("uploader.common.set_init_script", new_callable=AsyncMock) as set_init,
        ):
            set_init.side_effect = lambda ctx: ctx
            with pytest.raises(RuntimeError, match="boom"):
                async with managed_browser("cookies.json"):
                    raise RuntimeError("boom")

            context.close.assert_awaited()
            browser.close.assert_awaited()

    asyncio.run(_run())


def test_managed_browser_for_login_yields_pair_and_closes():
    cm, _playwright, browser, context = _make_playwright_stack()

    async def _run():
        with (
            patch("uploader.common.async_playwright", return_value=cm),
            patch("uploader.common.set_init_script", new_callable=AsyncMock) as set_init,
        ):
            set_init.side_effect = lambda ctx: ctx
            async with managed_browser_for_login(headless=False) as pair:
                assert pair == (context, browser)

            browser.new_context.assert_awaited_once_with()
            context.close.assert_awaited()
            browser.close.assert_awaited()

    asyncio.run(_run())


def test_managed_browser_default_storage_state_is_account_file():
    cm, _playwright, browser, _context = _make_playwright_stack()

    async def _run():
        with (
            patch("uploader.common.async_playwright", return_value=cm),
            patch("uploader.common.set_init_script", new_callable=AsyncMock) as set_init,
        ):
            set_init.side_effect = lambda ctx: ctx
            async with managed_browser("/tmp/account.json"):
                pass

            browser.new_context.assert_awaited_once_with(storage_state="/tmp/account.json")

    asyncio.run(_run())


def test_managed_browser_storage_state_false_omits_storage_state():
    cm, _playwright, browser, _context = _make_playwright_stack()

    async def _run():
        with (
            patch("uploader.common.async_playwright", return_value=cm),
            patch("uploader.common.set_init_script", new_callable=AsyncMock) as set_init,
        ):
            set_init.side_effect = lambda ctx: ctx
            async with managed_browser("cookies.json", storage_state=False):
                pass

            browser.new_context.assert_awaited_once_with()

    asyncio.run(_run())


def test_managed_browser_firefox_engine_launches_firefox():
    cm, playwright, browser, context = _make_playwright_stack()
    firefox = MagicMock()
    firefox.launch = AsyncMock(return_value=browser)
    playwright.firefox = firefox

    async def _run():
        with (
            patch("uploader.common.async_playwright", return_value=cm),
            patch("uploader.common.set_init_script", new_callable=AsyncMock) as set_init,
        ):
            set_init.side_effect = lambda ctx: ctx
            async with managed_browser(
                "cookies.json",
                browser_engine="firefox",
                channel=None,
            ) as yielded:
                assert yielded is context

            firefox.launch.assert_awaited_once()
            # channel must not be passed to firefox launch
            kwargs = firefox.launch.await_args.kwargs
            assert "channel" not in kwargs

    asyncio.run(_run())


def test_managed_browser_proxy_and_user_agent():
    cm, playwright, browser, _context = _make_playwright_stack()

    async def _run():
        with (
            patch("uploader.common.async_playwright", return_value=cm),
            patch("uploader.common.set_init_script", new_callable=AsyncMock) as set_init,
        ):
            set_init.side_effect = lambda ctx: ctx
            async with managed_browser(
                "cookies.json",
                proxy="http://127.0.0.1:7890",
                user_agent="TestAgent/1.0",
                channel=None,
            ):
                pass

            assert playwright.chromium.launch.await_args.kwargs.get("proxy") == {
                "server": "http://127.0.0.1:7890"
            }
            browser.new_context.assert_awaited_once_with(
                storage_state="cookies.json",
                user_agent="TestAgent/1.0",
            )

    asyncio.run(_run())
