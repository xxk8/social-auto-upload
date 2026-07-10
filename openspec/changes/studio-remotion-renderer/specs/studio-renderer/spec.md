# Capability: studio-renderer

## Purpose

Define how `/api/studio/projects/{id}/render` selects and executes a render backend so that `/dashboard/studio/{id}` reliably produces a 9:16 vertical MP4 + sibling `.srt`/`.ass` captions for any project that has at least a title, synopsis, or one episode with non-empty scenes/dialogues.

## ADDED Requirements

### Requirement: Default renderer is `remotion`

`SAU_STUDIO_RENDERER` SHALL default to `"remotion"` (case-insensitive). Operationally this means: `web_runner/routes/studio.py::_render_via_remotion` is selected unless env explicitly overrides.

- **WHEN** `SAU_STUDIO_RENDERER` is unset AND a user POSTs `/api/studio/projects/{id}/render` for an owned project with a populated storyboard
- **THEN** the backend SHALL spawn `node sau_web/frontend/remotion_studio/render.mjs --out <MEDIA_ROOT>/studio/<id>/render.mp4` with `{project, episodes}` JSON on stdin
- **THEN** the backend SHALL read `{success, duration, width, height}` JSON from the bridge stdout and surface it as `{success: true, data: {url, captions_ass, captions_srt, duration, width, height}}` on HTTP 200
- **AND** the backend SHALL honour `SAU_STUDIO_RENDER_TIMEOUT` (default 600 s) as the subprocess deadline

#### Scenario: Render success path

- **WHEN** the bridge exits 0 with stdout JSON `{"success":true,"duration":12.4,"width":1080,"height":1920}`
- **THEN** the route returns the manifest inside the existing `{success: true, data: {url, captions_ass, captions_srt, duration, width, height}}` envelope with HTTP 200
- **AND** the served MP4 URL `GET /api/studio/render/{id}/render.mp4` returns a `video/mp4` blob

#### Scenario: Render path is opaque to the browser

- **WHEN** the user POSTs from `/dashboard/studio/{id}` "渲染成片" button
- **THEN** the backend MUST route to `_render_via_remotion` and the browser MUST NOT change
- **AND** when the bridge exits non-zero the route returns HTTP 500 with `{success: false, message: "渲染失败:<std原因>"}` so the `<p role="alert">` flash can display it

### Requirement: Pacing constants are a single source of truth

The per-scene pacing math SHALL be identical across the three render backends so a project rendered by Remotion today and MoviePy tomorrow lands on the same per-card duration.

- **WHEN** `body.length / 14 < 3.0` the per-card duration SHALL be 3.0 s
- **WHEN** `body.length / 14 > 8.0` the per-card duration SHALL be 8.0 s
- **WHEN** `3.0 ≤ body.length / 14 ≤ 8.0` the per-card duration SHALL be `body.length / 14`
- **AND** FPS SHALL be 30 across all backends. CHARS_PER_SEC=14, MIN_SCENE_SEC=3, MAX_SCENE_SEC=8 are pinned by `tests/test_studio_remotion_render.py` + `sau_web/frontend/remotion_studio/utils/pacing.test.ts` so any drift fails CI.

#### Scenario: Drift detection

- **WHEN** `web_runner/studio_render.py::_scene_duration` constants drift from `pacing.ts` (FPS / CHARS_PER_SEC / MIN / MAX differ)
- **THEN** at least one of the two CI gates fails — the vitest `pacing.test.ts` or the pytest timing-pin tests — preventing a silent visual drift between backends

### Requirement: Bridge script does NOT use `npx`

The Node bridge MUST NOT shell out via `npx` to install packages on the fly. Cold-cache `npx` interactive prompts hang in non-interactive server shells.

- **WHEN** the operator's deploy image does not already have `hyperframes` (the legacy path's dependency) installed
- **THEN** `SAU_STUDIO_RENDERER=remotion` MUST NOT trigger any `npx` invocation in `render.mjs` or `_render_via_remotion`
- **AND** the bridge MUST spawn the system `node` binary directly via `[node_bin, bridge_path, "--out", out_path]` (where `node_bin := env.SAU_STUDIO_NODE_PATH or "node"`)

#### Scenario: Missing node binary

- **WHEN** `node` is not on `PATH` AND `SAU_STUDIO_NODE_PATH` is unset
- **THEN** the route returns HTTP 500 with `{success: false, message: "渲染失败:node 未安装或不在 PATH..."}` so the operator sees a clear remediation step (install Node ≥ 20 OR set `SAU_STUDIO_NODE_PATH`)

#### Scenario: Node binary override

- **WHEN** the operator sets `SAU_STUDIO_NODE_PATH=/usr/local/bin/node-22`
- **THEN** the spawn uses that exact path verbatim — the route does NOT prepend or subtract from the value

### Requirement: Captions are written alongside the MP4

For every successful render, the bridge MUST also write `captions.srt` and `captions.ass` next to `render.mp4` using the same per-scene duration math.

- **WHEN** a render succeeds with total duration `D` seconds and `N` scenes with bodies `[b₁, …, bₙ]`
- **THEN** `captions.srt` SHALL contain `N` cue blocks with start/end times computed from `Σᵢ₌₁ᵏ⁻¹ sceneDurationSec(bᵢ)` for cue `k`
- **AND** `captions.ass` SHALL contain `N` `Dialogue:` lines with the same start/end times in `H:MM:SS.cs` format

#### Scenario: Captions consumed by the existing `/api/studio/render/{id}/...` route

- **WHEN** the bridge writes `captions.srt` + `captions.ass` next to `render.mp4`
- **THEN** the existing `serve_render` route in `web_runner/routes/studio.py` returns them verbatim with the matching MIME (`application/x-subrip` for `.srt`, `text/x-ssa` for `.ass`)
- **AND** the StudioDetailPage download links (`下载字幕 (.srt)` / `下载字幕 (.ass)`) work without any frontend change

### Requirement: Render bridges respect the opaque canvas contract

The bridge MUST treat `studio_projects.canvas_data` as opaque tldraw JSON per `openspec/specs/canvas-editor/spec.md` and MUST NOT attempt to consume or interpret its shape server-side.

- **WHEN** a project's `canvas_data` exists but the rendered script comes from `episodes[*].scenes + dialogues` AND `synopsis`
- **THEN** the bridge MUST ignore the canvas field entirely for the v1 cut
- **AND** Phase 2 (separate openspec change) will introduce the canvas → video pipeline

#### Scenario: Canvas-bound project renders from text storyboard (MVP)

- **WHEN** the user has drawn a storyboard via the (future) `CanvasEditor.tsx` AND has not generated any `studio_episodes`
- **THEN** the render output SHALL still be a valid MP4 drawn from the project `synopsis` lines (one card per line) — never a blank 9:16 frame
