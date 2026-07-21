// ─────────────────────────────────────────────────────────────────────
// trendMock — deterministic N-day series generator for ad-hoc
// sparkline data on the Admin Overview page.
//
// Why deterministic:
//
//   • No real `/api/admin/trends` endpoint exists yet. Mock data must
//     be reproducible across renders so two consecutive page loads
//     don't show different sparklines (visually jarring on a "live"
//     dashboard). A LCG seeded by the metric key gives us
//     reproducible noise terms; the sine wave anchors are already
//     deterministic by definition.
//
//   • When the backend ships, we drop this file: the consumer
//     (`AdminOverviewPage`) reads from `adminApi.getTrends()` first
//     and only falls back to `trendMock(metric)` on error.
//
// Generation recipe (per metric):
//
//   1. Pick a `seed = stableStringHash(metric)` and instantiate a
//      tiny LCG. We don't need cryptographic noise; just varied jitter
//      so 6+ sparklines look distinct instead of identical sine clones.
//   2. Anchor the series so the LAST sample equals `current` — matches
//      the AdminStat value rendered above the sparkline, so the eye
//      can connect the chip's number to the line's endpoint instantly.
//   3. Build older samples by walking a low base + linear up-slope +
//      sine oscillation + small noise term. The slope ensures the
//      line "feels alive" (mostly upward trending, since most KPIs
//      grow over time).
//   4. Clamp to ≥ 0 so a negative-amplitude noise term doesn't render
//      a value-clip below the baseline (which Sparkline would happily
//      draw but the AdminStat value cannot go negative).
// ─────────────────────────────────────────────────────────────────────

import { stableStringHash } from '@/lib/hash'

const DEFAULT_DAYS = 14
const DEFAULT_AMPLITUDE = 0.18 // ± 18% of `current`

/**
 * Minimal Linear Congruential Generator — Numerical Recipes constants.
 * Good enough for visual variety; we don't need cryptographic noise.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  // Avoid the 0 seed (LCG degenerates to all zeros) — substitute a
  // well-known non-zero constant. Visually identical to the user.
  if (s === 0) s = 0x9e3779b9
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

interface TrendOpts {
  /** Live anchor — the most recent sample is pinned to this value. */
  current: number
  /** Relative amplitude as fraction of `current`. Defaults to 0.18. */
  amplitude?: number
  /** Day count. Defaults to 14. */
  days?: number
}

/**
 * Build a deterministic 14-day series ending at `current`.
 *
 * Returns `[]` when `current === 0` so the AdminStat can short-circuit
 * the sparkline (a 14-point all-zero series would render as a flat
 * baseline that mis-represents "no data" as "flat trend"). Callers
 * with non-zero `current` always get a length-`days` series.
 */
function trendMock(metric: string, opts: TrendOpts): number[] {
  const days = opts.days ?? DEFAULT_DAYS
  const amplitude = opts.amplitude ?? DEFAULT_AMPLITUDE

  // Pin to empty series when there's nothing to anchor against.
  if (opts.current === 0) return []

  const rand = lcg(stableStringHash(metric))
  const series: number[] = []
  const baseLow = Math.max(0, opts.current * (1 - amplitude))
  const slope = (opts.current - baseLow) / Math.max(1, days - 1)

  for (let i = 0; i < days; i++) {
    // Long wave dominates (60% of amplitude) + small noise (35%).
    // The `Math.sin(t * PI * 1.6)` shape gives one-and-a-half peaks
    // across 14 days so the line reads as "real" rather than perfectly
    // monotonic. Visually distinct from a pure sine.
    const wave = Math.sin((i / days) * Math.PI * 1.6) * amplitude * opts.current * 0.6
    const noise = (rand() - 0.5) * amplitude * opts.current * 0.35
    series.push(Math.max(0, baseLow + slope * i + wave + noise))
  }

  // Last-sample pin — the AdminStat value rendered DIRECTLY above the
  // sparkline is also `current`, so the eye should be able to draw a
  // straight horizontal line from the chip value to the endpoint dot.
  // Without this pin the sparkline would end ≈1 sample off due to the
  // last `+wave +noise` step.
  series[days - 1] = opts.current
  return series
}

export { trendMock, DEFAULT_DAYS }
