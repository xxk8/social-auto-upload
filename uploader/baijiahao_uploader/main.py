import asyncio
import os
import time
from datetime import datetime
from pathlib import Path

import patchright
from patchright.async_api import Page, Playwright, async_playwright

from conf import LOCAL_CHROME_HEADLESS, LOCAL_CHROME_PATH
from uploader.base_video import BaseVideoUploader
from uploader.common import (
    MAX_NAV_POLL,
    MAX_UPLOAD_POLL,
    _all_login_markers_hidden,
    _build_login_result,
    _check_login_markers,
    _emit_qrcode_callback,
    _msg,
)
from uploader.baijiahao_uploader.locators import BaijiahaoLocators as L
from utils.anti_detect import obfuscate_video
from utils.anti_detect.config import get_config
from utils.base_social_media import set_init_script
from utils.log import baijiahao_logger
from utils.network import async_retry

BAIJIAHAO_LOGIN_URL = L.LOGIN_URL
BAIJIAHAO_HOME_URL = L.HOME_URL

async def _extract_baijiahao_qrcode_src(page: Page) -> str:
    qrcode_img = page.locator(L.QR_IMG_PRIMARY).first
    if not await qrcode_img.count():
        qrcode_img = page.locator(L.QR_IMG_ALT).first
    if not await qrcode_img.count():
        qrcode_img = page.locator(L.QR_IMG_SRC).first
    await qrcode_img.wait_for(state='visible', timeout=30000)
    src = await qrcode_img.get_attribute('src')
    if not src:
        raise RuntimeError('未获取到百家号登录二维码地址')
    return src

async def _open_baijiahao_login_modal(page: Page) -> None:
    """Click to open the Baidu Passport login modal if it is not already visible."""
    login_triggers = [page.get_by_text(L.LOGIN_TRIGGER_TEXT, exact=True).first, page.get_by_role('button', name=L.LOGIN_TRIGGER_ROLE_BUTTON).first, page.locator(L.LOGIN_TRIGGER_LINK).first, page.locator(L.LOGIN_TRIGGER_BUTTON).first]
    for trigger in login_triggers:
        try:
            if await trigger.count() and await trigger.is_visible():
                await trigger.click()
                await asyncio.sleep(2)
                return
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
            continue
    baijiahao_logger.info(_msg('🧍', '未找到登录按钮，假设二维码已在页面上'))

async def _save_baijiahao_qrcode(page: Page, account_file: str, qrcode_callback=None) -> dict:
    """Extract QR via DOM <img> src. No local PNG file is written.

    Per round-OPT-acct-qr cleanup (2026-07-10), the baijiahao login flow
    is data-URL only — the platform's own QR <img> ``src`` is forwarded
    to the Web Shell via the SSE ``image_data_url`` field. The prior
    CLI direct-path ``save_data_url_image(...)`` round-trip and the
    ``decode_qrcode_from_path`` → ``print_terminal_qrcode`` zxing
    terminal-ASCII chain were both removed because:
      * CLI direct-path users (no ``qrcode_callback``) get a friendly
        warning instead of a local file; the web shell is the canonical
        QR scanning surface.
      * Removing the zxing decode also removes the unreliable cropped
        QR decode path (cf. ``tests/test_login_qrcode.py`` for the prior
        zxing→pyzbar fallback chain).
    """
    try:
        qrcode_src = await _extract_baijiahao_qrcode_src(page)
    except Exception as exc:
        baijiahao_logger.warning(_msg('😵', f'没定位到百家号登录二维码元素（{str(exc)[:50]}）——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
        qrcode_src = ''
    if not qrcode_src:
        baijiahao_logger.warning(_msg('😵', '没拿到百家号登录二维码——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
    qrcode_info: dict = {'image_path': '', 'image_data_url': qrcode_src}
    await _emit_qrcode_callback(qrcode_callback, qrcode_info)
    return qrcode_info

async def _is_baijiahao_login_completed(page: Page) -> bool:
    current_url = page.url
    if L.LOGIN_COMPLETED_HOME in current_url:
        return True
    if L.LOGIN_COMPLETED_EDIT in current_url:
        return True
    # 如果页面还在 baijiahao.baidu.com 域下但没有登录文本，说明已登录
    if 'baijiahao.baidu.com' in current_url and await _all_login_markers_hidden(page, [L.LOGIN_MARKER_TEXT]):
        return True
    return False

async def _wait_for_baijiahao_login(page: Page, account_file: str, qrcode_info: dict, qrcode_callback=None, poll_interval: int=3, max_checks: int=100) -> dict:
    for _ in range(max_checks):
        if await _is_baijiahao_login_completed(page):
            baijiahao_logger.info(_msg('🥳', f'扫码成功，已经跳转到登录后页面: {page.url}'))
            return _build_login_result(True, 'success', '百家号扫码登录成功', account_file, qrcode_info, page.url)
        await asyncio.sleep(poll_interval)
    return _build_login_result(False, 'timeout', '等待百家号扫码登录超时', account_file, qrcode_info, page.url)

async def baijiahao_cookie_gen(account_file, qrcode_callback=None, headless: bool=LOCAL_CHROME_HEADLESS, poll_interval: int=3, max_checks: int=100):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=headless, args=['--lang en-GB'])
        context = await browser.new_context()
        context = await set_init_script(context)
        result = _build_login_result(False, 'failed', '百家号登录失败', account_file)
        try:
            page = await context.new_page()
            await page.goto(BAIJIAHAO_LOGIN_URL)
            await page.wait_for_load_state('domcontentloaded')
            await asyncio.sleep(2)
            await _open_baijiahao_login_modal(page)
            qrcode_info = await _save_baijiahao_qrcode(page, account_file, qrcode_callback=qrcode_callback)
            baijiahao_logger.info(_msg('🧍', '请扫码，正在等待百家号登录完成'))
            result = await _wait_for_baijiahao_login(page, account_file, qrcode_info, qrcode_callback=qrcode_callback, poll_interval=poll_interval, max_checks=max_checks)
            if result['success']:
                await asyncio.sleep(2)
                await context.storage_state(path=account_file)
                if not await cookie_auth(account_file):
                    result = _build_login_result(False, 'cookie_invalid', '百家号扫码流程结束，但 cookie 校验失败', account_file, qrcode_info, page.url)
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError, RuntimeError) as exc:
            result = _build_login_result(False, 'failed', str(exc), account_file, current_url=page.url if 'page' in locals() else '')
        finally:
            if not result['success']:
                baijiahao_logger.error(_msg('😢', f"登录失败: {result['message']}"))
            await context.close()
            await browser.close()
        return result

async def cookie_auth(account_file):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=LOCAL_CHROME_HEADLESS)
        context = await browser.new_context(storage_state=account_file)
        context = await set_init_script(context)
        page = await context.new_page()
        await page.goto('https://baijiahao.baidu.com/builder/rc/home')
        await page.wait_for_timeout(timeout=5000)
        if await _check_login_markers(page, [L.LOGIN_MARKER_TEXT]):
            baijiahao_logger.error('等待5秒 cookie 失效')
            return False
        else:
            baijiahao_logger.success('[+] cookie 有效')
            return True

async def baijiahao_setup(account_file, handle=False, return_detail=False, qrcode_callback=None, headless: bool=LOCAL_CHROME_HEADLESS):
    if not os.path.exists(account_file) or not await cookie_auth(account_file):
        if not handle:
            result = _build_login_result(False, 'cookie_invalid', 'cookie文件不存在或已失效', account_file)
            return result if return_detail else False
        baijiahao_logger.info(_msg('🥹', 'cookie失效，准备打开浏览器扫码登录百家号'))
        result = await baijiahao_cookie_gen(account_file, qrcode_callback=qrcode_callback, headless=headless)
        return result if return_detail else result['success']
    result = _build_login_result(True, 'cookie_valid', 'cookie有效', account_file)
    return result if return_detail else True

class BaiJiaHaoVideo(BaseVideoUploader):
    # NOTE(deviation-from-spec): tasks §4.1 写 "加 super().__init__(publish_date, account_file) 调用",
    # 但 BaseVideoUploader 当前是 stateless namespace for classmethods (无 __init__)。这里走
    # Phase 1 已 ship 的 DouYinBaseUploader 相同 pattern: derived class 直接设置 shared attrs。
    # 给 base 加 __init__ 须同步更新全部 7 个 platform class, 超 AC 范围; 等更多 shared state
    # 进入 base 时再统一升级。详见 tasks.md §4.1 deviation note。

    def __init__(self, title, file_path, tags, publish_date: int | datetime | None, account_file, proxy_setting=None):
        self.title = title
        self.file_path = file_path
        self.tags = tags
        self.publish_date = publish_date
        self.account_file = account_file
        self.date_format = '%Y年%m月%d日 %H:%M'
        self.local_executable_path = LOCAL_CHROME_PATH
        self.headless = LOCAL_CHROME_HEADLESS
        self.proxy_setting = proxy_setting

    async def validate_upload_args(self):
        """Pre-flight validation before opening the browser (Phase 3 pattern).

        Mirrors ``DouYinVideo.validate_upload_args`` (no tags check — baijiahao's
        ``add_title_tags`` only consumes ``self.title``; ``self.tags`` is stored
        but never read, so empty tags are valid):
          * title is non-empty
          * file exists + supported video extension (via ``BaseVideoUploader.validate_video_file``)
          * publish_date, if scheduled (datetime), is at least ``MIN_SCHEDULE_LEAD_TIME`` in the future
            (via ``BaseVideoUploader.validate_publish_date``; short-circuits on ``0``/``None`` for immediate publish)
        """
        if not self.title or not str(self.title).strip():
            raise ValueError("百家号视频模式下，title 是必须的")
        self.file_path = str(self.validate_video_file(self.file_path))

        # ── Content fingerprint obfuscation (anti-duplicate-detection) ────────
        config = get_config("baijiahao")
        obf_path = str(Path(self.file_path).with_suffix("")) + ".obf" + Path(self.file_path).suffix
        obfuscated = obfuscate_video(
            self.file_path,
            obf_path,
            crop_pixels=config.crop_pixels,
            bitrate_variation=config.bitrate_variation,
            add_noise=config.add_noise,
            target_codec=config.target_codec,
            brightness_range=config.brightness_range,
            contrast_range=config.contrast_range,
            min_bitrate_mbps=config.min_bitrate_mbps,
            fast_mode=config.fast_mode,
        )
        if obfuscated.exists():
            self.file_path = str(obfuscated)
            baijiahao_logger.info(_msg("🎭", "视频指纹已混淆，用于对抗平台重复检测"))

        self.publish_date = self.validate_publish_date(self.publish_date)

    # FIXED（openspec/changes/fix-baijiahao-schedule-time, AC §1–§3）:
    # 原 `target_hour_index = min(publish_date.hour, current_choice_hour - 1)` 把 hour VALUE
    # 当作 dropdown INDEX, 实际选到的 hour 是 dropdown 列表中恰好落在 `min(...)` 范围里的任一随机项,
    # 而非用户请求的 hour。修复: 改用 `get_by_text(publish_date_hour, exact=True)` 精确匹配
    # hour option (与上方 day 的 text= 模式对称)。
    #
    # 残留风险(AC #4 真正账号 probe 后才能 close):
    #  1. 平台前端可能把 hour option 渲染成 "14 时" / "下午 2 点" / "14:00" 而非 "{N}点"。AC #4 要求
    #     一个真实百家号账号在 staging/dev 环境跑一次 publish e2e, 将 `available` 列表写入
    #     `openspec/changes/fix-baijiahao-schedule-time/_probes/yyyy-mm-dd.md`。如果实际格式不同,
    #     `publish_date_hour = f'{publish_date.hour}点'` 需要根据 probe 调整 (例如带前缀/后缀模板)。
    #  2. minute (`publish_date_min = '{N}分'`) 当前 set 但未使用 — 百家号 hour dropdown 内是否
    #     携带分钟级 slot 同样依赖 AC #4 真实 dropdown DOM 结构。设计决定 (D3): 默认 minute 无
    #     wire-up, 真要 minute 级精确发布仍然走 AC #4 后的 follow-up。
    async def set_schedule_time(self, page, publish_date):
        """Selects day + hour for scheduled publish via text-based exact match.

        Raises ``RuntimeError`` (per design D2 in the linked openspec ticket) if
        the requested hour is not in the platform's visible dropdown — the
        error message includes the literal ``available`` list for diagnosis
        without a re-run.

        Returns once the 百家号 "定时发布" submit button is clicked.
        """
        publish_date_day = f'{publish_date.month}月{publish_date.day}日' if publish_date.day > 9 else f'{publish_date.month}月0{publish_date.day}日'
        publish_date_hour = f'{publish_date.hour}点'
        await page.wait_for_selector(L.SCHEDULE_SELECT_WRAP, timeout=5000)
        for _ in range(3):
            try:
                await page.locator(L.SCHEDULE_SELECT_WRAP).nth(0).click()
                await page.wait_for_selector(L.SCHEDULE_OPTION_LIST, timeout=5000)
                break
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
                await page.locator(L.SCHEDULE_SELECT_WRAP).nth(0).click()
        await page.wait_for_timeout(2000)
        await page.locator(f'{L.SCHEDULE_OPTION_LIST} >> text={publish_date_day}').click()
        await page.wait_for_timeout(2000)
        for _ in range(3):
            try:
                await page.locator(L.SCHEDULE_SELECT_WRAP).nth(1).click()
                await page.wait_for_selector(L.SCHEDULE_OPTION_LIST_HOLDER, timeout=5000)
                break
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
                await page.locator(L.SCHEDULE_SELECT_WRAP).nth(1).click()
        await page.wait_for_timeout(2000)
        # Playwright text= 默认是 substring 匹配 —— `text=2点` 会同时命中 "12点" / "22点"。
        # `get_by_text(..., exact=True)` 强制精确匹配, 与上方 day 的 `text={day}` substring
        # 恰好不冲突 (day 只取 month+day, 没有 day=1 vs day=11/21 这种前缀碰撞风险)。
        try:
            await page.locator(L.SCHEDULE_OPTION_LIST_VISIBLE).get_by_text(publish_date_hour, exact=True).click()
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
            # 设计 D2: 错误消息必须包含 requested hour + 实际可见 options, 让 AC #4 probe 能
            # 从日志/堆栈直接读到 dropdown 实际渲染的文本格式 (无需重跑也能诊断)。
            try:
                available = await page.locator(L.SCHEDULE_OPTION_LIST_VISIBLE).all_inner_texts()
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
                available = ['<unavailable — dropdown may have closed after timeout>']
            # Empty-list vs unavailable-str have different operator-facing semantics —
            # empty means the dropdown opened but yielded no option texts; the secondary
            # except-branch unavailable-string means the dropdown already closed. Pin both
            # explicitly so the log reader can tell which root cause they're looking at.
            available = available or ['<empty — dropdown showed no option texts>']
            raise RuntimeError(
                f'百家号定时发布时间选择失败: 用户请求 hour={publish_date_hour!r}, '
                f'当前可见 hour options={available!r}. 原始 playwright error: {exc!r}. '
                f'如 hour option 实际渲染格式与 "{publish_date_hour}" 不符 (例如 "14 时" / '
                f'"下午 2 点" / "14:00"), 需调整 publish_date_hour 模板 — 详见 '
                f'openspec/changes/fix-baijiahao-schedule-time/ AC #4 真实账号 probe 任务。'
            ) from exc
        await page.wait_for_timeout(2000)
        await page.locator(L.SCHEDULE_SUBMIT_BUTTON).click()

    async def handle_upload_error(self, page):
        baijiahao_logger.error('视频出错了，重新上传中')
        await page.locator(L.FILE_INPUT).set_input_files(self.file_path)

    async def upload(self, playwright: Playwright) -> None:
        await self.validate_upload_args()
        browser = await playwright.chromium.launch(headless=self.headless, executable_path=self.local_executable_path, proxy=self.proxy_setting)
        context = await browser.new_context(storage_state=f'{self.account_file}', user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.4324.150 Safari/537.36')
        await context.grant_permissions(['geolocation'])
        page = await context.new_page()
        await page.goto(L.EDIT_URL, timeout=60000)
        baijiahao_logger.info(f'正在上传-------{self.title}.mp4')
        baijiahao_logger.info('正在打开主页...')
        await page.wait_for_url(L.EDIT_URL, timeout=60000)
        await page.locator(L.FILE_INPUT).set_input_files(self.file_path)
        for _ in range(MAX_NAV_POLL):
            try:
                await page.wait_for_selector(L.FORM_MAIN)
                break
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
                baijiahao_logger.info('正在等待进入视频发布页面...')
                await asyncio.sleep(0.1)
        else:
            raise TimeoutError('等待进入百家号视频发布页面超时')
        await asyncio.sleep(1)
        baijiahao_logger.info('正在填充标题和话题...')
        await self.add_title_tags(page)
        upload_status = await self.uploading_video(page)
        if not upload_status:
            baijiahao_logger.error(f'发现上传出错了... 文件:{self.file_path}')
            raise
        for _ in range(MAX_UPLOAD_POLL):
            baijiahao_logger.info('正在确认封面完成, 准备去点击定时/发布...')
            if await page.locator(L.COVER_IMAGE).count():
                baijiahao_logger.info('封面已完成，点击定时/发布...')
                break
            else:
                baijiahao_logger.info('等待封面生成...')
                await asyncio.sleep(3)
        else:
            raise TimeoutError('等待百家号封面生成超时')
        await self.publish_video(page, self.publish_date)
        await page.wait_for_timeout(2000)
        if await page.locator(L.SECURITY_VERIFY_DIALOG).count():
            baijiahao_logger.error('出现验证，退出')
            raise Exception('出现验证，退出')
        await page.wait_for_url(L.MANAGE_URL_PATTERN, timeout=5000)
        baijiahao_logger.success('视频发布成功')
        await context.storage_state(path=self.account_file)
        baijiahao_logger.info('cookie更新完毕！')
        await asyncio.sleep(2)
        await context.close()
        await browser.close()

    @async_retry(timeout=300)
    async def uploading_video(self, page):
        for _ in range(MAX_UPLOAD_POLL):
            upload_failed = await page.locator(L.UPLOAD_FAILED_OVERLAY).count()
            if upload_failed:
                baijiahao_logger.error('发现上传出错了...')
                return False
            uploading = await page.locator(L.UPLOADING_OVERLAY).count()
            if uploading:
                baijiahao_logger.info('正在上传视频中...')
                await asyncio.sleep(2)
                continue
            if not uploading and (not upload_failed):
                baijiahao_logger.success('视频上传完毕')
                return True
        else:
            baijiahao_logger.error('等待百家号视频上传超时')
            return False

    async def set_schedule_publish(self, page, publish_date):
        while True:
            schedule_element = page.locator(L.SCHEDULE_PUBLISH_ENTRY).locator('..').locator('button')
            try:
                await schedule_element.click()
                await page.wait_for_selector(L.SCHEDULE_SELECT_WRAP_VISIBLE, timeout=3000)
                await page.wait_for_timeout(timeout=2000)
                baijiahao_logger.info('开始点击发布定时...')
                await self.set_schedule_time(page, publish_date)
                break
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
                baijiahao_logger.error(f'定时发布失败: {e}')
                raise

    @async_retry(timeout=300)
    async def publish_video(self, page: Page, publish_date):
        if publish_date != 0:
            await self.set_schedule_publish(page, publish_date)
        else:
            await self.direct_publish(page)

    async def direct_publish(self, page):
        try:
            publish_button = page.locator(L.PUBLISH_BUTTON)
            if await publish_button.count():
                await publish_button.click()
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
            baijiahao_logger.error(f'直接发布视频失败: {e}')
            raise

    async def add_title_tags(self, page):
        title_container = page.get_by_placeholder(L.TITLE_PLACEHOLDER)
        if len(self.title) <= 8:
            self.title += ' 你不知道的'
        await title_container.fill(self.title[:30])

    async def main(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)

    async def ai2video(self, playwright: Playwright) -> None:
        browser = await playwright.chromium.launch(headless=self.headless, executable_path=self.local_executable_path, proxy=self.proxy_setting)
        context = await browser.new_context(viewport={'width': 1600, 'height': 900}, storage_state=f'{self.account_file}', user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.4324.150 Safari/537.36')
        await context.grant_permissions(['geolocation'])
        page = await context.new_page()
        await page.goto(L.AIGC_URL, timeout=60000)
        baijiahao_logger.info('正在打开主页...')
        await page.wait_for_url(L.AIGC_URL, timeout=60000)
        await page.locator(L.AIGC_ALL_NETWORK).click()
        await asyncio.sleep(1)
        now = datetime.now()
        datetime_str = now.strftime('%Y%m%d%H%M')
        processed_key = 'ai2video_processed_titles'
        batch_key = f'ai2video_{datetime_str}'
        await page.evaluate(f'\n                   if (!localStorage.getItem("{processed_key}")) {{\n                       localStorage.setItem("{processed_key}", JSON.stringify([]));                   \n                   }}\n                   if (!localStorage.getItem("{batch_key}")) {{\n                       localStorage.setItem("{batch_key}", JSON.stringify([]));                   \n                   }}\n               ')
        container_selector = '.overflow-auto.flex-grow.h-0.saas-scrollbar.mt\\-\\[-4px\\].pl\\-\\[24px\\].pr\\-\\[10px\\].pb\\-\\[18px\\]'
        news_items = await page.locator(container_selector).locator('div.py\\-\\[6px\\].group.cursor-pointer').all()
        for item in news_items:
            try:
                title_elem = item.locator('div.flex.text-gray-darker.items-center.relative.pr\\-\\[56px\\] > span')
                title = await title_elem.text_content()
                if not title:
                    continue
                is_processed = await page.evaluate(f'title => {{\n                               const processedList = JSON.parse(localStorage.getItem("{processed_key}") || "[]");\n                               return processedList.includes(title);\n                           }}', title)
                if is_processed:
                    print(f'[跳过] {title}')
                    continue
                await item.hover()
                button = item.locator('button:has-text("生成文案")')
                await button.click()
                print(f'[点击] {title}')
                print(f'[等待完成] {title}')
                print('[开始监听] 一键成片按钮')
                should_exit_while_loop = False
                while True:
                    one_key_button = page.locator("button:has-text('一键成片')")
                    if await one_key_button.count() > 0:
                        is_disabled = await one_key_button.get_attribute('disabled')
                        if is_disabled is None:
                            print('[发现可点击按钮] 一键成片')
                            await one_key_button.click()
                            print('[检查] 是否出现温馨提示窗口')
                            await page.wait_for_timeout(2000)
                            try:
                                tip_window = page.locator("div:has-text('温馨提示') >> visible=true")
                                if await tip_window.count() > 0:
                                    print('[发现] 温馨提示窗口')
                                    know_button = page.locator("button:has-text('知道了')")
                                    if await know_button.count() > 0:
                                        try:
                                            await know_button.click(timeout=5000)
                                            print('[已点击] 知道了按钮')
                                        except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
                                            print(f'[警告] 点击知道了按钮时出错: {str(e)}')
                                    else:
                                        print('[警告] 未找到知道了按钮')
                                else:
                                    print('[信息] 未出现温馨提示窗口，继续执行')
                            except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
                                print(f'[警告] 处理温馨提示窗口时出错: {str(e)}')
                            print(f"[开始记录] 准备将标题 '{title}' 记录到LocalStorage")
                            await page.evaluate('\n                                        (title, processedKey, batchKey) => {\n                                            // 更新已处理列表\n                                            const processedList = JSON.parse(localStorage.getItem(processedKey) || "[]");\n                                            if (!processedList.includes(title)) {\n                                                processedList.push(title);\n                                                localStorage.setItem(processedKey, JSON.stringify(processedList));\n                                            }\n\n                                            // 更新当前批次记录\n                                            const batchList = JSON.parse(localStorage.getItem(batchKey) || "[]");\n                                            if (!batchList.includes(title)) {\n                                                batchList.push(title);\n                                                localStorage.setItem(batchKey, JSON.stringify(batchList));\n                                            }\n                                        }\n                                        ', title, processed_key, batch_key)
                            print(f"[记录完成] 标题 '{title}' 已成功记录到LocalStorage")
                            print(f'[记录完成] {title}')
                            print('[监听] 等待新标签页打开')
                            current_pages = context.pages
                            current_page_count = len(current_pages)
                            new_page = None
                            max_wait_time = 10
                            start_time = time.time()
                            while time.time() - start_time < max_wait_time:
                                pages = context.pages
                                if len(pages) > current_page_count:
                                    new_page = pages[-1]
                                    print('[发现] 新标签页已打开')
                                    break
                                await asyncio.sleep(0.5)
                            if new_page:
                                try:
                                    await new_page.wait_for_load_state('domcontentloaded', timeout=5000)
                                    page_title = await new_page.title()
                                    page_url = new_page.url
                                    print(f'[获取] 标题: {page_title}')
                                    print(f'[获取] URL: {page_url}')
                                    with open('url.txt', 'a', encoding='utf-8') as f:
                                        f.write(f'{page_title}\n{page_url}\n\n')
                                    print('[保存] 标题和URL已保存到url.txt')
                                    print('[等待] 5秒后将关闭新标签页')
                                    await asyncio.sleep(5)
                                    await new_page.close()
                                    print('[关闭] 新标签页已关闭')
                                except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
                                    print(f'[错误] 处理新标签页时出错: {str(e)}')
                                    try:
                                        await new_page.close()
                                        print('[关闭] 新标签页已关闭（出错后）')
                                    except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
                                        pass
                            else:
                                print('[警告] 未检测到新标签页打开')
                            print('[操作] 跳出所有循环，不再处理其他新闻')
                            should_exit_while_loop = True
                            break
                    if should_exit_while_loop:
                        break
                    await page.wait_for_timeout(1000)
                if should_exit_while_loop:
                    print('[操作] 跳出for循环，完全结束处理')
                    break
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
                print(f'处理新闻时出错: {str(e)}')
                continue
        print('[循环完成] 准备关闭浏览器')
        await asyncio.sleep(1000)
        await context.storage_state(path=self.account_file)
        baijiahao_logger.info('cookie更新完毕！')
        await asyncio.sleep(2)
        await context.close()
        await browser.close()

    async def mainAi(self):
        async with async_playwright() as playwright:
            await self.ai2video(playwright)
