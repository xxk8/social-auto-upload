"""Centralized CSS selectors and locator strings for the Tencent (视频号) uploader.

When WeChat Channels' creator frontend changes, update ONLY this file.
"""


class TencentLocators:
    """All Tencent video-channel creator-platform selector constants."""

    # ── URLs ──────────────────────────────────────────────────────────────
    LOGIN_URL = "https://channels.weixin.qq.com"
    UPLOAD_URL = "https://channels.weixin.qq.com/platform/post/create"
    MANAGE_URL = "https://channels.weixin.qq.com/platform/post/list"

    # ── Login ─────────────────────────────────────────────────────────────
    LOGIN_QR_IFRAME = '[src*="login-for-iframe"]'
    LOGIN_QR_IFRAME_IMG = "div#app img.qrcode"
    LOGIN_QR_WRAP = "div.login-qrcode-wrap img.qrcode"
    LOGIN_QR_WRAP_NO_IMG = "div.qrcode-wrap img.qrcode"
    LOGIN_QR_IMG_BARE = "img.qrcode"
    LOGIN_QR_DATA_IMG = 'img[src^="data:image/"]'
    LOGIN_MARKER_SCAN_TEXT = "扫码登录"
    LOGIN_MARKER_PUBLISH_TEXT = "发表视频"
    LOGIN_MARKER_PUBLISH_ROLE = "发表"
    LOGIN_BOX_WRAP = "div.login-qrcode-wrap"
    LOGIN_QR_WRAP_ALT = "div.qrcode-wrap"
    LOGIN_TITLE_TEXT = "微信扫码登录 视频号助手"

    # ── QR expiry / refresh ───────────────────────────────────────────────
    QR_EXPIRED_TIP_SELECTORS = [
        'div.mask.show p.refresh-tip:has-text("二维码已过期，点击刷新")',
        'div.mask.show p.refresh-tip:has-text("网络不可用，点击刷新")',
        'p.refresh-tip:has-text("二维码已过期，点击刷新")',
        'p.refresh-tip:has-text("网络不可用，点击刷新")',
    ]
    QR_SCANNED_TIP_SELECTORS = [
        'div.qr-tip div:has-text("已扫码")',
        'div.qr-tip div:has-text("需在手机上进行确认")',
    ]
    QR_REFRESH_WRAP_SELECTORS = [
        "div.login-qrcode-wrap div.mask.show div.refresh-wrap",
        "div.login-qrcode-wrap div.mask.show .refresh-wrap",
    ]
    QR_REFRESH_FALLBACK = "div.login-qrcode-wrap div.refresh-wrap"

    # ── Upload ────────────────────────────────────────────────────────────
    FILE_INPUT = 'input[type="file"]'
    PUBLISH_ENTRY_TEXT = "发表视频"

    # ── Form ──────────────────────────────────────────────────────────────
    TITLE_EDITOR = "div.input-editor"
    SHORT_TITLE_LABEL = "短标题"
    SHORT_TITLE_INPUT = 'span input[type="text"]'
    COLLECTION_TEXT = "添加到合集"
    COLLECTION_OPTION_LIST = ".option-list-wrap > div"

    # ── Schedule ──────────────────────────────────────────────────────────
    SCHEDULE_LABEL = "label"
    SCHEDULE_LABEL_FILTER_TEXT = "定时"
    SCHEDULE_TIME_INPUT = 'input[placeholder="请选择发表时间"]'
    SCHEDULE_MONTH_PICKER = 'span.weui-desktop-picker__panel__label:has-text("月")'
    SCHEDULE_NEXT_MONTH_BTN = "button.weui-desktop-btn__icon__right"
    SCHEDULE_DAY_TABLE = "table.weui-desktop-picker__table a"
    SCHEDULE_DISABLED_CLASS = "weui-desktop-picker__disabled"
    SCHEDULE_HOUR_INPUT = 'input[placeholder="请选择时间"]'

    # ── Original declaration ──────────────────────────────────────────────
    ORIGINAL_CHECKBOX_LABEL = "视频为原创"
    ORIGINAL_AGREE_LABEL = "我已阅读并同意 《视频号原创声明使用条款》"
    ORIGINAL_DECLARE_BTN_NAME = "声明原创"
    ORIGINAL_DECLARATION_ENTRY = (
        'div.label span:has-text("声明原创"), '
        'div:has-text("声明原创"):has(input.ant-checkbox-input), '
        'div:has-text("原创声明"):has(input.ant-checkbox-input)'
    )
    ORIGINAL_CHECKBOX = "div.declare-original-checkbox input.ant-checkbox-input"
    ORIGINAL_DIALOG_CHECKED = (
        "div.declare-original-dialog "
        "label.ant-checkbox-wrapper.ant-checkbox-wrapper-checked:visible"
    )
    ORIGINAL_DIALOG_INPUT = "div.declare-original-dialog input.ant-checkbox-input:visible"
    ORIGINAL_TYPE_FORM = 'div.original-type-form > div.form-label:has-text("原创类型"):visible'
    ORIGINAL_FORM_CONTENT = "div.form-content:visible"
    ORIGINAL_CATEGORY_LIST = "ul.weui-desktop-dropdown__list"
    ORIGINAL_CATEGORY_ITEM = "li.weui-desktop-dropdown__list-ele"
    ORIGINAL_DECLARE_BUTTON = 'button:has-text("声明原创"):visible'
    CONTENT_DECLARATION_TEXT = 'text="内容声明"'

    # ── Thumbnail ─────────────────────────────────────────────────────────
    THUMB_DIALOG = "div.weui-desktop-dialog"
    THUMB_FILE_INPUT = '.single-cover-uploader-wrap input[type="file"]'
    THUMB_CONFIRM_BUTTON = (
        'div.weui-desktop-dialog__ft button.weui-desktop-btn_primary:has-text("确认")'
    )
    THUMB_CROP_DIALOG_TEXT = "裁剪封面图"
    THUMB_CROP_CONFIRM = (
        'div.weui-desktop-dialog__ft button.weui-desktop-btn_primary:has-text("确定")'
    )
    # Landscape (4:3) cover entry selectors
    THUMB_LANDSCAPE_SELECTORS = [
        'div.horizontal-cover-wrap:has-text("4:3")',
        'div[class*="cover-wrap"]:has-text("4:3"):has-text("动态")',
        'div:has-text("视频号动态"):has-text("4:3")',
        'div:has-text("横版封面"):has-text("4:3")',
    ]
    # Portrait (3:4) cover entry selectors
    THUMB_PORTRAIT_SELECTORS = [
        'div.vertical-cover-wrap:has-text("个人主页卡片"):has-text("3:4")',
        'div.vertical-cover-wrap:has-text("3:4")',
        'div.vertical-cover-wrap:has-text("个人主页卡片")',
    ]
    THUMB_LANDSCAPE_TITLES = ["编辑视频号动态封面", "编辑动态封面", "编辑封面"]
    THUMB_PORTRAIT_TITLES = ["编辑个人主页卡片", "编辑封面"]

    # ── Upload status ─────────────────────────────────────────────────────
    UPLOAD_STATUS_ERROR = "div.status-msg.error"
    UPLOAD_DELETE_TAG = 'div.media-status-content div.tag-inner:has-text("删除")'
    PUBLISH_BUTTON = 'div.form-btns button:has-text("发表")'
    DRAFT_BUTTON = 'div.form-btns button:has-text("保存草稿")'
    # Generic (no div.form-btns prefix) — used in _is_tencent_login_completed
    PUBLISH_BUTTON_GENERIC = 'button:has-text("发表")'
    DRAFT_BUTTON_GENERIC = 'button:has-text("保存草稿")'
    PUBLISH_VIDEO_DIV = 'div:has-text("发表视频")'
    PUBLISH_BUTTON_ROLE_NAME = "发表"
    PUBLISH_DISABLED_CLASS = "weui-desktop-btn_disabled"
