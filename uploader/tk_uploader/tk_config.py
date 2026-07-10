"""Centralized CSS selectors and locator strings for the TikTok uploader.

When TikTok Studio's frontend changes, update ONLY this file.
Covers both the Firefox (main.py) and Chrome (main_chrome.py) paths.
"""


class Tk_Locator:
    """All TikTok Studio selector constants (legacy name preserved for compat)."""

    # ── Base locator (iframe vs inline) ───────────────────────────────────
    tk_iframe = '[data-tt="Upload_index_iframe"]'
    default = 'body'

    # ── Upload page ───────────────────────────────────────────────────────
    # Wait for either iframe or div container to appear
    UPLOAD_CONTAINER_WAIT = 'iframe[data-tt="Upload_index_iframe"], div.upload-container'
    # Upload button (select video)
    UPLOAD_BUTTON = 'button:has-text("Select video"):visible'
    # File select button (retry path)
    FILE_SELECT_BUTTON = 'button[aria-label="Select file"]'

    # ── Editor ────────────────────────────────────────────────────────────
    EDITOR = 'div.public-DraftEditor-content'

    # ── Upload status ─────────────────────────────────────────────────────
    # Publish button (disabled while uploading)
    PUBLISH_BUTTON = 'div.btn-post'
    PUBLISH_BUTTON_INNER = 'div.btn-post > button'
    # Success indicators
    SUCCESS_INDICATOR = (
        'div.btn-post:has-text("View"), '
        'div.btn-post:has-text("查看"), '
        'div:has-text("Your video has been uploaded"), '
        'div:has-text("视频已上传")'
    )

    # ── Chrome path: publish / status ─────────────────────────────────────
    CHROME_PUBLISH_BUTTON = 'div.button-group button'
    CHROME_PUBLISH_CHECK = 'div.button-group > button >> text=Post'
    CHROME_PUBLISH_SUCCESS_URL = 'https://www.tiktok.com/tiktokstudio/content'

    # ── Schedule ──────────────────────────────────────────────────────────
    SCHEDULE_LABEL = 'Schedule'
    SCHEDULE_ALLOW_BUTTON = 'div.TUXButton-content >> text=Allow'
    SCHEDULE_PICKER = 'div.scheduled-picker'
    SCHEDULE_INPUT_BOX = 'div.TUXInputBox'
    CALENDAR_MONTH_TITLE = 'div.calendar-wrapper span.month-title'
    CALENDAR_ARROW = 'div.calendar-wrapper span.arrow'
    CALENDAR_DAY_VALID = 'div.calendar-wrapper span.day.valid'
    HOUR_PICKER_LEFT = "span.tiktok-timepicker-left:has-text('{hour}')"
    MINUTE_PICKER_RIGHT = "span.tiktok-timepicker-right:has-text('{minute}')"
    BACK_TO_UPLOAD_HEADING = "h1:has-text('Upload video')"

    # ── Chrome: thumbnail ─────────────────────────────────────────────────
    CHROME_COVER_CONTAINER = '.cover-container'
    CHROME_COVER_UPLOAD_TEXT = '.cover-edit-container >> text=Upload cover'
    CHROME_COVER_UPLOAD_AREA = '.upload-image-upload-area'
    CHROME_COVER_EDIT_PANEL = 'div.cover-edit-panel:not(.hide-panel)'
    CHROME_COVER_CONFIRM_BUTTON_NAME = 'Confirm'

    # ── Chrome: language switch ───────────────────────────────────────────
    CHROME_NAV_MORE_MENU = '[data-e2e="nav-more-menu"]'
    CHROME_LANGUAGE_SELECT = '[data-e2e="language-select"]'
    CHROME_LANGUAGE_ENGLISH = '#creator-tools-selection-menu-header >> text=English (US)'

    # ── Chrome: post table (get video ID) ─────────────────────────────────
    CHROME_POST_TABLE = 'div[data-tt="components_PostTable_Container"]'
    CHROME_POST_TABLE_LINK = (
        'div[data-tt="components_PostTable_Container"] '
        'div[data-tt="components_PostInfoCell_Container"] a'
    )
