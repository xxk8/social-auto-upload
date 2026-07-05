## Context

`add-web-inbox` change 已经把 inbox 路由(`/api/inbox/download` + `/api/inbox/transcribe`)和前端 AiPanel 按钮接通,形成 "粘贴链接 → 下载 → 转写 → AI 改写 → 发布" 的最小闭环。但平台覆盖只有 4 个域名(douyin/kuaishou/xiaohongshu/xhslink),且所有平台统一走 patchright browser-first。本 change 在已有基础设施上扩展平台到 8 个(增加 tiktok/baijiahao/youtube),并按平台特性选择最稳的下载路径(yt-dlp vs patchright)。

## Goals / Non-Goals

### Goals
- Inbox URL 解析支持 8 平台 13 个域名 pattern
- yt-dlp 与 patchright 双下载路径并存,按平台特性路由
- 前端粘贴 URL 自动识别平台
- 失败回落(ytdlp 失败 → patchright;patchright 失败 → ytdlp)
- 现有 5 平台行为不破

### Non-Goals
- ❌ 不实现 YouTube 内部长视频(>10min)下载(yt-dlp 限制;v0.1)
- ❌ 不做 TikTok watermark 移除(版权风险,留给第三方工具)
- ❌ 不做百家号 cookie-required 视频下载(需要登录,本 change 只下公开视频)
- ❌ 不做视频后期(转码/裁剪)— 留给 upload 前的 `obfuscate_video` 流程
- ❌ 不引入新依赖(yt-dlp 已有)

## Decisions

### D1: 双下载路径 — yt-dlp + patchright 按平台路由

**决策**: 不同平台走不同路径:
- **patchright**(已有,需 cookie): douyin / kuaishou / xiaohongshu / bilibili / tencent
  - 理由: 国内平台对未登录访问的 m3u8 段有 IP 限制 / 风控,patchright 携带 cookie 走 anti-bot 流最稳
- **yt-dlp**(新增,无 cookie 也能下): tiktok / baijiahao / youtube
  - 理由: 海外/百度系平台 yt-dlp extractor 成熟;YouTube 走 browser 必触发 anti-bot

**实现**: 统一抽象 `download_video(url, platform) -> Path`,内部按 platform 选 subprocess,失败回落到另一条路径。

**替代方案 1**: 全部走 yt-dlp — 拒绝:国内 5 平台对 m3u8 段有 cookie 鉴权,yt-dlp 不带 cookie 时下载会断流
**替代方案 2**: 全部走 patchright — 拒绝:YouTube anti-bot 严格,patchright 也下不了 1080p+

### D2: 失败回落策略 — 顺序回退,不是并行

**决策**: 主路径失败 → 试 fallback 路径;fallback 也失败 → 报 502 with last error。

```python
async def download_video(url, platform):
    primary = _DOWNLOAD_STRATEGY[platform]
    fallback = "ytdlp" if primary == "patchright" else "patchright"
    try:
        return await _download_via(url, primary)
    except DownloadError as e:
        log.warning(f"{primary} failed: {e}; trying {fallback}")
        return await _download_via(url, fallback)
```

**替代方案**: 并行下载取先到者 — 拒绝:浪费带宽,且国内平台对并发有 rate limit。

### D3: URL 自动识别按 hostname first,short-link second

**决策**: `detect_platform(url)` 先解 URL 取 hostname,匹配 `_PLATFORM_DOMAINS`;hostname 不匹配(`v.douyin.com` / `vm.tiktok.com` / `b23.tv` 等)时,对 short-link 做一次 HEAD 请求拿 redirect 后再匹配。

**理由**: short-link 在分享场景最常见(v.douyin.com / vm.tiktok.com / b23.tv / xhslink.com 都是 short-link 域名),不能漏。

**替代方案**: 全部都 HEAD redirect — 拒绝:增加 1 个 round-trip 延迟,且对未登录平台可能直接 403。

### D4: YouTube 不在 Inbox 中下长视频

**决策**: Inbox 不处理 YouTube 长视频(>10min 或 >500MB)。

**理由**:
- yt-dlp 下长视频 4K 经常 timeout(180s 不够)
- 长视频转写 Whisper API 单次 25MB 限制,得分片
- 与 v0 "短视频搬运"定位不符(本项目主线是短视频多平台分发,不是 YouTube 长视频翻译)

**实现**: 超过 500MB 的 YouTube 视频 → 502 with `video_too_large`,提示用户用 YouTube 原生下载工具 + 手动上传。

### D5: 百家号图文不算 desc

**决策**: 百家号的 `desc` capability 设为 False。

**理由**: 百家号发文界面没有独立的"description"字段,只有 title + body(从 `add_title_tags` 看,body 是合并的)。把 desc=False 让 PublishPage 自动隐藏 desc 输入框,避免用户填了不生效。

**替代方案**: 强行映射到 body — 拒绝:语义不同,会误导用户。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| yt-dlp 抖音/小红书 extractor 频繁变动(平台 anti-bot 升级) | `web_runner/utils.py` 加 `yt_dlp_min_version = "2024.10.7"` 启动时校验,过期提醒 |
| patchright 失败回落 yt-dlp 时,国内平台没带 cookie 仍会失败 | 失败时 502 + 友好 message: "请确认平台账号已登录后再试" |
| URL 短链 HEAD redirect 增加 200-500ms 延迟 | 缓存最近 100 个 short-link → platform 映射 1 小时 |
| 大视频下载超时 → 502 但 mp4 半截文件留在 .sau_uploads/ | `download_video` 失败时清理半截文件 |
| 百家号 yt-dlp 命中率 ~80%,部分视频下不到 | 失败时明确 message "百家号此视频需要登录观看" |

## Migration Plan

- **Phase 1** (Tasks 1-2): 后端 URL 识别 + 平台路由分发(零外部行为变化,只增加新平台)
- **Phase 2** (Task 3): `PLATFORM_CONFIG` 扩展(影响前端 platform 列表,需同步)
- **Phase 3** (Tasks 4-5): 前端 UI + 测试

每 Phase 可独立 merge,失败回滚成本低。

## Open Questions

- 是否要在 InboxPage 加 "批量粘贴多链接" 功能?(v0 单链接,批量留 v0.1)
- 失败时是否要 fallback 到客户端(浏览器插件下载)?— 拒绝:scope 太大
- TikTok watermark 移除是否要接?(版权风险,留 v0.1 调研)
