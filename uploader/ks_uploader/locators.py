"""Centralized CSS selectors and locator strings for the Kuaishou (快手) uploader.

When Kuaishou's creator frontend changes, update ONLY this file.
"""


class KsLocators:
    """All Kuaishou creator-platform selector constants."""

    # ── URLs ──────────────────────────────────────────────────────────────
    UPLOAD_URL = 'https://cp.kuaishou.com/article/publish/video'
    MANAGE_URL = 'https://cp.kuaishou.com/article/manage/video?status=2&from=publish'
    LOGIN_URL = (
        'https://passport.kuaishou.com/pc/account/login/'
        '?sid=kuaishou.web.cp.api&callback=https%3A%2F%2Fcp.kuaishou.com'
        '%2Frest%2Finfra%2Fsts%3FfollowUrl%3Dhttps%253A%252F%252Fcp.kuaishou.com'
        '%252Farticle%252Fpublish%252Fvideo%26setRootDomain%3Dtrue'
    )
    UPLOAD_URL_PATTERN = '**/article/publish/video**'
    MANAGE_URL_PATTERN = '**/article/manage/video?status=2&from=publish**'

    # ── Login ─────────────────────────────────────────────────────────────
    COOKIE_INVALID_SELECTOR = "div.names div.container div.name:text('机构服务')"
    LOGIN_FORM = 'main#login-form'
    LOGIN_QR_IMG = 'div.qr-login img[alt="qrcode"]'
    LOGIN_PLATFORM_SWITCH = 'div.platform-switch'
    QR_EXPIRED = 'div.qrcode-status.qrcode-status-timeout'
    QR_REFRESH_BUTTON = 'p.qrcode-refresh'

    # ── Upload ────────────────────────────────────────────────────────────
    UPLOAD_BUTTON = "button[class^='_upload-btn']"
    UPLOAD_BUTTON_IMAGE = "button[class^='_upload-btn']"
    UPLOAD_BUTTON_IMAGE_FILTER = '上传图片'
    UPLOAD_IN_PROGRESS_TEXT = 'text=上传中'
    UPLOAD_FAILED_TEXT = 'text=上传失败'
    UPLOAD_RETRY_INPUT = 'div.progress-div [class^="upload-btn-input"]'
    KNOW_BUTTON = 'button[type="button"] span:text("我知道了")'

    # ── Form ──────────────────────────────────────────────────────────────
    DESC_TRIGGER = '描述'
    DESC_TRIGGER_XPATH = 'xpath=following-sibling::div'
    SCHEDULE_RADIO = 'label.ant-radio-wrapper'
    SCHEDULE_RADIO_FILTER_TEXT = '定时发布'
    SCHEDULE_TIME_INPUT = 'input[placeholder="选择日期时间"]'

    # ── Thumbnail ─────────────────────────────────────────────────────────
    THUMB_COVER_LABEL = 'span'
    THUMB_COVER_LABEL_FILTER_TEXT = '封面设置'
    THUMB_COVER_SIBLING_XPATH = 'xpath=../following-sibling::div[1]'
    THUMB_MODAL = 'div[role="document"].ant-modal'
    THUMB_UPLOAD_TAB_TEXT = '上传封面'
    THUMB_FILE_INPUT = 'input[type="file"]'
    THUMB_CONFIRM_BUTTON_NAME = '确认'

    # ── Note mode ─────────────────────────────────────────────────────────
    NOTE_TAB = 'div[role="tablist"] div[role="tab"]:has-text("图文")'

    # ── Publish ───────────────────────────────────────────────────────────
    PUBLISH_BUTTON_TEXT = '发布'
    PUBLISH_CONFIRM_TEXT = '确认发布'

    # ── Guide overlay ─────────────────────────────────────────────────────
    GUIDE_TOOLTIP = 'div[id^="react-joyride-step"] div[role="alertdialog"]'
    GUIDE_CLOSE_BUTTON = (
        '[aria-label="Skip"], [data-action="skip"], button[title="Skip"]'
    )
