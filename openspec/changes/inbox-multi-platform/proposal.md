## Why

Web Inbox 路由(`web_runner/routes/inbox.py`)是从分享链接下载短视频到本地、再喂给 Whisper 转写、最后用 AI 改写并发布到多平台的核心入口。`add-web-inbox` change 已经把基础设施落地(`/api/inbox/download` + `/api/inbox/transcribe`),但支持的平台非常有限:

- `web_runner/routes/inbox.py:_BROWSER_FIRST_PLATFORMS = ("douyin.com", "kuaishou.com", "xiaohongshu.com", "xhslink.com")` — 只有 4 个域名
- `web_runner/utils.py:DESC_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "bilibili", "tencent"}` — 5 个平台
- `web_runner/utils.py:THUMBNAIL_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent"}` — 4 个
- `web_runner/utils.py:NOTE_PLATFORMS` — 仅 4 平台支持图文
- `web_runner/utils.py:_QR_LOGIN_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent", "tiktok", "baijiahao"}` — 6 平台

**结果**:
- 用户粘贴 TikTok / 百家号 / YouTube 链接到 Inbox,得到 "unsupported platform" 错误
- 实际出海创作者和 MCN 主用 TikTok + YouTube,这两个缺 = 80% 海外用户场景失效
- 百家号也是国内中长尾平台(百度搜索流量入口),缺失导致百度系流量入口断链

## What Changes

**Inbox 路由扩展**
- 在 `web_runner/routes/inbox.py` 增加 `_PLATFORM_DOMAINS` 映射,识别 7+ 平台 URL(`douyin.com / v.douyin.com / kuaishou.com / v.kuaishou.com / xiaohongshu.com / xhslink.com / bilibili.com / bilibili.tv / channels.weixin.qq.com / tiktok.com / vm.tiktok.com / baijiahao.baidu.com / youtube.com / youtu.be / m.youtube.com`)
- 每个平台走最稳的下载路径:
  - **douyin / kuaishou / xiaohongshu / bilibili / 视频号**:`_try_patchright`(已有,patchright + 平台 cookie)
  - **tiktok**:`_try_ytdlp`(TikTok 域名 yt-dlp 支持好,无 cookie 也能下)
  - **baijiahao**:`_try_ytdlp`(百度视频 yt-dlp 命中率 ~80%,不命中时回落到 browser-first)
  - **youtube**:`_try_ytdlp`(YouTube 走 browser 会触发 anti-bot)

**平台能力矩阵**
- 在 `web_runner/utils.py:PLATFORM_CONFIG` 增加 `'tiktok' / 'baijiahao' / 'youtube'` 三条:
  - tiktok: `{login: 'qr', note: False, thumbnail: False, desc: True}`
  - baijiahao: `{login: 'qr', note: False, thumbnail: False, desc: False}`(百家号发文没有 desc 字段)
  - youtube: `{login: 'manual', note: False, thumbnail: 'special', desc: True}`(YouTube 登录是 Google 账号,登录流程在 CLI 单独处理;thumbnail 是异步的,见 youtube-full-integration D3)
- 同步更新 `DESC_PLATFORMS` / `THUMBNAIL_PLATFORMS` / `NOTE_PLATFORMS` / `_QR_LOGIN_PLATFORMS` 集合

**前端 UI**
- `sau_web/frontend/src/Pages/InboxPage.tsx` 平台选择器从 PLATFORM_CONFIG 拉取,自动包含 7+ 平台,无需改业务代码
- `InboxPage` 加 "platform detected" 自动识别(粘贴 URL 后自动选中平台,无需手动选)

**测试**
- `tests/test_inbox.py` 加 `_PLATFORM_DOMAINS` URL 解析 case(每个新平台至少 2 个 URL pattern)
- `tests/test_inbox.py` 加 `_try_ytdlp` / `_try_patchright` 路由分发 case(tiktok/youtube 走 ytdlp,其它走 patchright)

## Capabilities

### New Capabilities
- `inbox-tiktok`: TikTok 链接 → yt-dlp 拉 mp4
- `inbox-baijiahao`: 百家号链接 → yt-dlp 拉 mp4(失败回落 patchright)
- `inbox-youtube`: YouTube 链接 → yt-dlp 拉 mp4
- `inbox-url-auto-detect`: 粘贴 URL 后自动识别平台

### Modified Capabilities
- `web-inbox`: `_PLATFORM_DOMAINS` 从 4 域名扩展到 13 域名;`PLATFORM_CONFIG` 从 5 平台扩到 7 平台

## Impact

- **CLI**: 无影响(Inbox 是 Web 专属)
- **Web API**:
  - `web_runner/routes/inbox.py` `_PLATFORM_DOMAINS` / 平台路由分发逻辑
  - `web_runner/utils.py` `PLATFORM_CONFIG` / `DESC_PLATFORMS` / `THUMBNAIL_PLATFORMS` / `NOTE_PLATFORMS` / `_QR_LOGIN_PLATFORMS` 集合扩展
  - `pyproject.toml` 确认 `yt-dlp>=2024.10.7` 已存在(`add-web-inbox` 引入)
- **Frontend**:
  - `sau_web/frontend/src/Pages/InboxPage.tsx` 加 URL 自动识别逻辑(粘贴 → onChange → 平台自动 select)
  - 其它 page 自动跟随 PLATFORM_CONFIG 变化
- **Database**: 无变化

## Acceptance Criteria

1. **平台识别**:
   - `https://v.douyin.com/xxx` → 识别为 douyin
   - `https://www.tiktok.com/@user/video/123` → 识别为 tiktok
   - `https://vm.tiktok.com/xxx` → 识别为 tiktok
   - `https://baijiahao.baidu.com/s?id=xxx` → 识别为 baijiahao
   - `https://www.youtube.com/watch?v=xxx` → 识别为 youtube
   - `https://youtu.be/xxx` → 识别为 youtube
   - 未知 URL → 400 with `unsupported platform`
2. **下载端到端**(需真实网络):
   - TikTok 公开视频 → 200 + mp4
   - YouTube 公开视频 → 200 + mp4(走 yt-dlp)
   - 百家号公开视频 → 200 + mp4(走 yt-dlp)
3. **单元测试**:`tests/test_inbox.py` 加 `_PLATFORM_DOMAINS` 解析 13 个 URL pattern 全通过
4. **UI 自动识别**:InboxPage 粘贴 tiktok 链接后,平台下拉自动选 "TikTok"
5. **配置扩展后不破现有**:`DESC_PLATFORMS` / `THUMBNAIL_PLATFORMS` 集合扩张不影响 douyin/xhs/ks 等现有 5 平台的现有行为
6. **测试不回归**:`pytest tests/test_inbox.py` 全绿
