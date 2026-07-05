## 1. URL 域名识别 (Web API)

- [ ] 1.1 在 `web_runner/routes/inbox.py` 定义 `_PLATFORM_DOMAINS: dict[str, tuple[str, ...]]` 映射,7 平台每个 2-3 个域名 pattern:
      - douyin: (`douyin.com`, `v.douyin.com`)
      - kuaishou: (`kuaishou.com`, `v.kuaishou.com`, `chenzhongtech.com`)
      - xiaohongshu: (`xiaohongshu.com`, `xhslink.com`)
      - bilibili: (`bilibili.com`, `b23.tv`, `bilibili.tv`)
      - tencent: (`channels.weixin.qq.com`, `weixin.qq.com`)
      - tiktok: (`tiktok.com`, `vm.tiktok.com`, `m.tiktok.com`)
      - baijiahao: (`baijiahao.baidu.com`, `mbd.baidu.com`)
      - youtube: (`youtube.com`, `youtu.be`, `m.youtube.com`)
- [ ] 1.2 实现 `detect_platform(url: str) -> str | None` 辅助函数,先 hostname 匹配,再 short-link 二次匹配(v.douyin.com / vm.tiktok.com 等)
- [ ] 1.3 在 `/api/inbox/download` handler 开头加 `if not detect_platform(url): return 400 {error: "unsupported_platform"}`

## 2. 平台路由分发 (Web API)

- [ ] 2.1 定义 `_DOWNLOAD_STRATEGY: dict[str, str]` 映射 7 平台的下载路径:
      - douyin / kuaishou / xiaohongshu / bilibili / tencent: `patchright`
      - tiktok / baijiahao / youtube: `ytdlp`
- [ ] 2.2 改造 `download_video(url)` 函数,按 `_DOWNLOAD_STRATEGY[platform]` 分发:
      - patchright 走现有逻辑(若已有)
      - ytdlp 走 `subprocess.run(["yt-dlp", "--no-playlist", "--quiet", "--print", "after_move:filepath", "-o", ...])`
- [ ] 2.3 失败回落:yt-dlp 失败 → 试 patchright(baijiahao 场景);patchright 失败 → 试 yt-dlp
- [ ] 2.4 加 `_MIN_VIDEO_BYTES` 校验(沿用现有 64KB 阈值,见 `add-web-inbox` 设计)

## 3. PLATFORM_CONFIG 扩展 (Web API)

- [ ] 3.1 `web_runner/utils.py:PLATFORM_CONFIG` 加 3 条:
      - tiktok: `{login: 'qr', note: False, thumbnail: False, desc: True, video_max_seconds: 600}`
      - baijiahao: `{login: 'qr', note: False, thumbnail: False, desc: False, video_max_seconds: 0}`
      - youtube: `{login: 'manual', note: False, thumbnail: 'special', desc: True, video_max_seconds: 0}`(登录流程在 CLI 单独)
- [ ] 3.2 同步更新 `DESC_PLATFORMS = {...} | {'tiktok', 'youtube'}` (baijiahao 不加)
- [ ] 3.3 同步更新 `THUMBNAIL_PLATFORMS` 不加(tiktok/baijiahao 无 / youtube 是 special)
- [ ] 3.4 同步更新 `NOTE_PLATFORMS` 不加(三个平台都不支持图文)
- [ ] 3.5 同步更新 `_QR_LOGIN_PLATFORMS` 加 tiktok / baijiahao(YouTube 是 manual,不进)

## 4. 前端 URL 自动识别 (Frontend)

- [ ] 4.1 `sau_web/frontend/src/Pages/InboxPage.tsx` 粘贴 URL 的 Input 加 `onChange` handler:调 `detectPlatform(url)` 自动 set 平台 state
- [ ] 4.2 平台下拉加 "Auto (推荐)" 默认项,粘贴 URL 时自动切到识别结果
- [ ] 4.3 加 platform icon 在 URL 旁边(react icon,跟 platform-icon.tsx 组件对齐)
- [ ] 4.4 `sau_web/frontend/src/lib/platform-detect.ts` 新文件,封装前端 detectPlatform 逻辑(共享域名映射)
- [ ] 4.5 验证粘贴 tiktok 链接后平台下拉自动选 TikTok

## 5. 测试 (Tests)

- [ ] 5.1 `tests/test_inbox.py` 加 `test_platform_detect_all_platforms`:13 个 URL pattern × 7 平台 = 13 个 case,全 pass
- [ ] 5.2 `tests/test_inbox.py` 加 `test_inbox_ytdlp_routing`:断言 youtube/tiktok URL 调用 `_try_ytdlp` 而非 `_try_patchright`
- [ ] 5.3 `tests/test_inbox.py` 加 `test_inbox_unsupported_url`:断言 `https://example.com` → 400 unsupported_platform
- [ ] 5.4 `tests/test_inbox.py` 加 `test_inbox_ytdlp_fallback_to_patchright`:mock ytdlp 失败 → 自动 fallback 到 patchright
- [ ] 5.5 `sau_web/frontend/src/Pages/InboxPage.test.tsx` 加 URL 自动识别 case

## 6. 验证 (Verification)

- [ ] 6.1 `pytest tests/test_inbox.py` 全绿
- [ ] 6.2 `pytest tests/` 全绿(无其它回归)
- [ ] 6.3 dev server 启动 → InboxPage 平台下拉出现 7 平台
- [ ] 6.4 粘贴 `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → 自动选 YouTube → 点下载 → 200 + mp4
- [ ] 6.5 粘贴 `https://v.douyin.com/xxx` → 自动选抖音 → 走 patchright
