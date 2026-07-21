"""Centralized CSS selectors and locator strings for the Bilibili (B站) uploader.

When Bilibili's creator frontend changes, update ONLY this file.
"""


class BilibiliLocators:
    """All Bilibili creator-platform selector constants."""

    # ── URLs ──────────────────────────────────────────────────────────────
    LOGIN_URL = 'https://passport.bilibili.com/login'
    CREATOR_HOME = 'https://member.bilibili.com/platform/home'
    NOTE_UPLOAD_PAGE = 'https://member.bilibili.com/platform/upload/text/edit'
    NAV_API = 'https://api.bilibili.com/x/web-interface/nav'

    # ── Login ─────────────────────────────────────────────────────────────
    QR_IMG_PRIMARY = 'img[class*="qr"], img[class*="qrcode"], div[class*="qr"] img'
    QR_IMG_ALT = 'img[alt*="二维码"], img[alt*="QR"]'
    QR_IMG_FALLBACK_1 = '.login-scan-box img, .qr-img img, #qrcode img'
    QR_IMG_FILTER = 'img'
    QR_IMG_FILTER_HAS = '[class*="qr"]'
    QR_IMG_FALLBACK_2 = 'div[class*="scan"] img, div[class*="qrcode"] img'
    QR_EXPIRED_TEXT = '二维码已失效'
    QR_EXPIRED_ALT_TEXT = '已过期'
    LOGIN_MARKER_TEXTS = ['登录', '扫码登录']

    # ── Note upload ───────────────────────────────────────────────────────
    NOTE_FILE_INPUT = "input[type='file'][accept*='image']"
    NOTE_TITLE_INPUT = "input[placeholder*='标题'], input[class*='title']"
    NOTE_CONTENT_AREA = "div[class*='editor'], div[contenteditable='true']"
    NOTE_TAG_INPUT = "input[placeholder*='标签'], input[placeholder*='tag']"
    NOTE_SCHEDULE_BUTTON = "button:has-text('定时'), div:has-text('定时发布')"
    NOTE_PUBLISH_BUTTON = "button:has-text('发布')"
