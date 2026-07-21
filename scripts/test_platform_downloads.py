#!/usr/bin/env python3
"""Test which video/image platforms are downloadable via yt-dlp / patchright.

Tests each platform by:
  1. Using yt-dlp extract_info(download=False) to check if the extractor works
  2. For browser-first platforms (Douyin, Kuaishou, Xiaohongshu), notes they need patchright
  3. Reporting results in a clean table.

Usage:
    python scripts/test_platform_downloads.py [--url-only]

Flags:
    --url-only    Print a copy-pasteable URL table without running tests.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

KNOWN_BROKEN_YTDLP = ("douyin.com", "kuaishou.com", "xiaohongshu.com", "xhslink.com")


@dataclass
class PlatformTest:
    key: str
    name: str
    cn_name: str
    test_url: str
    engine_expected: str
    ytdlp_extractor: str | None = None
    needs_browser: bool = False
    result: str | None = None  # 'ok' | 'fail' | 'skip' | None
    detail: str = ""
    supports_note: bool = False  # 图文发布


PLATFORMS: list[PlatformTest] = [
    # ── 国内短视频 ──────────────────────────────────────────
    PlatformTest(
        key="douyin",
        name="Douyin",
        cn_name="抖音",
        test_url="https://v.douyin.com/example-share/",
        engine_expected="patchright (browser)",
        needs_browser=True,
        ytdlp_extractor="douyin",
        supports_note=True,
    ),
    PlatformTest(
        key="kuaishou",
        name="Kuaishou",
        cn_name="快手",
        test_url="https://v.kuaishou.com/example",
        engine_expected="patchright (browser)",
        needs_browser=True,
        ytdlp_extractor=None,  # no extractor exists
        supports_note=True,
    ),
    PlatformTest(
        key="xiaohongshu",
        name="Xiaohongshu",
        cn_name="小红书",
        test_url="https://www.xiaohongshu.com/explore/example",
        engine_expected="patchright (browser)",
        needs_browser=True,
        ytdlp_extractor="xiaohongshu",
        supports_note=True,
    ),
    PlatformTest(
        key="bilibili",
        name="Bilibili",
        cn_name="B站",
        test_url="https://www.bilibili.com/video/BV1GJ411x7",
        engine_expected="yt-dlp / BBDown",
        ytdlp_extractor="bilibili",
    ),
    PlatformTest(
        key="ixigua",
        name="XiGua",
        cn_name="西瓜视频",
        test_url="https://www.ixigua.com/example",
        engine_expected="yt-dlp",
        ytdlp_extractor="ixigua",
    ),
    PlatformTest(
        key="pipix",
        name="PiPiXia",
        cn_name="皮皮虾",
        test_url="https://www.pipix.com/example",
        engine_expected="yt-dlp",
        ytdlp_extractor="pipix",
    ),
    PlatformTest(
        key="weishi",
        name="WeiShi",
        cn_name="微视",
        test_url="https://weishi.qq.com/example",
        engine_expected="yt-dlp",
        ytdlp_extractor="weishi",
    ),
    PlatformTest(
        key="miaopai",
        name="MiaoPai",
        cn_name="秒拍",
        test_url="https://www.miaopai.com/example",
        engine_expected="yt-dlp",
        ytdlp_extractor="miaopai",
    ),
    # ── 海外短视频 ──────────────────────────────────────────
    PlatformTest(
        key="tiktok",
        name="TikTok",
        cn_name="TikTok",
        test_url="https://www.tiktok.com/@example/video/123456",
        engine_expected="yt-dlp",
        ytdlp_extractor="tiktok",
    ),
    PlatformTest(
        key="twitter",
        name="X (Twitter)",
        cn_name="X (Twitter)",
        test_url="https://x.com/example/status/123456",
        engine_expected="yt-dlp",
        ytdlp_extractor="twitter",
    ),
    PlatformTest(
        key="youtube",
        name="YouTube",
        cn_name="YouTube Shorts",
        test_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        engine_expected="yt-dlp",
        ytdlp_extractor="youtube",
    ),
    PlatformTest(
        key="instagram",
        name="Instagram",
        cn_name="Instagram Reels",
        test_url="https://www.instagram.com/reel/example/",
        engine_expected="yt-dlp",
        ytdlp_extractor="instagram",
    ),
    PlatformTest(
        key="facebook",
        name="Facebook",
        cn_name="Facebook Reels",
        test_url="https://www.facebook.com/watch/?v=123456",
        engine_expected="yt-dlp",
        ytdlp_extractor="facebook",
    ),
    PlatformTest(
        key="dailymotion",
        name="Dailymotion",
        cn_name="Dailymotion",
        test_url="https://www.dailymotion.com/video/example",
        engine_expected="yt-dlp",
        ytdlp_extractor="dailymotion",
    ),
    PlatformTest(
        key="rumble",
        name="Rumble",
        cn_name="Rumble",
        test_url="https://rumble.com/example",
        engine_expected="yt-dlp",
        ytdlp_extractor="rumble",
    ),
    PlatformTest(
        key="vk",
        name="VK",
        cn_name="VK",
        test_url="https://vk.com/video-123456_789",
        engine_expected="yt-dlp",
        ytdlp_extractor="vk",
    ),
]


def test_ytdlp_extractor(url: str, extractor_name: str | None, timeout: int = 15) -> tuple[str, str]:
    """Test if yt-dlp can extract info for this URL.

    Returns (status, detail) where status is 'ok' or 'fail'.
    """
    if not extractor_name:
        return "skip", "no yt-dlp extractor"

    try:
        import yt_dlp
    except ImportError:
        return "skip", "yt-dlp not installed"

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "simulate": True,  # don't download, just extract info
        "skip_download": True,
        "socket_timeout": timeout,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                extractor = info.get("extractor_key", "") or info.get("extractor", "")
                title = info.get("title", "(no title)")
                duration = info.get("duration", None)
                # Check for video formats
                formats = info.get("formats", [])
                has_video = any(
                    f.get("vcodec") and f["vcodec"] != "none"
                    for f in formats[:50]
                )
                has_audio = any(
                    f.get("acodec") and f["acodec"] != "none"
                    for f in formats[:50]
                )
                detail_parts = [f"title={title[:40]}"]
                if duration:
                    detail_parts.append(f"dur={duration}s")
                detail_parts.append(f"video={'yes' if has_video else 'no'}")
                detail_parts.append(f"audio={'yes' if has_audio else 'no'}")
                detail_parts.append(f"formats={len(formats)}")
                if extractor:
                    detail_parts.insert(0, f"extractor={extractor}")
                return "ok", "; ".join(detail_parts)
            return "fail", "yt-dlp returned no info"
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)[:100]
        return "fail", f"DownloadError: {msg}"
    except yt_dlp.utils.ExtractorError as e:
        msg = str(e)[:100]
        return "fail", f"ExtractorError: {msg}"
    except Exception as e:
        msg = str(e)[:100]
        return "fail", f"Exception: {type(e).__name__}: {msg}"


def create_platform_icon_svgs(output_dir: Path) -> None:
    """Create or update brand SVGs for platforms that pass testing.

    Each SVG is a simple rounded-square brand glyph following the
    project's existing style (similar to the existing brand SVGs).
    """
    icons: dict[str, tuple[str, str]] = {
        "ixigua": ("西瓜视频", "#F12B00"),  # 西瓜红
        "pipix": ("皮皮虾", "#FF6B35"),
        "weishi": ("微视", "#FFD600"),
        "miaopai": ("秒拍", "#00C853"),
        "twitter": ("X", "#000000"),
        "instagram": ("IG", "#E4405F"),
        "facebook": ("FB", "#1877F2"),
        "dailymotion": ("DM", "#005EFF"),
        "rumble": ("Rumble", "#85C742"),
        "vk": ("VK", "#0077FF"),
    }
    for key, (label, color) in icons.items():
        svg_path = output_dir / f"{key}-dark.svg"
        if svg_path.exists():
            continue  # don't overwrite existing
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">'
            f'<rect width="24" height="24" rx="4" fill="{color}"/>'
            f'<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" '
            f'font-family="-apple-system,BlinkMacSystemFont,sans-serif" fill="white">{label}</text>'
            f'</svg>'
        )
        svg_path.write_text(svg)
        print(f"  Created {svg_path.name}")


def run_tests() -> None:
    """Run downloadability tests for each platform."""
    print("=" * 80)
    print("  Platform Downloadability Test Suite")
    print("=" * 80)
    print()
    print(f"{'Platform':<20} {'Engine':<25} {'Result':<10} {'Detail'}")
    print("-" * 80)

    total = len(PLATFORMS)
    ok = 0
    fail = 0
    skip = 0
    browser = 0

    for pt in PLATFORMS:
        label = f"{pt.cn_name} ({pt.key})"
        engine = pt.engine_expected

        if pt.needs_browser:
            # Browser-first: note as browser-dependent
            pt.result = "browser"
            pt.detail = "patchright browser fallback (yt-dlp unreliable)"
            browser += 1
        else:
            # Test with yt-dlp
            status, detail = test_ytdlp_extractor(pt.test_url, pt.ytdlp_extractor)
            pt.result = status
            pt.detail = detail
            if status == "ok":
                ok += 1
            elif status == "fail":
                fail += 1
            else:
                skip += 1

        print(f"{label:<20} {engine:<25} {pt.result:<10} {pt.detail[:50]}")

    print("-" * 80)
    print(f"  Total: {total} | OK: {ok} | Fail: {fail} | Skip: {skip} | Browser: {browser}")
    print()


def print_url_guide() -> None:
    """Print a URL pattern guide for each platform."""
    print()
    print("=" * 80)
    print("  URL Pattern Guide (for manual testing)")
    print("=" * 80)
    print()
    for pt in PLATFORMS:
        print(f"  {pt.cn_name:<12}  {pt.test_url}")
    print()


def print_summary_table() -> None:
    """Print a markdown summary table of results."""
    print()
    print("## Test Results Summary")
    print()
    print("| Platform | Key | Engine | Status | Detail |")
    print("|----------|-----|--------|--------|--------|")
    for pt in PLATFORMS:
        status = pt.result or "untested"
        detail = pt.detail[:60] if pt.detail else ""
        print(f"| {pt.cn_name} | {pt.key} | {pt.engine_expected} | {status} | {detail} |")
    print()


def print_frontend_config_update() -> None:
    """Print the updated frontend configuration to paste into InboxPage.tsx."""
    print()
    print("=" * 80)
    print("  Frontend Config Update Instructions")
    print("=" * 80)
    print()
    print("### 1. Update DOWNLOAD_PLATFORMS in InboxPage.tsx")
    print()
    print("```typescript")
    print("type PlatformKey = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'bilibili' | 'ixigua'")
    print("  | 'pipix' | 'weishi' | 'miaopai' | 'tiktok' | 'twitter'")
    print("  | 'instagram' | 'facebook' | 'dailymotion' | 'rumble' | 'vk' | 'general'")
    print()
    print("const DOWNLOAD_PLATFORMS: ReadonlyArray<{")
    print("  key: PlatformKey")
    print("  name: string")
    print("  engine: string")
    print("}> = [")
    for pt in PLATFORMS:
        print(f"  {{ key: '{pt.key}', name: '{pt.cn_name}', engine: '{pt.engine_expected}' }},")
    print("  { key: 'general', name: '其他·通用', engine: 'yt-dlp' },")
    print("]")
    print("```")
    print()


if __name__ == "__main__":
    if "--url-only" in sys.argv:
        print_url_guide()
    elif "--config" in sys.argv:
        print_frontend_config_update()
    else:
        run_tests()
        print_summary_table()
        print_frontend_config_update()
