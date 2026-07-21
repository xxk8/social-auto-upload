/**
 * Scene pacing constants — single source of truth for the Remotion
 * renderer. Round-Video-Backgrounds-v1 deleted the MoviePy fallback
 * (`web_runner/studio_render.py`) and the legacy Hyperframes Node
 * bridge (`hyperframes/render.js`), so the Python route now derives
 * `sceneDurationFrames` here-via-`render.mjs`'s `sceneDurationSec`
 * call from the same math this module exports. There is exactly ONE
 * renderer (Remotion) behind these constants; no cross-backend
 * drift possible because there are no other backends.
 *
 * Vitest unit-tests pin these values so a future preset or
 * `render_config` change that mutates the contract fails CI
 * immediately instead of landing in production with a per-card
 * duration drift.
 */

export const FPS = 30

/**
 * Canvas dimensions for 9:16 vertical short-form. Mirrors `render.mjs`
 * ASS header (`PlayResX: 1080 / PlayResY: 1920`) so the on-disk MP4
 * and the `captions.srt`/`.ass` sidecars agree on the same coordinate
 * system. Without these, `<Composition ... width={WIDTH} height={HEIGHT}>`
 * in `Root.tsx` and `calculateStudioMetadata` fallback width/height
 * resolve to `undefined` (TypeScript happily transpiles missing
 * exports silently) and Remotion 4's strict prop-validation throws
 * at selectComposition time: `The "width" prop of the "<Composition />"
 * component with the id "StudioProject" must be a number, but you passed
 * a value of type undefined.` This was the masked-behind-exit-3
 * blocker in the demo — `render.mjs`'s catch too-broad-relabel
 * hid the real cause for several debug rounds. Keep these values
 * byte-for-byte aligned with `render.mjs`'s `PlayResX/PlayResY`.
 */
export const WIDTH = 1080
export const HEIGHT = 1920

/** Average Chinese-heavy reading pace (CJK reads slower than Latin). */
export const CHARS_PER_SEC = 14

/** Minimum scene duration so a card with a 1-character body still breathes. */
export const MIN_SCENE_SEC = 3

/** Maximum scene duration so a long monologue does not lock the screen. */
export const MAX_SCENE_SEC = 8

/** Cross-fade between consecutive scenes. 0 for the single-scene case. */
export const FADE_SEC = 0.4

/**
 * Per-scene duration (seconds). Body length is measured by JS
 * `String.length` (UTF-16 code units). For CJK-heavy text this
 * matches Python `len(str(body))` closely enough that a Python-side
 * reassessment of `sceneDurationSec` would surface a parity delta
 * via vitest (no separate TextEncoder path here — render is
 * approximate).
 *
 * Historical note: Round-Video-Backgrounds-v1 removed the MoviePy
 * fallback that mirrored this math under `_scene_duration`. The
 * `web_runner/studio_render.py` module no longer exists; the same
 * min(MIN_SCENE_SEC, max(MAX_SCENE_SEC, len / CHARS_PER_SEC))
 * clamp is now the only renderer math.
 */
export function sceneDurationSec(body: string): number {
  const secs = body.length / CHARS_PER_SEC
  return Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, secs))
}

/** Per-scene duration in Remotion frames (30 fps). */
export function sceneDurationFrames(body: string): number {
  return Math.round(sceneDurationSec(body) * FPS)
}

/** Sum of per-scene durations across the whole script. */
export function totalScenesDurationSec(
  scenes: ReadonlyArray<{ body: string }>,
): number {
  return scenes.reduce((acc, s) => acc + sceneDurationSec(s.body), 0)
}

/** Sum of per-scene durations in frames. */
export function totalScenesDurationFrames(
  scenes: ReadonlyArray<{ body: string }>,
): number {
  return scenes.reduce((acc, s) => acc + sceneDurationFrames(s.body), 0)
}

/** Cross-fade duration in frames. 0 when there is at most one scene. */
export function transitionFrames(sceneCount: number): number {
  return sceneCount > 1 ? Math.round(FADE_SEC * FPS) : 0
}

/**
 * Alias for `transitionFrames` so call sites can read foreground
 * ("fade") rather than background ("transition") — `StudioProject.tsx`
 * imports `fadeFrames as fadeFramesCalc` for symmetry with the Python
 * side's `_fade_frames` helper, and adding the re-export here keeps a
 * single underlying implementation while letting the read-site pick
 * the vocabulary closer to its domain.
 */
export const fadeFrames = transitionFrames
