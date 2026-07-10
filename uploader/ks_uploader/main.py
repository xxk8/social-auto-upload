from __future__ import annotations

import asyncio
import os
from datetime import datetime
from pathlib import Path

import patchright
from patchright.async_api import Page, Playwright, async_playwright

from conf import DEBUG_MODE, LOCAL_CHROME_HEADLESS, LOCAL_CHROME_PATH
from uploader.base_video import BaseVideoUploader
from uploader.common import MAX_PUBLISH_POLL, _build_login_result, _emit_qrcode_callback, _msg
from uploader.ks_uploader.locators import KsLocators as L
from utils.anti_detect import obfuscate_image, obfuscate_video
from utils.anti_detect.config import get_config
from utils.base_social_media import set_init_script
from utils.files_times import get_absolute_path
from utils.log import kuaishou_logger

KUAISHOU_UPLOAD_URL = L.UPLOAD_URL
KUAISHOU_MANAGE_URL = L.MANAGE_URL
KUAISHOU_LOGIN_URL = L.LOGIN_URL
KUAISHOU_UPLOAD_URL_PATTERN = L.UPLOAD_URL_PATTERN
KUAISHOU_MANAGE_URL_PATTERN = L.MANAGE_URL_PATTERN
KUAISHOU_COOKIE_INVALID_SELECTOR = L.COOKIE_INVALID_SELECTOR
KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE = 'immediate'
KUAISHOU_PUBLISH_STRATEGY_SCHEDULED = 'scheduled'

async def _is_ks_cookie_invalid(page: Page, timeout: int=5000) -> bool:
    try:
        await page.wait_for_selector(KUAISHOU_COOKIE_INVALID_SELECTOR, timeout=timeout)
        return True
    except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
        return False

async def _extract_ks_qrcode_src(page: Page) -> str:
    login_form = page.locator(L.LOGIN_FORM).first
    await login_form.wait_for(state='visible', timeout=30000)
    qrcode_img = login_form.locator(L.LOGIN_QR_IMG).first
    try:
        if not await qrcode_img.count() or not await qrcode_img.is_visible():
            platform_switch = login_form.locator(L.LOGIN_PLATFORM_SWITCH).first
            await platform_switch.wait_for(state='visible', timeout=10000)
            await platform_switch.click()
            await asyncio.sleep(1)
    except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
        platform_switch = login_form.locator('div.platform-switch').first
        await platform_switch.wait_for(state='visible', timeout=10000)
        await platform_switch.click()
        await asyncio.sleep(1)
    await qrcode_img.wait_for(state='visible', timeout=15000)
    qrcode_src = await qrcode_img.get_attribute('src')
    if not qrcode_src:
        raise RuntimeError('未获取到快手登录二维码地址')
    return qrcode_src

async def _save_ks_qrcode(page: Page, qrcode_callback=None) -> dict:
    """Extract QR via DOM <img> src. No local PNG file is written.

    Per round-OPT-acct-qr cleanup (2026-07-10), the Kuaishou login flow
    is data-URL only — the platform's own QR <img> ``src`` is forwarded
    to the Web Shell via the SSE ``image_data_url`` field. CLI
    direct-path users (no callback) get a friendly warning instead of
    a local file; the web shell is the canonical QR scanning surface.
    """
    try:
        qrcode_src = await _extract_ks_qrcode_src(page)
    except Exception as exc:
        kuaishou_logger.warning(_msg('😵', f'没定位到快手登录二维码元素（{str(exc)[:50]}）——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
        qrcode_src = ''
    if not qrcode_src:
        kuaishou_logger.warning(_msg('😵', '没拿到快手登录二维码——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
    qrcode_info: dict = {'image_path': '', 'image_data_url': qrcode_src}
    await _emit_qrcode_callback(qrcode_callback, qrcode_info)
    return qrcode_info


async def _is_ks_qrcode_expired(page: Page) -> bool:
    expired_box = page.locator(L.QR_EXPIRED).first
    try:
        if not await expired_box.count():
            return False
        return await expired_box.is_visible()
    except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
        return False

async def _is_ks_login_page_gone(page: Page) -> bool:
    try:
        login_form = page.locator(L.LOGIN_FORM).first
        if not await login_form.count():
            return True
        return not await login_form.is_visible()
    except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
        return True

async def cookie_auth(account_file):
    async with async_playwright() as playwright:
        if LOCAL_CHROME_PATH:
            browser = await playwright.chromium.launch(headless=True, executable_path=LOCAL_CHROME_PATH)
        else:
            browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(storage_state=account_file)
            context = await set_init_script(context)
            page = await context.new_page()
            await page.goto(KUAISHOU_UPLOAD_URL)
            if await _is_ks_cookie_invalid(page):
                kuaishou_logger.info(_msg('🥹', 'cookie 已失效，得重新登录一下'))
                return False
            kuaishou_logger.success(_msg('🥳', 'cookie 有效'))
            return True
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError, RuntimeError) as exc:
            kuaishou_logger.warning(_msg('😵', f'cookie 校验时出错，按失效处理: {exc}'))
            return False
        finally:
            await browser.close()

async def ks_setup(account_file, handle=False, return_detail=False, qrcode_callback=None, headless: bool=LOCAL_CHROME_HEADLESS):
    account_file = get_absolute_path(account_file, 'ks_uploader')
    if not os.path.exists(account_file) or not await cookie_auth(account_file):
        if not handle:
            result = _build_login_result(False, 'cookie_invalid', 'cookie文件不存在或已失效', account_file)
            return result if return_detail else False
        kuaishou_logger.info(_msg('🥹', 'cookie 失效了，准备重新登录快手创作者平台'))
        result = await get_ks_cookie(account_file, qrcode_callback=qrcode_callback, headless=headless)
        return result if return_detail else result['success']
    result = _build_login_result(True, 'cookie_valid', 'cookie有效', account_file)
    return result if return_detail else True

async def get_ks_cookie(account_file, qrcode_callback=None, headless: bool=LOCAL_CHROME_HEADLESS, poll_interval: int=3, max_checks: int=100):
    async with async_playwright() as playwright:
        if LOCAL_CHROME_PATH:
            browser = await playwright.chromium.launch(headless=headless, executable_path=LOCAL_CHROME_PATH)
        else:
            browser = await playwright.chromium.launch(headless=headless)
        context = await browser.new_context()
        context = await set_init_script(context)
        qrcode_info = None
        result = _build_login_result(False, 'failed', '快手登录失败', account_file)
        try:
            page = await context.new_page()
            await page.goto(KUAISHOU_LOGIN_URL)
            kuaishou_logger.info(_msg('🧍', '请在浏览器里扫码登录快手，小人正在耐心等待'))
            qrcode_info = await _save_ks_qrcode(page, qrcode_callback=qrcode_callback)
            for _ in range(max_checks):
                if page.url.startswith(KUAISHOU_UPLOAD_URL) or await _is_ks_login_page_gone(page):
                    await context.storage_state(path=account_file)
                    if await cookie_auth(account_file):
                        kuaishou_logger.success(_msg('🥳', '快手扫码登录成功，小人开心收工'))
                        result = _build_login_result(True, 'success', '快手扫码登录成功', account_file, qrcode_info, page.url)
                    else:
                        kuaishou_logger.error(_msg('😢', '快手扫码完成了，但 cookie 校验失败'))
                        result = _build_login_result(False, 'cookie_invalid', '快手扫码流程结束，但 cookie 校验失败', account_file, qrcode_info, page.url)
                    return result
                if qrcode_info and await _is_ks_qrcode_expired(page):
                    kuaishou_logger.warning(_msg('😵', '二维码失效了，小人马上去刷新'))
                    refresh_button = page.locator(L.QR_REFRESH_BUTTON).first
                    if await refresh_button.count():
                        await refresh_button.click()
                        await asyncio.sleep(1)
                    qrcode_info = await _save_ks_qrcode(page, qrcode_callback=qrcode_callback)
                await asyncio.sleep(poll_interval)
            result = _build_login_result(False, 'timeout', '等待快手扫码登录超时', account_file, qrcode_info, page.url)
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
            result = _build_login_result(False, 'failed', str(exc), account_file, current_url=page.url if 'page' in locals() else '')
        finally:
            if not result['success']:
                kuaishou_logger.error(_msg('😢', f"登录失败: {result['message']}"))
            await context.close()
            await browser.close()
    return result

class KSBaseUploader(BaseVideoUploader):

    def __init__(self, publish_date: datetime | int, account_file, publish_strategy: str | None=None, debug: bool=DEBUG_MODE, headless: bool=LOCAL_CHROME_HEADLESS):
        self.publish_date = publish_date
        self.account_file = str(account_file)
        self.publish_strategy = publish_strategy
        self.debug = debug
        self.headless = headless
        self.local_executable_path = LOCAL_CHROME_PATH
        self.date_format = '%Y-%m-%d %H:%M'

    async def validate_base_args(self):
        if not os.path.exists(self.account_file):
            raise RuntimeError(f'cookie文件不存在，请先完成快手登录: {self.account_file}')
        if not await cookie_auth(self.account_file):
            raise RuntimeError(f'cookie文件已失效，请先完成快手登录: {self.account_file}')
        if self.publish_strategy is None:
            self.publish_strategy = KUAISHOU_PUBLISH_STRATEGY_SCHEDULED if self.publish_date != 0 else KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE
        if self.publish_strategy not in {KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE, KUAISHOU_PUBLISH_STRATEGY_SCHEDULED}:
            raise ValueError(f'不支持的发布策略: {self.publish_strategy}')
        # Phase 4 §8.5 migration (2026-07-02): strategy-conditional publish_date block
        # removed. Validation is now unconditional in the derived-class `validate_upload_args`
        # (matches `BaiJiaHaoVideo` / `DouYinVideo` shared pattern; fixes the latent
        # "IMMEDIATE strategy + datetime input → silently overwritten to 0" bug).

    async def set_schedule_time(self, page: Page, publish_date: datetime):
        kuaishou_logger.info(_msg('🕒', '小人准备设置定时发布时间'))
        publish_date_str = publish_date.strftime('%Y-%m-%d %H:%M:%S')
        await page.locator(L.SCHEDULE_RADIO).filter(has_text=L.SCHEDULE_RADIO_FILTER_TEXT).click()
        await asyncio.sleep(2)
        await page.locator(L.SCHEDULE_TIME_INPUT).click()
        await asyncio.sleep(1)
        js_code = '\n        (newValue) => {\n            const input = document.querySelector(\'input[placeholder=\"选择日期时间\"]\');\n            if (!input) return false;\n            const nativeSetter = Object.getOwnPropertyDescriptor(\n                window.HTMLInputElement.prototype, \'value\'\n            ).set;\n            nativeSetter.call(input, newValue);\n            input.dispatchEvent(new Event(\'input\', { bubbles: true }));\n            input.dispatchEvent(new Event(\'change\', { bubbles: true }));\n            return true;\n        }\n        '
        ok = await page.evaluate(js_code, publish_date_str)
        if not ok:
            kuaishou_logger.error('❌ 找不到时间选择器输入框')
            return
        await asyncio.sleep(1)
        await page.keyboard.press('Enter')
        await asyncio.sleep(2)
        kuaishou_logger.info(f'✅ 定时发布时间已设置为 {publish_date_str}')

    async def close_guide_overlay(self, page: Page) -> bool:
        joyride_tooltip = page.locator(L.GUIDE_TOOLTIP)
        if await joyride_tooltip.count() > 0 and await joyride_tooltip.first.is_visible():
            print('检测到 Joyride 引导遮罩，正在关闭...')
            close_button = page.locator('div[role="alertdialog"]').locator(L.GUIDE_CLOSE_BUTTON)
            await close_button.click(force=True)
            await joyride_tooltip.wait_for(state='hidden', timeout=5000)
            print('✅ 已关闭 Joyride 遮罩')
        else:
            print('未检测到 Joyride 遮罩，继续执行')

class KSVideo(KSBaseUploader):

    def __init__(self, title, file_path, tags, publish_date: datetime | int, account_file, publish_strategy: str | None=None, debug: bool=DEBUG_MODE, headless: bool=LOCAL_CHROME_HEADLESS, thumbnail_path=None, desc: str | None=None):
        super().__init__(publish_date=publish_date, account_file=account_file, publish_strategy=publish_strategy, debug=debug, headless=headless)
        self.title = title
        self.file_path = file_path
        self.tags = tags or []
        self.thumbnail_path = thumbnail_path
        self.desc = desc or ''

    async def validate_upload_args(self):
        await self.validate_base_args()
        if not self.title or not str(self.title).strip():
            raise ValueError('快手视频上传时，title 是必须的')
        self.file_path = str(self.validate_video_file(self.file_path))

        # ── Content fingerprint obfuscation (anti-duplicate-detection) ────────
        config = get_config("kuaishou")
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
            kuaishou_logger.info(_msg("🎭", "视频指纹已混淆，用于对抗平台重复检测"))

        if self.thumbnail_path:
            self.thumbnail_path = str(self.validate_image_file(self.thumbnail_path))
            # Obfuscate thumbnail if provided
            thumb_config = get_config("kuaishou")
            thumb_obf_path = str(Path(self.thumbnail_path).with_suffix("")) + ".obf" + Path(self.thumbnail_path).suffix
            thumb_obf = obfuscate_image(
                self.thumbnail_path,
                thumb_obf_path,
                quality=thumb_config.image_quality,
                crop_pixels=thumb_config.image_crop_pixels,
                brightness_range=thumb_config.brightness_range,
            )
            if thumb_obf.exists():
                self.thumbnail_path = str(thumb_obf)
                kuaishou_logger.info(_msg("🎭", "封面指纹已混淆"))

        self.publish_date = self.validate_publish_date(self.publish_date)

    async def handle_upload_error(self, page: Page):
        kuaishou_logger.warning(_msg('😵', '视频上传摔了一跤，小人马上重新上传'))
        await page.locator(L.UPLOAD_RETRY_INPUT).set_input_files(self.file_path)

    async def set_thumbnail(self, page: Page):
        if not self.thumbnail_path:
            return
        kuaishou_logger.info(_msg('🖼️', '小人准备设置封面'))
        cover_label = page.locator(L.THUMB_COVER_LABEL).filter(has_text=L.THUMB_COVER_LABEL_FILTER_TEXT)
        await cover_label.wait_for(state='visible', timeout=30000)
        await cover_label.locator(L.THUMB_COVER_SIBLING_XPATH).locator('div').nth(0).click()
        modal = page.locator(L.THUMB_MODAL)
        await modal.wait_for(state='visible', timeout=30000)
        upload_cover_tab = modal.get_by_text(L.THUMB_UPLOAD_TAB_TEXT, exact=True)
        await upload_cover_tab.wait_for(state='visible', timeout=10000)
        await upload_cover_tab.click()
        file_input = modal.locator(L.THUMB_FILE_INPUT)
        await file_input.wait_for(state='attached', timeout=30000)
        await file_input.set_input_files(self.thumbnail_path)
        await asyncio.sleep(1)
        confirm_button = modal.get_by_role('button', name=L.THUMB_CONFIRM_BUTTON_NAME, exact=True)
        await confirm_button.wait_for(state='visible', timeout=10000)
        await confirm_button.click()
        await modal.wait_for(state='hidden', timeout=30000)
        kuaishou_logger.success(_msg('🥳', '封面已经设置完成'))

    async def upload(self, playwright: Playwright) -> None:
        kuaishou_logger.info(_msg('🧍', '小人先检查 cookie、视频文件、封面和发布时间'))
        await self.validate_upload_args()
        kuaishou_logger.info(_msg('🥳', '上传前检查通过'))
        if self.local_executable_path:
            browser = await playwright.chromium.launch(headless=self.headless, executable_path=self.local_executable_path)
        else:
            browser = await playwright.chromium.launch(headless=self.headless)
        context = await browser.new_context(storage_state=self.account_file)
        context = await set_init_script(context)
        upload_success = False
        try:
            page = await context.new_page()
            await page.goto(KUAISHOU_UPLOAD_URL)
            kuaishou_logger.info(_msg('🏃', f'小人开始搬运视频: {self.title}.mp4'))
            kuaishou_logger.info(_msg('🧭', '小人正在赶往快手上传主页'))
            await page.wait_for_url(KUAISHOU_UPLOAD_URL_PATTERN)
            upload_button = page.locator(L.UPLOAD_BUTTON)
            await upload_button.wait_for(state='visible', timeout=10000)
            async with page.expect_file_chooser() as fc_info:
                await upload_button.click()
            file_chooser = await fc_info.value
            await file_chooser.set_files(self.file_path)
            await asyncio.sleep(2)
            know_button = page.locator(L.KNOW_BUTTON).first
            try:
                if await know_button.count() and await know_button.is_visible():
                    await know_button.click()
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
                pass
            await self.close_guide_overlay(page)
            kuaishou_logger.info(_msg('✍️', '小人开始填描述和话题'))
            await page.get_by_text(L.DESC_TRIGGER).locator(L.DESC_TRIGGER_XPATH).click()
            await page.keyboard.press('Backspace')
            await page.keyboard.press('Control+KeyA')
            await page.keyboard.press('Delete')
            await page.keyboard.type(self.desc or self.title)
            await page.keyboard.press('Enter')
            for index, tag in enumerate(self.tags[:3], start=1):
                kuaishou_logger.info(_msg('🏷️', f'小人正在添加第 {index} 个话题: #{tag}'))
                await page.keyboard.type(f'#{tag} ')
                await asyncio.sleep(2)
            max_retries = 60
            retry_count = 0
            while retry_count < max_retries:
                try:
                    number = await page.locator(L.UPLOAD_IN_PROGRESS_TEXT).count()
                    if number == 0:
                        kuaishou_logger.success(_msg('🥳', '视频已经传完啦'))
                        break
                    if retry_count % 5 == 0:
                        kuaishou_logger.info(_msg('🏃', '小人正在努力上传视频'))
                    if await page.locator(L.UPLOAD_FAILED_TEXT).count():
                        await self.handle_upload_error(page)
                    await asyncio.sleep(2)
                except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
                    kuaishou_logger.warning(_msg('😵', f'检查上传状态时出错，小人继续重试: {exc}'))
                    await asyncio.sleep(2)
                retry_count += 1
            if retry_count == max_retries:
                kuaishou_logger.warning(_msg('😵', '超过最大重试次数，视频上传可能未完成'))
            await self.set_thumbnail(page)
            if self.publish_strategy == KUAISHOU_PUBLISH_STRATEGY_SCHEDULED and self.publish_date != 0:
                await self.set_schedule_time(page, self.publish_date)
            for _ in range(MAX_PUBLISH_POLL):
                try:
                    publish_button = page.get_by_text('发布', exact=True)
                    if await publish_button.count() > 0:
                        await publish_button.click()
                    await asyncio.sleep(1)
                    confirm_button = page.get_by_text('确认发布')
                    if await confirm_button.count() > 0:
                        await confirm_button.click()
                    await page.wait_for_url(KUAISHOU_MANAGE_URL_PATTERN, timeout=5000)
                    kuaishou_logger.success(_msg('🥳', '视频发布成功，小人开心收工'))
                    break
                except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
                    kuaishou_logger.info(_msg('🏃', f'小人正在冲刺发布视频: {exc}'))
                    if self.debug:
                        await page.screenshot(full_page=True)
                    await asyncio.sleep(1)
            else:
                raise TimeoutError('等待快手视频发布超时')

            upload_success = True
        finally:
            if upload_success:
                await context.storage_state(path=self.account_file)
                kuaishou_logger.success(_msg('🥳', 'cookie 更新完毕'))
                await asyncio.sleep(2)
            await context.close()
            await browser.close()

    async def main(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)

class KSNote(KSBaseUploader):

    def __init__(self, image_paths, note, tags, publish_date: datetime | int, account_file, title: str | None=None, publish_strategy: str | None=None, debug: bool=DEBUG_MODE, headless: bool=LOCAL_CHROME_HEADLESS):
        super().__init__(publish_date=publish_date, account_file=account_file, publish_strategy=publish_strategy, debug=debug, headless=headless)
        self.image_paths = image_paths
        self.note = note or ''
        self.title = title or (self.note[:20] if self.note else '')
        self.tags = tags or []

    async def validate_upload_args(self):
        await self.validate_base_args()
        if not self.title or not str(self.title).strip():
            raise ValueError('快手图文上传时，title 是必须的')
        if not self.image_paths:
            raise ValueError('快手图文上传时，图片是必须的')
        if isinstance(self.image_paths, (str, Path)):
            self.image_paths = [self.image_paths]
        normalized_image_paths = []
        for image_path in self.image_paths:
            normalized_image_paths.append(str(self.validate_image_file(image_path)))

        # ── Image fingerprint obfuscation (anti-duplicate-detection) ──────────
        config = get_config("kuaishou")
        obfuscated_images = []
        for img_path in normalized_image_paths:
            p = Path(img_path)
            obf_path = str(p.with_suffix("")) + ".obf" + p.suffix
            obf = obfuscate_image(
                img_path,
                obf_path,
                quality=config.image_quality,
                crop_pixels=config.image_crop_pixels,
                brightness_range=config.brightness_range,
            )
            if obf.exists():
                obfuscated_images.append(str(obf))
        if obfuscated_images:
            self.image_paths = obfuscated_images
            kuaishou_logger.info(_msg("🎭", f"{len(obfuscated_images)} 张图片指纹已混淆"))

        self.publish_date = self.validate_publish_date(self.publish_date)

    async def upload_note_content(self, page: Page) -> None:
        kuaishou_logger.info(_msg('🏃', f'小人开始搬运图文，共 {len(self.image_paths)} 张图片'))
        kuaishou_logger.info(_msg('🔀', '小人正在切换到图文发布'))
        await page.locator(L.NOTE_TAB).click()
        await page.wait_for_timeout(1000)
        kuaishou_logger.info(_msg('📤', '小人正在上传图片'))
        upload_button = page.locator(L.UPLOAD_BUTTON_IMAGE).filter(has_text=L.UPLOAD_BUTTON_IMAGE_FILTER)
        await upload_button.wait_for(state='visible', timeout=10000)
        async with page.expect_file_chooser() as fc_info:
            await upload_button.click()
        file_chooser = await fc_info.value
        await file_chooser.set_files(self.image_paths)
        know_button = page.locator(L.KNOW_BUTTON).first
        try:
            if await know_button.count() and await know_button.is_visible():
                await know_button.click()
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
            pass
        await self.close_guide_overlay(page)
        kuaishou_logger.info(_msg('✍️', '小人开始填写图文内容和话题'))
        await page.get_by_text(L.DESC_TRIGGER).locator(L.DESC_TRIGGER_XPATH).click()
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Control+KeyA')
        await page.keyboard.press('Delete')
        await page.keyboard.type(self.note)
        await page.keyboard.press('Enter')
        for index, tag in enumerate(self.tags[:3], start=1):
            kuaishou_logger.info(_msg('🏷️', f'小人正在添加第 {index} 个话题: #{tag}'))
            await page.keyboard.type(f'#{tag} ')
            await asyncio.sleep(2)
        max_retries = 60
        retry_count = 0
        while retry_count < max_retries:
            try:
                number = await page.locator(L.UPLOAD_IN_PROGRESS_TEXT).count()
                if number == 0:
                    kuaishou_logger.success(_msg('🥳', '图文素材已经传完啦'))
                    break
                if retry_count % 5 == 0:
                    kuaishou_logger.info(_msg('🏃', '小人正在努力上传图文素材'))
                if await page.locator(L.UPLOAD_FAILED_TEXT).count():
                    kuaishou_logger.warning(_msg('😵', '图文素材上传摔了一跤，小人马上重新上传'))
                    await page.locator(L.UPLOAD_RETRY_INPUT).set_input_files(self.image_paths)
                await asyncio.sleep(2)
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
                kuaishou_logger.warning(_msg('😵', f'检查图文上传状态时出错，小人继续重试: {exc}'))
                await asyncio.sleep(2)
            retry_count += 1
        if retry_count == max_retries:
            kuaishou_logger.warning(_msg('😵', '超过最大重试次数，图文上传可能未完成'))
        if self.publish_strategy == KUAISHOU_PUBLISH_STRATEGY_SCHEDULED and self.publish_date != 0:
            await self.set_schedule_time(page, self.publish_date)
        for _ in range(MAX_PUBLISH_POLL):
            try:
                publish_button = page.get_by_text(L.PUBLISH_BUTTON_TEXT, exact=True)
                if await publish_button.count() > 0:
                    await publish_button.click()
                await asyncio.sleep(1)
                confirm_button = page.get_by_text(L.PUBLISH_CONFIRM_TEXT)
                if await confirm_button.count() > 0:
                    await confirm_button.click()
                await page.wait_for_url(KUAISHOU_MANAGE_URL_PATTERN, timeout=5000)
                kuaishou_logger.success(_msg('🥳', '图文发布成功，小人开心收工'))
                break
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
                kuaishou_logger.info(_msg('🏃', f'小人正在冲刺发布图文: {exc}'))
                if self.debug:
                    await page.screenshot(full_page=True)
                await asyncio.sleep(1)
        else:
            raise TimeoutError('等待快手图文发布超时')

    async def upload(self, playwright: Playwright) -> None:
        kuaishou_logger.info(_msg('🧍', '小人先检查 cookie、图片和发布时间'))
        await self.validate_upload_args()
        kuaishou_logger.info(_msg('🥳', '图文上传前检查通过'))
        if self.local_executable_path:
            browser = await playwright.chromium.launch(headless=self.headless, executable_path=self.local_executable_path)
        else:
            browser = await playwright.chromium.launch(headless=self.headless)
        context = await browser.new_context(storage_state=self.account_file)
        context = await set_init_script(context)
        upload_success = False
        try:
            page = await context.new_page()
            await page.goto(KUAISHOU_UPLOAD_URL)
            kuaishou_logger.info(_msg('🧭', '小人正在赶往快手图文发布页'))
            await page.wait_for_url(KUAISHOU_UPLOAD_URL_PATTERN)
            await self.upload_note_content(page)
            upload_success = True
        finally:
            if upload_success:
                await context.storage_state(path=self.account_file)
                kuaishou_logger.success(_msg('🥳', 'cookie 更新完毕'))
                await asyncio.sleep(2)
            await context.close()
            await browser.close()

    async def main(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)
