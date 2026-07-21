/**
 * StudioProject — the 9:16 vertical composition that turns a storyboard
 * (synopsis + episodes.scenes + episodes.dialogues) into a short-form
 * reel. Each scene is its own `Series.Sequence` with a per-card duration
 * computed from `utils/pacing.ts` so the React tree mirrors what the
 * Python bridge (`render.mjs`) computed pre-bundling.
 *
 * Remotion 4 reads inputProps via the bundle entrypoint (Root.tsx) and
 * preserves them across frames. We never `useVideoConfig` here because
 * the WIDTH/HEIGHT/FPS are fixed by the Root composition declaration.
 */

import { AbsoluteFill, Series } from 'remotion'
import type { StudioRenderInputProps } from '../types'
import { SceneCard } from './SceneCard'
import { resolveStoredPresetId } from '../presets'
import {
  fadeFrames as fadeFramesCalc,
  sceneDurationFrames,
} from '../utils/pacing'

/**
 * round-OPT-presets-v1 — read the persisted Visual Style Preset id
 * via the single-source resolver in `../presets.ts`. ``undefined``
 * / ``null`` / unknown ids flow through to `SceneCard` which
 * resolves via `getPresetById` to the Classic preset. We propagate
 * the raw id (not a resolved preset) so `SceneCard` is the single
 * resolver point — easier to vitest if needed.
 *
 * Tag studies on the Studio runbook for this: Row 14 of `docs/dev/
 * studio-renderer-ops.md` — once that lands, the picker dropdown in
 * `StudioDetailPage.tsx` writes the chosen id to the JSONB column
 * via PATCH /api/studio/projects/{id}. This composition then renders
 * the corresponding palette at next bridge spawn.
 */
export const StudioProject = ({
  project,
  scenes,
  backgroundUrls,
  backgroundVideos,
  voiceovers,
}: StudioRenderInputProps) => {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    // Should never run — render.mjs guarantees ≥1 scene (with a "(暂无内容)"
    // placeholder when the project has no body). Render a single
    // diagnostic card so the failure is debuggable instead of a black
    // 9:16 frame.
    return (
      <AbsoluteFill
        style={{
          background: '#12121A',
          color: '#9696a5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
        }}
      >
        no scenes
      </AbsoluteFill>
    )
  }

  const total = scenes.length
  const fade = fadeFramesCalc(total)
  const presetId = resolveStoredPresetId(project)

  return (
    <AbsoluteFill style={{ background: '#12121A' }}>
      <Series>
        {scenes.map((scene, i) => {
          const dur = sceneDurationFrames(scene.body)
          return (
            <Series.Sequence
              key={i}
              durationInFrames={dur}
              name={scene.title || `scene-${i + 1}`}
            >
              <SceneCard
                scene={scene}
                index={i + 1}
                total={total}
                sceneFrames={dur}
                fadeFrames={fade}
                presetId={presetId}
                // Round-Video-Backgrounds-v1 — individual video /
                // voiceover URLs per scene. SceneCard's render
                // branches pick `<OffthreadVideo>` over `<Image>`
                // when `backgroundVideo` is non-null.
                backgroundUrl={backgroundUrls?.[i] ?? null}
                backgroundVideo={backgroundVideos?.[i] ?? null}
                voiceover={voiceovers?.[i] ?? null}
              />
            </Series.Sequence>
          )
        })}
      </Series>
    </AbsoluteFill>
  )
}

// Re-export the props type so Root.tsx can declare a stable
// `<Composition ... defaultProps>` shape without re-importing the type
// from a relative path.
export type { StudioRenderInputProps }
