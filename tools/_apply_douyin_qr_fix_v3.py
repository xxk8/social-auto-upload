"""v3 of the douyin QR-extraction fix. Builds on tools/_apply_douyin_qr_fix.py.

Adds 4 surgical edits (HIGH-1 + HIGH-2 from code-reviewer-minimax-m3 pass):

  EDIT 4 (HIGH-1 / regression I introduced):
    `_save_douyin_qrcode` crashed for CLI direct-path users when Strategy 1
    returned empty string. Guard `save_data_url_image(qrcode_src, ...)` with
    `if qrcode_src:` so empty-string falls through to friendly warning instead
    of ValueError.

  EDIT 5 (HIGH-2 / the user's actual symptom):
    `cookie_auth` goto 到 creator-micro/content/upload 时若 "context or
    browser has been closed" patchright race 重抛异常，视为 cookie 失效 → 上层
    重新扫码 (attempt QR regen instead of crashing the whole CLI flow).

  EDIT 6 (HIGH-2 / Symmetric in DouYinVideo.upload):
    Wrap goto: 同样 try/except + log + raise — 上层 web_runner 会捕获异常，但
    日志里 douyin_logger.warning 会给出明确诊断（之前只是 Playwright 默认错）。
    上传重试由 web_runner 调度，douyin_uploader 自身不重建 context。

  EDIT 7 (HIGH-2 / Symmetric in DouYinNote.upload):
    Wrap goto 同上。

Run:    .venv/bin/python tools/_apply_douyin_qr_fix_v3.py
Verify: .venv/bin/python -m py_compile uploader/douyin_uploader/main.py
"""
import sys

PATH = "uploader/douyin_uploader/main.py"
with open(PATH, encoding="utf-8") as f:
    src = f.read()
print(f"loaded {len(src)} bytes from {PATH}")


# ---- EDIT 4: guard save_data_url_image call in _save_douyin_qrcode ----
# Anchor: the 5-line "if qrcode_callback is None: ... save_data_url_image(...) ..."
# block. Original code crashes when qrcode_src == "" (post-EDIT 1 state).
OLD4 = (
    "    qrcode_path: Path | None = None\n"
    "    if qrcode_callback is None:\n"
    "        # CLI direct-path: write PNG so the user can scan via file viewer.\n"
    "        qrcode_path = save_data_url_image(qrcode_src, build_login_qrcode_path(account_file))\n"
    "        douyin_logger.info(_msg(\"\U0001F5BC\ufe0f\", f\"二维码已存到本地：{qrcode_path}\"))\n"
    "        douyin_logger.info(_msg(\"\U0001F4F2\", f\"请用抖音APP扫码，或打开：file://{qrcode_path}\"))\n"
)
NEW4 = (
    "    qrcode_path: Path | None = None\n"
    "    if qrcode_callback is None:\n"
    "        if qrcode_src:\n"
    "            # CLI direct-path: write PNG so the user can scan via file viewer.\n"
    "            qrcode_path = save_data_url_image(qrcode_src, build_login_qrcode_path(account_file))\n"
    "            douyin_logger.info(_msg(\"\U0001F5BC\ufe0f\", f\"二维码已存到本地：{qrcode_path}\"))\n"
    "            douyin_logger.info(_msg(\"\U0001F4F2\", f\"请用抖音APP扫码，或打开：file://{qrcode_path}\"))\n"
    "        else:\n"
    "            # Strategy 0 + Strategy 1 都失败，_extract_douyin_qrcode_src 返回 \"\"；\n"
    "            # 之前的 EDIT 1 (Strategy 3 移除) 后这是常见落地形态。\n"
    "            # 不走 save_data_url_image (会 ValueError)，改走 operator-friendly warning。\n"
    "            douyin_logger.warning(_msg(\"\U0001F635\", \"没定位到二维码元素——请直接在弹出的浏览器里扫码，小人继续等登录跳转\"))\n"
)
if OLD4 in src:
    src = src.replace(OLD4, NEW4)
    print("EDIT 4: guarded save_data_url_image with if qrcode_src (HIGH-1 fix)")
else:
    print("WARN EDIT 4: anchor not found; skip.", file=sys.stderr)


# ---- EDIT 5: cookie_auth goto try/except context-closed ----
OLD5 = (
    "            page = await context.new_page()\n"
    "            await page.goto(\"https://creator.douyin.com/creator-micro/content/upload\", wait_until=\"domcontentloaded\", timeout=90000)\n"
    "            try:\n"
    "                await page.wait_for_url(\"https://creator.douyin.com/creator-micro/content/upload\", timeout=5000)\n"
)
NEW5 = (
    "            page = await context.new_page()\n"
    "            try:\n"
    "                await page.goto(\"https://creator.douyin.com/creator-micro/content/upload\", wait_until=\"domcontentloaded\", timeout=90000)\n"
    "            except Exception as e:\n"
    "                # patchright race: context/browser 在 goto resolve 前被关；\n"
    "                # 真实的根因可能在 (a) 启动参数冲突 (b) anti-detect init 顺序\n"
    "                # (c) 上一次 douyin_cookie_gen 留下的状态未彻底清理。如果把\n"
    "                # cookie 视为失效，上层会触发重新扫码流程 + 新 browser 进程，\n"
    "                # 通常能 recover（用户报告 2026-06-29 的场景与这条分支相关）\n"
    "                msg = str(e)\n"
    "                if \"context or browser has been closed\" in msg or \"Target page\" in msg:\n"
    "                    douyin_logger.warning(_msg(\"\U0001FA7B\", f\"patchright race：context 在 goto 完成前关闭（{msg[:60]}）。视为 cookie 失效，小人重新扫码\"))\n"
    "                return False\n"
    "            try:\n"
    "                await page.wait_for_url(\"https://creator.douyin.com/creator-micro/content/upload\", timeout=5000)\n"
)
if OLD5 in src:
    src = src.replace(OLD5, NEW5)
    print("EDIT 5: cookie_auth goto wrapped with try/except (HIGH-2 fix)")
else:
    print("WARN EDIT 5: anchor not found; skip.", file=sys.stderr)


# ---- EDIT 6: DouYinVideo.upload goto try/except context-closed ----
OLD6 = (
    "        page = await context.new_page()\n"
    "        await page.goto(\"https://creator.douyin.com/creator-micro/content/upload\", wait_until=\"domcontentloaded\", timeout=90000)\n"
    "        douyin_logger.info(_msg(\"\U0001F9ED\", \"小人正在赶往上传主页\"))\n"
)
NEW6 = (
    "        page = await context.new_page()\n"
    "        try:\n"
    "            await page.goto(\"https://creator.douyin.com/creator-micro/content/upload\", wait_until=\"domcontentloaded\", timeout=90000)\n"
    "        except Exception as e:\n"
    "            # patchright race 同 EDIT 5；但这里是 upload 入口，重建 context\n"
    "            # 是 douyin_uploader 上层的事，本模块只 log 让 web_runner 决定是否重试。\n"
    "            msg = str(e)\n"
    "            if \"context or browser has been closed\" in msg or \"Target page\" in msg:\n"
    "                douyin_logger.warning(_msg(\"\U0001FA7B\", f\"patchright race：{msg[:60]}；上传流程要先重新扫码再继续\"))\n"
    "            raise\n"
    "        douyin_logger.info(_msg(\"\U0001F9ED\", \"小人正在赶往上传主页\"))\n"
)
if OLD6 in src:
    src = src.replace(OLD6, NEW6)
    print("EDIT 6: DouYinVideo.upload goto wrapped with try/except (HIGH-2 fix)")
else:
    print("WARN EDIT 6: anchor not found; skip.", file=sys.stderr)


# ---- EDIT 7: DouYinNote.upload goto try/except context-closed ----
OLD7 = (
    "            page = await context.new_page()\n"
    "            await page.goto(\"https://creator.douyin.com/creator-micro/content/upload\", wait_until=\"domcontentloaded\", timeout=90000)\n"
    "            douyin_logger.info(_msg(\"\U0001F9ED\", \"小人正在赶往图文发布页\"))\n"
)
NEW7 = (
    "            page = await context.new_page()\n"
    "            try:\n"
    "                await page.goto(\"https://creator.douyin.com/creator-micro/content/upload\", wait_until=\"domcontentloaded\", timeout=90000)\n"
    "            except Exception as e:\n"
    "                msg = str(e)\n"
    "                if \"context or browser has been closed\" in msg or \"Target page\" in msg:\n"
    "                    douyin_logger.warning(_msg(\"\U0001FA7B\", f\"patchright race：{msg[:60]}；图文流程要先重新扫码再继续\"))\n"
    "                raise\n"
    "            douyin_logger.info(_msg(\"\U0001F9ED\", \"小人正在赶往图文发布页\"))\n"
)
if OLD7 in src:
    src = src.replace(OLD7, NEW7)
    print("EDIT 7: DouYinNote.upload goto wrapped with try/except (HIGH-2 fix)")
else:
    print("WARN EDIT 7: anchor not found; skip.", file=sys.stderr)


with open(PATH, "w", encoding="utf-8") as f:
    f.write(src)
print(f"wrote {len(src)} bytes back to {PATH}; net change {len(src) - 48819:+d} bytes from v2 baseline")
