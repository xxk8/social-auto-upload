#!/usr/bin/env node
/**
 * render.mjs — Node bridge that turns a Studio project payload into an
 * MP4 via Remotion 4. The Flask Studio route pipes the same JSON shape
 * as the legacy `hyperframes/render.js` script + `web_runner/studio_render.py`
 * MoviePy fallback, so flipping `SAU_STUDIO_RENDERER` between values
 * stays a one-env-var operation with the same input contract on every
 * backend.
 *
 * Invocation:
 *   echo '{"project":{...},"episodes":[...]}' \
 *     | node render.mjs --out /path/to/render.mp4
 *
 * Output (stdout, single line):
 *   {"success":true,"duration":12.4,"width":1080,"height":1920}
 *
 * Errors (stderr, multi-line):
 *   ERROR: <message>
 *   <stack trace>
 *
 * Side-effect artifacts in `dirname(out)`):
 *   - render.mp4
 *   - captions.srt
 *   - captions.ass
 *
 * Exit codes:
 *   1 = --out missing
 *   2 = stdin JSON parse failed
 *   3 = composition 'StudioProject' missing from bundle
 *   4 = renderMedia failed (see stderr stack)
 *   5 = node preflight failed (binary missing or version < 20)
 *   0 = success
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundle } from '@remotion/bundler'
import {
  renderMedia,
  selectComposition,
} from '@remotion/renderer'

// ── argument parsing ────────────────────────────────────────────────

const args = process.argv.slice(2)
let outPath = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    outPath = args[i + 1]
    i++
  }
}
if (!outPath) {
  process.stderr.write('ERROR: --out <path> is required\n')
  process.exit(1)
}

// ── import.meta.dirname (Node 20.11+, project ships v26) ───────────

const here =
  import.meta.dirname ??
  dirname(fileURLToPath(import.meta.url))

// ── stdin JSON → payload ───────────────────────────────────────────

let payload
try {
  const raw = readFileSync(0, 'utf-8')
  payload = JSON.parse(raw)
} catch (e) {
  process.stderr.write(`ERROR: failed to parse stdin JSON: ${e.message}\n`)
  process.exit(2)
}

const { project = {}, episodes = [] } = payload

// Pre-computed scenes (Phase 2). When the Python manifest supplies
// a flat `scenes[]` (the preferred contract — source of truth for
// scene ordering), the bridge uses it verbatim. Otherwise we fall
// through to `buildScenes()` from `episodes[]` (Phase 1 contract).
// A parallel `background_urls[]` (also from Python) lands side-by-
// side; index `i` aligns to `scenes[i]`. `overlay_opacity` rides
// on `project.overlay_opacity` for the dark-gradient overlay in
// `<SceneCard>`.
const payloadScenes = Array.isArray(payload.scenes) ? payload.scenes : null
const payloadBackgroundUrls = Array.isArray(payload.background_urls)
  ? payload.background_urls
  : null
// Round-Video-Backgrounds-v1 — parallel-array video and voiceover
// inputs from the Python side (`web_runner/routes/studio.py`).
// Both are absolute HTTP URLs the headless Chromium inside Remotion
// fetches during `renderMedia()`. The Python side builds them via
// `_build_absolute_url()` (uses `flask.request.host_url` so a reverse
// proxy reports the operator's URL, not Flask's localhost).
const payloadBackgroundVideos = Array.isArray(payload.background_videos)
  ? payload.background_videos
  : null
const payloadVoiceovers = Array.isArray(payload.voiceovers)
  ? payload.voiceovers
  : null
const payloadOverlayOpacity = Number(
  payload.overlay_opacity ?? project.overlay_opacity ?? 0.5,
)

// ── node version preflight ──────────────────────────────────────────
// Remotion 4 (and the Vite/Webpack pipeline it bundles) require Node
// ≥ 20. Fail fast here so the operator sees a clear remediation
// (upgrade node OR set SAU_STUDIO_NODE_PATH to a v20+ binary) instead
// of an opaque webpack/loader error from inside bundle().  We use the
// system `node` here because rendering is about to spawn `node2`
// itself; an asdf/volta-managed path is honoured by the Python side
// via SAU_STUDIO_NODE_PATH which spawns a fresh process.

try {
  // Honour `SAU_STUDIO_NODE_PATH` for the preflight so an asdf/volta
  // override is checked against the actual binary we will spawn.
  // Falls back to system PATH `node` — matches the Python side's
  // `node_bin = env.SAU_STUDIO_NODE_PATH or "node"` exactly.
  const nodeBin = process.env.SAU_STUDIO_NODE_PATH || 'node'
  const v = execFileSync(nodeBin, ['--version'], { encoding: 'utf-8' }).trim()
  const majorMatch = v.match(/^v(\d+)/)
  const major = parseInt(majorMatch?.[1] ?? '0', 10)
  if (major < 20) {
    process.stderr.write(
      `ERROR: node ${v} is too old; Remotion 4 requires v20+. Upgrade Node or set SAU_STUDIO_NODE_PATH.\n`,
    )
    process.exit(5)
  }
} catch (e) {
  process.stderr.write(
    `ERROR: cannot run 'node --version': ${e.message}. Is node on PATH or SAU_STUDIO_NODE_PATH set?\n`,
  )
  process.exit(5)
}

// ── pacing constants — mirror web_runner/studio_render.py ──────────

const FPS = 30
const CHARS_PER_SEC = 14
const MIN_SCENE_SEC = 3
const MAX_SCENE_SEC = 8

function sceneDurationSec(body) {
  const secs = String(body || '').length / CHARS_PER_SEC
  return Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, secs))
}

function sceneDurationFrames(body) {
  return Math.round(sceneDurationSec(body) * FPS)
}

// ── scene builder — mirror Python `_build_scenes` + JS render.js ───

function buildScenes() {
  const scenes = []
  const push = (title, body) => {
    const text = String(body || '').trim()
    if (!text) return
    scenes.push({ title: String(title || ''), body: text })
  }

  if (Array.isArray(episodes) && episodes.length) {
    for (const ep of episodes) {
      const scenesJson = Array.isArray(ep.scenes) ? ep.scenes : []
      const dialogues = Array.isArray(ep.dialogues) ? ep.dialogues : []
      if (scenesJson.length || dialogues.length) {
        const chunks = [
          ...scenesJson.map((s) => String(s)),
          ...dialogues.map((d) => String(d)),
        ]
        push(
          `第 ${ep.episode_no ?? '?'} 集 · ${ep.title || ''}`,
          chunks.join('\n'),
        )
      } else if (ep.title) {
        push(`第 ${ep.episode_no ?? '?'} 集`, ep.title)
      }
    }
  }

  if (!scenes.length) {
    const synopsis = String(project.synopsis || '').trim()
    if (synopsis) {
      for (const part of synopsis.replace(/\r/g, '\n').split('\n')) {
        const t = part.trim()
        if (t) push(project.title || '梗概', t)
      }
    }
  }

  if (!scenes.length) {
    scenes.push({
      title: project.title || '未命名',
      body: '（暂无内容）',
    })
  }

  return scenes
}

// Use the Python-pre-computed scenes when present (Phase 2 path),
// otherwise fall through to the JS builder (Phase 1 path used by
// legacy callers / smoke tests).
const scenes = payloadScenes && payloadScenes.length
  ? payloadScenes.map((sc) => ({
      // Defensive re-stringify so sceneDurationFrame(s.body) treats
      // non-strings as empty rather than throwing — the Python side
      // always emits strings, but Node-only smoke tests sometimes
      // hand us objects.
      title: String(sc.title || ''),
      body: String(sc.body || ''),
    }))
  : buildScenes()

const totalFrames = scenes.reduce(
  (acc, s) => acc + sceneDurationFrames(s.body),
  0,
)
// Used for early-debug logs only. The manifest's `duration` field is
// the post-calculateMetadata value from the composition object (single
// source of truth for the rendered MP4).
const totalDurationEarlyLog = totalFrames / FPS

// inputProps — what Root.tsx will receive via Remotion. The
// parallel-array layout is intentional: JSON serialisation is
// cheaper than a richer per-card object, and `<SceneCard>` reads
// `backgroundUrls[i]` by index aligned to its `<Series.Sequence
// key={i}>` ordering.
//
// Round-Video-Backgrounds-v1 — adds `backgroundVideos[i]` and
// `voiceovers[i]`, both parallel arrays aligned index-for-index to
// `scenes[i]`. SceneCard's render branches prefer video over image
// (see `hasVideoBackground` / `hasImageBackground` in
// `components/SceneCard.tsx`) so the visual contract is:
//
//   video present   → play downloaded Pexels MP4 via <OffthreadVideo>
//   image only      → <Image> with Pexels photo (Phase 2 path unchanged)
//   neither         → cold-canvas gradient
//
// and the audio contract is:
//
//   voiceover present → play synthesized Edge-TTS MP3 via <Audio>
//   absent            → silent scene
//
// Old round-OPT-presets-v1 — forward the full `render_config` JSONB
// dict through to the React composition so `Root.tsx` can hand it
// to `presets.ts::getPresetById` for visual resolution. ``null``
// (legacy rows pre-PR-A) is the documented fallback signal;
// `presets.ts` resolves null ids to the Classic preset so the
// operator sees zero visual regression on untouched projects.
const inputProps = {
  project: {
    id: project.id ?? null,
    title: String(project.title || ''),
    synopsis: String(project.synopsis || ''),
    style: project.style ?? null,
    overlayOpacity: payloadOverlayOpacity,
    renderConfig: project.render_config ?? null,
  },
  scenes,
  backgroundUrls: payloadBackgroundUrls
    ? payloadBackgroundUrls.map((u) => (typeof u === 'string' ? u : null))
    : scenes.map(() => null),
  // Round-Video-Backgrounds-v1 — video + voiceover. Both default
  // to `[]` filled with `null` so SceneCard's `backgroundVideos?.[i]
  // ?? null` short-circuit evaluates cleanly even when the Python
  // side skipped the field (e.g. older bridge payloads from a
  // pre-feature Remotion deploy still in the wild).
  backgroundVideos: payloadBackgroundVideos
    ? payloadBackgroundVideos.map((u) => (typeof u === 'string' ? u : null))
    : scenes.map(() => null),
  voiceovers: payloadVoiceovers
    ? payloadVoiceovers.map((u) => (typeof u === 'string' ? u : null))
    : scenes.map(() => null),
  overlayOpacity: payloadOverlayOpacity,
}

// ── subtitle helpers (.srt + .ass) — pure text writes ──────────────

function pad(n, width = 2) {
  return String(n).padStart(width, '0')
}
function formatSrtTime(seconds) {
  const safe = Math.max(0, seconds)
  const ms = Math.floor((safe % 1) * 1000)
  const t = Math.floor(safe)
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)},${pad(ms, 3)}`
}
function formatAssTime(seconds) {
  const safe = Math.max(0, seconds)
  const cs = Math.floor((safe % 1) * 100)
  const t = Math.floor(safe)
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}.${pad(cs)}`
}

function buildSrt(scenes) {
  let t = 0
  const out = []
  let i = 1
  for (const sc of scenes) {
    const d = sceneDurationSec(sc.body)
    out.push(String(i))
    out.push(`${formatSrtTime(t)} --> ${formatSrtTime(t + d)}`)
    out.push(sc.body.replace(/\n/g, ' '))
    out.push('')
    t += d
    i++
  }
  return out.join('\n')
}

function buildAss(scenes) {
  let t = 0
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,PingFang SC,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,60,60,60,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  for (const sc of scenes) {
    const d = sceneDurationSec(sc.body)
    const text = String(sc.body || '').replace(/\n/g, '\\N')
    header.push(
      `Dialogue: 0,${formatAssTime(t)},${formatAssTime(t + d)},Default,,0,0,0,,${text}`,
    )
    t += d
  }
  return header.join('\n')
}

// ── bundle → renderMedia ───────────────────────────────────────────

// monkey-patch stdout-bound console methods during bundle + render.
// Both @remotion/bundler (Vite/Webpack progress) and @remotion/renderer
// progress lines default to console.log → stdout which would interleave
// with our final single-line JSON manifest and break the parent's
// `proc.stdout.decode() -> json.loads` parse. We patch and restore via
// try/finally so a future code path that adds a new exit point cannot
// silently leave stdout muted.
const __origConsoleLog = console.log
const __origConsoleInfo = console.info
const __origConsoleWarn = console.warn
function __silenceConsole() {
  console.log = (...args) =>
    process.stderr.write(args.map(String).join(' ') + '\n')
  console.info = (...args) =>
    process.stderr.write(args.map(String).join(' ') + '\n')
  console.warn = (...args) =>
    process.stderr.write(args.map(String).join(' ') + '\n')
}
function __restoreConsole() {
  console.log = __origConsoleLog
  console.info = __origConsoleInfo
  console.warn = __origConsoleWarn
}

mkdirSync(dirname(outPath), { recursive: true })

try {
  __silenceConsole()

  const bundleLocation = await bundle({
    entryPoint: resolve(here, 'index.ts'),
  })

  // selectComposition runs Root.tsx::calculateStudioMetadata against
  // the actual `inputProps` for THIS project, so the returned
  // composition object carries the post-calculate dynamic
  // durationInFrames (not the bundled default of 1800).  Without
  // this, a 1-card script would render at the bundled fallback
  // duration and either truncate the actual content or waste
  // frames on a black tail — neither matches what calculateMetadata
  // computed. Source of truth for the manifest's `duration`.
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'StudioProject',
    inputProps,
  })

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    outputLocation: outPath,
    inputProps,
    codec: 'h264',
    crf: 22,
    x264Preset: 'ultrafast',
    pixelFormat: 'yuv420p',
    concurrency: null,
    timeoutInMilliseconds: 300000,
    verbose: false,
    chromiumOptions: {
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // Round-Video-Backgrounds-v1 — allow headless Chromium to
        // fetch the downloaded Pexels MP4 / synthesized TTS MP3
        // files from the same-host Flask
        // /api/studio/render/<id>/media/* URL. Without this the
        // chromium same-origin policy refuses the cross-port
        // request from localhost:6001 (Flask) to the same
        // localhost where renderMedia is consuming frames. Safe
        // because the headless Chromium is owned by our Flask
        // process, not a user-facing browser; --disable-web-security's
        // risk surface (a real user browsing malicious cross-origin
        // pages) does not apply.
        '--disable-web-security',
      ],
    },
  })

  // ── subtitle artifacts ───────────────────────────────────────────
  const stem = dirname(outPath)
  writeFileSync(join(stem, 'captions.srt'), buildSrt(scenes), 'utf8')
  writeFileSync(join(stem, 'captions.ass'), buildAss(scenes), 'utf8')

  // ── stdout manifest (single line, parseable) ─────────────────────
  // Use `composition.fps` (post-calculate) instead of the const FPS so
  // the manifest's `duration` stays consistent with the actual MP4
  // length even if a future caller composes at 24/25/29.97 fps.
  // NaN-safe: a corrupted/partial bundle could return composition.fps
  // = 0 or undefined — `|| FPS` keeps the manifest parseable to JSON
  // (otherwise NaN -> `null` via toFixed then breaks json.loads).
  const finalDurationSec = parseFloat(
    (composition.durationInFrames / (composition.fps || FPS)).toFixed(2),
  )
  process.stderr.write(
    `[studio-render] early-log totalDuration=${totalDurationEarlyLog.toFixed(2)}s; ` +
      `post-calculateMetadata=${finalDurationSec}s ` +
      `(composition.durationInFrames=${composition.durationInFrames})\n`,
  )
  const manifest = {
    success: true,
    duration: finalDurationSec,
    width: composition.width,
    height: composition.height,
  }
  process.stdout.write(JSON.stringify(manifest))
  process.exit(0)
} catch (e) {
  // `selectComposition` throws specifically when the requested id
  // is missing from the bundle — distinguishing that from generic
  // renderMedia failures lets the Python route surface exit code 3
  // consistently (config-drift) vs exit code 4 (transient render
  // failure like missing Chromium / OOM / codec error).
  // Differentiate composition-not-found (exit 3) from generic render
  // failures (exit 4). Remotion 4's `selectComposition` typically
  // throws `No composition with ID "StudioProject" was found.` — the
  // exact wording can drift across patches, so we test three patterns
  // (Remotion-specific phrasing, generic alternates, and ID literal
  // fallback) to avoid a brittle single-regex match.
  const errMsg = String(e?.message || '')
  // Operational telemetry: ALWAYS print the raw underlying error before
  // any relabel attempts. Without this, any toolbar/wrapper whose
  // message merely mentions the literal "StudioProject" gets masked
  // as exit-3 "composition not found" regardless of the actual root
  // cause — Chrome SSR failures, Webpack import-graph errors, Chromium
  // launch problems, Three.js / font misses, etc. have all been
  // silently bundled into this exit-class and trapped multiple debug
  // rounds. Next operator: read the `[studio-render] raw-server-error`
  // line above this classification to see the real cause.
  process.stderr.write(`[studio-render] raw-server-error: ${errMsg}\n`)
  if (e?.stack) process.stderr.write(`[studio-render] raw-server-stack: ${e.stack}\n`)
  // Differentiate "composition not found" (exit 3 — config drift) from
  // generic render / SSR failures (exit 4 — transient). Match the
  // ACTUAL Remotion 4 wording so the broad `errMsg.includes(
  // 'StudioProject')` literal-fallback (which previously matched every
  // error merely mentioning the id and hid the true cause) is gone.
  if (
    errMsg.match(/no composition with id ['"]StudioProject['"]/i) ||
    errMsg.match(/composition.*(?:not found|was found)/i)
  ) {
    process.stderr.write(
      "ERROR: composition 'StudioProject' not found in bundle\n",
    )
    process.exit(3)
  }
  process.stderr.write(`ERROR: ${e?.message ?? String(e)}\n`)
  if (e?.stack) process.stderr.write(`${e.stack}\n`)
  process.exit(4)
} finally {
  // Single source of truth for restoring stdout-bound console methods.
  // Even though `process.exit()` short-circuits the rest of the
  // finally block, V8 still runs finally BEFORE exit so restoration
  // still happens before any swallowed stderr deferral.
  __restoreConsole()
}
