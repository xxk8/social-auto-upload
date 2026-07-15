// ─────────────────────────────────────────────────────────────────────
// trendDelta — extract a "+X.X%" headline chip from a numeric series
// for use in the AdminStat delta slot.
//
// `computeDelta` is pure: same input → same output. No `Date.now()`,
// no locale side-effects, so test snapshots stay deterministic. Caller
// passes a numeric series (e.g. 14 days of `total_users`) and gets a
// structured `{ pct, direction, tone, label }` for chip rendering.
//
// Output ladder (kept explicit so the chip tone never lies about the
// underlying direction):
//
//   `series.length < 2` → `null`           (render nothing)
//   `first === last`    → flat   ('info')  label "0.0%"
//   `pct > 0.5`         → up     ('success')
//   `pct < -0.5`        → down   ('error')
//   `|pct| <= 0.5`      → flat   ('info')
//
//   first === 0 is a degenerate case (no historical base). Returns
//   `Infinity` / `-Infinity` in pct + arrow-only label so the chip
//   still renders something rather than silently dropping the trend.
//
// Module exports the function + types only (no React helpers) —
// Fast Refresh contract satisfied.
// ─────────────────────────────────────────────────────────────────────

export type DeltaDirection = 'up' | 'down' | 'flat'
export type DeltaTone = 'success' | 'error' | 'info'

interface DeltaResult {
  /** Rounded percentage change between first and last sample (1 dp). */
  pct: number
  /** Direction bucket used by the chip + arrow icon. */
  direction: DeltaDirection
  /** Tone class key — matches CodePill tone prop. */
  tone: DeltaTone
  /** Human label, e.g. "+12.4%" / "−3.1%" / "0.0%" / "↑" / "↓". */
  label: string
}

/**
 * Threshold in pct units between "flat" and a real directional move.
 * 0.5% is small enough that FP drift around the first sample doesn't
 * tip a non-trending series into "up" by accident; large enough that
 * a real ±X.X% production trend reads as a meaningful chip.
 */
const FLAT_THRESHOLD = 0.5

function computeDelta(
  series: number[] | undefined | null,
): DeltaResult | null {
  if (!series || series.length < 2) return null

  const first = series[0]
  const last = series[series.length - 1]

  if (first === last) {
    return { pct: 0, direction: 'flat', tone: 'info', label: '0.0%' }
  }

  // Degenerate base — the first sample was 0 so we can't form a %.
  // Pin the chip to whichever direction `last` lies in (positive vs
  // negative) and skip the percentage label since `Infinity` would
  // render as the literal string "Infinity" otherwise.
  if (first === 0) {
    return last > 0
      ? { pct: Infinity, direction: 'up', tone: 'success', label: '↑' }
      : { pct: -Infinity, direction: 'down', tone: 'error', label: '↓' }
  }

  const rawPct = ((last - first) / Math.abs(first)) * 100
  const pct = Math.round(rawPct * 10) / 10
  const direction: DeltaDirection =
    pct > FLAT_THRESHOLD ? 'up' : pct < -FLAT_THRESHOLD ? 'down' : 'flat'
  const tone: DeltaTone =
    direction === 'up' ? 'success' : direction === 'down' ? 'error' : 'info'
  const sign = pct > 0 ? '+' : ''
  return { pct, direction, tone, label: `${sign}${pct.toFixed(1)}%` }
}

export { computeDelta }
