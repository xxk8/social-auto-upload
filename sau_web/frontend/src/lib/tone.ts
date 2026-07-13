/**
 * Tone semantics — single source of truth for the four `--status-*-{fg,bg,border}`
 * tokens defined in `src/index.css`.
 *
 *   `success`  — green-tinted, the upper-band signal
 *   `warning`  — amber-tinted, the partial / cautionary signal
 *   `error`    — red-tinted, the lower-band / failure signal
 *   `info`     — steel-cyan-tinted (low-chroma cyan, hue 200), the neutral-positive signal
 *
 * Visual contract: every tone maps to a CSS triple `--status-{tone}-{bg,fg,border}`,
 * so light/dark theme palette switching is handled by the token system
 * rather than per-component logic.
 *
 * "Muted" / "no data" is intentionally NOT part of the union — it is
 * expressed as `null` (or omitted) and rendered with the project's neutral
 * `bg-muted text-muted-foreground` Tailwind utilities. This treatment lets
 * `null` quietly fall through every helper without needing a fifth token.
 */

export type Tone = 'success' | 'warning' | 'error' | 'info'

/**
 * Static class-string map for each tone's atomic Tailwind utilities.
 *
 * Two reasons every variant is declared here as flat static strings:
 *
 *  1. **Tailwind v4 JIT discovery**: the auto-scanner reads source files for
 *     class literal substrings. Everything else in this module composes via
 *     template literals / runtime lookup, so the scanner wouldn't see e.g.
 *     `bg-[var(--status-success-bg)]` on its own. Putting every variant
 *     here as a flat literal is what guarantees Tailwind emits the CSS rules
 *     regardless of where helpers end up being composed from.
 *
 *  2. **One source of truth**: `toneStyleClasses[tone].bg` is exactly the
 *     string `bg-[var(--status-success-bg)]`. If a future token rename is
 *     needed (e.g. palette rebrand), this map is the single place to touch.
 *
 * Public exposure: the map is re-exported as `toneStyleClasses` (typed
 * `Readonly<Record<Tone, ...>>`) so consumers can compose custom shapes
 * the helper catalogue doesn't cover (e.g. for a custom 30%-alpha ring,
 * append `/30` to `toneStyleClasses.warning.ring`). Prefer the helpers
 * below for common shapes; reach for the raw map when the helper
 * catalogue doesn't cover the consumer's exact need.
 */
const TONE_STYLE_CLASSES = {
  success: {
    bg: 'bg-[var(--status-success-bg)]',
    border: 'border-[var(--status-success-border)]',
    fg: 'text-[var(--status-success-fg)]',
    fill: 'bg-[var(--status-success-fg)]',
    ring: 'ring-[var(--status-success-fg)]',
  },
  warning: {
    bg: 'bg-[var(--status-warning-bg)]',
    border: 'border-[var(--status-warning-border)]',
    fg: 'text-[var(--status-warning-fg)]',
    fill: 'bg-[var(--status-warning-fg)]',
    ring: 'ring-[var(--status-warning-fg)]',
  },
  error: {
    bg: 'bg-[var(--status-error-bg)]',
    border: 'border-[var(--status-error-border)]',
    fg: 'text-[var(--status-error-fg)]',
    fill: 'bg-[var(--status-error-fg)]',
    ring: 'ring-[var(--status-error-fg)]',
  },
  info: {
    bg: 'bg-[var(--status-info-bg)]',
    border: 'border-[var(--status-info-border)]',
    fg: 'text-[var(--status-info-fg)]',
    fill: 'bg-[var(--status-info-fg)]',
    ring: 'ring-[var(--status-info-fg)]',
  },
} as const satisfies Record<Tone, Record<'bg' | 'border' | 'fg' | 'fill' | 'ring', string>>

/** Read-only view of the static class map for callers that need raw assembly. */
export const toneStyleClasses: Readonly<
  Record<Tone, { bg: string; border: string; fg: string; fill: string; ring: string }>
> = TONE_STYLE_CLASSES

/**
 * Map a 0..100 percentage → Tone.
 *
 *   `pct === 100`         → `'success'`
 *   `pct ∈ [50, 99]`      → `'warning'`
 *   everything else       → `'error'`
 *     (`<50`, `>100`, `NaN`, `±Infinity`, any non-finite number)
 *
 * Two guards at the top enforce the "everything else → error" promise
 * that strict-equality alone wouldn't (because `Infinity >= 50` is
 * `true`, and any pct in `(100, +∞)` would otherwise slide into the
 * warning branch by accident):
 *  - `!Number.isFinite(pct)`     covers NaN, ±Infinity
 *  - `pct < 0 || pct > 100`      covers negative and malformed-ratio
 *                                 (e.g. stale "valid / total" race)
 *
 * Note: this function NEVER returns `'info'` — it's the contract for the
 * strict 3-band pct mapping used by the cookie-health TokenHealthBar.
 * For surfaces that need a 4-band mapping with an `'info'` band (e.g.
 * the homepage validity tile), use `rateToTone(rate, total)` instead.
 */
export function pctToTone(pct: number): Tone {
  if (!Number.isFinite(pct)) return 'error'
  if (pct < 0 || pct > 100) return 'error'
  if (pct === 100) return 'success'
  if (pct >= 50) return 'warning'
  return 'error'
}

/**
 * Float-rounding tolerance for the `rateToTone` thresholds (`0.8 / 0.5`).
 * A rate that should resolve to `0.8` but drifted down by up to this
 * epsilon (e.g. `0.799999999` from cumulative division / Math.round) still
 * classifies into the upper band rather than slipping one tier down.
 * Same tolerance applies to the `0.5` threshold.
 *
 * Exposed for documentation only — the function reads the constant
 * directly. A future maintainer tightening or loosening the buffer
 * should change this once, not edit both branches.
 */
const RATE_EPSILON = 0.01

/**
 * 4-band validity mapper used by the homepage "有效率" tile.
 *
 *   `total === 0`         → `null`   (no data — render with neutral utilities)
 *   `rate === 1`          → `'success'` (full mint-green)
 *   `rate ∈ [0.79, 1)`    → `'info'`    (steel-cyan "mostly healthy", with `RATE_EPSILON` FP tolerance)
 *   `rate ∈ [0.49, 0.79)` → `'warning'` (amber partial, with `RATE_EPSILON` FP tolerance)
 *   `rate < 0.49`         → `'error'`   (red mostly broken)
 *
 * The boundaries shifted DOWN by `RATE_EPSILON` (= `0.01`) from the
 * nominal `0.8 / 0.5` so that float drift doesn't silently downgrade
 * a rate that's actually at-threshold. The user's regression lock:
 *   `rateToTone(0.799999999)` → `'info'` (not `'warning'` from FP slip)
 *
 * Defensive mapping (consistent with `pctToTone`):
 *   `rate > 1`            → `'error'`   (malformed: `valid > total` race)
 *   `NaN` / `±Infinity`   → `'error'`
 *
 * Why a separate helper: `pctToTone` is the strict 3-band pct mapping for
 * the TokenHealthBar (no `'info'` band) — collapsing 80–99% into warning
 * loses the deliberate steel-cyan hint in the homepage's validity tile.
 * Both helpers share the same `Tone` type and the same token contract;
 * the difference is purely the band boundaries.
 */
export function rateToTone(rate: number, total: number): Tone | null {
  if (total === 0) return null
  if (!Number.isFinite(rate)) return 'error'
  if (rate > 1) return 'error'
  if (rate >= 1) return 'success'
  // FP-drift tolerance: `rate >= 0.8 - RATE_EPSILON` ≡ `rate >= 0.79`.
  // Pinned on a separate constant so a future maintainer can tighten (e.g.
  // to `1e-9` if internal callsites always come in clean) or relax without
  // scattering edits across two branches.
  if (rate >= 0.8 - RATE_EPSILON) return 'info'
  if (rate >= 0.5 - RATE_EPSILON) return 'warning'
  return 'error'
}

/**
 * 2-band validity mapper used for account / authorization surface
 * (`SortableGroup` chip body, `GroupListItem.GroupValidityChip`).
 *
 *   `validCount === totalCount`  → `'success'` (mint-green, all valid)
 *   `validCount <  totalCount`  → `'warning'` (amber, partial — expiry isn't fatal)
 *   `totalCount === 0`           → `null`     (no data, render with neutral muted utilities)
 *
 * Design rationale: this is a "convenience" mapper for the accounts surface
 * where every platform is expected to be active, so 4-band granularity
 * (and the `'info'` steel-cyan hint) is information overload. `rateToTone`
 * stays the 4-band version for surfaces where 80–99% "mostly healthy" is
 * meaningfully different from "all healthy" (e.g. the homepage tile).
 *
 * Why `Tone | null` (alignment with `rateToTone`'s `Tone | null` shape):
 * a `total === 0` group has no authorizations and therefore no validity
 * to report. Returning `null` instead of `'success'` makes the degenerate
 * case explicit at the type level — a future caller that forgets the
 * JSX-level `{totalCount > 0 && <chip>}` guard will now tip over to the
 * muted fallback in helpers like `toneChipClasses(null)`, rather than
 * rendering a misleading mint-green chip on empty data. The two existing
 * call sites (`SortableGroup`, `GroupListItem`) already use this guard;
 * the contract hardening is defense in depth for future callsites.
 */
export function validityTone(validCount: number, totalCount: number): Tone | null {
  if (totalCount === 0) return null
  return validCount === totalCount ? 'success' : 'warning'
}

/**
 * Tailwind class string for a Tone-styled chip (paired bg + fg).
 * Used for inline pill components such as the validity badges above
 * task IDs and the "validity rate" tile accents.
 *
 * Nullish input → neutral muted utility classes (no token used).
 */
export function toneChipClasses(tone: Tone | null | undefined): string {
  if (!tone) return 'bg-muted text-muted-foreground'
  return `${TONE_STYLE_CLASSES[tone].bg} ${TONE_STYLE_CLASSES[tone].fg}`
}

/** Tone-coloured background only (no text counterpart). */
export function toneBgClass(tone: Tone | null | undefined): string {
  if (!tone) return 'bg-muted'
  return TONE_STYLE_CLASSES[tone].bg
}

/**
 * Tailwind class string for a Tone-coloured border.
 * Use for `Alert` / `Toast`-style boxes that wrap their tone in a 1-px
 * bounding rectangle. Falls back to `border-border` (hairline) for
 * nullish input so the box still has visual separation.
 */
export function toneBorderClass(tone: Tone | null | undefined): string {
  if (!tone) return 'border-border'
  return TONE_STYLE_CLASSES[tone].border
}

/**
 * Tailwind class string for a Tone-coloured foreground text only
 * (no background). Use for list rows, inline iconography, captions.
 */
export function toneTextClass(tone: Tone | null | undefined): string {
  if (!tone) return 'text-muted-foreground'
  return TONE_STYLE_CLASSES[tone].fg
}

/**
 * Tailwind class string for a Tone-coloured solid fill only — used by
 * status-fill bars (e.g. TaskProgressBar segments) where the foreground
 * color doubles as the bar color and no text sits on top.
 */
export function toneFillBgClass(tone: Tone | null | undefined): string {
  if (!tone) return 'bg-muted'
  return TONE_STYLE_CLASSES[tone].fill
}

/**
 * Tailwind class string for a Tone-coloured ring (e.g. focus outline).
 * Compose with `ring-{N}` for thickness and `/30` for alpha.
 */
export function toneRingClass(tone: Tone | null | undefined): string {
  if (!tone) return 'ring-border'
  return TONE_STYLE_CLASSES[tone].ring
}

/**
 * Tailwind class string for a Tone-coloured status dot.
 * The `warning` branch adds the `status-running` utility from index.css
 * which paints a pulse ring via `currentColor` and `::after` — so the
 * inline span needs `text-{--status-warning-fg}` AND `bg-{...fg}` for
 * the solid dot fill to read on the chip background.
 *
 * For inline-style non-pulsing dots with halo glow, see `toneDotStyle`.
 */
export function toneDotClasses(tone: Tone | null | undefined): string {
  if (!tone) return 'bg-muted-foreground/60'
  if (tone === 'warning') {
    return `status-running ${TONE_STYLE_CLASSES.warning.fg} ${TONE_STYLE_CLASSES.warning.fill}`
  }
  return TONE_STYLE_CLASSES[tone].fill
}

/**
 * Halo glow alpha for `toneDotStyle`'s box-shadow composer. Exposed so
 * tests and any future tone-library consumer needing the same halo
 * strength can import this single source of truth instead of replicating
 * the magic number. Adjust here is the only place that changes the
 * alpha everywhere — type-level lock against drift.
 */
export const HALO_ALPHA = 0.35

/**
 * Inline-style object for a Tone-coloured mini dot: solid background + a
 * faint halo glow via the canonical `--status-{tone}-fg` token.
 *
 * Apply via:
 *   `<span className="status-dot" style={toneDotStyle(tone)} />`
 * where `.status-dot` provides the geometric base (6×6 px, rounded-50%,
 * flex-shrink) and this helper provides the color + halo. Surfaces that
 * need custom sizing instead reach for the `toneStyleClasses[tone]` map
 * and compose their own shape.
 *
 * Halo alpha: `HALO_ALPHA` (= `0.35`) — chosen as the midpoint between
 * the pre-migration light-mode strength (`oklch(.../0.40)`) and the
 * deleted dark-mode override (`oklch(.../0.30)`). The four --status-*-fg
 * tokens absorb dark-mode switching automatically, so a single alpha
 * keeps both modes visually balanced (5% dimmer on light, 5% brighter
 * on dark — imperceptible at chip scale).
 *
 * Returns `undefined` for nullish input — React's `style={undefined}`
 * is valid and produces no inline styles on the DOM, so no caller-side
 * `?? {}` workaround is needed.
 *
 * Why this helper bundles `toneFillBgClass(tone) + box-shadow` into
 * one inline-style object: at the surface, splitting into a Tailwind
 * class + inline `style.boxShadow` would scatter the halo composer
 * across two format systems (class + style) at every consumer and
 * force the per-tone alpha into either a Tailwind utility list (four
 * new arbitrary tokens) or a duplicated string at each consumer. The
 * bundled form keeps the recipe 1-source-of-truth. Visual output is
 * identical to the literal split.
 *
 * Discipline-pinning: always read `HALO_ALPHA` here — do NOT inline
 * a literal percentage. The test in `tone.test.ts` derives the
 * expected boxShadow from the same constant, so the lockstep only
 * catches drift if BOTH producer AND consumer reference `HALO_ALPHA`.
 * An inlined `50`%, `30`%, etc. here would silently pass the test
 * while breaking the SSOT contract.
 */
export function toneDotStyle(
  tone: Tone | null | undefined,
): { background: string; boxShadow: string } | undefined {
  if (!tone) return undefined
  const fg = `var(--status-${tone}-fg)`
  return {
    background: fg,
    boxShadow: `0 0 6px color-mix(in oklab, ${fg} ${HALO_ALPHA * 100}%, transparent)`,
  }
}

/**
 * CSS variable string for the foreground color of a Tone — for use in
 * inline `style={...}` (e.g. progress bar fills) where a Tailwind class
 * can't be substituted. Returns `'var(--status-{tone}-fg)'`.
 *
 * Note: this is the one function still assembling a CSS var via template
 * literal rather than reading the static map. The map carries Tailwind
 * class form; this function carries raw CSS form. A future cleanup could
 * add a `fgVar` key per Tone carrying `'var(--status-{tone}-fg)'` for
 * one-source-of-truth parity, but until we have ≥2 sites that need both
 * forms the indirection isn't worth the type machinery.
 */
export function toneFgVar(tone: Tone): string {
  return `var(--status-${tone}-fg)`
}
