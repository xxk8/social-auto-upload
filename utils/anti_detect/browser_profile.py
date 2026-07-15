"""Consistent, platform-aware browser context options for patchright.

Instead of each uploader hard-coding its own ``viewport``, ``locale``,
``timezone``, and ``user_agent``, this module centralises the configuration
so that every platform gets a realistic, consistent fingerprint.
"""
from __future__ import annotations

import random
from typing import Any

from conf import LOCAL_CHROME_PATH

# ── Platform-specific UA & viewport presets ─────────────────────────────────

_PLATFORM_PRESETS: dict[str, dict[str, Any]] = {
    "douyin": {
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 31.2304, "longitude": 121.4737},  # Shanghai
    },
    "xiaohongshu": {
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1680, "height": 1050},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 31.2304, "longitude": 121.4737},
    },
    "kuaishou": {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 39.9042, "longitude": 116.4074},  # Beijing
    },
    "tencent": {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 22.5431, "longitude": 114.0579},  # Shenzhen
    },
    "bilibili": {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 31.2304, "longitude": 121.4737},
    },
    "youtube": {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "en-US",
        "timezone_id": "America/New_York",
        "geolocation": {"latitude": 40.7128, "longitude": -74.0060},  # NYC
    },
    "tiktok": {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "en-US",
        "timezone_id": "America/Los_Angeles",
        "geolocation": {"latitude": 34.0522, "longitude": -118.2437},  # LA
    },
    "baijiahao": {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 39.9042, "longitude": 116.4074},
    },
    "zhihu": {
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1680, "height": 1050},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 39.9042, "longitude": 116.4074},  # Beijing
    },
    "tieba": {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1920, "height": 1080},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 39.9042, "longitude": 116.4074},  # Beijing
    },
    "weibo": {
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1680, "height": 1050},
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "geolocation": {"latitude": 39.9042, "longitude": 116.4074},  # Beijing
    },
}


# ── Chrome launch args that reduce automation footprint ─────────────────────

_CHROME_LAUNCH_ARGS: list[str] = [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-setuid-sandbox",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
    "--disable-infobars",
    "--window-size=1920,1080",
    "--start-maximized",
    "--lang=zh-CN",
]


def _jitter_viewport(viewport: dict[str, int], jitter: int = 20) -> dict[str, int]:
    """Add ±*jitter* pixels to viewport dimensions to avoid exact-match fingerprints."""
    return {
        "width": viewport["width"] + random.randint(-jitter, jitter),
        "height": viewport["height"] + random.randint(-jitter, jitter),
    }


def build_browser_context_options(
    platform: str,
    account_file: str | None = None,
    headless: bool = True,
    extra_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build kwargs for ``browser.new_context()`` with anti-detection defaults.

    Args:
        platform: One of ``douyin``, ``xiaohongshu``, ``kuaishou``, ``tencent``,
            ``bilibili``, ``youtube``, ``tiktok``, ``baijiahao``.
        account_file: Path to a cookie / storage-state JSON. If provided it is
            passed as ``storage_state``.
        headless: Whether the browser runs headless. When ``True`` the stealth
            scripts are even more critical.
        extra_options: Any additional context options to merge in (overrides defaults).

    Returns:
        Dictionary suitable for unpacking into ``browser.new_context(**kwargs)``.
    """
    preset = _PLATFORM_PRESETS.get(platform.lower(), _PLATFORM_PRESETS["douyin"]).copy()

    # Jitter viewport slightly so that every launch has a subtly different size
    preset["viewport"] = _jitter_viewport(preset["viewport"])

    # Permissions that real browsers grant by default on most sites
    preset["permissions"] = ["geolocation"]

    # Storage state (cookies)
    if account_file:
        preset["storage_state"] = account_file

    # Accept-Language header
    preset["extra_http_headers"] = {
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" if preset.get("locale") == "zh-CN" else "en-US,en;q=0.9",
    }

    # Reduce color depth / device-scale-factor consistency
    preset["color_scheme"] = "light"
    preset["reduced_motion"] = "no-preference"

    # Merge user overrides last so they take precedence
    if extra_options:
        preset.update(extra_options)

    return preset


def build_browser_launch_kwargs(
    headless: bool = True,
    local_chrome_path: str | None = None,
    extra_args: list[str] | None = None,
) -> dict[str, Any]:
    """Build kwargs for ``playwright.chromium.launch()`` with anti-detection args.

    Args:
        headless: Whether to launch headless.
        local_chrome_path: Optional explicit path to a Chrome binary.
            If unset and ``LOCAL_CHROME_PATH`` is configured, that is used;
            otherwise ``channel="chrome"`` is preferred.
        extra_args: Additional command-line flags to append.

    Returns:
        Dictionary suitable for ``playwright.chromium.launch(**kwargs)``.
    """
    kwargs: dict[str, Any] = {"headless": headless}

    args = _CHROME_LAUNCH_ARGS.copy()
    if extra_args:
        args.extend(extra_args)

    kwargs["args"] = args

    if local_chrome_path:
        kwargs["executable_path"] = local_chrome_path
    elif LOCAL_CHROME_PATH:
        kwargs["executable_path"] = LOCAL_CHROME_PATH
    else:
        # 优先用系统真实 Chrome（降低 uc-secure-sdk CDP 检测概率），
        # 找不到则退回到 patchright 内置 Chromium。
        import platform as _platform
        if _platform.system() == "Darwin":
            _default_chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        elif _platform.system() == "Linux":
            _default_chrome = "/usr/bin/google-chrome"
        else:
            _default_chrome = ""
        import os as _os
        if _default_chrome and _os.path.exists(_default_chrome):
            kwargs["executable_path"] = _default_chrome
        else:
            kwargs["channel"] = "chrome"

    return kwargs
