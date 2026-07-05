

SOCIAL_MEDIA_DOUYIN = "douyin"
SOCIAL_MEDIA_TENCENT = "tencent"
SOCIAL_MEDIA_TIKTOK = "tiktok"
SOCIAL_MEDIA_BILIBILI = "bilibili"
SOCIAL_MEDIA_KUAISHOU = "kuaishou"


def get_supported_social_media() -> list[str]:
    return [SOCIAL_MEDIA_DOUYIN, SOCIAL_MEDIA_TENCENT, SOCIAL_MEDIA_TIKTOK, SOCIAL_MEDIA_KUAISHOU]


def get_cli_action() -> list[str]:
    return ["upload", "login", "watch"]


async def set_init_script(context):
    """DEPRECATED: use :func:`apply_anti_detect` instead.

    Kept for backwards compatibility with existing uploaders that have not
    yet migrated to the full anti-detection stack.
    """
    from utils.anti_detect.stealth_enhanced import apply_anti_detect

    return await apply_anti_detect(context)


async def apply_anti_detect(context):
    """Inject the full anti-detection script stack (base stealth + enhanced).

    This is the recommended replacement for the legacy ``set_init_script``.
    It adds evasions for navigator.webdriver, plugins, canvas noise, WebGL
    spoofing, and more on top of the bundled puppeteer-extra-stealth script.
    """
    from utils.anti_detect.stealth_enhanced import apply_anti_detect as _apply

    return await _apply(context)
