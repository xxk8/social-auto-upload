# Design: Studio AI Script Generation

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (StudioDetailPage.tsx)                                 │
│                                                                  │
│  [AI 生成四幕] button → readSSEStream(url, {}, handlers)         │
│    onChunk(text)      → 更新进度文案                              │
│    onDone(full)       → 无操作（generation_done 更有用）          │
│    onGenerationDone() → invalidateQueries → 刷新 episode 列表    │
│    onError(msg)       → 显示错误 toast                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /api/studio/projects/{id}/generate
                           │ Content-Type: application/json
                           │ Body: {} (空 — 从 DB 读项目数据)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend: studio.py::generate_episodes()                         │
│                                                                  │
│  1. _current_user_id() → 鉴权                                    │
│  2. _load_project(user_id, project_id) → 加载项目                 │
│  3. 项目不存在 → 404                                              │
│  4. 调用 studio_engine.generate_episodes_sse()                    │
│  5. 在 generation_done 事件后 → _persist_generated_episodes()     │
│  6. 返回 Response(stream(), mimetype="text/event-stream")        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Engine: studio_engine.py                                        │
│                                                                  │
│  generate_episodes_sse(title, synopsis, style)                   │
│    │                                                             │
│    ├── 构造 messages (system + user prompt)                       │
│    │                                                             │
│    ├── _stream_with_fallback(messages)                            │
│    │     ├── _stream_agnes(messages)  ← PRIMARY                  │
│    │     │     └── requests.post(AGNES_BASE_URL, stream=True)    │
│    │     │         逐行解析 SSE → yield data/done/error 事件      │
│    │     │                                                        │
│    │     └── _stream_openrouter_fallback()  ← FALLBACK           │
│    │           └── 调用 ai.py::_stream_openrouter()              │
│    │                                                             │
│    ├── yield data events (streaming text chunks)                  │
│    ├── yield done event (full text)                               │
│    │                                                             │
│    ├── _parse_episodes_json(full_text) → episodes[]               │
│    │     ├── 尝试直接 JSON.loads                                   │
│    │     ├── 尝试去除 ```code fence``` 后解析                      │
│    │     └── 尝试正则提取 {..."episodes"...}                       │
│    │                                                             │
│    └── yield generation_done event (parsed episodes)              │
└─────────────────────────────────────────────────────────────────┘
```

## Key design decisions

### 1. Agnes AI primary + OpenRouter fallback

**为什么选 Agnes AI 作为主 LLM？**
- OpenAI 兼容接口，迁移成本为零（改 base URL + API key 即可）
- 免费额度足够开发和初期运营
- `agnes-2.0-flash` 是最新的 flash 模型，速度快、中文好

**为什么保留 OpenRouter 兜底？**
- Agnes AI 是新服务，稳定性未经长期验证
- OpenRouter 已在 `ai.py` 中跑了数月，key 轮转和限流逻辑成熟
- 兜底逻辑简单：Agnes 失败 → 直接 yield from `_stream_openrouter()`

**实现细节**：
```python
def _stream_with_fallback(messages, max_tokens=4000, temperature=0.7):
    if _has_agnes_key():
        # 尝试 Agnes，捕获错误事件
        error_seen = False
        for event in _stream_agnes(messages, max_tokens, temperature):
            if 'event: error' in event:
                error_seen = True
            yield event
        if not error_seen:
            return  # Agnes 成功，不走兜底
        # Agnes 失败，尝试 OpenRouter
        if _get_openrouter_key():
            yield from _stream_openrouter_fallback(messages, max_tokens, temperature)
            return
    elif _has_any_key():
        yield from _stream_openrouter_fallback(messages, max_tokens, temperature)
    else:
        yield f"event: error\ndata: {json.dumps({'message': '未配置 AI API key'})}\n\n"
```

### 2. SSE streaming (非同步阻塞)

**为什么用 SSE 而不是同步返回？**
- 前端已有 `readSSEStream()` 基础设施，零成本复用
- 流式体验：用户看到逐字生成，而不是空白等待 10-30 秒
- 与 `ai.py` 的 `_stream_openrouter()` 模式完全一致

**SSE 事件格式**（遵循项目现有约定）：
```
event: data
data: {"content": "第一幕的标题是"}

event: data
data: {"content": "《勇气的起点》"}

...

event: done
data: {"content": "完整的 LLM 输出文本（含 JSON）"}

event: generation_done
data: {"episodes": [{"act": "起", "title": "勇气的起点", "scenes": [...], "dialogues": [...]}, ...]}

event: error
data: {"message": "API key 无效"}
```

**前端事件映射**：
| SSE event | 前端 handler | 行为 |
|-----------|-------------|------|
| `data` | `onChunk` | 更新进度文案（可选：显示实时文本） |
| `done` | `onDone` | 无操作（generation_done 更有用） |
| `generation_done` | `onGenerationDone` | 刷新 episodes 列表 |
| `error` | `onError` | 显示错误 toast |

### 3. Episodes 在流结束后持久化

**为什么不在流式过程中逐条插入？**
- 原子性：4 幕要么全部插入，要么全部不插入（半插入状态对用户无意义）
- 简单性：流式过程中只收集文本，解析 + 插入只做一次
- 复用性：`_persist_generated_episodes()` 复用 `create_project_episodes()` 的事务模式

**持久化流程**：
1. 流式完成后，`generation_done` 事件携带解析好的 `episodes[]`
2. `_persist_generated_episodes()` 在一个事务中：
   - 查询 `MAX(episode_no)` 确定起始编号
   - 逐条 INSERT（跳过无效 act）
   - UPDATE `studio_projects.updated_at`
3. 如果事务失败，所有 INSERT 自动回滚

### 4. Prompt 设计

**系统提示词**（`SYSTEM_PROMPT`，~40 行）：

```python
SYSTEM_PROMPT = """你是一位专业的短视频剧本编剧。根据用户提供的故事梗概，生成四幕结构的短视频分集剧本。

四幕结构说明：
- 起（开端）：介绍主角和背景，建立世界观，设置悬念或冲突的起点
- 承（发展）：推进剧情，深化矛盾，角色面临挑战或抉择
- 转（转折）：剧情出现意外转折，高潮前的关键反转或突破
- 合（结局）：解决冲突，收束故事，留下余韵或启示

每一幕生成一个分集，包含：
1. 集标题（简洁有力，10-15字）
2. 场景列表（每个场景包含场景描述、画面提示、时长建议）
3. 台词列表（角色对白或旁白）

输出格式要求（严格JSON）：
你必须返回一个JSON对象，格式如下：
{
  "episodes": [
    {
      "act": "起",
      "title": "集标题",
      "scenes": [
        {"title": "场景名", "body": "场景描述", "duration_sec": 3}
      ],
      "dialogues": [
        {"speaker": "角色名", "text": "台词内容"}
      ]
    },
    {"act": "承", ...},
    {"act": "转", ...},
    {"act": "合", ...}
  ]
}

注意事项：
- 每幕2-4个场景，每场景3-5秒画面
- 台词简短有力，适合短视频节奏
- 场景描述要具体，包含画面元素（人物、动作、环境）
- 整体故事要有起承转合的完整弧线
- 语言自然生动，适合中国社交媒体平台"""
```

**用户提示词**（动态构造）：
```
项目标题：{title}

故事梗概：{synopsis}

视觉风格：{style}  ← 仅在 style 非空时包含
```

**JSON 解析策略**（`_parse_episodes_json()`，3 级降级）：
1. **直接解析**：`json.loads(text)` → 检查是否有 `episodes` 键
2. **去 code fence**：去除 ``` ```json ... ``` ``` 后再解析
3. **正则提取**：`re.search(r'\{[\s\S]*"episodes"[\s\S]*\}', text)` 提取 JSON 子串

### 5. 错误处理策略

| 错误场景 | 处理方式 | 用户看到 |
|---------|---------|---------|
| `AGNES_API_KEY` 未设置 + 无 OpenRouter key | 返回 error 事件 | "未配置 AI API key，请在 .env 设置 AGNES_API_KEY" |
| Agnes API 返回 4xx/5xx | 降级到 OpenRouter | 无感切换，用户看到正常生成 |
| Agnes API 超时 (120s) | 降级到 OpenRouter | 同上 |
| OpenRouter 也失败 | 返回 error 事件 | "AI 服务暂时不可用，请稍后重试" |
| LLM 返回非 JSON / 无法解析 | 返回 error 事件 | "AI 生成结果格式异常，请重试" |
| LLM 返回的 act 不在 {起,承,转,合} | 跳过无效 episode | 只插入有效的 episodes（可能少于 4 幕） |
| DB 事务失败 | 自动回滚 | "episodes 写入失败，请稍后重试" |
| 用户未登录 | 401 | "未登录" |
| 项目不存在 | 404 | "项目不存在" |
| 项目不属于当前用户 | 404 | "项目不存在"（owner 隔离） |

## API contract

### Request

```
POST /api/studio/projects/{id}/generate
Content-Type: application/json
Cookie: session=...

Body: {}  (空对象 — 项目数据从 DB 读取)
```

### Response (SSE stream)

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no

event: data
data: {"content": "根据梗概"}

event: data
data: {"content": "，我为你构思了一个关于勇气的故事…"}

...

event: done
data: {"content": "完整 JSON 输出文本"}

event: generation_done
data: {"episodes": [
  {"act": "起", "title": "勇气的起点", "scenes": [...], "dialogues": [...]},
  {"act": "承", "title": "挑战来临", "scenes": [...], "dialogues": [...]},
  {"act": "转", "title": "意外转折", "scenes": [...], "dialogues": [...]},
  {"act": "合", "title": "圆满结局", "scenes": [...], "dialogues": [...]}
]}
```

### Error response (non-SSE, HTTP 4xx/5xx)

```json
{"success": false, "message": "项目不存在"}
```

## Database impact

**无 schema 变更**。复用现有 `studio_episodes` 表：
- `act` 字段：写入 "起"/"承"/"转"/"合"（与手动添加一致）
- `scenes_json` / `dialogues_json`：JSON 字符串（与手动添加一致）
- `episode_no`：自动递增（与手动添加一致）
- `status`：默认 "draft"（与手动添加一致）

**唯一新增**：`studio_projects.updated_at` 在生成完成后被 UPDATE（已有列，无 ALTER）。

## File responsibilities

| File | Role | Key functions |
|------|------|---------------|
| `web_runner/studio_engine.py` | LLM 调用、prompt 构造、JSON 解析 | `generate_episodes_sse()`, `_stream_agnes()`, `_parse_episodes_json()` |
| `web_runner/routes/studio.py` | HTTP 端点、鉴权、DB 持久化 | `generate_episodes()`, `_persist_generated_episodes()` |
| `sau_web/frontend/src/api/sse.ts` | SSE 事件类型路由 | `readSSEStream()` switch 增加 `generation_done` case |
| `sau_web/frontend/src/api/studio.ts` | API URL 构造 | `generateEpisodes(projectId)` |
| `sau_web/frontend/src/Pages/StudioDetailPage.tsx` | UI 按钮 + 流式进度展示 | `handleGenerateEpisodes()`, 空状态按钮 |
| `.env.example` | 环境变量文档 | `AGNES_API_KEY` 说明 |
