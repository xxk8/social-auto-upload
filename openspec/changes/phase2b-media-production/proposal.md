## Why

Phase 2a 解决了"何时发 + 发什么"的运营杠杆，但内容生产链本身仍然依赖外部工具：长视频需要用户在剪映剪好、字幕需要人工听写、封面需要自己设计。

本子变更把"切、识、封"三类操作纳入产品闭环：用户上传一段原始长视频，平台自动产出多条可直接发布的短视频 + 字幕 + 封面，节省 30-60 分钟 / 条的人工成本。

## What Changes

落地三个 capability：

- **`video-clipping`**：自动场景检测 + 切点可拖拽调整 + 一键裁剪为多条短视频
- **`auto-subtitle`**：faster-whisper 语音识别 + SRT 字幕 + 编辑 + 硬烧
- **`thumbnail-generation`**：综合评分选取最佳帧 + 文字叠加 + 水印

## Capabilities

- 新增 `video-clipping`
- 新增 `auto-subtitle`
- 新增 `thumbnail-generation`

## Impact

- **新增依赖**：`moviepy`, `scenedetect`, `faster-whisper`
- **已有依赖复用**：`Pillow`, `opencv-python`（封面生成）
- **Web API**：新增 `web_runner/routes/video_clip.py`, `subtitle.py`, `thumbnail.py` 三个蓝图
- **异步任务**：媒体处理耗时长，提交后入任务队列；SSE 推送进度
- **Frontend**：`PublishPage` 新增三个入口按钮 + 对应子页面

## Layer

- API: `web_runner/routes/video_clip.py` · `web_runner/routes/subtitle.py` · `web_runner/routes/thumbnail.py`
- Worker: 异步任务（独立进程 / 线程池）
- Frontend: `src/Pages/PublishPage.tsx`
- 模型缓存: `${DATA_DIR}/models/faster-whisper-*`

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- design.md: [`design.md`](design.md)
- 父 design.md 勘误：`web_runner/routes/inbox.py` 当前是调用 OpenAI API 而非本地 `faster-whisper`，本子变更需自行实现模型加载
