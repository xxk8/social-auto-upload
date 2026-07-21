"""Anti-detection toolkit for social-auto-upload platform uploaders.

Provides four layers of evasion:

1. **stealth_enhanced** — Browser fingerprint masking beyond puppeteer-extra-stealth.
2. **human_behavior** — Human-like typing, mouse movement, and random delays.
3. **content_fingerprint** — Video / image obfuscation to defeat content-hash detection.
4. **browser_profile** — Consistent browser context options (viewport, locale, timezone, UA).

Usage::

    from utils.anti_detect import apply_anti_detect, human_behavior, content_fingerprint
    from utils.anti_detect.browser_profile import build_browser_context_options

    # 1. Build realistic browser context kwargs
    ctx_opts = build_browser_context_options(
        account_file="cookies/douyin_test.json",
        platform="douyin",
    )
    context = await browser.new_context(**ctx_opts)

    # 2. Inject enhanced stealth scripts
    context = await apply_anti_detect(context)

    # 3. Use human behavior helpers in upload flow
    await human_behavior.human_type(page, "标题文本")
    await human_behavior.human_click(page, page.locator("button:has-text('发布')"))
"""

from __future__ import annotations

from utils.anti_detect.browser_profile import build_browser_context_options, build_browser_launch_kwargs
from utils.anti_detect.config import (
    PRESET_CONFIGS,
    ObfuscationConfig,
    get_config,
    list_presets,
)
from utils.anti_detect.content_fingerprint import (
    is_ffmpeg_available,
    obfuscate_image,
    obfuscate_video,
    strip_media_metadata,
)
from utils.anti_detect.human_behavior import (
    bezier_mouse_move,
    human_click,
    human_scroll,
    human_type,
    random_delay,
)
from utils.anti_detect.stealth_enhanced import apply_anti_detect, get_enhanced_stealth_script

__all__ = [
    # stealth
    "get_enhanced_stealth_script",
    "apply_anti_detect",
    # behavior
    "random_delay",
    "human_type",
    "human_click",
    "bezier_mouse_move",
    "human_scroll",
    # content
    "obfuscate_video",
    "obfuscate_image",
    "strip_media_metadata",
    "is_ffmpeg_available",
    # profile
    "build_browser_context_options",
    "build_browser_launch_kwargs",
    # config
    "ObfuscationConfig",
    "PRESET_CONFIGS",
    "get_config",
    "list_presets",
]
