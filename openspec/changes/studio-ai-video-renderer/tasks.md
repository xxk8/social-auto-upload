# Tasks — studio-ai-video-renderer (DRAFT — NO CODE)

Implementation tasks for the companion PR to
`studio-visual-presets`. **No code lands in this change folder**
in the current PR. The openspec exists so vendor selection +
fallback semantics + quota policy can be agreed in parallel
while visual-presets ships independently.

## 1. Backend abstraction

- [ ] Define `StudioRenderBackend` `Protocol` interface in
  `web_runner/studio_backends/base.py` —
  `render(project, episodes, preset, out_path) -> Manifest`.
- [ ] Migration helper to register concrete `RemotionBackend`
  (existing), `KlingBackend` (NEW), `ZhipuGLMVideoBackend`
  (NEW) impls as import-time singletons.
- [ ] `_render_via_remotion` and friends refactored into
  `RemotionBackend` impl. Old function names preserved as a
  thin alias for back-compat in tests.

## 2. Vendor integrations (PRIMARY = Kling)

- [ ] `web_runner/studio_backends/kling.py::KlingBackend` with:
  - [ ] `KlingAPIClient` (Bearer auth, retry-with-backoff,
    rate-limit-aware queue).
  - [ ] Async render submission + polling loop
    (Kling trims to short clips today; plan for 5–10 min
    per render).
  - [ ] Per-project prompt synthesis (consistent with
    `_auto_image_prompt` from the visual-presets PR).
  - [ ] Failure modes — Kling 5xx → silent fallback to
    Remotion (with the chosen preset).
- [ ] `web_runner/studio_backends/zhipu.py::ZhipuGLMVideoBackend`
  as the FALLBACK vendor for ops who can't procure a Kling
  account. Same retry/poll/fallback shape.

## 3. Per-project preferred_backend

- [ ] Extend `_validate_render_config` to optionally accept
  a `preferred_backend: 'remotion' | 'kling' | 'zhipu' | null`
  sub-field. Whitelist-validated (vs the `preset` field's
  open-string policy). The bridge routes based on the chosen
  backend; null → default to Remotion.
- [ ] `_serialize_project` exposes the chosen backend alongside
  the preset, no schema change needed (rides the existing
  JSONB column).
- [ ] `_render_via_remotion` becomes a dispatch wrapper that
  reads `preferred_backend` and calls the matching
  `StudioRenderBackend::render` impl.

## 4. API key / quota management

- [ ] `kling_api_key` and `zhipu_api_key` slots added to the
  existing `ai_api_keys` table (round-AI-paywall).
- [ ] `web_runner/middleware/usage_metering.py` extended with a
  per-vendor `KlingSecondsMonthly` / `ZhipuSecondsMonthly` cap
  for free-tier users. Pro/Studio tier = unlimited.
- [ ] Per-render quota write — silent-fail to Remotion when
  quota exhausts mid-render (with a 200 OK + warning toast on
  the StudioDetailPage).

## 5. Picker UI

- [ ] `StudioDetailPage.tsx` adds a second dropdown beside the
  visual preset picker:
  - Renderer:
    `Remotion (本地) ⬇ / Kling 可灵 (生成式 ~5 分钟) ⬇ / Zhipu
    GLM-Video (国内合规备选) ⬇`
- [ ] Selecting a Renderer auto-PATCHes the same
  `render_config` JSONB dict with `preferred_backend` set.
- [ ] `updateMutation` already accepts arbitrarily-keyed
  JSONB children, so no schema impact.

## 6. Tests

- [ ] `tests/test_studio_kling_backend.py` — vitest-pinnable
  stub for KlingAPIClient (mocked httpx.AsyncClient).
  Pins the retry-and-poll contract + the
  Remotion-silent-fallback path.
- [ ] `tests/test_studio_render_dispatch.py` — pytest covering
  the `_render_via_remotion`'s new dispatch wrapper with all
  three backends and the fallback paths.
- [ ] `tests/test_studio_usage_metering.py` extension — Kling /
  Zhipu quota caps.

## 7. Runbook

- [ ] Extend `docs/dev/studio-renderer-ops.md` by ~120 lines:
  "Kling credentials · vendor outage → Remotion fallback ·
  quota exhaustion UX". Cross-link to
  `docs/dev/INDEX.md` from the existing Web Shell runbook
  surface.
- [ ] `.env.example` adds `KLING_API_KEY` + `ZHIPU_API_KEY`
  rows under the existing AI section.

## 8. Operators handbook

- [ ] Procurement runbook at `docs/dev/studio-kling-ops.md` —
  how to procure a Kling developer account + the approval
  tier that ops hit before production rollout.

## 9. PR merge gates

- [ ] Pre-merge: confirm `usage_metering.py`'s existing
  free-tier AI-paywall gate is bypassed for Kling paths
  **OR** that the gate explicitly allows Kling calls — the
  visual-presets PR's round-AI-paywall-v1 pins this invariant
  on `web_runner/middleware/usage_metering.py`.
- [ ] Pre-merge: confirm `studio_projects.render_config` JSONB
  column gains an `idx_gin_render_config` GIN index for the
  per-vendor audit query ("how many renders used Kling last
  week?").
- [ ] E2E runbook screenshot — operator picks Kling, the
  StudioDetailPage shows a 5-min wait spinner, then the MP4
  lands with a "rendered by Kling" annotation.
