## 1. CLI 平台模块 (CLI)

- [ ] 1.1 新建 `cli/platforms/youtube.py`,实现 `login(account_name, headless, qrcode_callback=None)` / `check(account_name) -> bool` / `upload_video(request)`,参照 `cli/platforms/tiktok.py` 模板
- [ ] 1.2 `upload_video` 构造 `YouTubeVideo(title, file_path, tags, account_file, description=desc, visibility=request.visibility or "public", headless=request.headless)`,然后 `await uploader.main()`
- [ ] 1.3 `login` 直接 await `youtube_setup(account_file, handle=True, return_detail=True, headless=False)`(YouTube 必须有头,沿用 uploader 内部约定)
- [ ] 1.4 `check` 直接 await `cookie_auth(account_file)`
- [ ] 1.5 在 `cli/dispatchers.py:PLATFORM_REGISTRY` 加 `'youtube': _dispatch_youtube` 入口
- [ ] 1.6 在 `sau_cli.py` 加 `from cli.platforms.youtube import login as login_youtube_account` 等 3 个 re-export(同其它平台格式,即使本 change 砍 shim 趋势,这部分维持兼容)

## 2. CLI Parser 接入 (CLI)

- [ ] 2.1 在 `cli/parser.py:PLATFORM_PARSER_CONFIG`(承接 `cli-uploader-architecture-consistency` change 的注册表)加 `youtube` 条目:
      - has_note=False
      - upload_video_args 含 `--visibility public|unlisted|private` choice 参数
      - has_upload_video=True / has_check=True / has_login=True
- [ ] 2.2 验证 `sau youtube --help` 与 `sau tiktok --help` 格式一致

## 3. Web API — AI 多平台 (Web API)

- [ ] 3.1 `web_runner/routes/ai.py:SUPPORTED_PLATFORMS` 加 `'youtube'`
- [ ] 3.2 `web_runner/routes/ai.py:PLATFORM_STYLE_PROMPTS` 加 youtube 风格 prompt 字符串(英文口播、hook 优先、tags 多、end screen 提示)
- [ ] 3.3 `tests/test_ai_multi_platform.py` 的 `expected` 集合加 `'youtube'`
- [ ] 3.4 `pytest tests/test_ai_multi_platform.py` 验证新 prompt 不空且 7 平台 prompt 唯一

## 4. Web API — Upload 路由 (Web API)

- [ ] 4.1 `web_runner/routes/upload.py` upload-video handler 加 YouTube 分支:request 解析 `visibility` 字段
- [ ] 4.2 `_resolve_uploader` 工厂函数加 `platform == "youtube"` 路径
- [ ] 4.3 验证 `POST /api/upload/video` 接受 `{platform: "youtube", visibility: "unlisted", ...}` 请求
- [ ] 4.4 `tests/test_sau_web_upload.py` 加 YouTube video 上传 case(本地无 cookie 跳过实际执行,只验证 route 不 500)

## 5. Web API — Inbox 路由 (Web API)

- [ ] 5.1 `web_runner/routes/inbox.py:_BROWSER_FIRST_PLATFORMS` 不加 youtube(youtube 走 yt-dlp)
- [ ] 5.2 `web_runner/routes/inbox.py` yt-dlp extractor 调用处加 youtube domain 检查(`youtube.com` / `youtu.be`),YouTube 走 `_try_ytdlp` 而不是 `_try_patchright`
- [ ] 5.3 `tests/test_inbox.py` 加 `test_inbox_youtube_url_routes_to_ytdlp` case
- [ ] 5.4 `web_runner/utils.py:DESC_PLATFORMS` 加 `'youtube'`(YouTube 有 description 字段,支持)
- [ ] 5.5 `web_runner/utils.py:NOTE_PLATFORMS` / `THUMBNAIL_PLATFORMS` 不加(YouTube 不支持图文,thumbnail 流程特殊)

## 6. 前端 PLATFORMS 列表 (Frontend)

- [ ] 6.1 `sau_web/frontend/src/api/client.ts:PLATFORMS` 加 youtube PlatformOption:
      ```ts
      { value: 'youtube', label: 'YouTube', icon: YoutubeIcon, accent: '#FF0000' }
      ```
- [ ] 6.2 `sau_web/frontend/src/Components/CliCommand.tsx:KNOWN_PLATFORMS` 加 `'youtube'`
- [ ] 6.3 `sau_web/frontend/src/Components/ui/platform-icon.tsx` 新增 YouTube 图标(若尚未存在,沿用 lucide-react 已有 `Youtube` icon)
- [ ] 6.4 验证 `sau_web/frontend/src/Pages/PublishPage.tsx` 平台选择器自动出现 YouTube(无需业务代码改动,只跟随 PLATFORMS)
- [ ] 6.5 `tests/web_shell.py` 验证 `?platform=youtube` API 调用路径走通

## 7. Skill 安装 (CLI / Skill)

- [ ] 7.1 新建 `skills/youtube-upload/SKILL.md`,内容包含:
      - Purpose: 在 YouTube 自动发布视频(避开 API 强制 private 限制)
      - Commands: `sau youtube login/check/upload-video`
      - Examples: 命令行 + Web Shell 双路径
      - Gotchas: 必须 headed(headless 会被 Google 拦截);需要真实 Google 账号;visibility 默认 public;受平台风控影响
- [ ] 7.2 验证 `sau skill install` 能识别并复制

## 8. 文档 (Docs)

- [ ] 8.1 `docs/CLI.md` 表格加 YouTube 行 + 简述 API 限制原因(交叉引用 uploader 注释)
- [ ] 8.2 `docs/install.md` 加 YouTube 特殊说明(headed 模式)
- [ ] 8.3 `README.md` "Supported platforms" 列表加 YouTube

## 9. 验证

- [ ] 9.1 `pytest tests/` 全绿
- [ ] 9.2 `sau youtube --help` 与 `sau tiktok --help` 格式一致
- [ ] 9.3 Web Shell dev server 启动,AccountsPage / PublishPage 平台列表含 YouTube
- [ ] 9.4 AI 多平台生成端到端 smoke:`POST /api/ai/generate/multi-platform {platforms: ["youtube", "douyin"]}` 200 + 双平台结果
