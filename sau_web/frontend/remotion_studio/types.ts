/**
 * Shared TypeScript types for the Studio Remotion renderer.
 *
 * The Node bridge (`render.mjs`) builds inputProps of this exact shape from
 * the JSON it reads on stdin. The Python side (`web_runner/routes/studio.py`)
 * reuses the same field names from `studio_projects` + `studio_episodes`
 * rows. Round-Video-Backgrounds-v1 removed the MoviePy fallback
 * (`web_runner/studio_render.py`) and the Hyperframes Node bridge
 * (`hyperframes/render.js`), so the bridge contract is now single-
 * backend: the contract is whatever `_render_via_remotion`'s
 * `_build_scenes_for_render` emits == what `render.mjs::buildScenes`
 * consumes == what this `StudioRenderInputProps` declares.
 *
 * Phase 2 — image-background types added alongside the text-only path.
 * The bridge reads `scenes[]` (preferred by `render.mjs` when present) so
 * Python-side `_build_scenes_for_render` is the source of truth for scene
 * order, which lets `backgroundUrls[]` (parallel array) align index-for-
 * index to `scenes[]` without a join-table lookup.
 */

export interface StudioProjectShape {
  /** Database primary key (debug only — not persisted in the rendered output). */
  id: number | string | null
  title: string
  synopsis: string
  style: string | null
  /**
   * Phase 2 — image-overlay opacity [0..1]. Read from
   * `studio_projects.overlay_opacity` (REAL NOT NULL DEFAULT 0.5).
   * Forwarded to `<SceneCard>` via `overlayOpacity` so the dark
   * gradient on top of the background image scales per project.
   */
  overlayOpacity?: number
  /**
   * round-OPT-presets-v1 — Visual Style Preset selector payload,
   * forwarded verbatim from ``studio_projects.render_config``
   * (PG JSONB). ``Root.tsx`` reads ``renderConfig?.preset`` and
   * resolves to the matching ``VisualPreset`` via
   * ``sau_web/frontend/remotion_studio/presets.ts``.
   *
   * ``null`` (legacy rows pre-PR-A) is the documented fallback
   * signal — ``getPresetById(null)`` returns Classic so untouched
   * projects render with the existing cold-canvas tokens.
   *
   * Forward-compat: future per-renderer fields ride this same
   * dict (custom font URL, motion-curve override, vendor-specific
   * opaques) without an ALTER round-trip.
   */
  renderConfig?: {
    preset?: string
    version?: number
    [k: string]: unknown
  } | null
}

export interface StudioEpisodeShape {
  episode_no: number | null
  title: string | null
  /** Free-form scene strings; rendered join-joined with dialogues inside one card. */
  scenes: string[]
  /** Dialogue / narration strings; rendered join-joined with scenes inside one card. */
  dialogues: string[]
}

export interface StudioSceneCard {
  /** Wrapped title e.g. "第 3 集 · 转折" — falls back to project.title for synopsis-only fallback. */
  title: string
  /** Single card body — text the renderer pip-joins from scenes + dialogues. */
  body: string
}

/**
 * Phase 2P — alternative shape with per-scene background URL. The bridge
 * accepts EITHER `scenes: StudioSceneCard[]` (text-only) OR
 * `scenes: StudioSceneCardWithBackground[]` + `backgroundUrls: (string |
 * null)[]` (Pexels-backed). Currently we use the parallel-array approach
 * for serialisation simplicity — `backgroundUrls[i]` sits behind
 * `scenes[i]`. We keep the type for forward-compat in case the parallel
 * arrays ever collapse into a single richer scene object.
 */
export interface StudioSceneCardWithBackground extends StudioSceneCard {
  backgroundUrl?: string | null
}

export interface StudioRenderInputProps {
  project: StudioProjectShape
  /**
   * Phase 2 — flat list of cards (already scene-built by Python's
   * `_build_scenes_for_render`). The Node bridge passes these through
   * verbatim into `selectComposition(...inputProps)` so `<SceneCard>`
   * reads them with `useCurrentFrame().scenes` per-sequence.
   */
  scenes: StudioSceneCard[]

  /**
   * Phase 2 — parallel-array background URLs aligned to `scenes`.
   * Index `i` corresponds to `scenes[i]`. `null` or empty string means
   * "no image for this scene" — the card falls through to the cold-
   * neutral canvas gradient (no black box, just the original dark
   * background).
   */
  backgroundUrls?: Array<string | null>

  /**
   * Phase 2 — pulled from `project.overlayOpacity` so consumers can
   * pass a single opacity instead of reading the nested property. The
   * Node bridge prefers `project.overlayOpacity` (single source of
   * truth) and this top-level mirror is kept for legacy callers.
   */
  overlayOpacity?: number

  /**
   * Round-Video-Backgrounds-v1 — parallel-array of downloaded Pexels
   * Videos CDN URLs (each entry is an ABSOLUTE URL the headless
   * Chromium inside Remotion can fetch via
   * `GET /api/studio/render/<project_id>/media/scene_<idx>.mp4`).
   * Index `i` aligns to `scenes[i]`. `null` means "Pexels Videos
   * returned no acceptable portrait MP4 ≥ 540px" — SceneCard falls
   * through to the `<Image>` (`backgroundUrls[i]`) branch for that
   * scene, then to the cold-canvas degrade if neither is present.
   *
   * Mirrors `backgroundUrls` shape so a future maintainer can
   * grep both via parallel-array contract tests.
   */
  backgroundVideos?: Array<string | null>

  /**
   * Round-Video-Backgrounds-v1 — parallel-array of synthesized
   * Edge-TTS voiceover MP3 URLs (each entry is an ABSOLUTE URL
   * served by `GET /api/studio/render/<project_id>/media/scene_<idx>.mp3`).
   * Index `i` aligns to `scenes[i]`. `null` means "edge-tts CLI
   * missing / failed / 0-byte output" — SceneCard omits `<Audio>`
   * and renders a silent video for that scene.
   */
  voiceovers?: Array<string | null>
}
