import asyncio
import json
import os
from pathlib import Path

import patchright
import requests
from patchright.async_api import Page, Playwright, async_playwright

from conf import DEBUG_MODE, LOCAL_CHROME_HEADLESS
from uploader.base_video import BaseVideoUploader
from uploader.bilibili_uploader.note import _convert_biliup_cookies_to_storage_state
from uploader.common import (
    _all_login_markers_hidden,
    _build_login_result,
    _check_login_markers,
    _emit_qrcode_callback,
    _msg,
)
from uploader.bilibili_uploader.locators import BilibiliLocators as L
from utils.anti_detect import obfuscate_image, obfuscate_video
from utils.anti_detect.config import get_config
from utils.base_social_media import set_init_script
from utils.log import bilibili_logger

# ── Bilibili API endpoints for cookie verification ────────────────────────
_BILIBILI_NAV_API = 'https://api.bilibili.com/x/web-interface/nav'
_BILIBILI_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async def _bilibili_api_check(account_file: str) -> bool:
    """Verify Bilibili cookies by calling the official nav API.

    Makes an authenticated request to ``x/web-interface/nav`` and checks
    ``data.isLogin``. This is faster and more reliable than browser-based
    DOM text detection — it directly asks Bilibili's backend whether the
    session is still valid.

    Returns ``True`` when the API confirms the user is logged in.
    Returns ``False`` on any network error, JSON parse failure, or if
    the API explicitly reports not-logged-in.
    """
    if not os.path.exists(account_file):
        return False
    try:
        raw = json.loads(Path(account_file).read_text(encoding='utf-8'))
        cookies = raw if isinstance(raw, list) else raw.get('cookies', [])
        if not cookies:
            return False
    except (OSError, json.JSONDecodeError):
        return False

    session = requests.Session()
    for c in cookies:
        session.cookies.set(
            c.get('name', ''),
            c.get('value', ''),
            domain=c.get('domain', '.bilibili.com'),
            path=c.get('path', '/'),
        )

    try:
        resp = session.get(
            _BILIBILI_NAV_API,
            timeout=10,
            headers={'User-Agent': _BILIBILI_USER_AGENT, 'Referer': 'https://www.bilibili.com/'},
        )
        data = resp.json()
        is_login = data.get('data', {}).get('isLogin', False)
        if is_login:
            bilibili_logger.debug(_msg('✅', f'Bilibili API 校验通过 (uid={data["data"].get("mid", "?")})'))
        else:
            bilibili_logger.debug(_msg('❌', f'Bilibili API 返回未登录状态 (code={data.get("code")})'))
        return is_login is True
    except (requests.RequestException, json.JSONDecodeError, KeyError) as exc:
        bilibili_logger.debug(_msg('😵', f'Bilibili API 校验请求失败: {exc}'))
        return False
BILIBILI_LOGIN_URL = L.LOGIN_URL
BILIBILI_CREATOR_HOME = L.CREATOR_HOME

async def bilibili_cookie_auth(account_file: str) -> bool:
    if not os.path.exists(account_file):
        return False
    try:
        raw = json.loads(Path(account_file).read_text(encoding='utf-8'))
        cookies = raw if isinstance(raw, list) else raw.get('cookies', [])
        if not cookies:
            return False
    except (patchright.async_api.Error, OSError, asyncio.TimeoutError, RuntimeError):
        return False
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            storage_state = _convert_biliup_cookies_to_storage_state(account_file)
            context = await browser.new_context(storage_state=storage_state)
            context = await set_init_script(context)
            page = await context.new_page()
            await page.goto(BILIBILI_CREATOR_HOME)
            await page.wait_for_load_state('domcontentloaded')
            await asyncio.sleep(2)
            if await _check_login_markers(page, L.LOGIN_MARKER_TEXTS):
                return False
            return True
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError, RuntimeError):
            return False
        finally:
            await browser.close()

async def _extract_bilibili_qrcode_src(page: Page) -> str:
    qrcode_img = page.locator(L.QR_IMG_PRIMARY).first
    if not await qrcode_img.count():
        qrcode_img = page.locator(L.QR_IMG_ALT).first
    if not await qrcode_img.count():
        qrcode_img = page.locator(L.QR_IMG_FALLBACK_1).first
    if not await qrcode_img.count():
        qrcode_img = page.locator(L.QR_IMG_FILTER).filter(has=page.locator(L.QR_IMG_FILTER_HAS)).first
    if not await qrcode_img.count():
        qrcode_img = page.locator(L.QR_IMG_FALLBACK_2).first
    await qrcode_img.wait_for(state='visible', timeout=30000)
    src = await qrcode_img.get_attribute('src')
    if not src:
        raise RuntimeError('未获取到B站登录二维码地址')
    return src

async def _save_bilibili_qrcode(page: Page, qrcode_callback=None) -> dict:
    """Extract QR via DOM <img> src. No local PNG file is written.

    Per round-OPT-acct-qr cleanup (2026-07-10), the B-station login flow
    is data-URL only — the platform's own QR <img> ``src`` is forwarded
    to the Web Shell via the SSE ``image_data_url`` field, and the
    frontend renders it inline. CLI direct-path users (no callback) get
    a friendly warning instead of a local file; the web shell is the
    canonical QR scanning surface.
    """
    try:
        qrcode_src = await _extract_bilibili_qrcode_src(page)
    except Exception as exc:
        bilibili_logger.warning(_msg('😵', f'没定位到B站登录二维码元素（{str(exc)[:50]}）——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
        qrcode_src = ''
    if not qrcode_src:
        bilibili_logger.warning(_msg('😵', '没拿到B站登录二维码——请直接在弹出的浏览器里扫码，小人继续等登录跳转'))
    qrcode_info: dict = {'image_path': '', 'image_data_url': qrcode_src}
    await _emit_qrcode_callback(qrcode_callback, qrcode_info)
    return qrcode_info


async def _is_bilibili_login_completed(page: Page) -> bool:
    current_url = page.url
    if 'passport.bilibili.com/login' in current_url:
        return False
    return await _all_login_markers_hidden(page, L.LOGIN_MARKER_TEXTS)

async def _wait_for_bilibili_login(page: Page, account_file: str, qrcode_info: dict, qrcode_callback=None, poll_interval: int=3, max_checks: int=100) -> dict:
    for _ in range(max_checks):
        if await _is_bilibili_login_completed(page):
            bilibili_logger.info(_msg('🥳', f'扫码成功，已经跳转到登录后页面: {page.url}'))
            return _build_login_result(True, 'success', 'B站扫码登录成功', account_file, qrcode_info, page.url)
        expired_box = page.get_by_text(L.QR_EXPIRED_TEXT, exact=True).locator('xpath=..').first
        if not await expired_box.count():
            expired_box = page.get_by_text(L.QR_EXPIRED_ALT_TEXT, exact=True).locator('xpath=..').first
        if await expired_box.count() and await expired_box.is_visible():
            bilibili_logger.warning(_msg('😵', '二维码失效了，小人马上去刷新'))
            await expired_box.click()
            await asyncio.sleep(1)
            qrcode_info = await _save_bilibili_qrcode(page, qrcode_callback=qrcode_callback)
        await asyncio.sleep(poll_interval)
    return _build_login_result(False, 'timeout', '等待B站扫码登录超时', account_file, qrcode_info, page.url)

async def bilibili_cookie_gen(account_file: str, qrcode_callback=None, poll_interval: int=3, max_checks: int=100, headless: bool=LOCAL_CHROME_HEADLESS):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=headless)
        context = await browser.new_context()
        context = await set_init_script(context)
        result = _build_login_result(False, 'failed', 'B站登录失败', account_file)
        try:
            page = await context.new_page()
            await page.goto(BILIBILI_LOGIN_URL)
            await page.wait_for_load_state('domcontentloaded')
            await asyncio.sleep(2)
            qrcode_info = await _save_bilibili_qrcode(page, qrcode_callback=qrcode_callback)
            bilibili_logger.info(_msg('🧍', '请扫码，小人正在耐心等待登录完成'))
            result = await _wait_for_bilibili_login(page, account_file, qrcode_info, qrcode_callback=qrcode_callback, poll_interval=poll_interval, max_checks=max_checks)
            if result['success']:
                await asyncio.sleep(2)
                # 在同一个 context 中导航到创作者中心，避免 cookies 序列化/反序列化丢失字段
                await page.goto(BILIBILI_CREATOR_HOME)
                await page.wait_for_load_state('domcontentloaded')
                await asyncio.sleep(2)
                if await _check_login_markers(page, L.LOGIN_MARKER_TEXTS):
                    result = _build_login_result(False, 'cookie_invalid', 'B站扫码流程结束，但 cookie 校验失败', account_file, qrcode_info, page.url)
                else:
                    storage_state = await context.storage_state()
                    _save_bilibili_cookies_from_storage(storage_state, account_file)
        except (patchright.async_api.Error, OSError, asyncio.TimeoutError, RuntimeError) as exc:
            result = _build_login_result(False, 'failed', str(exc), account_file, current_url=page.url if 'page' in locals() else '')
        finally:
            if not result['success']:
                bilibili_logger.error(_msg('😢', f"登录失败: {result['message']}"))
            await context.close()
            await browser.close()
        return result

def _save_bilibili_cookies_from_storage(storage_state: dict, account_file: str) -> None:
    cookies = storage_state.get('cookies', [])
    bilibili_cookies = []
    for c in cookies:
        bilibili_cookies.append({'name': c.get('name', ''), 'value': c.get('value', ''), 'domain': c.get('domain', '.bilibili.com'), 'path': c.get('path', '/'), 'expires': c.get('expires', -1)})
    account_path = Path(account_file)
    account_path.parent.mkdir(parents=True, exist_ok=True)
    account_path.write_text(json.dumps(bilibili_cookies, ensure_ascii=False, indent=2), encoding='utf-8')
    bilibili_logger.info(_msg('💾', f'Cookie 已保存到: {account_file}'))

async def bilibili_setup(account_file: str, handle=False, return_detail=False, qrcode_callback=None, headless: bool=LOCAL_CHROME_HEADLESS):
    if not os.path.exists(account_file) or not await bilibili_cookie_auth(account_file):
        if not handle:
            result = _build_login_result(False, 'cookie_invalid', 'cookie文件不存在或已失效', account_file)
            return result if return_detail else False
        bilibili_logger.info(_msg('🥹', 'cookie 失效了，准备打开浏览器重新登录'))
        result = await bilibili_cookie_gen(account_file, qrcode_callback=qrcode_callback, headless=headless)
        return result if return_detail else result['success']
    result = _build_login_result(True, 'cookie_valid', 'cookie有效', account_file)
    return result if return_detail else True


class BilibiliVideo(BaseVideoUploader):
    """B站视频上传器（Phase 4 §8.5 family pattern）。

    提供视频混淆和封面混淆功能。
    """

    def __init__(self, title, file_path, tags, publish_date, account_file,
                 desc: str | None = None, thumbnail_path: str | None = None,
                 publish_strategy: str = "immediate"):
        self.title = title
        self.file_path = file_path
        self.tags = tags or []
        self.publish_date = publish_date
        self.account_file = account_file
        self.desc = desc or ''
        self.thumbnail_path = thumbnail_path
        self.publish_strategy = publish_strategy
        self.debug = DEBUG_MODE
        self.headless = LOCAL_CHROME_HEADLESS

    async def validate_upload_args(self):
        """Pre-flight validation before opening the browser."""
        if not self.title or not str(self.title).strip():
            raise ValueError("Bilibili 视频上传时，title 是必须的")
        self.file_path = str(self.validate_video_file(self.file_path))

        # ── Content fingerprint obfuscation (anti-duplicate-detection) ────────
        config = get_config("bilibili")
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
            bilibili_logger.info(_msg("🎭", "视频指纹已混淆，用于对抗平台重复检测"))

        if self.thumbnail_path:
            self.thumbnail_path = str(self.validate_image_file(self.thumbnail_path))
            # Obfuscate thumbnail if provided
            thumb_config = get_config("bilibili")
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
                bilibili_logger.info(_msg("🎭", "封面指纹已混淆"))

        self.publish_date = self.validate_publish_date(self.publish_date)

    async def upload(self, playwright: Playwright) -> None:
        """B站视频上传流程（待实现具体浏览器自动化）。"""
        raise NotImplementedError(
            "BilibiliVideo 的浏览器自动化流程尚未实现。"
            "validate_upload_args 已包含混淆逻辑；upload() 需补充具体 DOM 操作。"
        )

    async def main(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)
