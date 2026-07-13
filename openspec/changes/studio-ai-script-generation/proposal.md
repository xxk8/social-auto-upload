# Studio Phase 2: AI Script Generation (Agnes AI)

## Why

### Current pain point

Studio (剧本工坊) has a complete pipeline from project creation → episode authoring → render → MP4 output. But the episode authoring step is entirely manual:

1. User creates a project with title + synopsis + style (easy, 10 seconds)
2. User clicks "添加 1 集" → fills title, act, scenes JSON, dialogues JSON (hard, 5-10 minutes per episode)
3. Repeat step 2 three more times for a complete 4-act story
4. Total manual effort: 20-40 minutes just for scriptwriting

This is the #1 friction point. Users who can write a one-line synopsis ("一个外卖员意外穿越到古代成为御厨的爆笑故事") should not need to manually author 4 episodes with structured JSON.

### What Phase 2 delivers

One click: "AI 生成四幕" → the system calls an LLM → 4 episodes (起/承/转/合) with titles, scenes, and dialogues appear → user reviews, tweaks if needed → proceeds to render.

**Success metric**: From synopsis to render-ready script in < 30 seconds (vs. 20-40 minutes today).

## What changes

### Backend (Python) — 2 files

| File | Action | Lines (est.) | Purpose |
|------|--------|-------------|---------|
| `web_runner/studio_engine.py` | **NEW** | ~200 | LLM generation engine: prompt, streaming, JSON parsing, fallback |
| `web_runner/routes/studio.py` | **EDIT** | +80 | New SSE endpoint + DB persistence helper |

**`web_runner/studio_engine.py`** (new module):
- `AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1"` — Agnes AI base URL
- `AGNES_MODEL = "agnes-2.0-flash"` — primary model
- `OPENROUTER_FALLBACK_MODEL = "google/gemma-4-26b-a4b-it:free"` — fallback model
- `SYSTEM_PROMPT` — 4-act episode generation prompt (~40 lines, detailed below in Design)
- `_get_agnes_key()` → reads `AGNES_API_KEY` from env
- `_has_agnes_key()` → bool check
- `_stream_agnes(messages, max_tokens, temperature)` → SSE generator from Agnes AI
- `_stream_with_fallback(messages, max_tokens, temperature)` → tries Agnes, falls back to OpenRouter
- `_parse_episodes_json(text)` → extracts episodes array from LLM output (handles code-fenced, bare JSON, regex fallback)
- `generate_episodes_sse(title, synopsis, style)` → main entry point, yields SSE events

**`web_runner/routes/studio.py`** (edit):
- New route: `POST /api/studio/projects/<id>/generate` — SSE stream endpoint
- New helper: `_persist_generated_episodes(project_id, user_id, episodes_data)` — transactional batch insert

### Frontend (React) — 3 files

| File | Action | Purpose |
|------|--------|---------|
| `sau_web/frontend/src/api/sse.ts` | **EDIT** | Add `onGenerationDone` handler + `generation_done` case |
| `sau_web/frontend/src/api/studio.ts` | **EDIT** | Add `generateEpisodes(projectId)` URL builder |
| `sau_web/frontend/src/Pages/StudioDetailPage.tsx` | **EDIT** | "AI 生成四幕" button + streaming progress UI |

### Config — 1 file

| File | Action | Purpose |
|------|--------|---------|
| `.env.example` | **EDIT** | Add `AGNES_API_KEY` under AI section |

## Why now

1. **Agnes AI is confirmed working** — tested via curl, `agnes-2.0-flash` returns valid chat completions
2. **OpenRouter fallback is proven** — `ai.py` has 1000+ lines of battle-tested SSE streaming with key rotation
3. **Studio infrastructure is complete** — episode CRUD, render, export all work; only AI generation is missing
4. **The skill `sau-studio-from-topic` already defines the prompt pattern** — we're formalizing it into a production endpoint

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LLM returns invalid JSON | Episodes not created | `_parse_episodes_json()` has 3 fallback extraction strategies; user sees clear error |
| Agnes AI rate limit / outage | Generation fails | OpenRouter fallback is automatic; both fail → clear error message |
| LLM generates wrong act count | Missing acts or extra episodes | Prompt enforces exactly 4 acts; persistence validates `_VALID_ACTS` whitelist |
| Long generation time (>30s) | User thinks it's stuck | SSE streaming shows real-time progress; timeout at 120s |
| LLM generates inappropriate content | Platform ban risk | Prompt includes safety guidelines; user reviews before render |

## Out of scope

- **Image generation** for character/scene references (future enhancement, requires `agnes-image-2.1-flash`)
- **Video generation** via Agnes AI (`agnes-video-v2.0` returns 429 — no deployments available)
- **Multi-turn conversation** / episode refinement (v0.3 scope — "对某一集不满意？让 AI 重写")
- **Replacing Pexels** with AI-generated backgrounds (separate change)
- **Batch generation** across multiple projects (v0.3 scope)
