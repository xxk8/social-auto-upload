import asyncio
import inspect
import os
import random
from datetime import datetime
from pathlib import Path

from patchright.async_api import Page, Playwright, async_playwright

from conf import DEBUG_MODE, LOCAL_CHROME_HEADLESS, LOCAL_CHROME_PATH
from uploader.base_video import BaseVideoUploader
from utils.anti_detect import (
    apply_anti_detect,
    build_browser_context_options,
    build_browser_launch_kwargs,
    human_type,
    obfuscate_video,
)
from utils.log import douyin_logger
from utils.login_qrcode import build_login_qrcode_path, remove_qrcode_file, save_data_url_image
from utils.patchright_race import is_patchright_race

DOUYIN_PUBLISH_STRATEGY_IMMEDIATE = "immediate"
DOUYIN_PUBLISH_STRATEGY_SCHEDULED = "scheduled"


def _msg(emoji: str, text: str) -> str:
    return f"{emoji} {text}"


async def _emit_qrcode_callback(qrcode_callback, payload: dict):
    if not qrcode_callback:
        return

    callback_result = qrcode_callback(payload)
    if inspect.isawaitable(callback_result):
        await callback_result


def _build_login_result(success: bool, status: str, message: str, account_file: str, qrcode: dict | None = None, current_url: str = "") -> dict:
    # status 字面以 module-local `LOGIN_RESULT_STATUSES` 为 source-of-truth。
    # 如果你不确定 valid 取值是什么, 看 `uploader.douyin_uploader._status_schema`
    # 或跑 `python -c "from uploader.douyin_uploader._status_schema import LOGIN_RESULT_STATUSES; print(LOGIN_RESULT_STATUSES)"`。
    # 未来 TBF-019 增量迁移到 enum; 本 PR 不 break current call-site signature。
    return {
        "success": success,
        "status": status,
        "message": message,
        "account_file": str(account_file),
        "qrcode": qrcode,
        "current_url": current_url,
    }


class PatchrightRaceError(Exception):
    """patchright race (context/browser closed mid-operation) captured at a goto / wait_for_url site.

    Three pieces of context for the caller:
      * flow_label: 语义化后缀, 来自 caller(cookie校验 / 视频流程 / 图文流程 / 落地页跳转 / 上传页跳转(…))
        一并写入 🩻 警告。grep 友好, 后续 dashboard 可以按 label 分桶统计 race 频率。
      * original_msg: page.goto/wait_for_url 抛出的 str(e), 保留 [:60] 用于 match 定位。
      * safe_url: 在 race 触发前缓存的 page.url(空字符串 = capture 阶段也已坏)。让 caller
        在 except 块内能直接读 self.safe_url, 避免 race-after-race 的二次 exception。
    """

    def __init__(self, original_msg: str, flow_label: str, safe_url: str):
        self.original_msg = original_msg
        self.flow_label = flow_label
        self.safe_url = safe_url
        super().__init__(f"PatchrightRace[{flow_label}]: {original_msg}")


async def _goto_race_safe(page: Page, url: str, *, flow_label: str, wait_until: str = "domcontentloaded", timeout: int = 60000) -> None:
    """统一包裹 page.goto: race 时打 🩻 与注入 flow_label 后缀 + 抛 PatchrightRaceError。

    not-race 的 exception(goto 超时 / DNS 失败 / TLS 错误)原样向上抛, 由 caller
    或上层 try/except 决定如何处理(race 之外不该被吞)。
    """
    try:
        # race-safe capture: context 已关闭时 page.url 会再次 throw, 用空串兜底
        safe_url = page.url
    except Exception:
        safe_url = ""

    try:
        await page.goto(url, wait_until=wait_until, timeout=timeout)
    except Exception as e:
        msg = str(e)
        if is_patchright_race(e):
            douyin_logger.warning(_msg("🩻", f"patchright race：{msg[:60]}；{flow_label} 小人先去有头浏览器重新登录"))
            raise PatchrightRaceError(msg, flow_label, safe_url) from e
        raise


async def _wait_for_url_race_safe(page: Page, url_pattern: str, *, flow_label: str, timeout: int = 5000) -> None:
    """统一包裹 page.wait_for_url: race 时同样打 🩻 + 抛 PatchrightRaceError。

    wait_for_url 在 context/browser 已经 race 关闭的状态下不能抛 clean 的
    "context closed" 给 caller, 会先抛 timeout(因为 url 永远 match 不到)。
    我们仍然按 race-substring 检测 + throw, 这样 5 处 wrap 共享同一套
    PatchrightRaceError 处理路径。
    """
    try:
        safe_url = page.url
    except Exception:
        safe_url = ""

    try:
        await page.wait_for_url(url_pattern, timeout=timeout)
    except Exception as e:
        msg = str(e)
        if is_patchright_race(e):
            douyin_logger.warning(_msg("🩻", f"patchright race：{msg[:60]}；{flow_label} wait_for_url race 小人先去有头浏览器重新登录"))
            raise PatchrightRaceError(msg, flow_label, safe_url) from e
        raise


async def cookie_auth(account_file):
    async with async_playwright() as playwright:
        # 抖音无头会撞反爬墙→content/upload 跳登录→误判 cookie 失效（间歇性）。校验必须有头。
        browser = await playwright.chromium.launch(
            **build_browser_launch_kwargs(headless=False),
        )
        try:
            context = await browser.new_context(
                **build_browser_context_options("douyin", account_file=account_file, headless=False),
            )
            context = await apply_anti_detect(context)
            page = await context.new_page()
            try:
                await _goto_race_safe(
                    page,
                    "https://creator.douyin.com/creator-micro/content/upload",
                    flow_label="cookie校验",
                    timeout=90000,
                )
                await _wait_for_url_race_safe(
                    page,
                    "https://creator.douyin.com/creator-micro/content/upload",
                    flow_label="cookie校验",
                    timeout=5000,
                )
            except PatchrightRaceError:
                return False
            except Exception as exc:
                # nonrace 异常(超时 / 网络 / TLS 抖动)保留原 over-broad tolerance:
                # cookie_auth 的 caller contract 是 bool False = cookie_invalid,
                # 不是要不要向上传的错误 subtype。race 还会在上方 ⩕ 警告里留痕,
                # 其他异常 → 一律 cookie_invalid。
                douyin_logger.warning(_msg("🩻", f"cookie校验非 race 异常（{str(exc)[:50]}）；视为 cookie 失效，小人重新扫码"))
                return False

            if await page.get_by_text("手机号登录").count() or await page.get_by_text("扫码登录").count():
                return False

            return True
        finally:
            await browser.close()


async def douyin_setup(account_file, handle=False, return_detail=False, qrcode_callback=None, headless: bool = LOCAL_CHROME_HEADLESS):
    if not os.path.exists(account_file) or not await cookie_auth(account_file):
        if not handle:
            result = _build_login_result(False, "cookie_invalid", "cookie文件不存在或已失效", account_file)
            return result if return_detail else False
        douyin_logger.info(_msg("🥹", "cookie 失效了，准备打开浏览器重新登录"))
        result = await douyin_cookie_gen(account_file, qrcode_callback=qrcode_callback, headless=headless)
        return result if return_detail else result["success"]

    result = _build_login_result(True, "cookie_valid", "cookie有效", account_file)
    return result if return_detail else True


async def _cdp_capture_screenshot(page: Page, clip: dict | None = None, capture_beyond_viewport: bool = False) -> str:
    """Capture at CDP level (Page.captureScreenshot), returning a data: URL.

    DEPRECATED-FOR-QR-EXTRACTION (2026-06-29): no longer called by
    `_extract_douyin_qrcode_src`. The Strategy 3 CDP-screenshot-fallback was
    removed because modal bbox often missed the rendered QR (browser zoom +
    modal-shift animations + async-render timing). Preserved as a future-use
    building block for CDP capture (debug dumps, content-upload page diff
    snapshots). DOM extraction + network interception are preferred for new
    QR-scrapes.

    Returns ``"data:image/png;base64,<...>"`` ready for inline ``<img>`` rendering
    in the Web Shell or for PNG-on-disk writes. CDP's ``Page.captureScreenshot``
    already returns the image as a base64 string in ``result["data"]`` — no
    second ``b64encode`` needed — saving a CPU pass on a hot path that fires on
    every login flow.

    We open a fresh CDP session per call (~50-200 ms overhead) because the
    login flow captures at most twice (initial + QR refresh on expiry);
    carrying a long-lived session across plugin/script iterations adds
    detaching bookkeeping that isn't worth the marginal speedup.

    Args:
        page: patchright async ``Page``.
        clip: Optional CDP clip dict ``{x, y, width, height, scale}``.
            When omitted, takes the full viewport.
        capture_beyond_viewport: When ``True`` + ``clip`` is set, CDP will
            paint content outside the viewport to satisfy the clip region.
            Use this when the captured region (e.g. a centered login modal)
            may extend below the document fold on smaller viewports. Default
            ``False`` keeps viewport-bound semantics for the implicit
            full-viewport fallback path.
    """
    cdp = await page.context.new_cdp_session(page)
    try:
        params: dict = {"format": "png", "captureBeyondViewport": capture_beyond_viewport}
        if clip is not None:
            params["clip"] = {
                "x": clip["x"], "y": clip["y"],
                "width": clip["width"], "height": clip["height"],
                "scale": clip.get("scale", 1),
            }
        result = await cdp.send("Page.captureScreenshot", params)
        return "data:image/png;base64," + result["data"]
    finally:
        await cdp.detach()


async def _extract_douyin_qrcode_src(page: Page) -> str:
    # Strategy 1: poll for async data:image <img> inside login modal.
    # Douyin 2026 落地页→模态框的登录流程里，二维码是异步从后端
    # 拉取后以 base64 data:image 渲染到 <img> 上的，不是 canvas。
    # 轮询 10s（1s 步进），匹配 100-400px 方块 shape 的 data:image img。
    # 限定在模态框容器内搜索，避免落地页其他 data:image 元素误伤。
    for _ in range(10):
        try:
            modal_imgs = page.locator(
                ".login-card-double-Gtywl8 img, .douyin-login-container-sl0M7z img"
            )
            for i in range(await modal_imgs.count()):
                try:
                    img = modal_imgs.nth(i)
                    src = await img.get_attribute("src") or ""
                    if not src.startswith("data:image"):
                        continue
                    bbox = await img.bounding_box()
                    if bbox and 100 <= bbox.get("width", 0) <= 400 and 100 <= bbox.get("height", 0) <= 400:
                        return src
                except Exception:
                    continue
        except Exception:
            pass
        await asyncio.sleep(1)

    # Strategy 3 removed: CDP-screenshot-fallback was unreliable for QR extraction.
    # Modal bbox often missed the rendered QR because of async-render timing +
    # browser zoom + modal-shift animations in Douyin 2026 (user feedback
    # 2026-06-29: screen capture is not accurate). The QR capture hierarchy is
    # now Strategy 0 (network interception of get_qrcode) and Strategy 1 (DOM
    # polling for data:image img). The preserved _cdp_capture_screenshot helper
    # below is a future-use building block; nothing currently calls it.
    return ""


async def _save_douyin_qrcode(page: Page, account_file: str, previous_qrcode_path: Path | None = None, qrcode_callback=None) -> dict:
    """Extract QR via Strategy 0/1/2/3 and emit SSE/direct-path payload.

    Disk-write policy:
      * ``qrcode_callback`` set (SSE flow used by the Web Shell) → bytes
        flow through ``image_data_url`` only — **no PNG written to cookies/**.
        Web Shell consumes the ``data:image/png;base64,...`` value via inline
        ``<img src=...>``, so on-disk persistence adds cleanup burden and
        stale-file risk for zero UX gain.
      * No callback (CLI direct-path user) → save PNG to cookies/ so the
        user can open it with a file viewer and scan with the Douyin app.

    We deliberately do NOT run ``decode_qrcode_from_path`` /
    ``print_terminal_qrcode`` anymore: zxing-based QR-content decode was
    unreliable for cropped screenshots (see tests/test_login_qrcode.py for
    the zxing-then-pyzbar fallback chain we'd otherwise need), and ASCII
    render in the terminal is replaced by inline ``<img>`` rendering on the
    Web Shell side. CLI direct-path users get a clear "open the PNG" hint
    instead of an ASCII rewrite attempt — this is the
    "zxing-ascii-render-broke path" the user asked us to sidestep.
    """
    # 提取二维码 src 仅为了保存/终端显示；定位不到时不致命——有头浏览器里二维码可见，直接扫码即可
    try:
        qrcode_src = await _extract_douyin_qrcode_src(page)
    except Exception as exc:
        douyin_logger.warning(_msg("😵", f"没定位到二维码元素（{str(exc)[:50]}）——请直接在弹出的浏览器里扫码，小人继续等登录跳转"))
        return {"image_path": "", "image_data_url": ""}

    qrcode_path: Path | None = None
    if qrcode_callback is None:
        if qrcode_src:
            # CLI direct-path: write PNG so the user can scan via file viewer.
            qrcode_path = save_data_url_image(qrcode_src, build_login_qrcode_path(account_file))
            douyin_logger.info(_msg("🖼️", f"二维码已存到本地：{qrcode_path}"))
            douyin_logger.info(_msg("📲", f"请用抖音APP扫码，或打开：file://{qrcode_path}"))
        else:
            # Strategy 0 + Strategy 1 都失败，_extract_douyin_qrcode_src 返回 ""；
            # 之前的 EDIT 1 (Strategy 3 移除) 后这是常见落地形态。
            # 不走 save_data_url_image (会 ValueError)，改走 operator-friendly warning。
            douyin_logger.warning(_msg("😵", "没定位到二维码元素——请直接在弹出的浏览器里扫码，小人继续等登录跳转"))

    if previous_qrcode_path and previous_qrcode_path != qrcode_path:
        if remove_qrcode_file(previous_qrcode_path):
            douyin_logger.info(_msg("🧹", f"临时二维码文件已清理: {previous_qrcode_path}"))

    qrcode_info: dict = {
        "image_path": str(qrcode_path) if qrcode_path else "",
        "image_data_url": qrcode_src,
    }
    await _emit_qrcode_callback(qrcode_callback, qrcode_info)
    return qrcode_info


async def _is_douyin_login_completed(page: Page) -> bool:
    # 登录后会跳到 creator-micro 下任意页（home/content 等）；登录页是 creator.douyin.com/ 根路径
    if "creator.douyin.com/creator-micro" not in page.url:
        return False

    login_markers = [
        page.get_by_text("扫码登录", exact=True).first,
        page.get_by_text("手机号登录", exact=True).first,
        page.get_by_text("二维码失效", exact=True).first,
        page.get_by_role("img", name="二维码").first,
    ]

    for marker in login_markers:
        if not await marker.count():
            continue
        try:
            if await marker.is_visible():
                return False
        except Exception:
            continue

    return True


async def _wait_for_douyin_login(page: Page, account_file: str, qrcode_info: dict, qrcode_callback=None, poll_interval: int = 3, max_checks: int = 100, max_soft_failures: int = 5) -> dict:
    qrcode_path = Path(qrcode_info["image_path"]) if qrcode_info.get("image_path") else None
    # 软失败 counter: 防止 network blip 连续触发 nonrace exception 走 continue
    # 耗光 max_checks*poll_interval 全量预算(上百 5min)后才超时。
    # 连续 max_soft_failures 次软失败升级为 hard fail, 让 web-runner 走快速
    # re-login 路径而不再 5min 后 receiver timeout。
    polling_soft_failures = 0
    for _ in range(max_checks):
        # race-safe: 轮询 marker.count / is_visible / page.url 时 context 已关闭
        # 都可能 throw；走原路径会 propagate 到 outer except 并打裸 😢。
        try:
            is_completed = await _is_douyin_login_completed(page)
        except Exception as e:
            msg = str(e)
            if is_patchright_race(e):
                douyin_logger.warning(_msg("🩻", f"patchright race：{msg[:60]}；扫码轮询小人先去有头浏览器重新登录"))
                return _build_login_result(
                    False,
                    "patchright_race",
                    "扫码轮询 race; please re-login via sau douyin login",
                    account_file,
                    qrcode_info,
                    "",
                )
            # nonrace 异常(网络抖动 / marker 渲染超时)按原 marker-level 容错什继续轮询:
            # 单次软失败允许, 接下来 iter sleep poll_interval 后重新。counter
            # 连续递增, 达到 max_soft_failures 后升级为 hard fail。
            polling_soft_failures += 1
            if polling_soft_failures >= max_soft_failures:
                douyin_logger.warning(
                    _msg("🐢", f"扫码轮询连续 {polling_soft_failures} 次软失败，升级为 hard fail; 请重新登录")
                )
                return _build_login_result(
                    False,
                    "polling_unstable",
                    f"扫码轮询连续 {polling_soft_failures} 次软失败，升级为 hard fail;请重新登录",
                    account_file,
                    qrcode_info,
                    "",
                )
            douyin_logger.debug(
                _msg("🐢", f"扫码轮询非 race 抖动({polling_soft_failures}/{max_soft_failures})（{msg[:40]}）；小人继续等")
            )
            # NOTE (2026-06-29 user-accepted risk): 去除 inside-except sleep 后,
            # `continue` 跳到 for-loop 顶端 next iter 不会有底 sleep 间隔 (Python)
            # `continue` 不会 fall through 到 bottom sleep). 这意味着 except 路径
            # 重试间隔 = 0, 出现 persistent transient blip 会形成 ~CPU-spin tight
            # loop, marker.count()/is_visible() 被 hammer thousands/s。
            #
            # operator-traceable 兜底是 polling_soft_failures >= max_soft_failures
            # (=5) 升级为 hard fail (🐢→ polling_unstable result), 调用方走快速
            # re-login 路径, 不是 5×0ms=0ms 后 hot-spin 黑洞。
            #
            # 双层 mental model 决定: user choose raw-minimal-state path
            # (reviewer LOW-1 cosmetic polish), 不是 try/finally 包装。变更点
            # 不在 structural correctness, 在 operator 监控 visibility preference。
            continue
        # 一次 exception-free 轮询成功(如 is_completed=False 正常), 重置 counter
        polling_soft_failures = 0
        if is_completed:
            douyin_logger.info(_msg("🥳", f"扫码成功，已经跳转到登录后页面: {page.url}"))
            return _build_login_result(True, "success", "抖音扫码登录成功", account_file, qrcode_info, page.url)

        expired_box = page.get_by_text("二维码失效", exact=True).locator("..").first
        if await expired_box.count() and await expired_box.is_visible():
            douyin_logger.warning(_msg("😵", "二维码失效了，小人马上去刷新"))
            await expired_box.click()
            await asyncio.sleep(1)
            qrcode_info = await _save_douyin_qrcode(page, account_file, qrcode_path, qrcode_callback=qrcode_callback)
            qrcode_path = Path(qrcode_info["image_path"]) if qrcode_info.get("image_path") else None

        await asyncio.sleep(poll_interval)

    return _build_login_result(False, "timeout", "等待抖音扫码登录超时", account_file, qrcode_info, page.url)


async def douyin_cookie_gen(
    account_file,
    qrcode_callback=None,
    poll_interval: int = 3,
    max_checks: int = 100,
    headless: bool = LOCAL_CHROME_HEADLESS,
):
    # Douyin 反爬在 headless 下会拦截登录页 → 二维码元素永远等不到。
    # cookie_auth 已经强制有头；登录流程也必须保持一致。
    if headless:
        douyin_logger.warning(
            _msg("🎭", "Douyin 扫码登录不支持 headless，强制切换到有头浏览器")
        )
        headless = False
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            **build_browser_launch_kwargs(headless=headless),
        )
        context = await browser.new_context(
            **build_browser_context_options("douyin", headless=headless),
        )
        context = await apply_anti_detect(context)
        qrcode_path = None
        result = _build_login_result(False, "failed", "抖音登录失败", account_file)
        # Strategy 0: network interception — CDP 层面 route 拦截 Douyin get_qrcode API。
        # page.on("response") 事件回调在 patchright async API 下对
        # 某些请求类型可能不触发；page.route() 在 CDP 层面工作，
        # handler 是 async 可以正确 await response.json()。
        captured_qrcode_b64: list[str] = []

        async def _handle_get_qrcode_route(route):
            douyin_logger.info(_msg("📡", f"路由拦截到 get_qrcode 请求: {route.request.url[:120]}..."))
            response = await route.fetch()
            try:
                body = await response.json()
                qr = body.get("data", {}).get("qrcode", "")
                if qr:
                    captured_qrcode_b64.append(qr)
                    douyin_logger.info(_msg("📡", "路由拦截到 Douyin get_qrcode 响应，已捕获二维码"))
            except Exception as exc:
                douyin_logger.warning(_msg("📡", f"路由拦截解析出错: {exc}"))
            await route.fulfill(response=response)

        try:
            page = await context.new_page()
            await page.route("**/passport/web/get_qrcode*", _handle_get_qrcode_route)
            # domcontentloaded not load: Douyin page has hundreds of
            # tracking / ad scripts; "load" event typically >30 s on
            # patchright first-run, which burned our default page.goto
            # timeout.
            try:
                await _goto_race_safe(
                    page,
                    "https://creator.douyin.com/",
                    flow_label="落地页跳转",
                    timeout=60000,
                )
            except PatchrightRaceError as e:
                return _build_login_result(
                    False,
                    "patchright_race",
                    "落地页跳转 race; please re-login via sau douyin login",
                    account_file,
                    current_url=e.safe_url,
                )
            # 显式点「创作者登录」进登录页 — Douyin 2026 的 creator.douyin.com/
            # 默认展示的是落地页（产品介绍），不再是直出登录 form。domcontentloaded
            # 只代表 HTML 解析完，JS 渲染的按钮还要 3-5s 才出现——先等页面就绪。
            # force=True 绕过 Semi modal 遮罩对 pointer-events 的拦截。
            await asyncio.sleep(5)
            landing_page_clicked = False
            try:
                creator_login_btn = page.locator("text=创作者登录").first
                if await creator_login_btn.count():
                    landing_page_clicked = True
                    douyin_logger.info(_msg("🚪", "侦测到落地页，小人点击「创作者登录」进入登录页"))
                    await creator_login_btn.click(force=True, timeout=5000)
                    await asyncio.sleep(3)
                    # 防御：若 click 打开了新标签/窗口（target=_blank）或模态框未弹出，
                    # URL 不变且登录 UI 不可见——此时直导到 content/upload 触发登录重定向。
                    if page.url.rstrip("/") == "https://creator.douyin.com":
                        login_visible = await page.locator(
                            ".douyin-login-container-sl0M7z, .login-card-double-Gtywl8"
                        ).first.count() > 0
                        if not login_visible:
                            douyin_logger.warning(
                                _msg("🪟", "点击「创作者登录」后 URL 未变化且登录 UI 不可见（可能弹出新窗口或模态框未渲染），小人直接导航到登录页")
                            )
                            try:
                                await _goto_race_safe(
                                    page,
                                    "https://creator.douyin.com/creator-micro/content/upload",
                                    flow_label="上传页跳转（点击创作者登录重试）",
                                    timeout=60000,
                                )
                            except PatchrightRaceError as e:
                                return _build_login_result(
                                    False,
                                    "patchright_race",
                                    "上传页跳转 race（点击创作者登录重试）; please re-login via sau douyin login",
                                    account_file,
                                    current_url=e.safe_url,
                                )
                            await asyncio.sleep(3)
            except Exception:
                pass
            # 扫码登录 tab 默认已选中（class="selected-w_E01s"），force=True
            # 绕过模态框内其他元素对 pointer-events 的拦截，避免 TimeoutError。
            try:
                qr_tab = page.locator("text=扫码登录").first
                if await qr_tab.count():
                    await qr_tab.click(force=True, timeout=5000)
                    await asyncio.sleep(2)
            except Exception:
                pass
            # 优先使用网络拦截到的二维码（策略 0），其次走 DOM/截图提取。
            # 短轮询等待 API 响应——Douyin 的 get_qrcode 可能比点击稍慢返回。
            #
            # Bug fix: 原写法在 captured_qrcode_b64 已经非空（route handler
            # 在前序 ``await asyncio.sleep(2)`` 期间已被填入，例如 SSE 扫码
            # fast path）下，iter 0 顶端的 break 跳过内层
            # ``if captured_qrcode_b64: build+emit`` 块。for/else-exit 处
            # qrcode_info 仍然 unbound，下一行的
            # ``if not qrcode_info.get(...)`` 直接 UnboundLocalError 把 SSE
            # worker 整条崩掉。
            #
            # 修复：把 captured-build 块平移到 for/else 之后单点处理，同时
            # 把 qrcode_info 初始化为 ``dict | None = None``（带类型注解）使
            # exit 处不论走 captured 分支还是 else 分支都是 bound。这是 user
            # 提示的 “Either move the captured-payload build into an
            # else: on the top check, or initialize qrcode_info = None
            # before the loop” 的合并方案（实际效果是 init + else 后单点
            # build，等价于"init + ensure-bind-after-loop"）。
            qrcode_info: dict | None = None
            for _ in range(4):
                if captured_qrcode_b64:
                    break
                await asyncio.sleep(1)
                if captured_qrcode_b64:
                    break  # Captured during this iter's sleep; consolidated build below.
            else:
                # 4 次轮询都返回空（route handler 未触发 or API 超时）：
                # 退回 DOM 提取路径。
                qrcode_info = await _save_douyin_qrcode(page, account_file, qrcode_callback=qrcode_callback)

            # 单点 captured-build：统一处理 (a) 循环开始前 captured_qrcode_b64
            # 已非空（fast path 上 iter 0 break，未进原内层 build 块），
            # 以及 (b) 轮询期间某次 sleep 内被 route handler 填入（iter 内层
            # 现在改为显式 break，也未进 build，落到这里来）。两种 Path 走
            # 同一个 build 路径，修复 UnboundLocalError 的 fast-path 崩。
            if qrcode_info is None and captured_qrcode_b64:
                qrcode_src = "data:image/png;base64," + captured_qrcode_b64[0]
                qrcode_path_obj: Path | None = None
                if qrcode_callback is None:
                    # CLI direct-path: write PNG so the user can scan via file viewer.
                    # SSE/Web Shell flow: skip disk write — bytes already flow through
                    # ``image_data_url`` and the Web Shell renders inline.
                    qrcode_path_obj = save_data_url_image(qrcode_src, build_login_qrcode_path(account_file))
                    douyin_logger.info(_msg("🖼️", f"二维码已存到本地（网络拦截）：{qrcode_path_obj}"))
                    douyin_logger.info(_msg("📲", f"请用抖音APP扫码，或打开：file://{qrcode_path_obj}"))
                qrcode_info = {"image_path": str(qrcode_path_obj) if qrcode_path_obj else "", "image_data_url": qrcode_src}
                await _emit_qrcode_callback(qrcode_callback, qrcode_info)
            # 落地页→模态框路径若二维码提取失败且登录 UI 从未出现
            # （可能页面受限没渲染按钮），fallback：导航到 upload 页，
            # 未登录时 Douyin 会重定向到登录页。仅在没有登录 UI 时
            # 才跳转——如果模态框已打开只是 QR 加载慢，不触发 fallback。
            if not qrcode_info.get("image_data_url") and not landing_page_clicked:
                douyin_logger.info(_msg("🔄", "落地页未拿到二维码，尝试导航到内容上传页触发登录重定向"))
                try:
                    await _goto_race_safe(
                        page,
                        "https://creator.douyin.com/creator-micro/content/upload",
                        flow_label="上传页跳转（QR未捕获）",
                        timeout=60000,
                    )
                except PatchrightRaceError as e:
                    return _build_login_result(
                        False,
                        "patchright_race",
                        "上传页跳转 race（QR未捕获）; please re-login via sau douyin login",
                        account_file,
                        current_url=e.safe_url,
                    )
                await asyncio.sleep(3)
                qrcode_info = await _save_douyin_qrcode(page, account_file, qrcode_callback=qrcode_callback)
            qrcode_path = Path(qrcode_info["image_path"]) if qrcode_info.get("image_path") else None
            douyin_logger.info(_msg("🧍", "请扫码，小人正在耐心等待登录完成"))
            result = await _wait_for_douyin_login(
                page,
                account_file,
                qrcode_info,
                qrcode_callback=qrcode_callback,
                poll_interval=poll_interval,
                max_checks=max_checks,
            )
            if result["success"]:
                await asyncio.sleep(2)
                await context.storage_state(path=account_file)
                if not await cookie_auth(account_file):
                    result = _build_login_result(
                        False,
                        "cookie_invalid",
                        "抖音扫码流程结束，但 cookie 校验失败",
                        account_file,
                        qrcode_info,
                        page.url,
                    )
        except Exception as exc:
            result = _build_login_result(False, "failed", str(exc), account_file, current_url=page.url if "page" in locals() else "")
        finally:
            if remove_qrcode_file(qrcode_path):
                douyin_logger.info(_msg("🧹", f"临时二维码文件已清理: {qrcode_path}"))
            if not result["success"]:
                douyin_logger.error(_msg("😢", f"登录失败: {result['message']}"))
            await context.close()
            await browser.close()
        return result


class DouYinBaseUploader(BaseVideoUploader):
    def __init__(
        self,
        publish_date: datetime | int,
        account_file,
        publish_strategy: str = DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
        debug: bool = DEBUG_MODE,
        headless: bool = LOCAL_CHROME_HEADLESS,
    ):
        self.publish_date = publish_date
        self.account_file = account_file
        self.publish_strategy = publish_strategy
        self.debug = debug
        self.date_format = "%Y年%m月%d日 %H:%M"
        self.local_executable_path = LOCAL_CHROME_PATH
        self.headless = headless

    async def validate_base_args(self):
        # Phase 4 alignment (2026-07-02): shared `BaiJiaHaoVideo.validate_upload_args` pattern.
        # publish_date validation moved to derived-class `validate_upload_args` (unconditional
        # `self.validate_publish_date(self.publish_date)`, short-circuits on `0`/`None`).
        # validate_base_args NOW: cookie file + cookie_auth + publish_strategy only.
        if not os.path.exists(self.account_file):
            raise RuntimeError(f"cookie文件不存在，请先完成抖音登录: {self.account_file}")
        if not await cookie_auth(self.account_file):
            raise RuntimeError(f"cookie文件已失效，请先完成抖音登录: {self.account_file}")
        if self.publish_strategy not in {DOUYIN_PUBLISH_STRATEGY_IMMEDIATE, DOUYIN_PUBLISH_STRATEGY_SCHEDULED}:
            raise ValueError(f"不支持的发布策略: {self.publish_strategy}")

    async def set_schedule_time_douyin(self, page, publish_date):
        label_element = page.locator("[class^='radio']:has-text('定时发布')")
        await label_element.click()
        await asyncio.sleep(1)
        publish_date_hour = publish_date.strftime("%Y-%m-%d %H:%M")

        await asyncio.sleep(1)
        await page.locator('.semi-input[placeholder="日期和时间"]').click()
        await page.keyboard.press("Control+KeyA")
        await page.keyboard.type(str(publish_date_hour))
        await page.keyboard.press("Enter")
        await asyncio.sleep(1)

    async def fill_title_and_description(self, page: Page, title: str, description: str, tags: list[str] | None = None):
        # 2026-06 抖音发布页 DOM：标题=input[placeholder*=填写作品标题]，描述=div.zone-container[contenteditable]
        # version_2(post/video) 发布页要等视频上传完才渲染表单（实测约 40s），故等待超时给到 120s
        title_input = page.locator('input[placeholder*="填写作品标题"]').first
        await title_input.wait_for(state="visible", timeout=120000)
        await human_type(page, title[:30], min_delay_ms=40, max_delay_ms=150)

        description_editor = page.locator('div.zone-container[contenteditable="true"]').first
        await description_editor.wait_for(state="visible", timeout=120000)
        await description_editor.click()
        await page.keyboard.press("Control+KeyA")
        await page.keyboard.press("Delete")

        for tag in tags or []:
            await page.keyboard.type(" #" + tag, delay=random.randint(30, 80))
            await page.keyboard.press("Space")
        await page.keyboard.press("Escape")  # 收起话题下拉，避免浮层拦截后续点击

    async def set_location(self, page: Page, location: str = ""):
        if not location:
            return
        await page.locator('div.semi-select span:has-text("输入地理位置")').click()
        await page.keyboard.press("Backspace")
        await page.wait_for_timeout(2000)
        await page.keyboard.type(location)
        await page.wait_for_selector('div[role="listbox"] [role="option"]', timeout=5000)
        await page.locator('div[role="listbox"] [role="option"]').first.click()

    async def handle_product_dialog(self, page: Page, product_title: str):
        await page.wait_for_timeout(2000)
        await page.wait_for_selector('input[placeholder="请输入商品短标题"]', timeout=10000)
        short_title_input = page.locator('input[placeholder="请输入商品短标题"]')
        if not await short_title_input.count():
            douyin_logger.error(_msg("😵", "没找到商品短标题输入框"))
            return False

        product_title = product_title[:10]
        await short_title_input.fill(product_title)
        await page.wait_for_timeout(1000)

        finish_button = page.locator('button:has-text("完成编辑")')
        if "disabled" not in await finish_button.get_attribute("class"):
            await finish_button.click()
            douyin_logger.debug(_msg("🥳", "已点击“完成编辑”按钮"))
            await page.wait_for_selector(".semi-modal-content", state="hidden", timeout=5000)
            return True

        douyin_logger.error(_msg("😵", "“完成编辑”按钮是灰的，小人先把弹窗关掉"))
        cancel_button = page.locator('button:has-text("取消")')
        if await cancel_button.count():
            await cancel_button.click()
        else:
            close_button = page.locator(".semi-modal-close")
            await close_button.click()
        await page.wait_for_selector(".semi-modal-content", state="hidden", timeout=5000)
        return False

    async def set_product_link(self, page: Page, product_link: str, product_title: str):
        await page.wait_for_timeout(2000)
        try:
            await page.wait_for_selector("text=添加标签", timeout=10000)
            dropdown = page.get_by_text("添加标签").locator("..").locator("..").locator("..").locator(".semi-select").first
            if not await dropdown.count():
                douyin_logger.error(_msg("😵", "没找到标签下拉框"))
                return False
            douyin_logger.debug(_msg("🧍", "找到标签下拉框，小人准备选择“购物车”"))
            await dropdown.click()
            await page.wait_for_selector('[role="listbox"]', timeout=5000)
            await page.locator('[role="option"]:has-text("购物车")').click()
            douyin_logger.debug(_msg("🥳", "已经选中“购物车”"))

            await page.wait_for_selector('input[placeholder="粘贴商品链接"]', timeout=5000)
            input_field = page.locator('input[placeholder="粘贴商品链接"]')
            await input_field.fill(product_link)
            douyin_logger.debug(_msg("🔗", f"商品链接已经填好了: {product_link}"))

            add_button = page.locator('span:has-text("添加链接")')
            button_class = await add_button.get_attribute("class")
            if "disable" in button_class:
                douyin_logger.error(_msg("😵", "“添加链接”按钮现在点不了"))
                return False
            await add_button.click()
            douyin_logger.debug(_msg("🥳", "已点击“添加链接”按钮"))

            await page.wait_for_timeout(2000)
            error_modal = page.locator("text=未搜索到对应商品")
            if await error_modal.count():
                confirm_button = page.locator('button:has-text("确定")')
                await confirm_button.click()
                douyin_logger.error(_msg("😢", "这个商品链接无效"))
                return False

            if not await self.handle_product_dialog(page, product_title):
                return False

            douyin_logger.debug(_msg("🥳", "商品链接设置好了"))
            return True
        except Exception as e:
            douyin_logger.error(_msg("😢", f"设置商品链接时出错: {str(e)}"))
            return False

    async def set_self_declaration(self, page: Page, declaration: str = "内容为个人观点或见解") -> None:
        """抖音「自主声明」为发布必选项：打开声明弹窗 → 选指定类型 → 确定。

        入口和弹窗都是异步渲染，等不到就记 warning 跳过、继续发布，绝不因此中断
        （与小红书话题、视频号声明原创的容错策略保持一致）。
        """
        try:
            # 发布页底部「自主声明」行，未选时显示占位文案「请选择自主声明」
            entry = page.get_by_text("请选择自主声明").first
            await entry.wait_for(state="visible", timeout=6000)
            await entry.click()

            # 弹窗标题「对作品内容添加声明」
            dialog = page.locator(".semi-modal-content").filter(has_text="对作品内容添加声明").first
            await dialog.wait_for(state="visible", timeout=6000)

            # 单选项：Semi 的文字是 .semi-radio-addon（常带 pointer-events:none，直接点会卡 30s 超时），
            # 要点可交互的 .semi-radio 外层；找不到外层再退回 force 强制点文字。exact 避免误命中预览「作者声明：…」。
            option = dialog.locator(".semi-radio").filter(has_text=declaration).first
            if await option.count():
                await option.click(timeout=6000)
            else:
                await dialog.get_by_text(declaration, exact=True).first.click(timeout=6000, force=True)
            await dialog.get_by_role("button", name="确定").click(timeout=6000)
            await dialog.wait_for(state="hidden", timeout=6000)
            douyin_logger.info(_msg("🧾", f"自主声明已选择「{declaration}」"))
        except Exception as exc:
            douyin_logger.warning(_msg("🧾", f"自主声明设置失败，跳过该步骤继续发布：{exc}"))

    async def select_bgm(self, page: Page, bgm_name: str) -> bool:
        """为图文发布选择 BGM：可选增强功能，搜索无结果或异常均跳过不中断发布。"""
        try:
            # 点击「选择音乐」按钮
            music_entry = page.locator('text="选择音乐"').nth(1)
            if not await music_entry.count():
                music_entry = page.locator('text="选择音乐"').first
            await music_entry.wait_for(state="visible", timeout=10000)
            await music_entry.click()

            # 等待侧边栏出现并搜索
            sidesheet = page.locator(".semi-sidesheet-content").first
            await sidesheet.wait_for(state="visible", timeout=8000)
            search_input = sidesheet.locator('input.semi-input[placeholder="搜索音乐"]').first
            await search_input.wait_for(state="visible", timeout=5000)
            await search_input.fill(bgm_name)
            await search_input.press("Enter")

            # 等待搜索结果
            await asyncio.sleep(2)
            first_card = sidesheet.locator(".card-container-tmocjc").first
            try:
                await first_card.wait_for(state="visible", timeout=8000)
            except Exception:
                douyin_logger.warning(_msg("🎵", f"音乐「{bgm_name}」搜索结果为空，小人跳过"))
                await self._close_music_sidesheet(page)
                return False

            # 打印找到的音乐名称
            try:
                song_name_el = first_card.locator(".song-name-oRge4d").first
                if await song_name_el.count():
                    song_name = await song_name_el.inner_text()
                    douyin_logger.info(_msg("🎵", f"小人找到了: {song_name}"))
            except Exception:
                pass

            # JS 点击「使用」（按钮 visibility:hidden，普通 click 无效）
            apply_btn = first_card.locator(".apply-btn-LUPP0D").first
            await apply_btn.evaluate("el => el.click()")
            douyin_logger.info(_msg("🥳", f"BGM「{bgm_name}」已应用"))

            # 等待侧边栏关闭，超时则手动关闭
            try:
                await sidesheet.wait_for(state="hidden", timeout=5000)
            except Exception:
                await self._close_music_sidesheet(page)

            return True
        except Exception as exc:
            douyin_logger.warning(_msg("🎵", f"添加 BGM 时出错，跳过该步骤继续发布：{exc}"))
            try:
                await self._close_music_sidesheet(page)
            except Exception:
                pass
            return False

    async def _close_music_sidesheet(self, page: Page) -> None:
        try:
            close_btn = page.locator(".semi-sidesheet-close").first
            if await close_btn.count() and await close_btn.is_visible():
                await close_btn.click()
                await asyncio.sleep(1)
        except Exception:
            pass


class DouYinVideo(DouYinBaseUploader):
    def __init__(
        self,
        title,
        file_path,
        tags,
        publish_date: datetime | int,
        account_file,
        thumbnail_landscape_path=None,
        productLink="",
        productTitle="",
        thumbnail_portrait_path=None,
        desc: str | None = None,
        publish_strategy: str = DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
        debug: bool = DEBUG_MODE,
        headless: bool = LOCAL_CHROME_HEADLESS,
    ):
        super().__init__(
            publish_date=publish_date,
            account_file=account_file,
            publish_strategy=publish_strategy,
            debug=debug,
            headless=headless,
        )
        self.title = title
        self.file_path = file_path
        self.tags = tags
        self.thumbnail_landscape_path = thumbnail_landscape_path
        self.thumbnail_portrait_path = thumbnail_portrait_path
        self.productLink = productLink
        self.productTitle = productTitle
        self.desc = desc or ""

    async def validate_upload_args(self):
        await self.validate_base_args()
        if not self.title or not str(self.title).strip():
            raise ValueError("视频模式下，title 是必须的")

        self.file_path = str(self.validate_video_file(self.file_path))

        # ── Content fingerprint obfuscation (anti-duplicate-detection) ────────
        obf_path = str(Path(self.file_path).with_suffix("")) + ".obf" + Path(self.file_path).suffix
        obfuscated = obfuscate_video(self.file_path, obf_path)
        if obfuscated.exists():
            self.file_path = str(obfuscated)
            douyin_logger.info(_msg("🎭", "视频指纹已混淆，用于对抗平台重复检测"))

        if self.thumbnail_landscape_path:
            self.thumbnail_landscape_path = str(self.validate_image_file(self.thumbnail_landscape_path))
        if self.thumbnail_portrait_path:
            self.thumbnail_portrait_path = str(self.validate_image_file(self.thumbnail_portrait_path))

        # Phase 4 alignment (2026-07-02): shared BaiJiaHaoVideo.validate_upload_args pattern.
        # Unconditional validate_publish_date (short-circuits on 0/None for immediate,
        # enforces past-date + 2h lead-time for scheduled). Replaces the prior
        # strategy-conditional logic that lived in validate_base_args.
        self.publish_date = self.validate_publish_date(self.publish_date)

    async def handle_upload_error(self, page):
        douyin_logger.warning(_msg("😵", "视频上传摔了一跤，小人马上重新上传"))
        await page.locator('div.progress-div [class^="upload-btn-input"]').set_input_files(self.file_path)

    async def handle_auto_video_cover(self, page):
        if await page.get_by_text("请设置封面后再发布").first.is_visible():
            douyin_logger.info(_msg("🧍", "发布前还得先把封面弄好"))
            recommend_cover = page.locator('[class^="recommendCover-"]').first
            if await recommend_cover.count():
                douyin_logger.info(_msg("🏃", "小人去选第一个推荐封面"))
                try:
                    await recommend_cover.click()
                    await asyncio.sleep(1)
                    confirm_text = "是否确认应用此封面？"
                    if await page.get_by_text(confirm_text).first.is_visible():
                        douyin_logger.info(_msg("🪟", f"弹出确认框了: {confirm_text}"))
                        await page.get_by_role("button", name="确定").click()
                        douyin_logger.info(_msg("🥳", "推荐封面已经应用"))
                        await asyncio.sleep(1)
                    douyin_logger.info(_msg("🥳", "封面选择流程完成"))
                    return True
                except Exception as e:
                    douyin_logger.warning(_msg("😵", f"推荐封面没选成功: {e}"))
        return False

    async def set_thumbnail(self, page: Page):
        if not self.thumbnail_landscape_path and not self.thumbnail_portrait_path:
            return

        douyin_logger.info(_msg("🏃", "小人正在设置视频封面"))
        # 先清掉 shepherd 新手引导浮层，否则它会拦截“选择封面”点击导致弹窗打不开
        await page.evaluate(
            "() => document.querySelectorAll('.shepherd-element,.shepherd-modal-overlay-container').forEach(e=>e.remove())"
        )
        await page.get_by_text("选择封面", exact=True).first.click(force=True)
        cover_locator_str = 'div.dy-creator-content-modal'
        cover_locator = page.locator(cover_locator_str).first
        await page.wait_for_selector(cover_locator_str, timeout=20000)

        await page.wait_for_timeout(1500)
        # version_2 封面弹窗有 4 个隐藏 file input：
        #   [0]/[1] 左侧“AI生成参考图”上传/替换，[2]/[3] 才是“上传封面”/替换。
        # 旧代码用 .first 传到了 AI 参考图（不会成为封面）→ 这就是“传了却没封面”的根因。
        # 取 input.semi-upload-hidden-input 的第 2 个（nth(1)），即真正的封面上传输入。
        cover_upload = cover_locator.locator("input.semi-upload-hidden-input").nth(1)

        if self.thumbnail_portrait_path:
            # 弹窗默认就在“设置竖封面”页；防御性点一下 tab（已激活则忽略）
            try:
                await cover_locator.get_by_text("设置竖封面", exact=True).first.click(timeout=3000)
                await page.wait_for_timeout(800)
            except Exception:
                pass
            await cover_upload.set_input_files(self.thumbnail_portrait_path)
            await page.wait_for_timeout(3000)
            douyin_logger.info(_msg("🖼️", "竖版封面已上传到预览"))
        elif self.thumbnail_landscape_path:
            try:
                await cover_locator.get_by_text("设置横封面", exact=True).first.click(timeout=3000)
                await page.wait_for_timeout(800)
            except Exception:
                pass
            await cover_upload.set_input_files(self.thumbnail_landscape_path)
            await page.wait_for_timeout(3000)
            douyin_logger.info(_msg("🖼️", "横版封面已上传到预览"))

        # 点红色主按钮“完成”应用封面（exact 避免误中“完成编辑”）
        await cover_locator.get_by_role("button", name="完成", exact=True).first.click()
        douyin_logger.info(_msg("🥳", "视频封面设置完成"))
        await cover_locator.wait_for(state="detached", timeout=20000)

    async def upload(self, playwright: Playwright) -> None:
        douyin_logger.info(_msg("🧍", "小人先检查 cookie、视频文件、封面和发布时间"))
        await self.validate_upload_args()
        douyin_logger.info(_msg("🥳", "上传前检查通过"))

        browser = await playwright.chromium.launch(
            **build_browser_launch_kwargs(headless=self.headless),
        )
        context = await browser.new_context(
            **build_browser_context_options(
                "douyin",
                account_file=self.account_file,
                headless=self.headless,
            ),
        )
        context = await apply_anti_detect(context)

        page = await context.new_page()
        await _goto_race_safe(
            page,
            "https://creator.douyin.com/creator-micro/content/upload",
            flow_label="视频流程",
            timeout=90000,
        )
        douyin_logger.info(_msg("🏃", f"小人开始搬运视频: {self.title}.mp4"))
        douyin_logger.info(_msg("🧭", "小人正在赶往上传主页"))
        await page.wait_for_url("https://creator.douyin.com/creator-micro/content/upload", timeout=90000)
        # wait_for_url 完成时上传页可能尚未渲染出文件 input（实测偶发），先等它挂载再 set_input_files
        await page.wait_for_selector("div[class^='container'] input", state="attached", timeout=60000)
        await page.locator("div[class^='container'] input").set_input_files(self.file_path)

        while True:
            try:
                await page.wait_for_url(
                    "https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page",
                    timeout=3000,
                )
                douyin_logger.info(_msg("🥳", "已经进入 version_1 发布页面"))
                break
            except Exception:
                try:
                    await page.wait_for_url(
                        "https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page",
                        timeout=3000,
                    )
                    douyin_logger.info(_msg("🥳", "已经进入 version_2 发布页面"))
                    break
                except Exception:
                    douyin_logger.debug(_msg("🧍", "还没进到视频发布页面，小人继续等一会"))
                    await asyncio.sleep(0.5)

        await asyncio.sleep(1)
        douyin_logger.info(_msg("✍️", "小人开始填标题、描述和话题"))
        await self.fill_title_and_description(page, self.title, self.desc or self.title, self.tags)
        douyin_logger.info(_msg("🏷️", f"小人一共贴了 {len(self.tags)} 个话题"))

        while True:
            try:
                number = await page.locator('[class^="long-card"] div:has-text("重新上传")').count()
                if number > 0:
                    douyin_logger.success(_msg("🥳", "视频已经传完啦"))
                    break
                douyin_logger.info(_msg("🏃", "小人正在努力上传视频"))
                await asyncio.sleep(2)
                if await page.locator('div.progress-div > div:has-text("上传失败")').count():
                    douyin_logger.error(_msg("😵", "检测到上传失败，小人准备重试"))
                    await self.handle_upload_error(page)
            except Exception:
                douyin_logger.debug(_msg("🧍", "小人还在等视频上传完成"))
                await asyncio.sleep(2)

        if self.productLink and self.productTitle:
            douyin_logger.info(_msg("🛒", "小人正在设置商品链接"))
            await self.set_product_link(page, self.productLink, self.productTitle)
            douyin_logger.info(_msg("🥳", "商品链接设置完成"))

        await self.set_thumbnail(page)

        await self.set_self_declaration(page)

        third_part_element = '[class^="info"] > [class^="first-part"] div div.semi-switch'
        if await page.locator(third_part_element).count():
            if "semi-switch-checked" not in await page.eval_on_selector(third_part_element, "div => div.className"):
                await page.locator(third_part_element).locator("input.semi-switch-native-control").click()

        if self.publish_strategy == DOUYIN_PUBLISH_STRATEGY_SCHEDULED and self.publish_date != 0:
            await self.set_schedule_time_douyin(page, self.publish_date)

        while True:
            try:
                # 移除会拦截发布按钮点击的新手引导/话题下拉浮层
                await page.evaluate(
                    "() => { document.querySelectorAll('.shepherd-element, .shepherd-modal-overlay-container, [class*=\"mention-wrapper\"]').forEach(e => e.remove()); }"
                )
                publish_button = page.get_by_role("button", name="发布", exact=True)
                if await publish_button.count():
                    await publish_button.click(force=True)
                await page.wait_for_url(
                    "https://creator.douyin.com/creator-micro/content/manage**",
                    timeout=3000,
                )
                douyin_logger.success(_msg("🥳", "视频发布成功，小人开心收工"))
                break
            except Exception:
                await self.handle_auto_video_cover(page)
                douyin_logger.info(_msg("🏃", "小人正在冲刺发布视频"))
                # Screen capture disabled 2026-06-29 (not accurate per user feedback).
                await asyncio.sleep(0.5)

        await context.storage_state(path=self.account_file)
        douyin_logger.success(_msg("🥳", "cookie 更新完毕"))
        await asyncio.sleep(2)
        await context.close()
        await browser.close()

    async def douyin_upload_video(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)

    async def main(self):
        await self.douyin_upload_video()


class DouYinNote(DouYinBaseUploader):
    def __init__(
        self,
        image_paths,
        note,
        tags,
        publish_date: datetime | int,
        account_file,
        title: str | None = None,
        publish_strategy: str = DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
        debug: bool = DEBUG_MODE,
        headless: bool = LOCAL_CHROME_HEADLESS,
        bgm: str = "",
    ):
        super().__init__(
            publish_date=publish_date,
            account_file=account_file,
            publish_strategy=publish_strategy,
            debug=debug,
            headless=headless,
        )
        self.image_paths = image_paths
        self.note = note or ""
        self.title = title or (self.note[:30] if self.note else "")
        self.tags = tags or []
        self.bgm = bgm or ""

    async def validate_upload_args(self):
        await self.validate_base_args()
        if not self.title or not str(self.title).strip():
            raise ValueError("图文模式下，title 是必须的")

        if len(self.title) > 20:
            raise ValueError(f"标题不能超过20字符，当前: {len(self.title)}字符")

        if not self.image_paths:
            raise ValueError("图文模式下，图片是必须的")

        if isinstance(self.image_paths, (str, Path)):
            self.image_paths = [self.image_paths]

        if len(self.image_paths) > 35:
            raise ValueError("图文模式下最多只支持上传 35 张图片")

        note_len = len(self.note) if self.note else 0
        if note_len > 1000:
            raise ValueError(f"正文不能超过1000字符，当前: {note_len}字符")

        normalized_image_paths = []
        for image_path in self.image_paths:
            normalized_image_paths.append(str(self.validate_image_file(image_path)))
        self.image_paths = normalized_image_paths

        # Phase 4 alignment (2026-07-02): shared BaiJiaHaoVideo.validate_upload_args pattern.
        # Unconditional validate_publish_date (short-circuits on 0/None for immediate,
        # enforces past-date + 2h lead-time for scheduled). Symmetric to DouYinVideo.
        self.publish_date = self.validate_publish_date(self.publish_date)

    async def upload_note_content(self, page: Page) -> None:
        douyin_logger.info(_msg("🏃", f"小人开始搬运图文，共 {len(self.image_paths)} 张图片"))
        douyin_logger.info(_msg("🔀", "小人正在切换到图文发布"))
        await page.get_by_text("发布图文", exact=True).click()
        await page.wait_for_timeout(1000)

        douyin_logger.info(_msg("📤", "小人正在上传图片"))
        await page.locator("div[class^='container'] input[accept*='image']").set_input_files(self.image_paths)

        while True:
            try:
                await page.wait_for_url(
                    "**/creator-micro/content/post/image?**",
                    timeout=3000,
                )
                douyin_logger.info(_msg("🥳", "已经进入图文发布页面"))
                break
            except Exception:
                douyin_logger.debug(_msg("🧍", "小人还在等图片上传完成"))
                await asyncio.sleep(0.5)

        await asyncio.sleep(1)
        douyin_logger.info(_msg("✍️", "小人开始填标题、描述和话题"))
        await self.fill_title_and_description(page, self.title, self.note, self.tags)
        title_len = len(self.title) if self.title else 0
        tags_text = " ".join(f"#{t}" for t in self.tags) if self.tags else ""
        desc_and_tags_len = len(self.note or "") + (len(tags_text) + 2 if self.tags else 0)
        douyin_logger.info(_msg("📝", f"标题总字数: {title_len}，描述+话题总字数: {desc_and_tags_len}"))
        douyin_logger.info(_msg("🏷️", f"小人一共贴了 {len(self.tags)} 个话题"))

        if self.bgm:
            await self.select_bgm(page, self.bgm)

        if self.publish_strategy == DOUYIN_PUBLISH_STRATEGY_SCHEDULED and self.publish_date != 0:
            await self.set_schedule_time_douyin(page, self.publish_date)

        while True:
            try:
                publish_button = page.get_by_role("button", name="发布", exact=True)
                if await publish_button.count():
                    await publish_button.click()
                await page.wait_for_url(
                    "**/creator-micro/content/manage?enter_from=publish**",
                    timeout=3000,
                )
                douyin_logger.success(_msg("🥳", "图文发布成功，小人开心收工"))
                break
            except Exception:
                douyin_logger.info(_msg("🏃", "小人正在冲刺发布图文"))
                await asyncio.sleep(0.5)

    async def upload(self, playwright: Playwright) -> None:
        douyin_logger.info(_msg("🧍", "小人先检查 cookie、图片和发布时间"))
        await self.validate_upload_args()
        douyin_logger.info(_msg("🥳", "图文上传前检查通过"))

        browser = await playwright.chromium.launch(
            **build_browser_launch_kwargs(headless=self.headless),
        )
        context = await browser.new_context(
            **build_browser_context_options(
                "douyin",
                account_file=self.account_file,
                headless=self.headless,
            ),
        )
        context = await apply_anti_detect(context)

        upload_success = False
        try:
            page = await context.new_page()
            await _goto_race_safe(
                page,
                "https://creator.douyin.com/creator-micro/content/upload",
                flow_label="图文流程",
                timeout=90000,
            )
            douyin_logger.info(_msg("🧭", "小人正在赶往图文发布页"))
            await page.wait_for_url("https://creator.douyin.com/creator-micro/content/upload", timeout=90000)

            await self.upload_note_content(page)
            upload_success = True
        finally:
            if upload_success:
                await context.storage_state(path=self.account_file)
                douyin_logger.success(_msg("🥳", "cookie 更新完毕"))
                await asyncio.sleep(2)
            await context.close()
            await browser.close()

    async def douyin_upload_note(self):
        async with async_playwright() as playwright:
            await self.upload(playwright)
