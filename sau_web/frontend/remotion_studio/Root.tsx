/**
 * Remotion entry point (`@remotion/bundler` resolves this when it bundles
 * `index.ts`). The `calculateMetadata` function reads inputProps after
 * `bundle()` so the dynamic per-project `durationInFrames` arrives BEFORE
 * `renderMedia()`. Without this, Remotion would lock us to a fallback
 * fixed `durationInFrames` and we would either truncate the video at the
 * end or waste frames stretching a short script.
 *
 * The fallback `durationInFrames` of 30 * 60 (60 s) is generous enough
 * to cover a 7-card script at MAX_SCENE_SEC=8. After bundling the bridge
 * `render.mjs` overrides it via `selectComposition` which runs
 * `calculateMetadata` with the project inputProps.
 */

import type { CalculateMetadataFunction } from 'remotion'
import { Composition } from 'remotion'
import { StudioProject } from './components/StudioProject'
import type { StudioRenderInputProps } from './types'
import {
  FPS,
  HEIGHT,
  WIDTH,
  totalScenesDurationFrames,
} from './utils/pacing'

export const DEFAULT_DURATION_FRAMES = FPS * 60

export const calculateStudioMetadata: CalculateMetadataFunction<
  StudioRenderInputProps
> = async ({ props }) => {
  const total = totalScenesDurationFrames(props.scenes ?? [])
  // Always at least 1 frame so `Composition` renders something even
  // when the bridge sends an empty list — render.mjs guarantees ≥1 scene.
  const durationInFrames = Math.max(1, total)
  return {
    durationInFrames,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
  }
}

// Resolver lives in `../presets.ts` as `resolveStoredPresetId` —
// shared by `<StudioProject>` and the picker UI page so the
// "raw stored preset id" read site is single-source. Nothing to
// do here because `RemotionRoot`'s composition property bag
// already carries `props` through to `<StudioProject>`.

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="StudioProject"
        component={StudioProject}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        calculateMetadata={calculateStudioMetadata}
      />
    </>
  )
}
