/**
 * Visual Style Presets — round-OPT-presets-v1
 *
 * Single source of truth for the Studio renderer preset catalog. The
 * Python side (`web_runner/routes/studio.py` `_serialize_project` /
 * `_validate_update_payload` / `_render_via_remotion`) is a pure
 * pass-through for the `render_config.preset` string id; the bridge
 * reads it from `payload.project.render_config.preset` and asks THIS
 * module for the matching VisualPreset.
 *
 * Why a TS-only catalog (option A1):
 *   * The catalog is consumed at render time by the Remotion
 *     React composition. A shared JSON-file source adds a build-time
 *     dependency on a fs loader + a runtime dependency on a Python
 *     loader — both can drift independently. Hardcoded in TS keeps
 *     the 3 entries provably in lock-step with the React
 *     composition's expectations (font-family strings, exact hex
 *     tokens, etc.).
 *   * Adding a 4th preset is a single-file edit; versioning the
 *     catalog in version control gives PR-A atomic provenance.
 *   * Python's `_validate_update_payload` does NOT whitelist ids.
 *     Unrecognized ids are STORED VERBATIM in the JSONB column and
 *     resolved at render-time by `getPresetById` below. This is
 *     intentional flexibility: a future catalog rename ("noir" →
 *     "noir-deep") keeps existing rows renderable; the picker UI's
 *     "Unknown preset — falling back to Classic" toast surfaces
 *     the drift to the operator immediately on first paint.
 *
 * Schema (option D2 — bare id + explicit `version: 1` for forward-
 * compat):
 *   * `id`     — case-sensitive kebab-case string. Stable
 *                identifier; do NOT rename without backfilling
 *                existing JSONB rows. Max length 64 (enforced server-
 *                side by `_validate_render_config`).
 *   * `label`  — human display name for the picker.
 *   * `description` — one-line "what's this for" copy shown on hover
 *                and in the dev catalog.
 *   * `palette`     — 6 colour tokens replacing the existing
 *                hard-coded hex values inside `<SceneCard>`. Same
 *                slot names as the existing implementation so a
 *                future SceneCard refactor can read them straight
 *                from a single source.
 *   * `typography`  — font stack + sizes + weight. The existing
 *                SceneCard uses inline `fontFamily` + per-line
 *                `fontSize` props; these slots map 1:1 to those
 *                props so component surfacing stays trivial.
 *   * `motion`      — option C2 (compact): just `fadeFrames`
 *                (integer ceiling overriding the existing
 *                `utils/pacing.ts::fadeFrames()` calc when non-null)
 *                and `motionCurve: 'linear' | 'ease' | 'bounce'`.
 *                `fadeFrames=0` disables cross-fade; `bounce` adds
 *                an overshoot envelope in `<SceneCard>` via the
 *                easeInOutBack cubic-bezier (still in the existing
 *                `Math.max(0, Math.min(1, fadeIn * fadeOut))` cap so
 *                we don't snap past 0 or 1). Smaller blast radius
 *                than C1 (3 features + curve) — a future PR can
 *                extend.
 *
 * Adding a preset:
 *   1. Append an entry to `PRESETS` (id stable; pick a kebab-case
 *      name unlikely to clash).
 *   2. Pick a palette/typography/motion that differs visibly from
 *      the other 3 entries (or explain why it's a deliberate
 *      duplicate).
 *   3. Add a pytest case in `tests/test_studio_presets.py` covering
 *      `getPresetById(<new_id>)` returns the entry.
 *   4. Add a vitest snapshot case (if the picker dropdown gets one).
 *   5. Update the picker label list in `StudioDetailPage.tsx` (the
 *      dropdown is bound to `PRESETS` via a `useMemo`, so this is
 *      usually a one-line change).
 */

export type MotionCurve = 'linear' | 'ease' | 'bounce'

/**
 * Motion descriptor (option C2). Smaller than C1's
 * `(fadeInMs, fadeOutMs, transition)` triple; only overrides the
 * bits the existing `<SceneCard>` already reads via `sceneFrames`
 * + `fadeFrames` props. Adding a `transition: 'zoom'` field for
 * "Vibrant" would require C1 + a SceneCard refactor — punt to a
 * follow-up PR.
 */
export interface VisualMotion {
  /**
   * Frames for both fade-in AND fade-out around each scene, when
   * non-null. When null, `<SceneCard>` falls back to the existing
   * `utils/pacing.ts::fadeFrames(N scenes)` heuristic. Range 0..30 at
   * 30 fps = max 1 second of cross-fade per side. `0` disables cross-
   * fade entirely.
   */
  fadeFrames: number | null
  /**
   * Easing curve for the fade. `<SceneCard>` reads this and applies
   * a per-curve cubic-bezier mapper to the `fadeIn * fadeOut`
   * envelope. `bounce` adds a subtle overshoot (easeInOutBack
   * quadratic equivalent) for the high-energy presets (Vibrant);
   * `linear` is the un-curved default for Minimalist.
   */
  curve: MotionCurve
}

export interface VisualPalette {
  /** Cold-neutral canvas / paint-base (replaces `#12121A`). */
  background: string
  /** Card gradient start (replaces `#1e1e2a`). */
  gradientFrom: string
  /** Card gradient end (replaces `#12121A`). */
  gradientTo: string
  /** Accent bar (replaces `#6366f1`). */
  accent: string
  /** Body / title (replaces `#ebebf0`). */
  body: string
  /** Muted meta (replaces `#9696a5`). */
  muted: string
  /** Divider line (replaces `#2e2e36`). */
  divider: string
}

export interface VisualTypography {
  /**
   * Full font-family stack with CJK fallback intact. Keeping the
   * existing walk ping-fang → yahei → noto-cjk → wqy → source-han →
   * liberation in the chain so a Linux deploy without
   * `fonts-noto-cjk` still falls through gracefully.
   */
  fontStack: string
  /** H1 weight — replaces `fontWeight: 700`. */
  titleWeight: number
  /** H1 size (px) — replaces `fontSize: 72`. */
  titleSize: number
  /** Body size (px) — replaces `fontSize: 48`. */
  bodySize: number
}

export interface VisualPreset {
  /** Stable kebab-case id. PERSISTED in PG JSONB. Do NOT rename. */
  id: string
  /** Picker label (中文 + 英文 mix OK). */
  label: string
  /** One-line description (used in picker hint + dev catalog). */
  description: string
  palette: VisualPalette
  typography: VisualTypography
  motion: VisualMotion
  /** Mirror of `render_config.version` for forward-compat readers. */
  version: 1
}

// ── Catalog ──────────────────────────────────────────────────────────

/**
 * Classic — fallback. Mirrors the exact hex tokens currently
 * hard-coded inside `<SceneCard>` to keep parity with pre-PR-A
 * renders. Returning this on null/unknown id means a regression to
 * PR-A never changes the visual of an unchanged project.
 */
const CLASSIC: VisualPreset = {
  id: 'classic',
  label: '经典 (Classic)',
  description: '冷色暗调 · 默认样式 · 与升级前完全一致',
  palette: {
    background: '#12121A',
    gradientFrom: '#1e1e2a',
    gradientTo: '#12121A',
    accent: '#6366f1',
    body: '#ebebf0',
    muted: '#9696a5',
    divider: '#2e2e36',
  },
  typography: {
    fontStack:
      '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK JP", "WenQuanYi Micro Hei", "Source Han Sans SC", "Liberation Sans", sans-serif',
    titleWeight: 700,
    titleSize: 72,
    bodySize: 48,
  },
  motion: {
    // null → fall back to utils/pacing.ts heuristic in SceneCard
    fadeFrames: null,
    curve: 'ease',
  },
  version: 1,
}

/**
 * Noir 暗黑电影 — dark gradient + bold serif → wait, we use sans
 * everywhere. Bold sans + slower fade for 悬疑/科普 (suspense /
 * science explainer). Higher-contrast gradient (almost-black) so
 * the CJK body text reads weightier.
 */
const NOIR: VisualPreset = {
  id: 'noir',
  label: '暗黑电影 (Noir)',
  description: '更暗的渐变 · 粗体衬线感 · 慢淡入淡出 · 适合悬疑/科普',
  palette: {
    background: '#0a0a12', // darker than Classic's #12121A
    gradientFrom: '#1a1a28',
    gradientTo: '#0a0a12',
    accent: '#7c3aed', // deeper indigo for noir vibe
    body: '#f5f5fa', // slightly cooler white
    muted: '#8a8a9a',
    divider: '#26262f',
  },
  typography: {
    fontStack:
      '"Source Han Serif SC", "Noto Serif CJK SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Liberation Sans", serif',
    titleWeight: 800, // heavier than Classic's 700
    titleSize: 78, // slightly bigger to compensate for serif x-height
    bodySize: 50,
  },
  motion: {
    // 45 frames at 30 fps = 1.5 s cross-fade — slower than Classic's
    // pacing.ts heuristic for a cinematic feel
    fadeFrames: 45,
    curve: 'ease',
  },
  version: 1,
}

/**
 * Vibrant 活力流行 — high-saturation accent + sans bold + bounce
 * for 带货/生活黑客 (eCommerce / productivity hacker).
 */
const VIBRANT: VisualPreset = {
  id: 'vibrant',
  label: '活力流行 (Vibrant)',
  description: '高饱和渐变 · 加粗无衬线 · 弹性入场 · 适合带货/生活黑客',
  palette: {
    background: '#18142b', // purple-tinted dark
    gradientFrom: '#3d2b6e',
    gradientTo: '#18142b',
    accent: '#f43f5e', // hot pink-red for 带货 accent
    body: '#ffe4e6', // pink-tinted body
    muted: '#c4b5fd',
    divider: '#4c1d95',
  },
  typography: {
    fontStack:
      '"PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", "Liberation Sans", sans-serif',
    titleWeight: 900, // extra-bold for 带货 punch
    titleSize: 80,
    bodySize: 52,
  },
  motion: {
    // Fast cross-fade with bounce — 15 frames (0.5 s) so the energy
    // pops without overwhelming the 8 s scene duration
    fadeFrames: 15,
    curve: 'bounce',
  },
  version: 1,
}

/**
 * Minimalist 日式极简 — greyscale + thin sans + linear-only
 * motion for 鸡汤/情感语录 (inspirational quotes / emotional
 * short-form).
 */
const MINIMALIST: VisualPreset = {
  id: 'minimalist',
  label: '日式极简 (Minimalist)',
  description: '灰白底色 · 细体 · 静态 · 适合鸡汤/情感语录',
  palette: {
    background: '#f5f5f0', // warm light grey, NOT stark white
    gradientFrom: '#f5f5f0',
    gradientTo: '#e8e8e0', // subtle bottom darkening
    accent: '#475569', // slate accent (NOT the indigo default)
    body: '#1f1f24',
    muted: '#737373',
    divider: '#d4d4d4',
  },
  typography: {
    fontStack:
      '"Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Liberation Sans", sans-serif',
    titleWeight: 400, // thin for 鸡汤
    titleSize: 68,
    bodySize: 46,
  },
  motion: {
    // Static — no cross-fade at all
    fadeFrames: 0,
    curve: 'linear',
  },
  version: 1,
}

export const PRESETS: ReadonlyArray<VisualPreset> = [
  CLASSIC,
  NOIR,
  VIBRANT,
  MINIMALIST,
]

/**
 * Resolve a stored preset id to its `VisualPreset` entry. Falls back
 * to CLASSIC when:
 *   * `id` is null / undefined / empty string
 *   * `id` is not present in `PRESETS` (typo, rename, post-deletion)
 *
 * The fallback is intentional and SILENT (no throw) so a renamed
 * catalog never breaks a render — the operator's picker shows
 * "Unknown preset — falling back to Classic" via the
 * `picker_unknown` toast that the picker UI emits on first paint.
 *
 * Pure function — vitest-pinnable via
 * ``tests/test_studio_presets.py::test_get_preset_by_id_fallback_*``.
 */
export function getPresetById(id: string | null | undefined): VisualPreset {
  if (!id) return CLASSIC
  const found = PRESETS.find((p) => p.id === id)
  return found ?? CLASSIC
}

/**
 * Cubic-bezier mapper for the `motion.curve` field. `<SceneCard>`
 * applies this AFTER clamping `fadeIn * fadeOut ∈ [0,1]` so the
 * curve never overshoots outside the safe alpha range. Returns
 * `t ∈ [0,1]` for any input `t ∈ [0,1]`.
 */
export function applyMotionCurve(t: number, curve: MotionCurve): number {
  // Clamp input — defensively against a malicious or buggy bridge
  const x = Math.max(0, Math.min(1, t))
  switch (curve) {
    case 'linear':
      return x
    case 'ease':
      // easeInOutQuad equivalent
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    case 'bounce':
      // easeInOutBack (subtle overshoot without leaving [0,1])
      // C1 = 1.10 keeps overshoot under ~10 %. C3 = C1 + 1 to
      // standardise the "back" coordinate space.
      const c1 = 1.10
      const c3 = c1 + 1
      return x < 0.5
        ? (c3 * x * x * x - c1 * x * x) * 0.5
        : 1 + ((c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)) * 0.5)
  }
}

/**
 * Resolves the row's stored preset id (raw, NOT catalog-resolved).
 *
 * Single source of truth for the "raw stored preset id" read site.
 * Used by both the Remotion composition (`<StudioProject>`) and the
 * picker UI (`StudioDetailPage`), so a future drift between the two
 * is caught at the helper signature, not at runtime.
 *
 * Returns `null` for:
 *   * Missing `project` argument
 *   * Missing or non-object `renderConfig` (legacy rows pre-PR-A)
 *   * Missing `preset` sub-key
 *   * Non-string `preset` (e.g. configured by a buggy upstream)
 *
 * Drops to `getPresetById(null)` → Classic at render-time for all
 * the above. Surfaces the raw id verbatim when the catalog HAS the
 * entry, so the picker can match the dropdown's selected option
 * against the row's persisted value without a binding dance.
 */
export function resolveStoredPresetId(
  project:
    | { renderConfig?: { preset?: unknown } | null }
    | null
    | undefined,
): string | null {
  if (!project) return null
  const rc = project.renderConfig
  if (!rc || typeof rc !== 'object') return null
  const p = (rc as { preset?: unknown }).preset
  return typeof p === 'string' && p ? p : null
}
