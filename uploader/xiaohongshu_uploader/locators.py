"""Centralized CSS selectors and locator strings for the Xiaohongshu uploader.

When Xiaohongshu's creator frontend changes, update ONLY this file.
"""


class XhsLocators:
    """All Xiaohongshu creator-platform selector constants."""

    # ── URLs ──────────────────────────────────────────────────────────────
    PUBLISH_VIDEO_URL_PATH = "/publish/publish?from=homepage&target=video"
    PUBLISH_IMAGE_URL_PATH = "/publish/publish?from=homepage&target=image"
    PUBLISH_SUCCESS_URL_PATTERN = "**/publish/success?**"

    # ── Login ─────────────────────────────────────────────────────────────
    LOGIN_BOX = "div[class*='login-box']"
    LOGIN_SWITCH_IMG = "img.css-wemwzq"
    LOGIN_SCAN_TEXT = "扫一扫"
    LOGIN_BOX_CONTAINER = ".login-box-container"
    LOGIN_APP_SCAN_TEXT = "APP扫一扫登录"
    LOGIN_QR_IMG_XPATH = (
        "xpath=..//following-sibling::div//img"
    )

    # ── Upload ────────────────────────────────────────────────────────────
    VIDEO_FILE_INPUT = "div[class^='upload-content'] input[class='upload-input']"
    IMAGE_FILE_INPUT_PRIMARY = 'input[type="file"][accept*="image"]'
    IMAGE_FILE_INPUT_FALLBACK = "div[class^='upload-content'] input[class='upload-input']"
    UPLOAD_STATUS_INPUT = "input.upload-input"
    UPLOAD_PREVIEW_NEW_XPATH = (
        'xpath=following-sibling::div[contains(@class, "preview-new")]'
    )

    # ── Form ──────────────────────────────────────────────────────────────
    TITLE_INPUT = 'input[placeholder*="填写标题"]'
    DESC_EDITOR = 'p[data-placeholder*="输入正文描述"]'
    SCHEDULE_SWITCH = '.custom-switch-card'
    SCHEDULE_SWITCH_TEXT = "定时发布"
    SCHEDULE_SWITCH_TOGGLE = '.d-switch'
    SCHEDULE_TIME_INPUT = '.d-datepicker-input-filter input.d-text'

    # ── Tags ──────────────────────────────────────────────────────────────
    TAG_TOPIC_CONTAINER = '#creator-editor-topic-container'
    TAG_TOPIC_FIRST_ITEM = '#creator-editor-topic-container .item'

    # ── Original declaration ──────────────────────────────────────────────
    ORIGINAL_CHECKBOX = (
        'div.original-declaration checkbox, '
        'div.original-declaration input[type="checkbox"], '
        'label:has-text("原创") input[type="checkbox"]'
    )
    ORIGINAL_TEXT = (
        'div:has-text("原创声明"), span:has-text("原创声明"), '
        'div:has-text("原创"), label:has-text("原创")'
    )

    # ── Thumbnail ─────────────────────────────────────────────────────────
    THUMB_COVER_TITLE = "div.cover-plugin-title"
    THUMB_COVER_TITLE_TEXT = "设置封面"
    THUMB_COVER_DIALOG_XPATH = (
        "xpath=ancestor::div[contains(@class, 'cover-plugin-preview')]"
    )
    THUMB_COVER_CLICK_AREA = "div.cover > div.default:visible"
    THUMB_MODAL = "div.d-modal.cover-modal"
    THUMB_FILE_INPUT = 'input[type="file"][accept*="image"]'
    THUMB_CONFIRM_BUTTON = "button.mojito-button"

    # ── Publish ───────────────────────────────────────────────────────────
    PUBLISH_BUTTON_TEXT = 'button:has-text("发布")'
    PUBLISH_SCHEDULED_BUTTON_TEXT = 'button:has-text("定时发布")'

    # ── Location ──────────────────────────────────────────────────────────
    LOCATION_PLACEHOLDER = 'div.d-text.d-select-placeholder.d-text-ellipsis.d-text-nowrap'
    LOCATION_DROPDOWN = 'div.d-popover.d-popover-default.d-dropdown.--size-min-width-large'
