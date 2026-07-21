## Context

`sau` 项目主线是 Python CLI + 浏览器自动化(`patchright`)做发布;Web 后端(`web_runner/`)组装参数 + 任务持久化(走 `_run_sau` subprocess 调 `sau_cli`)。当前缺"物料获取"与"脚本消化"两个能力。本变更在 Web 后端 inline 落两个最小路由,**不增 CLI 子命令**(用户已显式排除 CLI 路径)。两个新路由(`/api/inbox/download`、`/api/inbox/transcribe`)通过现有 Flask `@app.before_request` auth 网关自动套上认证,无需新增鉴权逻辑。

## Goals / Non-Goals

### Goals
- 仅增 1 个新文件 + 3 处 1-3 行微改
- 1 个新依赖(`yt-dlp`);Whisper 走 OpenAI 公开 API
- 前端 1 个按钮的 UX 闭环(粘贴链接 → 下载 → 转写 → 进 AI 改写)
- 配额跟现有 `ai_generate / publish` 同架构,只多 1 个 key

### Non-Goals
- ❌ 不增任何 CLI 子命令(`cli/` 与 `sau_cli.py` 一行不动)
- ❌ 不建 `tasks` / `materials` 新表(走服务器日志够 v0)
- ❌ 不接 `PlatformExecutor` 优先级队列 / per-platform semaphore(Flask 默认 threadpool 8 够 v0)
- ❌ 不接 patchright / Douyin_TikTok_Download_API / XHS-Downloader 单点 fallback(yt-dlp 命中率已够)
- ❌ 不接本地 FunASR / WhisperX(OpenAI Whisper API 是 v0;v1.1 再本地化)
- ❌ 不开新 SSE 进度通道(`Response(generator, mimetype=text/plain)` 已够 streaming;真正 SSE 不做)
- ❌ 不加新 AI 路由(`/api/ai/enhance-prompt` 已存在 → 把 srt 直接填 `text` 字段即可)

## Decisions

### 1. yt-dlp 走 subprocess 而不是 Python API

**理由**:Python API 多 ~5 行 typed 调用 + 异常类处理;subprocess 一行 `--print after_move:filepath` 直接拿到落盘路径。Ponytail ultra:少 import、少类型、少行。

**替代**:`from yt_dlp import YoutubeDL`(拒绝: 多 ~10 行 + 复杂 error 类)

### 2. Whisper 走 OpenAI 公开 HTTP API,不走 OpenRouter

**理由**:`OPENAI_API_KEY` 是 SaaS 标准;OpenRouter 在 audio 端列了 `openai/whisper-large-v3` 等,但客户端二次适配没有任何收益。直接 `requests.post` 一个 multipart 文件最少。

**替代**:
- OpenRouter `/api/v1/audio/transcriptions`(拒绝:无收益)
- 本地 FunASR(GPU + 模型下载 2GB,v0 不上)

### 3. 沿用现有 `usage_metering.py` 三件套,加 1 行 enum

**理由**:`_ENDPOINT_ACTION_MAP + _METERED_PREFIXES + TIER_LIMITS` 已成熟;`/api/inbox/` 加进去即接入全局限额 + 配额查询端点(`/api/usage/quota`)。

**替代**:新建平行 quota middleware(拒绝:7 个文件 + 双套钩子)

### 4. 下载 + 转写串行,无 background job

**理由**:`POST /api/inbox/download` 同步返回 `{filename}`;前端拿到后发 `POST /api/inbox/transcribe`。两端各自 30-120s,Flask threadpool 8 撑并发足够。后端复杂度:0(无 Semaphore、状态机、SSE)。

**替代**:Celery / RQ / 自建 PlatformExecutor(拒绝:YAGNI;加 3 个文件 + DB schema)

### 5. 转写结果塞进 `enhance-prompt` 而非独立 AI 路由

**理由**:已有 `/api/ai/enhance-prompt {text, platform}` 可直接消费 srt 文本。新路径等同把 `textarea` 自动填充,触发现有 pipeline。多一个并行 AI 路由等于分叉 AI 侧栏的状态机。

**替代**:新增 `/api/ai/rewrite-from-srt`(拒绝:每多 1 路由 = 多 1 状机)

## Risks / Trade-offs

- **yt-dlp 抖音签名变化** → 失败时 stderr 透传给客户端 502;定期 `yt-dlp -U` 升级。
- **OpenAI 上云 ASR 的隐私** → v0 接受 OpenAI T&C;v1.1 在 AiPanel settings 加本地 FunASR toggle。
- **180s 下载超时** → 4K 大视频会触发 502;v1.1 后台化时加 long-polling。
- **无 `inbox_jobs` 表** → 重启后无法查询历史下载;v0 接受,运维从 server log 查。

## Migration Plan

- **无 schema 迁移**:`/api/inbox/*` 是全新前缀,不破坏既有路径。
- **配额**:`SAU_TIER_FREE_INBOX` 控制默认额度(20/天);Pro 用户配 `-1` 无限。
- **`OPENAI_API_KEY`** 由用户自备(`.env` 或 deployment env),缺失时 transcribe 返回 503 + 清晰 message,不静默失败。

## Open Questions

- `/api/inbox/download` 是否要支持 client-supplied `--format`(目前 yt-dlp 自动最佳)?
- `/api/inbox/transcribe` 是否要 `vtt` / `txt` 多格式(srt 默认)?
- 同一个 `OPENAI_API_KEY` 是单独给 transcribe 用,还是复用项目已有 `OPENROUTE_API_KEY`(路线 2 拒绝建议)?
