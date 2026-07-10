import asyncio
import os
import re
from datetime import datetime
from pathlib import Path

import patchright
from patchright.async_api import Page, Playwright, async_playwright

from conf import LOCAL_CHROME_HEADLESS
from uploader.base_video import BaseVideoUploader
from uploader.common import _build_login_result, _emit_qrcode_callback, _msg
from uploader.tk_uploader.tk_config import Tk_Locator
from utils.anti_detect import obfuscate_image, obfuscate_video
from utils.anti_detect.config import get_config
from utils.base_social_media import set_init_script
from utils.files_times import get_absolute_path
from utils.log import tiktok_logger

TIKTOK_LOGIN_QRCODE_URL = 'https://www.tiktok.com/login/qrcode'

async def cookie_auth(account_file):
    async with async_playwright() as playwright:
        browser = await playwright.firefox.launch(headless=LOCAL_CHROME_HEADLESS)
        context = await browser.new_context(storage_state=account_file)
        context = await set_init_script(context)
        page = await context.new_page()
        await page.goto('https://www.tiktok.com/tiktokstudio/upload?lang=en')
        await page.wait_for_load_state('networkidle')
        try:
            select_elements = await page.query_selector_all('select')
            for element in select_elements:
                class_name = await element.get_attribute('class')
                if re.match('tiktok-.*-SelectFormContainer.*', class_name):
                    tiktok_logger.error('[+] cookie expired')
                    return False
            tiktok_logger.success('[+] cookie valid')
            return True
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError, RuntimeError):
            tiktok_logger.success('[+] cookie valid')
            return True

async def _extract_tiktok_qrcode_src(page: Page) -> str:
    qrcode_img = page.get_by_role('img', name='qrcode').first
    if not await qrcode_img.count():
        qrcode_img = page.locator('img[alt*="QR"], img[alt*="qr"], img[alt*="code"]').first
    if not await qrcode_img.count():
        qrcode_img = page.locator('div[class*="qr"] img, div[class*="qrcode"] img').first
    if not await qrcode_img.count():
        qrcode_img = page.locator('img[src*="qr"], img[src*="qrcode"]').first
    await qrcode_img.wait_for(state='visible', timeout=30000)
    src = await qrcode_img.get_attribute('src')
    if not src:
        raise RuntimeError('未获取到TikTok登录二维码地址')
    return src

async def _save_tiktok_qrcode(page: Page, qrcode_callback=None) -> dict:
    """Extract QR via DOM <img> src. No local PNG file is written.

    Per round-OPT-acct-qr cleanup (2026-07-10), the TikTok login flow
    is data-URL only — the platform's own QR <img> ``src`` is forwarded
    to the Web Shell via the SSE ``image_data_url`` field. CLI
    direct-path users (no callback) get a friendly warning instead of
    a local file; the web shell is the canonical QR scanning surface.
    """
    try:
        qrcode_src = await _extract_tiktok_qrcode_src(page)
    except Exception as exc:
        tiktok_logger.warning(_msg('😵', f'没定位到TikTok登录二维码元素（{str(exc)[:50]}）——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
        qrcode_src = ''
    if not qrcode_src:
        tiktok_logger.warning(_msg('😵', '没拿到TikTok登录二维码——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
    qrcode_info: dict = {'image_path': '', 'image_data_url': qrcode_src}
    await _emit_qrcode_callback(qrcode_callback, qrcode_info)
    return qrcode_info


async def _is_tiktok_login_completed(page: Page) -> bool:
    current_url = page.url
    if 'tiktok.com/login' not in current_url:
        return True
    qrcode_img = page.get_by_role('img', name='qrcode').first
    if not await qrcode_img.count():
        return True
    try:
        if not await qrcode_img.is_visible():
            return True
    except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
        return True
    return False

async def _wait_for_tiktok_login(page: Page, account_file: str, qrcode_info: dict, qrcode_callback=None, poll_interval: int=3, max_checks: int=100) -> dict:
    for _ in range(max_checks):
        if await _is_tiktok_login_completed(page):
            tiktok_logger.info(_msg('🥳', f'QR scan succeeded, redirected to: {page.url}'))
            return _build_login_result(True, 'success', 'TikTok扫码登录成功', account_file, qrcode_info, page.url)
        await asyncio.sleep(poll_interval)
    return _build_login_result(False, 'timeout', '等待TikTok扫码登录超时', account_file, qrcode_info, page.url)

async def tiktok_setup(account_file, handle=False, return_detail=False, qrcode_callback=None, headless: bool=LOCAL_CHROME_HEADLESS):
    account_file = get_absolute_path(account_file, 'tk_uploader')
    if not os.path.exists(account_file) or not await cookie_auth(account_file):
        if not handle:
            result = _build_login_result(False, 'cookie_invalid', 'cookie文件不存在或已失效', account_file)
            return result if return_detail else False
        tiktok_logger.info(_msg('🥹', 'cookie失效，准备打开浏览器扫码登录TikTok'))
        result = await get_tiktok_cookie(account_file, qrcode_callback=qrcode_callback, headless=headless)
        return result if return_detail else result['success']
    result = _build_login_result(True, 'cookie_valid', 'cookie有效', account_file)
    return result if return_detail else True

async def get_tiktok_cookie(account_file, qrcode_callback=None, headless: bool=LOCAL_CHROME_HEADLESS, poll_interval: int=3, max_checks: int=100):
    async with async_playwright() as playwright:
        browser = await playwright.firefox.launch(headless=headless, args=['--lang en-GB'])
        context = await browser.new_context()
        context = await set_init_script(context)
        result = _build_login_result(False, 'failed', 'TikTok登录失败', account_file)
        try:
            page = await context.new_page()
            await page.goto(TIKTOK_LOGIN_QRCODE_URL)
            await page.wait_for_load_state('domcontentloaded')
            await asyncio.sleep(2)
            qrcode_info = await _save_tiktok_qrcode(page, qrcode_callback=qrcode_callback)
            tiktok_logger.info(_msg('🧍', '请扫码，正在等待TikTok登录完成'))
            result = await _wait_for_tiktok_login(page, account_file, qrcode_info, qrcode_callback=qrcode_callback, poll_interval=poll_interval, max_checks=max_checks)
            if result['success']:
                await asyncio.sleep(2)
                await context.storage_state(path=account_file)
                if not await cookie_auth(account_file):
                    result = _build_login_result(False, 'cookie_invalid', 'TikTok扫码流程结束，但 cookie 校验失败', account_file, qrcode_info, page.url)
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as exc:
            result = _build_login_result(False, 'failed', str(exc), account_file, current_url=page.url if 'page' in locals() else '')
        finally:
            if not result['success']:
                tiktok_logger.error(_msg('😢', f"登录失败: {result['message']}"))
            await context.close()
            await browser.close()
        return result

class TiktokVideo(BaseVideoUploader):
    # NOTE(deviation-from-spec): tasks §5.1 写 "加 super().__init__(publish_date, account_file) 调用",
    # 但 BaseVideoUploader 当前是 stateless namespace (无 __init__)。这里走 Phase 1 DouYinBaseUploader
    # 相同 pattern: derived class 直接设置 shared attrs。给 base 加 __init__ 须同步更新全部 7 个 platform
    # class, 超 AC 范围。详见 tasks.md §5.1 deviation note。

    def __init__(self, title, file_path, tags, publish_date, account_file):
        self.title = title
        self.file_path = file_path
        self.tags = tags
        self.publish_date = publish_date
        self.account_file = account_file
        self.headless = LOCAL_CHROME_HEADLESS
        self.locator_base = None

    async def validate_upload_args(self):
        """Pre-flight validation before opening the browser (Phase 3 pattern).

        Mirrors ``DouYinVideo.validate_upload_args``:
          * title is non-empty
          * file exists + supported video extension (via ``BaseVideoUploader.validate_video_file``)
          * publish_date, if scheduled (datetime), is at least ``MIN_SCHEDULE_LEAD_TIME`` in the future
            (via ``BaseVideoUploader.validate_publish_date``; short-circuits on ``0`` for immediate publish)
        """
        if not self.title or not str(self.title).strip():
            raise ValueError("TikTok video mode requires title")
        self.file_path = str(self.validate_video_file(self.file_path))

        # ── Content fingerprint obfuscation (anti-duplicate-detection) ────────
        config = get_config("tiktok")
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
            tiktok_logger.info(_msg("🎭", "视频指纹已混淆，用于对抗平台重复检测"))

        self.publish_date = self.validate_publish_date(self.publish_date)

    async def set_schedule_time(self, page, publish_date):
        schedule_input_element = self.locator_base.get_by_label(Tk_Locator.SCHEDULE_LABEL)
        await schedule_input_element.wait_for(state='visible')
        await schedule_input_element.click()
        scheduled_picker = self.locator_base.locator(Tk_Locator.SCHEDULE_PICKER)
        await scheduled_picker.locator(Tk_Locator.SCHEDULE_INPUT_BOX).nth(1).click()
        calendar_month = await self.locator_base.locator(Tk_Locator.CALENDAR_MONTH_TITLE).inner_text()
        n_calendar_month = datetime.strptime(calendar_month, '%B').month
        schedule_month = publish_date.month
        if n_calendar_month != schedule_month:
            if n_calendar_month < schedule_month:
                arrow = self.locator_base.locator(Tk_Locator.CALENDAR_ARROW).nth(-1)
            else:
                arrow = self.locator_base.locator(Tk_Locator.CALENDAR_ARROW).nth(0)
            await arrow.click()
        valid_days_locator = self.locator_base.locator(Tk_Locator.CALENDAR_DAY_VALID)
        valid_days = await valid_days_locator.count()
        for i in range(valid_days):
            day_element = valid_days_locator.nth(i)
            text = await day_element.inner_text()
            if text.strip() == str(publish_date.day):
                await day_element.click()
                break
        await scheduled_picker.locator('div.TUXInputBox').nth(0).click()
        hour_str = publish_date.strftime('%H')
        correct_minute = int(publish_date.minute / 5)
        minute_str = f'{correct_minute:02d}'
        hour_selector = Tk_Locator.HOUR_PICKER_LEFT.format(hour=hour_str)
        minute_selector = Tk_Locator.MINUTE_PICKER_RIGHT.format(minute=minute_str)
        await self.locator_base.locator(hour_selector).click()
        await page.wait_for_timeout(1000)
        await scheduled_picker.locator('div.TUXInputBox').nth(0).click()
        await self.locator_base.locator(minute_selector).click()
        await self.locator_base.locator(Tk_Locator.BACK_TO_UPLOAD_HEADING).click()

    async def handle_upload_error(self, page):
        tiktok_logger.info('video upload error retrying.')
        select_file_button = self.locator_base.locator(Tk_Locator.FILE_SELECT_BUTTON)
        async with page.expect_file_chooser() as fc_info:
            await select_file_button.click()
        file_chooser = await fc_info.value
        await file_chooser.set_files(self.file_path)

    async def upload(self, playwright: Playwright) -> None:
        await self.validate_upload_args()
        browser = await playwright.firefox.launch(headless=self.headless)
        context = await browser.new_context(storage_state=f'{self.account_file}')
        context = await set_init_script(context)
        page = await context.new_page()
        await page.goto('https://www.tiktok.com/creator-center/upload')
        tiktok_logger.info(f'[+]Uploading-------{self.title}.mp4')
        await page.wait_for_url('https://www.tiktok.com/tiktokstudio/upload', timeout=10000)
        try:
            await page.wait_for_selector(Tk_Locator.UPLOAD_CONTAINER_WAIT, timeout=10000)
            tiktok_logger.info('Either iframe or div appeared.')
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError):
            tiktok_logger.error('Neither iframe nor div appeared within the timeout.')
        await self.choose_base_locator(page)
        upload_button = self.locator_base.locator(Tk_Locator.UPLOAD_BUTTON)
        await upload_button.wait_for(state='visible')
        async with page.expect_file_chooser() as fc_info:
            await upload_button.click()
        file_chooser = await fc_info.value
        await file_chooser.set_files(self.file_path)
        await self.add_title_tags(page)
        await self.detect_upload_status(page)
        if self.publish_date != 0:
            await self.set_schedule_time(page, self.publish_date)
        await self.click_publish(page)
        await context.storage_state(path=f'{self.account_file}')
        tiktok_logger.info('  [-] update cookie！')
        await asyncio.sleep(2)
        await context.close()
        await browser.close()

    async def add_title_tags(self, page):
        editor_locator = self.locator_base.locator(Tk_Locator.EDITOR)
        await editor_locator.click()
        await page.keyboard.press('End')
        await page.keyboard.press('Control+A')
        await page.keyboard.press('Delete')
        await page.keyboard.press('End')
        await page.wait_for_timeout(1000)
        await page.keyboard.insert_text(self.title)
        await page.wait_for_timeout(1000)
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        for index, tag in enumerate(self.tags, start=1):
            tiktok_logger.info(f'Setting the {index} tag')
            await page.keyboard.press('End')
            await page.wait_for_timeout(1000)
            await page.keyboard.insert_text('#' + tag + ' ')
            await page.keyboard.press('Space')
            await page.wait_for_timeout(1000)
            await page.keyboard.press('Backspace')
            await page.keyboard.press('End')

    async def click_publish(self, page):
        max_retries = 120
        retries = 0
        while retries < max_retries:
            try:
                publish_button = self.locator_base.locator(Tk_Locator.PUBLISH_BUTTON)
                if await publish_button.count():
                    await publish_button.click()
                success_indicator = self.locator_base.locator(Tk_Locator.SUCCESS_INDICATOR).first
                await success_indicator.wait_for(state='visible', timeout=3000)
                tiktok_logger.success('  [-] video published success')
                return
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
                success_indicator = self.locator_base.locator(Tk_Locator.SUCCESS_INDICATOR).first
                if await success_indicator.count():
                    tiktok_logger.success('  [-]video published success')
                    return
                else:
                    tiktok_logger.exception(f'  [-] Exception: {e}')
                    tiktok_logger.info('  [-] video publishing')
                    await page.screenshot(full_page=True)
                    await asyncio.sleep(0.5)
                    retries += 1
        raise TimeoutError('click_publish timed out after waiting for success flag')

    async def detect_upload_status(self, page):
        max_retries = 180
        retries = 0
        while retries < max_retries:
            try:
                if await self.locator_base.locator(Tk_Locator.PUBLISH_BUTTON_INNER).get_attribute('disabled') is None:
                    tiktok_logger.info('  [-]video uploaded.')
                    return
                else:
                    tiktok_logger.info('  [-] video uploading...')
                    await asyncio.sleep(2)
                    if await self.locator_base.locator(Tk_Locator.FILE_SELECT_BUTTON).count():
                        tiktok_logger.info('  [-] found some error while uploading now retry...')
                        await self.handle_upload_error(page)
                    retries += 1
            except (patchright.async_api.Error, OSError, asyncio.TimeoutError) as e:
                tiktok_logger.warning(f'  [-] detect_upload_status error: {e}')
                tiktok_logger.info('  [-] video uploading...')
                await asyncio.sleep(2)
                retries += 1
        raise TimeoutError('detect_upload_status timed out waiting for upload to complete')

    async def choose_base_locator(self, page):
        if await page.locator(f'iframe{Tk_Locator.tk_iframe}').count():
            self.locator_base = page.frame_locator(Tk_Locator.tk_iframe)
        else:
            self.locator_base = page.locator(Tk_Locator.default)

    async def main(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)


class TiktokNote(BaseVideoUploader):
    """TikTok Photo Post (image carousel) uploader — Phase 5 migration.

    Inherits ``BaseVideoUploader`` and applies the shared
    ``validate_upload_args`` consolidation (matches BilibiliNote /
    KSNote / DouYinNote / TencentNote / XiaoHongShuNote). The actual
    ``upload()`` body is stubbed with ``NotImplementedError`` —
    TikTok Studio's Photo Post UI flow is not yet wired through
    the patchright automation pattern. The pre-flight validator IS
    real + tested (mirrors §8.4.3's TencentNote sub-design-decision:
    validation runs BEFORE the not-yet-implemented upload body, so
    the lock-in test only exercises the real validator without
    driving a real TikTok session).

    NOTE(deviation-from-spec): same as TiktokVideo — derived class
    directly sets shared attrs (no ``super().__init__()``).
    ``BaseVideoUploader`` is a stateless namespace for classmethods.
    Details: tasks.md §5.1 deviation note.
    """

    # Per-class cap (matches BilibiliNote.MAX_IMAGES shape). TikTok Studio's
    # Photo Post carousel is 35 images as of 2024 (storage-side limit; the
    # upload UI's hot path is 9 with the rest accessed via a "see more"
    # affordance). Per BilibiliNote's pattern, the cap is enforced in
    # ``validate_upload_args`` BEFORE the per-image loop so we fail fast on
    # shape — not on the 36th individual image validation.
    MAX_IMAGES = 35

    def __init__(self, *, title, note, image_files, tags, publish_date,
                 account_file, headless=LOCAL_CHROME_HEADLESS):
        self.title = title
        self.note = note
        # Store as-passed (list[str] | list[Path]) — ``validate_image_file``
        # does the ``Path(...).expanduser().resolve()`` normalisation
        # internally, so per-item conversion here would be redundant. This
        # matches BilibiliNote's shape (which also stores as-passed).
        self.image_files = list(image_files)
        self.tags = tags
        self.publish_date = publish_date
        self.account_file = account_file
        self.headless = headless

    async def validate_upload_args(self):
        """Pre-flight validation before opening the browser (Phase 4 §8.4 family pattern).

        The order mirrors ``BilibiliNote`` (the closest analog per the
        §8.4.5 family audit):
          * title non-empty (matches base pattern across all 11 prior
            classes + the new YouTubeVideo)
          * note non-empty (TikTok Photo Post caption requirement;
            mirrors ``BilibiliNote`` shape)
          * image_files non-empty + within ``MAX_IMAGES`` cap
          * each image validates via the consolidated
            ``BaseVideoUploader.validate_image_file`` (cross-platform
            ``SUPPORTED_IMAGE_EXTENSIONS`` set; resolves to ``Path``,
            normalised back to ``str`` for symmetry with the rest of
            the family)
          * publish_date unconditional via
            ``BaseVideoUploader.validate_publish_date``; short-circuits
            on ``0``/``None`` for immediate publish.
        """
        if not self.title or not str(self.title).strip():
            raise ValueError("TikTok note mode requires title")
        if not self.note or not str(self.note).strip():
            raise ValueError("TikTok note mode requires note text")
        if not self.image_files:
            raise ValueError("TikTok note mode requires at least one image")
        if len(self.image_files) > self.MAX_IMAGES:
            raise ValueError(
                f"TikTok note mode supports at most {self.MAX_IMAGES} images "
                f"(got {len(self.image_files)})"
            )
        self.image_files = [str(self.validate_image_file(p)) for p in self.image_files]

        # ── Image fingerprint obfuscation (anti-duplicate-detection) ──────────
        config = get_config("tiktok")
        obfuscated_images = []
        for img_path in self.image_files:
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
            self.image_files = obfuscated_images
            tiktok_logger.info(_msg("🎭", f"{len(obfuscated_images)} 张图片指纹已混淆"))

        self.publish_date = self.validate_publish_date(self.publish_date)

    async def upload(self, playwright: Playwright) -> None:
        await self.validate_upload_args()
        raise NotImplementedError(
            "TikTok Photo Post upload is not yet wired through patchright "
            "automation (Phase 5 marker). The pre-flight validate_upload_args "
            "IS real + tested; the body stub prevents the test from accidentally "
            "driving a real TikTok Studio session. Swap in the browser "
            "automation when TikTok Studio's Photo Post UI flow is wired."
        )

    async def main(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)
