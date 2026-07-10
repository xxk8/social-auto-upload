# Studio Render Backend — Switch to Remotion

## Why

The current `/api/studio/projects/{id}/render` endpoint errors out in practice:

- `hyperframes/render.js:223` shells out to `npx hyperframes render`.
- The `hyperframes` npm package is NOT installed (no `package.json`, no `node_modules/hyperframes`).
- `npx` hangs in non-interactive shells on the install prompt, then exits 1.
- `web_runner/routes/studio.py:_render_via_hyperframes` reads `returncode != 0` and converts it into a generic 500 / `RuntimeError`.

The MoviePy fallback (`web_runner/studio_render.py`) works but produces text-only cards which don't justify the dataset of 9:16 short-form reels the Studio product is supposed to enable.

## What we are changing

Adopt **[Remotion 4](https://www.remotion.dev)** as the default render backend. Vite-based bundler + headless Chromium is the same rendering model Hyperframes wanted to use — but Remotion draws the composition in React (same mental model as the rest of the codebase) and ships its CLI as installable dev deps rather than external globals.

| Field | Before | After |
| --- | --- | --- |
| Default `SAU_STUDIO_RENDERER` | `hyperframes` | `remotion` |
| Render bridge | `hyperframes/render.js` (Node, calls `npx`) | `sau_web/frontend/remotion_studio/render.mjs` (Node ESM, calls `bundle()` + `renderMedia()` from `@remotion/renderer`) |
| Composition model | Hand-rolled HTML + GSAP `timeline` | React `Composition` (`<Series>`, `<Series.Sequence>`) with `calculateMetadata` for dynamic duration |
| Pacing constants | Duplicated across 3 files (`studio_render.py`, `hyperframes/render.js`, new) | Single source of truth in `sau_web/frontend/remotion_studio/utils/pacing.ts` + vitest pins them to the Python `_scene_duration` math |
| Per-card visuals | Indigo accent + cold-neutral card | Same — visual language mirrored across all three backends |
| OpenRouter hook | None | Bridge reads `--out` JSON; future pre-step (Flask) will pre-fetch `/api/v1/images` results per scene and pass URLs as `inputProps.backgroundUrls` |

## What is NOT changing

- **Output format**: still 9:16 vertical `1080×1920 @ 30fps` MP4 + sibling `.srt`/`.ass` captions.
- **API contract**: `/api/studio/projects/{id}/render` still returns `{ url, captions_ass, captions_srt, duration, width, height }`.
- **Manifest schema**: existing `/api/studio/render/{id}/render.mp4` route still serves the MP4; only the writer changed.
- **Project / episode data model**: unchanged — render reads `studio_projects.title + synopsis + style` and `studio_episodes[*].scenes_json + dialogues_json + title + episode_no`. Same field names as the MoviePy fallback.
- **`canvas_data` column**: NOT consumed yet (Phase 2 work — openspec/changes/studio-whiteboard).
- **Browser-side Studio page**: unchanged — `/dashboard/studio/{id}` keeps the existing "渲染成片" button + download links.
- **MoviePy fallback**: preserved as `SAU_STUDIO_RENDERER=moviepy` for environments without Node.
- **Hyperframes fallback**: preserved as `SAU_STUDIO_RENDERER=hyperframes` for backwards-compat with any operator who pinned the old env. Default flips to `remotion`.

## OpenSpec deltas to apply post-merge

1. `web_runner.routes.studio` — new render backend `remotion` selected by default.
2. `web_runner.studio_renderer` — split between two env-driven backends; add `SAU_STUDIO_RENDER_TIMEOUT` env to honour.
3. `package.json` (frontend) — add `remotion` + `@remotion/cli` + `@remotion/transitions` to dependencies and `@remotion/renderer` + `@remotion/bundler` to devDependencies.
4. New file `web_runner/routes/studio.py::_render_via_remotion` — Node bridge spawn.

## Risks (documented + mitigated)

| Risk | Mitigations |
| --- | --- |
| Headless Chromium absent on deploy | Document `npx remotion browser ensure` in install steps; `--no-sandbox --disable-dev-shm-usage` flags in chromiumOptions; `concurrency=null` defaults to CPU count. |
| `npx`-style pitfalls | Bridge script does NOT use `npx`; spawns `node <absolute bridge path>` directly. |
| React-version drift | Bridge shares `sau_web/frontend`'s React 19.2.6 — single instance, no double-React. |
| Long bundle latency (≥10 s first render) | Acceptable for MVP; future optim is per-project cache of `bundleLocation`. |
| tldraw → video (out of scope MVP) | Phase 2 of `studio-whiteboard` change; MVP consumes text only and respects the opaque-canvas server contract. |
