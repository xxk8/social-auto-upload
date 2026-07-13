# Tasks — studio-ai-script-generation

> 预估总工时：3-4 天（后端 1.5 天，前端 1 天，测试 0.5 天，联调 0.5 天）

## 1. Backend: studio_engine.py（新建）

- [ ] **1.1** 创建 `web_runner/studio_engine.py` 模块骨架
  - [ ] 模块 docstring（Phase 2 说明）
  - [ ] imports: `json`, `os`, `re`, `requests`, `utils.log.logger`
  - [ ] 常量: `AGNES_BASE_URL`, `AGNES_MODEL`, `OPENROUTER_FALLBACK_MODEL`
  - [ ] 常量: `AGNES_CHAT_ENDPOINT = f"{AGNES_BASE_URL}/chat/completions"`

- [ ] **1.2** 实现 SYSTEM_PROMPT
  - [ ] 4-幕结构说明（起承转合各一句话描述）
  - [ ] 输出格式规范（严格 JSON schema）
  - [ ] 约束条件（每幕 2-4 场景、台词简短、中文）
  - [ ] 总计约 40 行，写在模块顶部作为常量

- [ ] **1.3** 实现 key 管理函数
  - [ ] `_get_agnes_key() -> str` — 读取 `os.environ.get("AGNES_API_KEY", "")`
  - [ ] `_has_agnes_key() -> bool` — `bool(_get_agnes_key().strip())`
  - [ ] `_get_openrouter_key() -> str` — 调用 `ai.py::_get_next_key()`
  - [ ] `_has_any_key() -> bool` — 任一 key 可用

- [ ] **1.4** 实现 `_stream_agnes()` SSE generator
  - [ ] 构造 payload: `model`, `messages`, `max_tokens`, `temperature`, `stream: True`
  - [ ] `requests.post()` with `stream=True`, timeout `(10, 120)`
  - [ ] 逐行解析 `resp.iter_lines()`
  - [ ] 提取 `choices[0].delta.content` → yield `event: data`
  - [ ] 完成后 yield `event: done` with full_content
  - [ ] 异常处理: `RequestException`, `TimeoutError`, `JSONDecodeError` → yield `event: error`
  - [ ] HTTP 非 200 → 提取 error message → yield `event: error`

- [ ] **1.5** 实现 `_stream_with_fallback()` 
  - [ ] 优先调用 `_stream_agnes()`
  - [ ] 检测 `event: error` → 降级到 `_stream_openrouter_fallback()`
  - [ ] 无 Agnes key → 直接走 OpenRouter
  - [ ] 无任何 key → yield `event: error` "未配置 AI API key"

- [ ] **1.6** 实现 `_parse_episodes_json()`
  - [ ] 策略 1: 直接 `json.loads(text)` → 检查 `data["episodes"]`
  - [ ] 策略 2: 去除 ``` ```json ... ``` ``` 后解析
  - [ ] 策略 3: `re.search(r'\{[\s\S]*"episodes"[\s\S]*\}', text)` 提取子串
  - [ ] 全部失败 → 返回 `None`

- [ ] **1.7** 实现 `generate_episodes_sse()` 主入口
  - [ ] 构造 user_msg: 标题 + 梗概 + 风格（可选）
  - [ ] 构造 messages: `[system_prompt, user_msg]`
  - [ ] yield from `_stream_with_fallback()`
  - [ ] 收集 full_text → 调用 `_parse_episodes_json()`
  - [ ] 解析成功 → yield `event: generation_done` with episodes
  - [ ] 解析失败 → yield `event: error` "AI 生成结果格式异常"

## 2. Backend: studio.py generate endpoint（编辑）

- [ ] **2.1** 在 studio.py 顶部添加 import
  - [ ] `from web_runner.studio_engine import generate_episodes_sse`
  - [ ] `from flask import Response` (如果尚未 import)

- [ ] **2.2** 实现 `POST /api/studio/projects/<id>/generate` 路由
  - [ ] `_current_user_id()` 鉴权 → None 返回 401
  - [ ] `_load_project(user_id, project_id)` → None 返回 404
  - [ ] 检查项目是否已有 episodes（可选：允许覆盖 or 拒绝）
  - [ ] 定义 `stream()` 内部生成器
  - [ ] 在 `generation_done` 事件中提取 episodes_data
  - [ ] 调用 `_persist_generated_episodes()`
  - [ ] 返回 `Response(stream(), mimetype="text/event-stream", headers=...)`

- [ ] **2.3** 实现 `_persist_generated_episodes()`
  - [ ] `_VALID_ACTS = {"起", "承", "转", "合"}` — 过滤无效 act
  - [ ] `db.transaction()` 事务块
  - [ ] `COALESCE(MAX(episode_no), 0) + i + 1` 计算 episode_no
  - [ ] 逐条 `INSERT INTO studio_episodes` (复用现有列结构)
  - [ ] `UPDATE studio_projects SET updated_at = ?` bump 时间戳
  - [ ] 异常处理: log + 静默失败（流已完成，不影响前端）

## 3. Frontend: SSE event types（编辑）

- [ ] **3.1** `sau_web/frontend/src/api/sse.ts`
  - [ ] 在 `SSEHandlers` interface 中添加:
    ```typescript
    onGenerationDone?: (data: { episodes: unknown[] }) => void
    ```
  - [ ] 在 `readSSEStream()` 的 switch 中添加:
    ```typescript
    case 'generation_done':
      handlers.onGenerationDone?.(data)
      break
    ```

## 4. Frontend: API method（编辑）

- [ ] **4.1** `sau_web/frontend/src/api/studio.ts`
  - [ ] 添加 `generateEpisodes(projectId: number)` 方法
  - [ ] 返回 SSE URL: `${baseURL}/api/studio/projects/${projectId}/generate`
  - [ ] 注意：这是 SSE 端点，调用方使用 `readSSEStream` 直接消费

## 5. Frontend: StudioDetailPage UI（编辑）

- [ ] **5.1** 添加状态
  - [ ] `const [generating, setGenerating] = useState(false)`
  - [ ] `const [generationProgress, setGenerationProgress] = useState<string | null>(null)`
  - [ ] `const abortRef = useRef<AbortController | null>(null)`

- [ ] **5.2** 实现 `handleGenerateEpisodes()`
  - [ ] 防重入: `if (generating) return`
  - [ ] `setGenerating(true)`, `setGenerationProgress("正在构思故事结构…")`
  - [ ] 创建 `AbortController`
  - [ ] 调用 `readSSEStream(url, {}, { onChunk, onGenerationDone, onError }, signal)`
  - [ ] `onGenerationDone`: 刷新 query + 清除状态
  - [ ] `onError`: 显示 toast + 清除状态
  - [ ] `finally`: `setGenerating(false)`

- [ ] **5.3** 空状态 UI（episodes.length === 0 时）
  - [ ] "AI 生成四幕" 按钮 (Sparkles icon)
  - [ ] 生成中显示 Loader2 spinner + progress 文案
  - [ ] "手动添加 1 集" 按钮 (outline variant)
  - [ ] 按钮 disabled 条件: `generating || !project.synopsis`

- [ ] **5.4** 非空状态 UI（已有 episodes 时）
  - [ ] 在 episodes 列表顶部添加 "AI 重新生成" 按钮（可选，v0.3 再做）
  - [ ] 或者只在空状态显示 AI 按钮

## 6. Config

- [ ] **6.1** `.env.example`
  - [ ] 在 "5. AI / 图片素材搜索" 段添加:
    ```bash
    # Agnes AI API Key（剧本工坊 AI 生成用，免费额度）
    #   获取：https://apihub.agnes-ai.com/v1
    AGNES_API_KEY=
    ```

## 7. Tests

- [ ] **7.1** `tests/test_studio_engine.py` — 单元测试
  - [ ] `test_parse_valid_json()` — 直接 JSON 解析成功
  - [ ] `test_parse_code_fenced_json()` — 去除 ``` ``` 后解析
  - [ ] `test_parse_json_in_text()` — 正则提取嵌入的 JSON
  - [ ] `test_parse_invalid_returns_none()` — 无效输入返回 None
  - [ ] `test_parse_missing_episodes_key()` — 有 JSON 但无 episodes 键
  - [ ] `test_has_agnes_key_true()` — key 存在时返回 True
  - [ ] `test_has_agnes_key_false()` — key 为空时返回 False

- [ ] **7.2** `tests/test_studio_generate_endpoint.py` — 集成测试
  - [ ] `test_generate_requires_auth()` — 未登录返回 401
  - [ ] `test_generate_project_not_found()` — 项目不存在返回 404
  - [ ] `test_generate_not_owner()` — 非项目 owner 返回 404
  - [ ] `test_generate_success()` — mock LLM → 验证 episodes 写入 DB
  - [ ] `test_generate_sse_events()` — 验证 SSE 事件序列 (data → done → generation_done)
  - [ ] `test_generate_persist_error()` — DB 写入失败时流正常结束

## 8. Verification（手动验证清单）

- [ ] **8.1** 基本流程
  - [ ] 创建项目（标题 + 梗概 + 风格）
  - [ ] 点击 "AI 生成四幕"
  - [ ] 观察进度文案变化
  - [ ] 确认 4 个 episodes 出现在列表中
  - [ ] 确认每个 episode 有 title, scenes, dialogues

- [ ] **8.2** SSE 流式
  - [ ] 生成过程中按钮显示 spinner
  - [ ] 进度文案从 "正在构思…" → "正在生成「起」幕…" → …
  - [ ] 完成后按钮恢复可点击状态

- [ ] **8.3** 兜底测试
  - [ ] 清空 `AGNES_API_KEY` → 确认 OpenRouter 兜底正常
  - [ ] 两个 key 都清空 → 确认错误提示 "未配置 AI API key"

- [ ] **8.4** 边界情况
  - [ ] 项目已有 episodes 时点击生成 → 确认行为（追加 or 拒绝）
  - [ ] 梗概为空时按钮 disabled
  - [ ] 生成中断（网络断开）→ 前端不崩溃
