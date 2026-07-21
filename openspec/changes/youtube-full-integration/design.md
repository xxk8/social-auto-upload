## Context

YouTube uploader (`uploader/youtube_uploader/main.py`) 完整且经过生产验证,代码顶部有详细 rationale 解释为什么用 browser automation 而非 YouTube Data API(Data API 项目上传的视频强制 private,需要 Google 合规审核才能公开;browser automation 没有这个限制)。但 uploader 是孤岛 — CLI/前端/AI/Inbox/Skill 五层都没接入。本 change 把 YouTube 完整接入,使其达到与 douyin/xhs/ks/bilibili 相同的"开箱即用"地位。

## Goals / Non-Goals

### Goals
- YouTube 接入 CLI/前端/AI/Inbox/Skill 五层,达到与 7 个现有平台一致的 UX
- 文档化"YouTube 为什么不用 API" 的设计决策(交叉引用到 uploader 注释)
- 单平台 5 处接入 ≤ 150 行总代码

### Non-Goals
- ❌ 不实现 YouTube note / 短图文(YouTube 没有 note 产品形态)
- ❌ 不接入 YouTube playlist 自动管理(uploader 已支持,但本 change 不接 Web Shell UI)
- ❌ 不接 YouTube Analytics API(YouTube Studio 分析数据)
- ❌ 不实现 YouTube Shorts 单独处理(走同一个 `upload_video` 流程)
- ❌ 不引入新依赖

## Decisions

### D1: YouTube 走 yt-dlp 而非 browser-first 下载

**决策**: `web_runner/routes/inbox.py` 中 YouTube URL 走 `_try_ytdlp` 而非 `_try_patchright`。

**理由**: YouTube 的 m3u8 / DASH 段流复杂,video_id-extractor 体系成熟(yt-dlp 有 80+ YouTube extractor 变体),browser 自动化下载 YouTube 视频会:
- 被 YouTube anti-bot 检测拦截
- 拿不到高码率(只能 360p)
- cookie 过期快
- 速度慢 5-10x

**替代方案**:browser-first(与 douyin/xhs/ks 一致) — 拒绝:YouTube anti-bot 严格得多。

### D2: YouTube 不在 PLATFORM_REGISTRY 的 publish_strategy 控制中

**决策**: `cli/platforms/youtube.py:upload_video` 不接受 `--schedule` 参数,YouTube 视频始终立即发布。

**理由**: YouTube Studio 的"定时发布"是 Scheduled Video 功能,需要 video 先上传 + processing 完成后才能 schedule。这个流程与抖音/小红书的"上传时直接 schedule"语义不同,强制对齐会丢失功能。v0 只支持立即发布,定时发布留到 v0.1。

**替代方案**: 加 `scheduled_at` 字段 + YouTube API call — 拒绝:本 change 的 scope 是接入,不是新功能。

### D3: YouTube 不在 `THUMBNAIL_PLATFORMS` / `NOTE_PLATFORMS` 中

**决策**: `web_runner/utils.py:THUMBNAIL_PLATFORMS` / `NOTE_PLATFORMS` 不加 youtube。

**理由**:
- THUMBNAIL: YouTube 已有 thumbnail 流程(uploader 的 `thumbnail_path` 参数),但它要求 video 处理完成后才能传(Async 异步),与抖音/小红书的"上传时一并传"语义不同。v0 暂不接 Web Shell 的 thumbnail UI。
- NOTE: YouTube 没有 note/图文产品形态。

**替代方案**: 在 Web Shell 加 YouTube 专属 thumbnail UI — 拒绝:scope 太大,本 change 只做接入。

### D4: YouTube 走 `headless=False` 登录

**决策**: `cli/platforms/youtube.py:login` 强制 `headless=False`。

**理由**: uploader 内的 `youtube_cookie_gen` 注释已经说明:Google 登录必须显形,需要用户输账号密码 + 2FA。沿用 uploader 的现有约定,不在 CLI 层覆盖。

**替代方案**: 让用户传 `--headless` flag — 拒绝:headless 登录必然失败,显形 flag 是隐性坑。

### D5: YouTube AI prompt 走"英文口播风"

**决策**: `web_runner/routes/ai.py:PLATFORM_STYLE_PROMPTS["youtube"]` = 英文口播风,强调:
- Hook in first 5 seconds
- SEO-friendly title (60 chars max, keywords front-loaded)
- Description with timestamps + tags + links
- Tags: 5-8 broad tags + 3-5 long-tail
- End screen + cards mention
- Pacing: 6-8 second scene changes for retention

**替代方案**: 中文 prompt — 拒绝:YouTube 主用户英文,中文 prompt 输出中文标题会严重降 SEO。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| YouTube uploader 用了 `channel="chrome"`(系统 Chrome)而非 bundled chromium — 在没有 Chrome 的服务器上跑会失败 | docs 注明 "需要本地 Chrome 浏览器" |
| YouTube cookie 有效期比国内平台短(7-30 天),失败率高 | 后续 `account-health-monitoring` change 解决(本 change 不动) |
| `visibility=unlisted/private` 参数与现有 upload 路由 schema 不匹配 | 在 upload 路由单独加 platform-specific 解析,不影响其它平台 |
| YouTube 不支持图文 → PublishPage "上传图文"按钮对 YouTube 仍可见,需要禁用 | Frontend 加 `platform.note` capability 判断,见 D3 |

## Migration Plan

- **Phase 1** (Tasks 1-2): CLI 接入(零外部影响,可独立 merge)
- **Phase 2** (Tasks 3-5): Web API 接入(AI / upload / inbox)
- **Phase 3** (Tasks 6-7): 前端 / Skill 接入
- **Phase 4** (Tasks 8-9): 文档 + 验证

每 Phase 可独立 revert。建议 Phase 1 + 2 先合并,Phase 3 跟随后,Phase 4 收尾。

## Open Questions

- YouTube 视频上传最大文件 256GB,但本项目前端 `<input type=file>` 没限大小,后端 multipart 也没限 — 是否需要加 file size 校验?留到 v0.1。
- YouTube 登录需要 Google 账号,在国内开发者机器上不便测试 — 是否需要 mock login endpoint 模拟?(仿照 `SAU_MOCK_AUTHORIZE`)— 留到 v0.1。
- YouTube channel 切换(同一 cookie 多 channel)— 现有 `cli/account_name` 模型只有单 account,是否要加 `channel_id` 参数?— 留到 v0.1。
