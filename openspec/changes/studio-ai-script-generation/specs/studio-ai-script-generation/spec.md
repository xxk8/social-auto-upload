# AI Script Generation (Studio Phase 2) — Requirements

## Source-of-truth table

| Source-of-truth line | Owner |
|---|---|
| LLM provider selection (Agnes primary / OpenRouter fallback) | `web_runner/studio_engine.py` |
| API endpoint contract (SSE events) | `web_runner/routes/studio.py::generate_episodes()` |
| Prompt design for 4-act generation | `web_runner/studio_engine.py::SYSTEM_PROMPT` |
| Episode persistence logic | `web_runner/routes/studio.py::_persist_generated_episodes()` |
| Frontend SSE event routing | `sau_web/frontend/src/api/sse.ts::readSSEStream()` |
| Frontend UI (button + progress) | `sau_web/frontend/src/Pages/StudioDetailPage.tsx` |
| Environment variable | `.env.example::AGNES_API_KEY` |

## ADDED Requirements

### Requirement: AI generates 4-act episodes from synopsis

The system SHALL generate exactly 4 episodes (起/承/转/合) from a project's synopsis when the user triggers AI generation.

#### Scenario: successful generation

- **GIVEN** a project with title="穿越当御厨", synopsis="一个外卖员意外穿越到古代成为御厨的爆笑故事", style="古风喜剧"
- **WHEN** user clicks "AI 生成四幕"
- **THEN** the system SHALL call the LLM with a system prompt defining 4-act structure and a user prompt containing the title, synopsis, and style
- **AND** the LLM response SHALL contain a JSON object with an `episodes` array of exactly 4 items
- **AND** each episode SHALL have `act` ∈ {"起", "承", "转", "合"}, `title` (string, 10-15 chars), `scenes` (array of {title, body, duration_sec}), `dialogues` (array of {speaker, text})
- **AND** all 4 episodes SHALL be persisted to `studio_episodes` table in one transaction
- **AND** `studio_projects.updated_at` SHALL be set to current timestamp

#### Scenario: generation with style

- **GIVEN** a project with style="水墨武侠"
- **WHEN** user triggers generation
- **THEN** the style value SHALL be included in the LLM user prompt as "视觉风格：水墨武侠"
- **AND** the generated scenes and dialogues SHALL reflect the武侠 aesthetic

#### Scenario: generation without style

- **GIVEN** a project with style=NULL or style=""
- **WHEN** user triggers generation
- **THEN** the style line SHALL be omitted from the user prompt
- **AND** generation SHALL proceed normally

#### Scenario: generation with existing episodes

- **GIVEN** a project that already has 2 episodes (e.g., manually added "起" and "承")
- **WHEN** user triggers generation
- **THEN** the system SHALL generate 4 new episodes
- **AND** new episode_no SHALL start from `MAX(existing_episode_no) + 1`
- **AND** existing episodes SHALL NOT be modified or deleted

### Requirement: SSE streaming to frontend

The generate endpoint SHALL return an SSE stream (`text/event-stream`) with real-time progress updates.

#### Scenario: normal streaming event sequence

- **WHEN** the LLM generates content successfully
- **THEN** the endpoint SHALL yield zero or more `event: data` events with `{"content": "<chunk>"}` payloads
- **AND** yield exactly one `event: done` event with `{"content": "<full_text>"}` containing the complete LLM output
- **AND** yield exactly one `event: generation_done` event with `{"episodes": [...]}` containing the parsed episodes array
- **AND** the `Content-Type` header SHALL be `text/event-stream`
- **AND** the `Cache-Control` header SHALL be `no-cache`
- **AND** the `X-Accel-Buffering` header SHALL be `no`

#### Scenario: LLM returns invalid JSON

- **WHEN** the LLM completes but `_parse_episodes_json()` returns None
- **THEN** the endpoint SHALL yield `event: error` with `{"message": "AI 生成结果格式异常，请重试"}`
- **AND** no episodes SHALL be persisted to the database

#### Scenario: LLM returns partial episodes

- **GIVEN** the LLM returns only 2 episodes (missing "转" and "合")
- **WHEN** `_parse_episodes_json()` extracts the episodes array
- **THEN** only the valid episodes with acts in {"起", "承", "转", "合"} SHALL be persisted
- **AND** the missing acts SHALL NOT be generated (user must retry or add manually)

#### Scenario: LLM stream interrupted

- **WHEN** the network connection drops mid-stream
- **THEN** the frontend `readSSEStream` SHALL handle the error gracefully
- **AND** the `generating` state SHALL be reset to false
- **AND** no episodes SHALL be persisted (incomplete data)

#### Scenario: concurrent generation requests

- **WHEN** user double-clicks "AI 生成四幕" rapidly
- **THEN** only one generation SHALL proceed (frontend prevents via `if (generating) return`)
- **AND** the AbortController SHALL cancel the previous request if still in-flight

### Requirement: Agnes AI primary with OpenRouter fallback

The system SHALL use Agnes AI as the primary LLM provider and automatically fall back to OpenRouter on failure.

#### Scenario: Agnes AI succeeds

- **GIVEN** `AGNES_API_KEY` environment variable is set and non-empty
- **WHEN** user triggers generation
- **THEN** the system SHALL send a POST request to `https://apihub.agnes-ai.com/v1/chat/completions`
- **AND** the request SHALL use model `agnes-2.0-flash`
- **AND** the request SHALL include `Authorization: Bearer <AGNES_API_KEY>` header
- **AND** the request SHALL set `stream: true`

#### Scenario: Agnes AI HTTP error → OpenRouter fallback

- **GIVEN** `AGNES_API_KEY` is set
- **WHEN** Agnes API returns HTTP 4xx or 5xx
- **THEN** the system SHALL fall back to OpenRouter via `_stream_openrouter()`
- **AND** the fallback SHALL use model `google/gemma-4-26b-a4b-it:free`
- **AND** the user SHALL see normal generation output (no error toast)

#### Scenario: Agnes AI timeout → OpenRouter fallback

- **GIVEN** `AGNES_API_KEY` is set
- **WHEN** Agnes API does not respond within 120 seconds
- **THEN** the system SHALL fall back to OpenRouter
- **AND** the user SHALL see normal generation output

#### Scenario: Agnes AI rate limit (429) → OpenRouter fallback

- **GIVEN** `AGNES_API_KEY` is set
- **WHEN** Agnes API returns HTTP 429
- **THEN** the system SHALL fall back to OpenRouter
- **AND** no retry shall be attempted on Agnes for this request

#### Scenario: OpenRouter also fails

- **GIVEN** Agnes AI failed AND OpenRouter also fails (no keys, rate limit, or error)
- **WHEN** fallback is attempted
- **THEN** the endpoint SHALL yield `event: error` with the OpenRouter error message
- **AND** no episodes SHALL be persisted

#### Scenario: no API keys configured

- **GIVEN** `AGNES_API_KEY` is empty/unset AND no OpenRouter keys are available
- **WHEN** user triggers generation
- **THEN** the endpoint SHALL yield `event: error` with `{"message": "未配置 AI API key，请在 .env 设置 AGNES_API_KEY"}`
- **AND** no HTTP request SHALL be made to any external API

### Requirement: episode persistence is atomic

Generated episodes SHALL be inserted in a single database transaction. All-or-nothing semantics.

#### Scenario: all 4 episodes inserted successfully

- **GIVEN** LLM returns 4 episodes with valid acts {"起", "承", "转", "合"}
- **WHEN** `_persist_generated_episodes()` is called
- **THEN** all 4 episodes SHALL be inserted in one `db.transaction()` block
- **AND** `episode_no` SHALL auto-increment: `COALESCE(MAX(episode_no), 0) + 1` for the first, +2 for the second, etc.
- **AND** `scenes_json` and `dialogues_json` SHALL be stored as JSON strings (using `json.dumps(ensure_ascii=False, separators=(",", ":"))`)
- **AND** `status` SHALL default to `"draft"`
- **AND** `created_at` SHALL be set to current ISO 8601 timestamp

#### Scenario: invalid act filtered out

- **GIVEN** LLM returns episodes with acts ["起", "承", "高潮", "合"] (invalid act "高潮")
- **WHEN** episodes are persisted
- **THEN** the episode with act="高潮" SHALL be skipped
- **AND** the 3 valid episodes (起, 承, 合) SHALL be inserted
- **AND** episode_no SHALL be sequential (1, 2, 3)

#### Scenario: DB transaction failure

- **GIVEN** a database error occurs during INSERT (e.g., connection lost)
- **WHEN** `_persist_generated_episodes()` catches the exception
- **THEN** the transaction SHALL be rolled back by `db.transaction()` context manager
- **AND** no episodes SHALL be persisted
- **AND** the error SHALL be logged via `_task_logger.exception()`
- **AND** the SSE stream SHALL have already completed (persistence runs after generation_done)

#### Scenario: project updated_at bump

- **GIVEN** episodes are successfully inserted
- **WHEN** the transaction commits
- **THEN** `studio_projects.updated_at` SHALL be updated to the same timestamp used for episode `created_at`
- **AND** the projects list view SHALL reorder the project to the top

### Requirement: frontend displays generation progress

The StudioDetailPage SHALL show a button and real-time progress indicator for AI generation.

#### Scenario: empty state shows generate button

- **GIVEN** a project with 0 episodes
- **WHEN** the detail page renders the episodes section
- **THEN** the empty state SHALL display an "AI 生成四幕" button with a Sparkles icon (from `lucide-react`)
- **AND** the button SHALL be disabled if `project.synopsis` is empty/falsy
- **AND** a "手动添加 1 集" outline button SHALL appear below it

#### Scenario: generation in progress

- **WHEN** user clicks "AI 生成四幕"
- **THEN** the button SHALL display a `Loader2` spinner with `animate-spin`
- **AND** the button text SHALL change to "生成中…"
- **AND** a progress text element SHALL appear below the button with role="status"
- **AND** the progress text SHALL update as SSE events arrive:
  - Initial: "正在构思故事结构…"
  - On `episode_start`: "正在生成「{act}」幕…" (if implemented)
  - On `onChunk`: optional — no visible change by default
  - On completion: progress text disappears

#### Scenario: generation complete

- **WHEN** `onGenerationDone` callback fires
- **THEN** `generating` state SHALL reset to false
- **AND** `generationProgress` SHALL reset to null
- **AND** TanStack Query `queryClient.invalidateQueries({ queryKey: ['studio-project', projectId] })` SHALL be called
- **AND** the episodes list SHALL refresh to display the 4 newly generated episodes

#### Scenario: generation error

- **WHEN** `onError` callback fires with a message
- **THEN** `generating` state SHALL reset to false
- **AND** `generationProgress` SHALL reset to null
- **AND** an error toast SHALL be displayed to the user
- **AND** the episodes list SHALL remain unchanged (no stale data)

#### Scenario: user aborts generation

- **WHEN** user navigates away from the page during generation
- **THEN** the `AbortController.signal` SHALL trigger `abort()`
- **AND** the SSE connection SHALL be closed
- **AND** the `generating` state SHALL be cleaned up (no memory leak)

### Requirement: environment variable configuration

The `.env.example` file SHALL document the `AGNES_API_KEY` variable.

#### Scenario: env var documentation

- **WHEN** a developer reads `.env.example`
- **THEN** they SHALL find `AGNES_API_KEY=` under the "5. AI / 图片素材搜索" section
- **AND** a comment SHALL explain: "Agnes AI API Key（剧本工坊 AI 生成用，免费额度）"
- **AND** a comment SHALL include the key retrieval URL: "获取：https://apihub.agnes-ai.com/v1"

## MODIFIED Requirements

None.

## REMOVED Requirements

None.

## DEPENDENCIES

| Dependency | How used | Status |
|---|---|---|
| `_stream_openrouter()` in `web_runner/routes/ai.py` | OpenRouter fallback streaming | ✅ Already shipped |
| `readSSEStream()` in `sau_web/frontend/src/api/sse.ts` | Frontend SSE consumer | ✅ Already shipped |
| `db.transaction()` + `insert_returning_id()` in `web_runner/db.py` | Transactional episode insert | ✅ Already shipped |
| `_load_project()` in `web_runner/routes/studio.py` | Owner-isolated project load | ✅ Already shipped |
| `_current_user_id()` in `web_runner/routes/studio.py` | Auth check | ✅ Already shipped |
| `_VALID_ACTS` in `web_runner/routes/studio.py` | Act whitelist validation | ✅ Already shipped |
| `studioApi` in `sau_web/frontend/src/api/studio.ts` | Frontend API client | ✅ Already shipped |
| `useQueryClient` in TanStack Query | Cache invalidation | ✅ Already shipped |
