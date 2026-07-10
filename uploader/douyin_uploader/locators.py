"""Centralized CSS selectors and locator strings for the Douyin uploader.

When Douyin's creator frontend changes (e.g. class-name hashing, DOM
restructure), update ONLY this file — ``main.py`` references these
constants by name, not by raw selector string.

Groups:
  * URLs            — page targets + wait-for-url patterns
  * Login           — QR extraction, login-completion markers, landing-page
  * Upload          — file input, upload-progress indicators, error retry
  * Form            — title, description, schedule, location, third-party
  * Cover           — auto-cover, manual thumbnail upload dialog
  * Product         — shopping-cart link, product dialog
  * Declaration     — 自主声明 modal
  * BGM             — music selection sidesheet
  * Publish         — publish button, manage-page URL pattern
  * Shepherd        — JS selector strings for removing guide overlays
"""


class DouyinLocators:
    """All Douyin creator-platform selector constants.

    Naming convention: ``<AREA>_<ELEMENT>`` (e.g. ``FORM_TITLE_INPUT``).
    Suffix ``_URL`` / ``_URL_PATTERN`` for navigation targets;
    ``_TEXT`` for text-based locators; ``_ROLE`` for role+name pairs.
    """

    # ── URLs ──────────────────────────────────────────────────────────────
    UPLOAD_PAGE_URL = "https://creator.douyin.com/creator-micro/content/upload"
    LANDING_PAGE_URL = "https://creator.douyin.com/"
    PUBLISH_PAGE_V1_URL = (
        "https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page"
    )
    PUBLISH_PAGE_V2_URL = (
        "https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page"
    )
    MANAGE_PAGE_URL_PATTERN = "https://creator.douyin.com/creator-micro/content/manage**"
    NOTE_PUBLISH_PAGE_URL_PATTERN = "**/creator-micro/content/post/image?**"
    NOTE_MANAGE_PAGE_URL_PATTERN = "**/creator-micro/content/manage?enter_from=publish**"
    CREATOR_MICRO_URL_FRAGMENT = "creator.douyin.com/creator-micro"
    QRCODE_ROUTE_PATTERN = "**/passport/web/get_qrcode*"

    # ── Login ─────────────────────────────────────────────────────────────
    # QR image inside login modal (async-rendered data:image <img>)
    QR_MODAL_IMGS = ".login-card-double-Gtywl8 img, .douyin-login-container-sl0M7z img"
    # Landing-page login button (Douyin 2026: creator.douyin.com/ shows a
    # product landing page, not a direct login form)
    LANDING_CREATOR_LOGIN_TEXT = "text=创作者登录"
    # Login-container visibility check after clicking landing-page button
    LOGIN_CONTAINER_VISIBLE = ".douyin-login-container-sl0M7z, .login-card-double-Gtywl8"
    # QR tab in modal (force-click to bypass pointer-events interception)
    QR_TAB_TEXT = "text=扫码登录"
    # Login-completion markers (any visible → still on login page)
    LOGIN_MARKER_SCAN_TEXT = "扫码登录"
    LOGIN_MARKER_PHONE_TEXT = "手机号登录"
    LOGIN_MARKER_EXPIRED_TEXT = "二维码失效"
    LOGIN_MARKER_QR_ROLE_NAME = "二维码"
    # QR-expired refresh: parent of "二维码失效" text
    QR_EXPIRED_TEXT = "二维码失效"

    # ── Upload ────────────────────────────────────────────────────────────
    # File input on upload page
    FILE_INPUT = "div[class^='container'] input"
    # Image file input (note mode)
    IMAGE_FILE_INPUT = "div[class^='container'] input[accept*='image']"
    # Upload-complete indicator: "重新上传" appears when video is done
    UPLOAD_COMPLETE_TEXT = '[class^="long-card"] div:has-text("重新上传")'
    # Upload-failed indicator
    UPLOAD_FAILED_TEXT = 'div.progress-div > div:has-text("上传失败")'
    # Upload retry file input
    UPLOAD_RETRY_INPUT = 'div.progress-div [class^="upload-btn-input"]'
    # Note-mode switch button
    NOTE_SWITCH_TEXT = "发布图文"

    # ── Form ──────────────────────────────────────────────────────────────
    # Title input
    TITLE_INPUT = 'input[placeholder*="填写作品标题"]'
    # Description editor (contenteditable div)
    DESCRIPTION_EDITOR = 'div.zone-container[contenteditable="true"]'
    # Schedule: radio label
    SCHEDULE_RADIO = "[class^='radio']:has-text('定时发布')"
    # Schedule: datetime input
    SCHEDULE_DATETIME_INPUT = '.semi-input[placeholder="日期和时间"]'
    # Location: trigger
    LOCATION_TRIGGER = 'div.semi-select span:has-text("输入地理位置")'
    # Location: dropdown option
    LOCATION_OPTION = 'div[role="listbox"] [role="option"]'
    # Third-party switch
    THIRD_PARTY_SWITCH = '[class^="info"] > [class^="first-part"] div div.semi-switch'
    THIRD_PARTY_SWITCH_INPUT = "input.semi-switch-native-control"
    THIRD_PARTY_SWITCH_CHECKED_CLASS = "semi-switch-checked"

    # ── Cover ─────────────────────────────────────────────────────────────
    # Cover-required prompt
    COVER_REQUIRED_TEXT = "请设置封面后再发布"
    # Recommended cover (auto-select first)
    RECOMMEND_COVER = '[class^="recommendCover-"]'
    # Cover confirm dialog text
    COVER_CONFIRM_TEXT = "是否确认应用此封面？"
    # Cover dialog "选择封面" button
    COVER_SELECT_TEXT = "选择封面"
    # Cover dialog container
    COVER_DIALOG = "div.dy-creator-content-modal"
    # Hidden file input inside cover dialog (nth(1) = real upload, not AI ref)
    COVER_FILE_INPUT = "input.semi-upload-hidden-input"
    # Portrait cover tab
    COVER_PORTRAIT_TAB_TEXT = "设置竖封面"
    # Landscape cover tab
    COVER_LANDSCAPE_TAB_TEXT = "设置横封面"

    # ── Product link ──────────────────────────────────────────────────────
    PRODUCT_TAG_DROPDOWN_TEXT = "添加标签"
    PRODUCT_LISTBOX = '[role="listbox"]'
    PRODUCT_CART_OPTION = '[role="option"]:has-text("购物车")'
    PRODUCT_LINK_INPUT = 'input[placeholder="粘贴商品链接"]'
    PRODUCT_ADD_LINK_BUTTON = 'span:has-text("添加链接")'
    PRODUCT_NOT_FOUND_TEXT = "text=未搜索到对应商品"
    PRODUCT_CONFIRM_BUTTON = 'button:has-text("确定")'
    # Product dialog
    PRODUCT_SHORT_TITLE_INPUT = 'input[placeholder="请输入商品短标题"]'
    PRODUCT_FINISH_EDIT_BUTTON = 'button:has-text("完成编辑")'
    PRODUCT_CANCEL_BUTTON = 'button:has-text("取消")'
    PRODUCT_CLOSE_BUTTON = ".semi-modal-close"
    PRODUCT_MODAL_CONTENT = ".semi-modal-content"

    # ── Self declaration (自主声明) ───────────────────────────────────────
    DECLARATION_ENTRY_TEXT = "请选择自主声明"
    DECLARATION_DIALOG = ".semi-modal-content"
    DECLARATION_DIALOG_TITLE = "对作品内容添加声明"
    DECLARATION_RADIO = ".semi-radio"

    # ── BGM (图文) ────────────────────────────────────────────────────────
    BGM_SELECT_MUSIC_TEXT = 'text="选择音乐"'
    BGM_SIDESHEET = ".semi-sidesheet-content"
    BGM_SEARCH_INPUT = 'input.semi-input[placeholder="搜索音乐"]'
    BGM_FIRST_CARD = ".card-container-tmocjc"
    BGM_SONG_NAME = ".song-name-oRge4d"
    BGM_APPLY_BUTTON = ".apply-btn-LUPP0D"
    BGM_CLOSE_BUTTON = ".semi-sidesheet-close"

    # ── Publish ───────────────────────────────────────────────────────────
    # Publish button (exact match to avoid hitting "完成编辑")
    PUBLISH_BUTTON_ROLE_NAME = "发布"
    # "完成" button in cover dialog (exact)
    COVER_DONE_BUTTON_ROLE_NAME = "完成"
    # "确定" button (cover confirm, declaration, product)
    CONFIRM_BUTTON_ROLE_NAME = "确定"

    # ── Shepherd overlay removal (JS) ─────────────────────────────────────
    SHEPHERD_REMOVE_JS_COVER = (
        "() => document.querySelectorAll"
        "('.shepherd-element,.shepherd-modal-overlay-container')"
        ".forEach(e=>e.remove())"
    )
    SHEPHERD_REMOVE_JS_PUBLISH = (
        "() => { document.querySelectorAll"
        "('.shepherd-element, .shepherd-modal-overlay-container, "
        "[class*=\"mention-wrapper\"]').forEach(e => e.remove()); }"
    )
