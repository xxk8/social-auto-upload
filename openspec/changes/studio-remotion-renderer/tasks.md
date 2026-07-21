# Tasks — studio-remotion-renderer

## 1. Dependencies (Frontend package.json)

- [x] 1.1 `pnpm add remotion @remotion/cli @remotion/transitions` → `^4.0.486`
- [x] 1.2 `pnpm add -D @remotion/renderer @remotion/bundler` → `^4.0.486`
- [x] 1.3 Verify peer deps resolve cleanly (React 19.2.6 already in tree).

## 2. Composition + Bridge

- [x] 2.1 `sau_web/frontend/remotion_studio/types.ts` — shared types.
- [x] 2.2 `sau_web/frontend/remotion_studio/utils/pacing.ts` — FPS / CHARS_PER_SEC / MIN / MAX / FADE helpers.
- [x] 2.3 `sau_web/frontend/remotion_studio/components/SceneCard.tsx` — single storyboard card.
- [x] 2.4 `sau_web/frontend/remotion_studio/components/StudioProject.tsx` — `<Series>` of `<SceneCard>` per scene.
- [x] 2.5 `sau_web/frontend/remotion_studio/Root.tsx` — `<Composition id="StudioProject">` + `calculateMetadata`.
- [x] 2.6 `sau_web/frontend/remotion_studio/index.ts` — `registerRoot()` entrypoint.
- [x] 2.7 `sau_web/frontend/remotion_studio/render.mjs` — Node ESM bridge (stdin JSON → bundle → renderMedia → stdout JSON).
- [x] 2.8 `sau_web/frontend/remotion_studio/utils/pacing.test.ts` — vitest pins pacing math to Python.

## 3. Flask integration

- [x] 3.1 `web_runner/routes/studio.py` — `_render_via_remotion(project, episodes, out_path, project_id)` mirroring `_render_via_hyperframes`.
- [x] 3.2 Flip `SAU_STUDIO_RENDERER` default from `hyperframes` to `remotion`.
- [x] 3.3 Preserve `moviepy` and `hyperframes` as explicit env choices.
- [x] 3.4 Add `SAU_STUDIO_RENDER_TIMEOUT` env (default 600 s) for subprocess deadline.
- [x] 3.5 Add `SAU_STUDIO_NODE_PATH` env override for asdf / nvm-managed Node binaries.

## 4. Tests

- [x] 4.1 `tests/test_studio_remotion_render.py` — pytest mocks `subprocess.run` and asserts:
  - [x] bridge path resolves to `sau_web/frontend/remotion_studio/render.mjs`
  - [x] subprocess payload is UTF-8 + JSON + `ensure_ascii=False` (no `\uXXXX`)
  - [x] manifest JSON is read from stdout
  - [x] non-zero rc → RuntimeError with stderr text
  - [x] timeout → RuntimeError(渲染超时 (>Ns))
  - [x] missing node binary → RuntimeError mentioning `node`
  - [x] `SAU_STUDIO_NODE_PATH` env overrides the spawn binary
- [x] 4.2 `sau_web/frontend/remotion_studio/utils/pacing.test.ts` — vitest pins:
  - [x] FPS=30, CHARS_PER_SEC=14, MIN=3, MAX=8, FADE_SEC=0.4
  - [x] `sceneDurationSec` clamps to MIN/MAX as expected
  - [x] `totalScenesDurationFrames` is sum of per-scene frame counts
  - [x] `transitionFrames` returns 0 for ≤1 scene, `FADE_SEC*FPS` otherwise

## 5. Documentation

- [ ] 5.1 Update `CLAUDE.md` — call out `SAU_STUDIO_RENDERER=remotion` as the new default and link to the OpenSpec change.
- [ ] 5.2 Update `.env.example` — document `SAU_STUDIO_RENDERER`, `SAU_STUDIO_RENDER_TIMEOUT`, `SAU_STUDIO_NODE_PATH`.
- [ ] 5.3 Update `docs/studio-whiteboard-spec.md` — replace the renderer-subsection to point at Remotion in §"渲染层".
- [x] 5.4 Add `docs/dev/studio-renderer-ops.md` — operator runbook:
  - [x] 5.4.1 Install Chromium (Remotion CLI) — minimal Dockerfile patch in §"Deploy" pins `RUN patchright install chromium` (NOT `chromium-headless-shell`) + `fonts-noto-cjk` apt + Node ≥20 nodesource block.
  - [x] 5.4.2 Troubleshooting common failures (timeout, missing chromium, missing node, fps mismatch, missing CJK font → blank boxes, missing `@remotion/bundler` module) — §Troubleshooting table in the runbook covers all 12 known failure modes with exact remediation + cross-refs to source files.
  - [x] 5.4.3 How to switch back to MoviePy fallback for a single project — §"Rollback" covers Compose / systemd / k8s / Bash overrides for `SAU_STUDIO_RENDERER=moviepy`, no image rebuild required.

## 6. Smoke

- [ ] 6.1 `pytest tests/test_studio_remotion_render.py` — 7 tests pass.
- [ ] 6.2 `pnpm --filter frontend vitest run remotion_studio/utils` — pacing.test passes.
- [ ] 6.3 Manual: `cd sau_web/frontend && npx remotion browser ensure` then a one-shot render of a sample project via the `/api/studio/projects/{id}/render` endpoint. Compare MP4 + .srt against the MoviePy fallback output to confirm visual parity.

## 7. Phase-2 image backgrounds (Pexels-via-cache) — DONE this change

- [x] 7.1 Pexels `studio_assets.kind='background'` cache-through per-scene background hook (Flask pre-step in `_render_via_remotion`).
  - [x] 7.1.1 `web_runner/db.py` — `ALTER TABLE studio_projects ADD COLUMN overlay_opacity REAL NOT NULL DEFAULT 0.5` for per-project gradient opacity slider.
  - [x] 7.1.2 `web_runner/routes/ai.py` — `_search_pexels(query, count, orientation=None)` extended with `orientation='portrait'` for 9:16 hits.
  - [x] 7.1.3 `web_runner/routes/studio.py` — `_auto_image_prompt`, `_build_scenes_for_render` (mirror of Node), `_resolve_scene_backgrounds` (3-worker pool, count=2 dedupe).
  - [x] 7.1.4 `web_runner/routes/studio.py` — `_render_via_remotion` flushes `background_urls[]` + `overlay_opacity` into `render.mjs`'s stdin payload.
  - [x] 7.1.5 `sau_web/frontend/remotion_studio/types.ts` — `StudioProjectShape.overlayOpacity`, `StudioRenderInputProps.backgroundUrls[]`, `overlayOpacity` (parallel-array contract).
  - [x] 7.1.6 `sau_web/frontend/remotion_studio/components/SceneCard.tsx` — `<Image>` layer behind text + linear-gradient overlay with `overlayOpacity` alpha. Falls through to cold-canvas gradient when `backgroundUrl` missing.
  - [x] 7.1.7 `sau_web/frontend/remotion_studio/render.mjs` — reads `payload.scenes` (preferred contract) + `payload.background_urls` + `payload.overlay_opacity`; passes through verbatim into `selectComposition`/`<SceneCard>`.
  - [x] 7.1.8 `tests/test_studio_remotion_render.py` — 7 Phase-2 tests added (cache hit / cache miss+UPSERT / dedupe / malformed-cache / overlay / parallel-array). Total 14 tests in the file, all parse-cleanly.

## 7.Phase-2 future backlog

- [ ] 7.2 OpenRouter `/api/v1/videos` per-scene clip via `<OffthreadVideo>` (separate openspec change once image backgrounds are running in production for ≥30 days).
- [ ] 7.3 tldraw `canvas_data` → video direct pipeline (separate openspec change).
- [ ] 7.4 Cross-render-call cross-scene dedupe — add `upstream_id TEXT` column to `studio_assets` and seed `seen_pexels_ids` from cache so re-renders don't re-pick the same already-curated photos across calls. Phase 3 polish; Phase 2 only does within-render dedupe.
