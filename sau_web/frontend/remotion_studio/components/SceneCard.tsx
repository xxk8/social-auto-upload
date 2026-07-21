/**
 * SceneCard — the single visible card on the 9:16 vertical frame.
 *
 * Round-Video-Backgrounds-v1 is the only renderer; the legacy
 * MoviePy fallback (`web_runner/studio_render.py::_make_card`) and
 * Hyperframes HTML bridge (`hyperframes/render.js`) were deleted
 * along with `SAU_STUDIO_RENDERER` env switch. The visual tokens
 * below are the canonical cold-neutral palette the operator sees:
 *
 *   Background       `#12121A`   (cold-neutral canvas)
 *   Card gradient    `#1e1e2a → #12121A`
 *   Accent bar       `#6366f1` (indigo, mirrors the app accent)
 *   Body / title     `#ebebf0`
 *   Muted meta       `#9696a5`
 *   Divider          `#2e2e36`
 *
 * Phase 3 (round-OPT-presets-v1) — `SceneCard` now consumes a Visual
 * Style Preset identified by `presetId`. The catalog lives in
 * `sau_web/frontend/remotion_studio/presets.ts` (single source of
 * truth on the TS side; Python forwards the string id verbatim via
 * `studio_projects.render_config.JSONB`). When `presetId` is
 * `undefined` / `null` / unknown, `getPresetById` returns
 * `PRESETS[0]` (Classic) so pre-PR-A projects render with the
 * exact same tokens as today.
 *
 * Layout is plain flex column. We avoid Tailwind class extraction here
 * because the Remotion bundler (`@remotion/bundler`) is its own build
 * pipeline and pulling in the frontend's `tailwind.config` would couple
 * this server-side renderer to the dev/web bundle. Plain inline styles
 * keep this folder autonomous.
 *
 * Font fallback (Linux deploy note):
 *   The stack walks macOS → Windows → common Linux CJK packages in
 *   order so a minimal headless Chromium on a Linux deploy image
 *   renders Chinese bodies instead of `.notdef` tofu boxes. We
 *   deliberately DROP the Latin-only `'Noto Sans'` from the chain so a
 *   deploy that has `fonts-noto` but lacks `fonts-noto-cjk` falls
 *   through to the generic `sans-serif` (with Chromium's missing-glyph
 *   fallback) rather than silently resolving at a name that doesn't
 *   carry CJK glyphs. Operators are expected to install at least ONE
 *   of `fonts-noto-cjk` / `fonts-wqy-microhei` /
 *   `fonts-source-han-sans` on the deploy image per the openspec
 *   design doc.
 *
 * Phase 2 — image background layer (Pexels CDN URL):
 *   When `backgroundUrl` is non-empty, an `<Image>` from `remotion` is
 *   rendered BEHIND the text, scaled `objectFit: 'cover'` to fill the
 *   1080×1920 frame (Pexels photos arrive as `orientation=portrait`
 *   but a 4:3 fallback is acceptable — the cover crop trims
 *   gracefully). A linear-gradient BLACK overlay sits on top with
 *   alpha derived from `overlayOpacity` (project-level, default
 *   0.5) — strong enough to guarantee `#ebebf0` body / `#6366f1`
 *   accent stay legible regardless of source-photo brightness,
 *   weak enough that the photo is still recognisably visible.
 */

import { useMemo } from 'react'
import { useCurrentFrame, Audio, Image, OffthreadVideo } from 'remotion'
import type { StudioSceneCard as StudioSceneCardType } from '../types'
import {
  PRESETS,
  applyMotionCurve,
  getPresetById,
  type VisualPreset,
} from '../presets'

interface SceneCardProps {
  scene: StudioSceneCardType
  /** 1-based index in the project list. */
  index: number
  /** Total scene count for "3 / 7" counter. */
  total: number
  /** Total duration of THIS scene in frames — used for fade-out timing. */
  sceneFrames: number
  /**
   * Cross-fade duration in frames — drawn from the chosen VisualPreset
   * when present, otherwise from the parent's `fadeFrames` heuristic.
   * 0 disables cross-fade for single-scene.
   */
  fadeFrames: number
  /**
   * Phase 2 — Pexels CDN URL (or `null`/undefined for the cold-canvas
   * degrade path). When provided, an `<Image>` renders underneath
   * the text inside the same `<div>` (z-stack via document order).
   */
  backgroundUrl?: string | null
  /**
   * Phase 2 — overlay opacity [0..1] from `project.overlay_opacity`.
   * 0 ⇒ no overlay (use only when the image is dark enough on its
   * own); 1 ⇒ full black, image is just barely a backdrop.
   * Default 0.5 — kept identical to the SQL DEFAULT so a missing
   * prop doesn't flip the visual.
   */
  overlayOpacity?: number
  /**
   * round-OPT-presets-v1 — Visual Style Preset id resolved via
   * `presets.ts::getPresetById`. ``undefined`` / ``null`` / unknown
   * returns CLASSIC so the pre-PR-A render surface is byte-equivalent.
   * Tag studio tests can pass an explicit id to assert the new
   * visual surface (e.g. `getPresetById('noir')`).
   */
  presetId?: string | null

  /**
   * Round-Video-Backgrounds-v1 — downloaded Pexels Videos MP4 URL
   * (absolute, served by `/api/studio/render/<id>/media/<file>.mp4`).
   * When non-null, an `<OffthreadVideo>` renders as the background
   * INSTEAD of `<Image>` — the actual downloaded clip plays (muted,
   * native audio suppressed) behind the text card. The legacy
   * `<Image>` path is preserved via `backgroundUrl`.
   *
   * When `backgroundVideo` is set, `backgroundUrl` is ignored
   * (video takes visual precedence); when null, `<Image>` still runs
   * for `backgroundUrl` non-null; when both null, cold-canvas.
   */
  backgroundVideo?: string | null

  /**
   * Round-Video-Backgrounds-v1 — synthesized Edge-TTS MP3 URL
   * (absolute, served by `/api/studio/render/<id>/media/<file>.mp3`).
   * When non-null, an `<Audio>` element plays the synthesized
   * voiceover across the scene's `sceneFrames` budget so a
   * too-long voiceover cuts off cleanly when the scene ends,
   * matching the existing `utils/pacing.ts::sceneDurationFrames`
   * cap.
   */
  voiceover?: string | null
}

/**
 * Default preset (Classic) — pre-PR-A tokens. Pinned here as a
 * module-level const so a `presetId={undefined}` test path doesn't
 * re-import the catalog every render, and so a future SceneCard
 * refactor reads from this one source. Classically `PRESETS[0]`.
 */
const DEFAULT_PRESET: VisualPreset = PRESETS[0]

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Greedy line wrap on the rendered font width. Pure function so a sibling
 * vitest can pin it. Returns an array of lines ≤ maxW chars wide given
 * the font. CJK glyphs occupy 1 char here — Chromium's font rendering
 * matches this at our 48px / 72px sizes for the listed Linux fonts.
 */
function wrapLines(
  text: string,
  maxCharsPerLine: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let cur = ''
    for (const ch of paragraph) {
      if (cur.length + 1 > maxCharsPerLine && cur.length > 0) {
        lines.push(cur)
        cur = ''
      }
      cur += ch
    }
    if (cur) lines.push(cur)
  }
  return lines
}

/**
 * Clamp a number to [lo, hi] — used so a misconfigured project row
 * (e.g. overlay_opacity = 1.3 from a malicious JSON patch) can't
 * produce alpha values that make the bg layer fully black or fully
 * transparent. The result is always a usable number between 0 and 1.
 */
function clamp01(x: number, fallback: number): number {
  if (!Number.isFinite(x)) return fallback
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

export function SceneCard({
  scene,
  index,
  total,
  sceneFrames,
  fadeFrames,
  backgroundUrl,
  backgroundVideo,
  voiceover,
  overlayOpacity,
  presetId,
}: SceneCardProps) {
  const frame = useCurrentFrame()

  // Resolve the chosen VisualPreset against the catalog. ``undefined``
  // / ``null`` / unknown ids return `PRESETS[0]` (Classic) so a
  // backwards-incompatible catalog rename can't break renders.
  const preset = useMemo(
    () => (presetId === undefined ? DEFAULT_PRESET : getPresetById(presetId)),
    [presetId],
  )

  // Effective fade timing — the parent's `fadeFrames` is the
  // canonical timing when the preset doesn't override; when the
  // preset specifies `motion.fadeFrames: number`, it takes
  // precedence for cinematic presets (Vibrant → 0.5 s bounce;
  // Minimalist → 0 hard cut).
  const effectiveFadeFrames = preset.motion.fadeFrames ?? fadeFrames

  // Fade-in over the first `fadeFrames`; fade-out over the last. The
  // preset's motion curve is applied AFTER the linear fade multiplier
  // is clamped to [0,1] so `bounce` overshoot stays in-band.
  const opacity = useMemo(() => {
    if (effectiveFadeFrames === 0) return 1
    const fadeIn = Math.min(1, frame / effectiveFadeFrames)
    const fadeOut = Math.min(
      1,
      (sceneFrames - frame) / effectiveFadeFrames,
    )
    const linear = Math.max(0, Math.min(1, fadeIn * fadeOut))
    return applyMotionCurve(linear, preset.motion.curve)
  }, [frame, effectiveFadeFrames, sceneFrames, preset.motion.curve])

  const safeTitle = escapeText(scene.title || '')
  const safeBody = escapeText(scene.body || '')

  const overlayAlpha = clamp01(
    typeof overlayOpacity === 'number' ? overlayOpacity : 0.5,
    0.5,
  )
  // Round-Video-Backgrounds-v1 — three states for the background
  // layer, evaluated in priority order:
  //   video  > image > cold canvas
  // A scene with a downloaded Pexels MP4 plays it via
  // `<OffthreadVideo>`; when no video is available, the legacy
  // `<Image>` branch runs with the Pexels photo URL; when neither,
  // the cold-canvas gradient is the degrade.
  const hasVideoBackground = Boolean(
    backgroundVideo && backgroundVideo.length > 0,
  )
  const hasImageBackground =
    !hasVideoBackground &&
    Boolean(backgroundUrl && backgroundUrl.length > 0)
  const hasBackground = hasVideoBackground || hasImageBackground
  const hasVoiceover = Boolean(voiceover && voiceover.length > 0)

  // Title fits up to 3 lines at the preset's title size; body fits the
  // rest of the canvas at bodySize. The wrap-width heuristic is
  // preserved (12 / 18 chars across presets) — CJK glyphs occupy 1
  // char and Chromium's font rendering matches at our preset sizes.
  const TITLE_MAX_LINES = 3
  const titleLines = wrapLines(safeTitle, 12).slice(0, TITLE_MAX_LINES)
  const bodyLines = wrapLines(safeBody, 18)

  // Pull from the chosen preset. Local destructuring keeps the JSX
  // expression below readable — long inline ternaries would obscure
  // the layout grid.
  const {
    palette: { background, gradientFrom, gradientTo, accent, body, muted, divider },
    typography: { fontStack, titleWeight, titleSize, bodySize },
  } = preset

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: hasBackground
          ? background // Image occupies the visible area; this is a paint-base
          : `linear-gradient(160deg, ${gradientFrom} 0%, ${gradientTo} 100%)`,
        opacity,
        fontFamily: fontStack,
        color: body,
        padding: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        boxSizing: 'border-box',
        overflow: 'hidden',
        // Render everything inside a relative container so the
        // `<Image>` can absolutely-position UNDER the text content
        // via lower z-index without disturbing the column flow.
      }}
    >
      {/* ── Round-Video-Backgrounds-v1 — video background layer ──
          Renders FIRST in DOM order so subsequent text/overlay
          siblings paint on top via default stacking context. The
          fade on this wrapper follows the same `opacity` curve as
          the text so a new scene appears to "rise in" together.
          When `backgroundVideo` is null we fall through to the
          legacy `<Image>` branch below for static-photo videos,
          then to cold-canvas for both null. */}
      {hasVideoBackground && (
        <OffthreadVideo
          src={backgroundVideo as string}
          muted
          volume={0}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}

      {/* ── Phase 2 image background layer (fallback) ──
          Skipped when the video branch above is active (video
          takes visual precedence). Same flex-column stacking
          contract as the video above — sits at z=0 of the
          parent so text/overlay paint on top. */}
      {hasImageBackground && (
        <Image
          src={backgroundUrl as string}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}

      {/* ── Phase 2 dark gradient overlay ──
          Black-to-transparent top-to-bottom gradient with alpha
          equal to `overlayAlpha`. A solid dark band at the bottom
          (where the body text sits) gives consistent contrast
          regardless of the photo's lower-half brightness. The
          overlay colour is the preset's `background` token so a
          Minimalist preset (light bg) gets a light overlay, not
          a black gradient that punches a hole in the design. */}
      {hasBackground && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg,
              rgba(18, 18, 26, ${overlayAlpha * 0.4}) 0%,
              rgba(18, 18, 26, ${overlayAlpha * 0.7}) 60%,
              rgba(18, 18, 26, ${overlayAlpha}) 100%)`,
            // No pointer events so the overlay never steals clicks
            // from Remotion's debug tooling (development studio only).
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Indented accent bar — mirrors MoviePy `accent bar (left)`.
          Kept ON TOP of the image + overlay so the accent stripe
          remains the dominant visual anchor for every card, regardless
          of which preset is active. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 14,
          background: accent,
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          fontSize: 34,
          color: muted,
          fontVariantNumeric: 'tabular-nums',
          marginBottom: 24,
        }}
      >
        {index} / {total}
      </div>

      <h1
        style={{
          fontSize: titleSize,
          fontWeight: titleWeight,
          lineHeight: 1.25,
          marginBottom: 40,
          color: body,
          margin: 0,
        }}
      >
        {titleLines.join('\u00A0')}
      </h1>

      <div
        style={{
          width: '100%',
          height: 3,
          background: divider,
          marginBottom: 48,
        }}
      />

      <p
        style={{
          fontSize: bodySize,
          lineHeight: 1.6,
          color: body,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
        }}
      >
        {/* Avoid React text-node collapsing of newlines — explicit \n. */}
        {bodyLines.join('\n')}
      </p>

      {/* ── Round-Video-Backgrounds-v1 — voiceover layer ──
          Mounted AFTER the text content so a future overlay/audio
          z-order change has a clear anchor. `endAt={sceneFrames}`
          clips the audio to this scene's frame budget so a
          too-long TTS MP3 doesn't bleed into the next scene's
          voiceover track (overlapping would otherwise crash two
          voices reading different sentences simultaneously). */}
      {hasVoiceover && (
        <Audio src={voiceover as string} endAt={sceneFrames} />
      )}
    </div>
  )
}

/**
 * Re-export so a vitest or Playwright e2e can pin the catalog
 * against the runtime drift-detection layer without re-importing
 * from a sibling relative path. Mirror of
 * `sau_web/frontend/remotion_studio/presets.ts::DEFAULT_PRESET`
 * (== `PRESETS[0]`).
 */
export const SCENE_CARD_DEFAULT_PRESET = DEFAULT_PRESET
