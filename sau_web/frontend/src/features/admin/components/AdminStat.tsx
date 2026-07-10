// ─────────────────────────────────────────────────────────────────────
// AdminStat — premium stat card for the Admin Overview hero strip.
//
// Visual contract:
//   • Left-side chromatic accent (per Tone) gives each card an
//     identity without a heavy filled chip — a single 2px bar that
//     matches the icon stroke.
//   • Eyebrow label is uppercase 11px tracking — reads like Linear/
//     Vercel dashboard chrome rather than default shadcn.
//   • Value is 32px tabular-nums semibold — the single eye-catching
//     number on the surface.
//   • Optional `<trend>` series (v3-mini):
//     - renders a 24-height pure-SVG sparkline directly below the value
//     - produces a tone-coloured +X.X% / -X.X% delta chip in the
//       bottom row, with a 6-px arrow icon marking direction
//     - loading state hides both (skeleton would reflow)
//   • Optional explicit `<meta>` (absolute label like "/ 38 全部") and
//     `<delta>` (caller-computed relative chip) slots. When both
//     `trend` and `delta` are passed, `trend` wins so the chip stays
//     consistent with the sparkline it sits next to.
//
// Loading state: `loading` prop dims + removes the value text. We
// render a non-collapsing placeholder with the same line-height so
// the card doesn't reflow on data resolve — preserves the Overview
// test contract that asserts the "总用户数" label is present even on
// loading.
//
// Module exports ONLY the component (no helpers) so Fast Refresh
// stays happy (`react-refresh/only-export-components`).
// ─────────────────────────────────────────────────────────────────────

import { useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneChipClasses, toneStyleClasses, type Tone } from '@/lib/tone'
import { Sparkline } from '@/lib/sparkline'
import { computeDelta, type DeltaDirection } from '@/lib/trendDelta'

interface AdminStatProps {
  /** Eyebrow label above the value (e.g. "总用户数"). */
  label: string
  /** Big value (a number / percent / formatted string). */
  value: ReactNode
  /** Decorative icon — shown top-right. Should be stroke-only. */
  icon: ReactNode
  /** Accent tone — drives the left bar AND the icon tint. */
  tone: Tone
  /** Optional absolute ceiling (e.g. 全部 users) for context. */
  meta?: ReactNode
  /** Optional caller-computed relative chip (e.g. "+ 12.4%"). Wins
      only when `trend` is absent; otherwise the trend-derived chip
      takes the slot. */
  delta?: ReactNode
  /** Optional N-day series. Renders the sparkline + auto-derived
      colored delta chip on the bottom row. Suppressed on loading
      and when the series is too short to chart (length < 2) or
      anchorless (all zeros). */
  trend?: number[]
  /** Tint override for the sparkline stroke/dot. Defaults to `tone`. */
  sparkTone?: Tone
  /** Loading state — dims + removes the value text. */
  loading?: boolean
  className?: string
}

/**
 * 8×8 arrow that marks the trend's direction inside the delta chip.
 * Stroke-only so the icon stays subordinate to the percentage label.
 */
function TrendArrow({ direction }: { direction: DeltaDirection }) {
  if (direction === 'up') {
    return <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
  }
  if (direction === 'down') {
    return <ArrowDown className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
  }
  return <Minus className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
}

function AdminStat({
  label,
  value,
  icon,
  tone,
  meta,
  delta,
  trend,
  sparkTone,
  loading,
  className,
}: AdminStatProps) {
  // Self-contained delta computation. Caller passes `trend` and we
  // derive the chip; the explicit `delta` slot stays available for
  // call-sites where the consumer prefers a pre-computed label or the
  // delta isn't series-bound (e.g. cross-system comparisons).
  const trendDelta = useMemo(() => computeDelta(trend ?? null), [trend])

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl bg-card/60 p-4 sm:p-5',
        'ring-1 ring-foreground/10',
        'transition-colors duration-200 hover:ring-foreground/15',
        className,
      )}
      data-tone={tone}
      role="group"
      aria-label={label}
      data-testid="admin-stat-card"
    >
      {/* Header row — icon on the left, percentage badge on the right.
          The badge is the primary visual signal; the icon is muted
          so the number below owns the focal point. */}
      <div className="flex items-start justify-between">
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            'bg-muted/40 text-muted-foreground',
          )}
        >
          {icon}
        </span>

        {!loading && trendDelta ? (
          <span
            data-testid="admin-stat-delta"
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums',
              toneChipClasses(trendDelta.tone),
            )}
          >
            <TrendArrow direction={trendDelta.direction} />
            {trendDelta.label}
          </span>
        ) : (
          delta && !loading && (
            <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground tabular-nums bg-muted/50">
              {delta}
            </span>
          )
        )}
      </div>

      {/* Value — big tabular-nums numeral. In loading state we render
          a non-collapsing placeholder with the same line-height so the
          card doesn't reflow on data resolve. */}
      <div className="mt-3">
        {loading ? (
          <span className="block h-8 w-20 rounded-md bg-muted/60 animate-pulse" />
        ) : (
          <span className="text-[28px] sm:text-[32px] font-semibold text-foreground tabular-nums tracking-[-0.01em] leading-none">
            {value}
          </span>
        )}
      </div>

      {/* Eyebrow + meta — placed BELOW the value so the eye reads
          number-first (Linear / Vercel dashboard pattern). */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground/80 uppercase">
          {label}
        </span>
        {meta && !loading && (
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {meta}
          </span>
        )}
      </div>

      {/* Sparkline row (v3-mini). Renders only when `trend` has at
          least 2 anchored points AND we're past the loading state.
          Height reduced to 20px for a more compact strip. */}
      {trend && !loading && trend.length >= 2 && (
        <div
          className="mt-2 h-[20px]"
          data-testid="admin-stat-sparkline"
        >
          <Sparkline
            points={trend}
            height={20}
            tone={sparkTone ?? tone}
            ariaLabel={`${label} 趋势`}
          />
        </div>
      )}
    </div>
  )
}

export { AdminStat }
