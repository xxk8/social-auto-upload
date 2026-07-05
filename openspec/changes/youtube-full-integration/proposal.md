## Why

YouTube 平台的 uploader(`uploader/youtube_uploader/main.py`)在历史上是完整实现的,代码内有显式注释解释为什么不用官方 YouTube Data API(API 项目上传的视频强制 private,需要通过 Google 合规审核才能公开,而 browser automation 没有这个限制)。但 YouTube 在另外四层(CLI/前端/AI/Inbox/Skill)都是缺失的:

- `cli/platforms/` 没有 `youtube.py`,`cli/parser.py` 没有 `_add_youtube_parser`
- `cli/dispatchers.py:PLATFORM_REGISTRY` 没有 `'youtube'`
- `web_runner/routes/ai.py:SUPPORTED_PLATFORMS = {"douyin", "xiaohongshu", "kuaishou", "bilibili", "tencent", "tiktok", "baijiahao"}` 缺 youtube
- `web_runner/utils.py:DESC_PLATFORMS` / `THUMBNAIL_PLATFORMS` / `NOTE_PLATFORMS` / `_QR_LOGIN_PLATFORMS` 没有 youtube
- `sau_web/frontend/src/api/client.ts:PLATFORMS` 没有 youtube
- `sau_web/frontend/src/Components/CliCommand.tsx:KNOWN_PLATFORMS` 没有 youtube
- `skills/` 没有 `youtube-upload/SKILL.md`
- `tests/test_ai_multi_platform.py` 的 `expected = {"douyin", "xiaohongshu", ...}` 也不含 youtube

这意味着:
- 用户不能用 Web Shell / CLI / Skill 在 YouTube 上传
- AI 多平台生成不能为 YouTube 输出定制 prompt
- Inbox 不能下载 YouTube 链接
- Frontend AccountsPage 看不到 YouTube 账号

而 YouTube 是出海创作者的最大平台,缺这个 = 失去 30%+ 目标用户。

## What Changes

**CLI 接入**
- 新增 `cli/platforms/youtube.py`,实现 `login` / `check` / `upload_video` 三个函数,签名为标准 dispatcher 接口
- 在 `cli/parser.py` 加 `_add_youtube_parser`,加入 PLATFORM_PARSER_CONFIG 注册表
- 在 `cli/dispatchers.py:PLATFORM_REGISTRY` 加 `'youtube': _dispatch_youtube`

**前端接入**
- `sau_web/frontend/src/api/client.ts:PLATFORMS` 加 `youtube` PlatformOption(logo/icon/label 复用现有 YouTube SVG 资产,无则新增)
- `sau_web/frontend/src/Components/CliCommand.tsx:KNOWN_PLATFORMS` 加 `'youtube'`
- `sau_web/frontend/src/Pages/PublishPage.tsx` 自动从 `PLATFORMS` 拉取,无需改业务代码
- `sau_web/frontend/src/Pages/AccountsPage.tsx` 同步自动可见

**Web API 接入**
- `web_runner/routes/ai.py:SUPPORTED_PLATFORMS` 加 `'youtube'`
- `web_runner/routes/ai.py:PLATFORM_STYLE_PROMPTS` 加 youtube 专属 prompt(口播风、有 hook、optimize for retention、英文为主)
- `web_runner/utils.py:DESC_PLATFORMS` / `THUMBNAIL_PLATFORMS` 视情况加(YouTube 有 desc 字段但流程不同 — 见 design D3)
- `web_runner/routes/upload.py` 加 YouTube video 上传分支(需要支持 YouTube 特有的 `visibility` 参数:public / unlisted / private)
- `web_runner/routes/inbox.py` 加 youtube 域名到 `_BROWSER_FIRST_PLATFORMS` 或 yt-dlp extractor 列表(YouTube 走 yt-dlp 比 browser-first 稳)

**Skill 接入**
- 新建 `skills/youtube-upload/SKILL.md`,描述 `sau youtube login/upload-video/check` 工作流(对齐已有 SKILL.md 模板:purpose / commands / examples / gotchas)

**测试**
- `tests/test_sau_browser_cli.py` 加 YouTube 平台分支
- `tests/test_ai_multi_platform.py` 的 `expected` 集合加 `'youtube'`
- `tests/test_web_shell.py` 加 `?platform=youtube` 路径

## Capabilities

### New Capabilities
- `youtube-platform-cli`: `sau youtube login/check/upload-video` 三命令,签名对齐其它 7 平台
- `youtube-platform-web`: Web Shell 可见 YouTube 账号 + PublishPage 平台选择器含 YouTube
- `youtube-ai-style-prompt`: AI 多平台生成支持 youtube 风格 prompt(英文口播、SEO 优先)
- `youtube-inbox-download`: 粘贴 YouTube 链接 → yt-dlp 拉 mp4 → 进 inbox 转写
- `youtube-skill`: SKILL.md 安装后,Claude Code 可调 `sau youtube ...` 工作流

### Modified Capabilities
- `ai-content-generation`: `SUPPORTED_PLATFORMS` 加 youtube
- `web-inbox`: YouTube 走 yt-dlp 而非 browser-first

## Impact

- **CLI**:
  - 新增 `cli/platforms/youtube.py` (~50 行,参照 `cli/platforms/tiktok.py` 模板)
  - `cli/parser.py` `PLATFORM_PARSER_CONFIG` 加一段 (~20 行)
  - `cli/dispatchers.py` 加一行注册
- **Web API**:
  - `web_runner/routes/ai.py` SUPPORTED_PLATFORMS + PLATFORM_STYLE_PROMPTS 加 youtube (~15 行)
  - `web_runner/utils.py` PLATFORM_CONFIG 加 youtube (有 desc 但无 note/thumbnail,见 design)
  - `web_runner/routes/upload.py` 加 YouTube video upload 分支 (~40 行,处理 visibility 字段)
  - `web_runner/routes/inbox.py` yt-dlp extractor 列表加 youtube
- **Frontend**:
  - `sau_web/frontend/src/api/client.ts` PLATFORMS 加 youtube PlatformOption
  - `sau_web/frontend/src/Components/CliCommand.tsx` KNOWN_PLATFORMS 加 'youtube'
  - 其它前端 page (AccountsPage / PublishPage / InboxPage) 自动跟随 PLATFORMS 变化,无业务代码改动
- **Database**: 无变化
- **Dependencies**: 无新增

## Acceptance Criteria

1. **CLI**:
   - `sau youtube --help` 输出包含 login / check / upload-video 三个 subcommand
   - `sau youtube login --account <name>` 调用 `youtube_setup` 走交互式 Google 登录(headless=False,需要真实账号)
   - `sau youtube check --account <name>` 返回 valid / invalid
   - `sau youtube upload-video --account <name> --file <mp4> --title <text> [--tags ...] [--visibility public|unlisted|private]` 调用 `YouTubeVideo(...).upload(playwright)`
2. **AI 多平台生成**:`POST /api/ai/generate/multi-platform` 接受 `platforms: ["youtube"]`,返回结果带 youtube 风格 prompt
3. **前端 AccountsPage**:`/app/accounts` 平台过滤下拉框出现 "YouTube" 选项,无 YouTube cookie 时显示空态
4. **前端 PublishPage**:平台选择器出现 YouTube,选项带 YouTube icon
5. **Inbox 下载**:粘贴 `https://www.youtube.com/watch?v=...` 链接 → 200 + mp4 文件名
6. **Skill**:`sau skill install` 复制 `skills/youtube-upload/SKILL.md` 到 `~/.claude/skills/`,Claude Code 可识别
7. **测试不回归**:`pytest tests/` 全绿;`tests/test_ai_multi_platform.py` 的 `SUPPORTED_PLATFORMS` snapshot 更新
8. **文档**:`docs/CLI.md` 表格加 YouTube 行
