## Context

Phase 2b 补全内容生产链：用户上传一段长视频或视频素材，平台可以自动产出多条短视频 + 字幕 + 封面。父 umbrella `product-roadmap-2026q3` 把这一 Phase 命名为"内容生产链"，对应"切、识、封"三类操作。

继承自 umbrella 的关键技术决策（保留不变）：

- 切片用 `scenedetect`（场景检测）+ `moviepy`（裁剪执行）
- 字幕用 `faster-whisper`（语音识别），**注意**：父 umbrella design.md 中"复用 Inbox 的 Whisper 模型加载逻辑"这一说法不正确——`web_runner/routes/inbox.py` 当前调用的是 OpenAI API 而非本地 `faster-whisper`；本子变更需自行实现模型加载与缓存（建议按 CTranslate2 + 内存 + 磁盘双层缓存）
- 封面用项目已有依赖 `Pillow` + `opencv-python`，不新增依赖

## Goals / Non-Goals

**Goals:**

- 任意 mp4 / mov 长视频可在 ≤ 1/3 视频时长时间内完成场景切片（PoC 性能预算）
- faster-whisper 首次启动 ≤ 30 秒（模型下载 + 加载），后续启动 ≤ 5 秒（磁盘缓存命中）
- 字幕生成后支持二次编辑，最终硬烧或作为软字幕发布

**Non-Goals:**

- 不实现 GPU 加速（faster-whisper CPU 模式即可，避免服务器部署复杂度）
- 不实现 4K / HDR 处理（限制 1080p SDR）
- 不实现 GPU 推理服务（保持单进程内嵌，避免引入 Triton / vLLM 等）

## Decisions

### 1. 媒体处理：异步任务 + SSE 进度

**决定**: 切片 / 字幕 / 封面都走"提交任务 → 异步 worker 处理 → SSE 推送进度 → 完成后回调"模型。worker 独立进程，Flask 主进程通过任务队列解耦。

**理由**: 单个视频处理可能 30 秒 ~ 数分钟，HTTP 同步请求会超时；异步任务可被前端 Task 列表复用。

### 2. 模型缓存：内存 + 磁盘双层

**决定**: faster-whisper 模型加载一次后驻留内存（LRU 策略，限制内存上限）；磁盘缓存到 `${DATA_DIR}/models/` 避免重复下载。

**理由**: CTranslate2 模型加载耗时 5-30 秒；冷启动期远多于热路径，避免每次都重新加载。

### 3. 切点可调整

**决定**: 自动检测的切点列表在前端展示为可拖拽时间轴；用户调整后再触发实际裁剪。

**理由**: scenedetect ContentDetector 在综艺 / 直播录屏上切点可能过于密集；人工微调是必走路径。

### 4. 封面帧选择：综合评分

**决定**: 提取 N 个候选帧（按时间均匀采样），按"清晰度 + 信息量 + 居中度"加权评分，选 Top 1；评分逻辑后续可调参数。

**理由**: 单一指标（如拉普拉斯方差）不够鲁棒；复合指标覆盖更多失败模式。

## Risks / Trade-offs

- **OOM 风险** → 分段加载视频、流式处理切片
- **scenedetect 切点不准** → 前端可拖拽调整 + 手动模式
- **faster-whisper 模型下载失败** → 启动期检测 + 友好错误提示 + 文档说明手动下载方式
- **CPU 占用过高** → 限制并发 worker 数 + 用户可见进度

## Open Questions

- 字幕硬烧走 ffmpeg 还是 moviepy？（性能 vs 灵活性 trade-off）
- 封面候选帧数量 N 默认多少？（N=10 是合理起点）

## Reference

- 父 umbrella: [`product-roadmap-2026q3`](../../product-roadmap-2026q3/)
- 兄弟子变更: [`phase1-content-publish-loop`](../../phase1-content-publish-loop/) · [`phase2a-publish-intelligence`](../../phase2a-publish-intelligence/) · [`phase3-trust-and-monitoring`](../../phase3-trust-and-monitoring/) · [`phase4-collab-and-monetization`](../../phase4-collab-and-monetization/)
- 新增依赖: `moviepy`, `scenedetect`, `faster-whisper`
- 已有依赖复用: `Pillow`, `opencv-python`
- 父 design.md 勘误: "复用 Inbox 的 Whisper 模型加载逻辑" 表述错误，本子变更需自行实现
