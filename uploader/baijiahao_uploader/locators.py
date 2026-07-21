"""Centralized CSS selectors and locator strings for the Baijiahao (百家号) uploader.

When Baijiahao's creator frontend changes, update ONLY this file.
"""


class BaijiahaoLocators:
    """All Baijiahao creator-platform selector constants."""

    # ── URLs ──────────────────────────────────────────────────────────────
    LOGIN_URL = 'https://baijiahao.baidu.com/builder/theme/bjh/login'
    HOME_URL = 'https://baijiahao.baidu.com/builder/rc/home'
    EDIT_URL = 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2'
    MANAGE_URL_PATTERN = 'https://baijiahao.baidu.com/builder/rc/clue**'
    AIGC_URL = 'https://aigc.baidu.com/make'

    # ── Login ─────────────────────────────────────────────────────────────
    QR_IMG_PRIMARY = 'div[class*="qrcode"] img, div[class*="qr"] img, .qr-code-img'
    QR_IMG_ALT = 'img[alt*="二维码"], img[alt*="QR"], img[alt*="qr"]'
    QR_IMG_SRC = 'img[src*="passport.baidu.com"], img[src*="qrcode"]'
    LOGIN_MARKER_TEXT = '注册/登录百家号'
    # Login-modal trigger buttons (tried in order)
    LOGIN_TRIGGER_TEXT = '登录'
    LOGIN_TRIGGER_ROLE_BUTTON = '登录'
    LOGIN_TRIGGER_LINK = 'a:has-text("登录")'
    LOGIN_TRIGGER_BUTTON = 'button:has-text("登录")'
    # Login-completed URL fragments
    LOGIN_COMPLETED_HOME = 'baijiahao.baidu.com/builder/rc/home'
    LOGIN_COMPLETED_EDIT = 'baijiahao.baidu.com/builder/rc/edit'

    # ── Upload ────────────────────────────────────────────────────────────
    FILE_INPUT = "div[class^='video-main-container'] input"
    FORM_MAIN = 'div#formMain:visible'

    # ── Upload status ─────────────────────────────────────────────────────
    UPLOAD_FAILED_OVERLAY = 'div .cover-overlay:has-text("上传失败")'
    UPLOADING_OVERLAY = 'div .cover-overlay:has-text("上传中")'

    # ── Cover ─────────────────────────────────────────────────────────────
    COVER_IMAGE = 'div.cheetah-spin-container img'

    # ── Security verification ─────────────────────────────────────────────
    SECURITY_VERIFY_DIALOG = 'div.passMod_dialog-container >> text=百度安全验证:visible'

    # ── Form ──────────────────────────────────────────────────────────────
    TITLE_PLACEHOLDER = '添加标题获得更多推荐'

    # ── Schedule ──────────────────────────────────────────────────────────
    SCHEDULE_SELECT_WRAP = 'div.select-wrap'
    SCHEDULE_OPTION_LIST = 'div.rc-virtual-list  div.cheetah-select-item'
    SCHEDULE_OPTION_LIST_VISIBLE = 'div.rc-virtual-list:visible div.cheetah-select-item-option'
    SCHEDULE_OPTION_LIST_HOLDER = 'div.rc-virtual-list div.rc-virtual-list-holder-inner:visible'
    SCHEDULE_SUBMIT_BUTTON = 'button >> text=定时发布'
    SCHEDULE_PUBLISH_ENTRY = 'div.op-btn-outter-content >> text=定时发布'
    SCHEDULE_SELECT_WRAP_VISIBLE = 'div.select-wrap:visible'

    # ── Publish ───────────────────────────────────────────────────────────
    PUBLISH_BUTTON = 'button >> text=发布'

    # ── AI2Video (legacy feature) ─────────────────────────────────────────
    AIGC_ALL_NETWORK = 'div.rounded-lg.border:has-text("全网")'
    AIGC_CONTAINER = (
        '.overflow-auto.flex-grow.h-0.saas-scrollbar.mt\\-\\[-4px\\]'
        '.pl\\-\\[24px\\].pr\\-\\[10px\\].pb\\-\\[18px\\]'
    )
    AIGC_NEWS_ITEM = 'div.py\\-\\[6px\\].group.cursor-pointer'
    AIGC_TITLE_ELEM = 'div.flex.text-gray-darker.items-center.relative.pr\\-\\[56px\\] > span'
    AIGC_GENERATE_BUTTON = 'button:has-text("生成文案")'
    AIGC_ONE_KEY_BUTTON = "button:has-text('一键成片')"
    AIGC_TIP_WINDOW = "div:has-text('温馨提示') >> visible=true"
    AIGC_KNOW_BUTTON = "button:has-text('知道了')"
