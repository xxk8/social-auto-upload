from pathlib import Path

from conf import BASE_DIR

Path(BASE_DIR / "cookies" / "tencent_uploader").mkdir(exist_ok=True)

from uploader.tencent_uploader.main import (  # noqa: E402
    TENCENT_PUBLISH_STRATEGY_IMMEDIATE,
    TENCENT_PUBLISH_STRATEGY_SCHEDULED,
    TencentBaseUploader,
    TencentNote,
    TencentVideo,
    cookie_auth,
    format_str_for_short_title,
    get_tencent_cookie,
    tencent_cookie_gen,
    tencent_setup,
    weixin_setup,
)

__all__ = [
    "TENCENT_PUBLISH_STRATEGY_IMMEDIATE",
    "TENCENT_PUBLISH_STRATEGY_SCHEDULED",
    "TencentBaseUploader",
    "TencentNote",
    "TencentVideo",
    "cookie_auth",
    "format_str_for_short_title",
    "get_tencent_cookie",
    "tencent_cookie_gen",
    "tencent_setup",
    "weixin_setup",
]
