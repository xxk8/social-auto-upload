/**
 * index.ts — Remotion 4 bundle entry point.
 *
 * `render.mjs` (the Flask-side Node bridge that produces MP4s)
 * calls `bundle({ entryPoint: resolve(here, 'index.ts') })` from
 * `@remotion/bundler` v4.0.486. Remotion 4's bundler REQUIRES the
 * entry-point module to call `registerRoot(...)` at module-init
 * time — a plain `export default RemotionRoot` is rejected with
 * `this file does not contain 'registerRoot'. You should use the
 * file that calls registerRoot() as the entry point.` (the way to
 * ignore is to pass `ignoreRegisterRootWarning` but the CLI does
 * not honour that flag, so the validation is hard-required).
 *
 * The entry-point module side-effect of calling `registerRoot`
 * mounts the React composition tree into Remotion's internal
 * CompositionManager, which `selectComposition({ serveUrl, id })`
 * later queries to find the `<Composition id="StudioProject">`
 * defined in `./Root.tsx`. Without this side-effect, the bundler
 * bundles the React module but no composition is registered →
 * `selectComposition` returns no match → `renderMedia` exits with
 * "composition 'StudioProject' not found in bundle".
 *
 * This file is intentionally a thin re-export. The actual
 * composition definitions live in `./Root.tsx`. Keeping the
 * re-export thin means a future change (e.g. registering a second
 * composition for the companion `studio-ai-video-renderer` openspec)
 * either adds a `<Composition>` next to the existing one inside
 * `RemotionRoot` (zero changes to this file) OR composes multiple
 * registered roots here.
 *
 * round-OPT-presets-v1 addendum (debugging note):
 * Earlier the file used `export { RemotionRoot as default }` which
 * is the pre-Remotion-4 idiom. @remotion/bundler 4.x now rejects it
 * — the runtime symptom was `composition 'StudioProject' not found
 * in bundle` because no composition registration side-effect ran.
 */

import { registerRoot } from 'remotion'
import { RemotionRoot } from './Root'

registerRoot(RemotionRoot)
