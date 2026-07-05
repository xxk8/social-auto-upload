## Why

运营者看完一条爆款短视频想搬运时,需要先下载、然后消化脚本再写入多平台发布。当前 `social-auto-upload` 只做"发布"这一半链路,缺"获取素材"和"消化脚本"这两步。本变更把这两步补全,且**只在 Web 后端落,不增 CLI 子命令**,与既有 Web UI 入口一致(用户已明确"只走 Web,不再增 CLI")。

## What Changes

- 新增 1 个蓝图 `web_runner/routes/inbox.py`(POST download + POST transcribe + GET serve 三路由,共 ~60 行)
- 微改 `web_runner/__init__.py` 注册新蓝图(1-2 行)
- 微改 `web_runner/middleware/usage_metering.py` 把 `/api/inbox/` 接入配额计数(~3 行)
- `pyproject.toml` 加 `yt-dlp` 依赖(1 行)
- 前端:`sau_web/frontend/src/Components/AiPanel/AiPanelToolbar.tsx` 加 1 个"粘贴链接"按钮,把转写后的 srt 自动塞进现有 textarea,纯复用 `<AiPanel>`

## Capabilities

### New Capabilities

- `web-inbox`: 从分享链接下载视频 + 转音频为文字(SRT),用于给"发布"链路补前两步

### Modified Capabilities

- 复用 `ai-content-generation`:转写结果直接喂进 AiPanel 的 prompt → `/api/ai/enhance-prompt`,不增新 capability
- `<AiPanel>` 加 1 按钮属于 cosmetic add-on,不形成新 capability

## Impact

- **CLI**:**零影响**(本变更刻意不增 download / transcribe 子命令)
- **Web API**:
  - 新文件:`web_runner/routes/inbox.py`
  - 修改:`web_runner/__init__.py`、`web_runner/middleware/usage_metering.py`、`pyproject.toml`
  - 配额:新增 `inbox` action,受 `SAU_TIER_FREE_INBOX` 控制(默认 20/天,Pro `-1` 无限)
- **Frontend**:修改 `<AiPanel>` toolbar 加 1 按钮+popover(粘贴 URL → 调 download → 调 transcribe → 写入提示框)
- **依赖**:`yt-dlp>=2024.10.7`(`OPENAI_API_KEY` 由用户自备,缺失时 transcribe 503)
