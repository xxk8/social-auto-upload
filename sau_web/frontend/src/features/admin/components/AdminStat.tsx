// ─────────────────────────────────────────────────────────────────────
// AdminStat v2 — premium stat card with motion + gradient glow.
//
// Upgrades from v1:
//   • Motion entrance (staggered via `delay` prop) + hover lift.
//   • Top accent stripe (3px, tone-colored) replaces the left bar.
//   • Radial gradient glow (tone-colored, top-center) adds depth.
//   • Bigger icon container (h-10 w-10) with tone-colored bg + fg.
//   • Bigger value font (34–38px) for more visual impact.
//   • Taller sparkline (28px) for better trend readability.
//   • Hover shadow ring for a tactile, elevated feel.
//
// Test contract (locked — unchanged from v1):
//   • data-testid="admin-stat-card" on the outer element.
//   • data-testid="admin-stat-sparkline" on the sparkline wrapper.
//   • data-testid="admin-stat-delta" on the delta chip.
//   • role="group" + aria-label={label} on the outer element.
//   • Delta chip className contains status-{tone}-bg (from toneChipClasses).
//   • Label text rendered unconditionally (present during loading).
//   • Value text rendered only when !loading.
//   • Sparkline + delta suppressed during loading.
//
// Module exports ONLY the component (no helpers) so Fast Refresh
// stays happy (`react-refresh/only-export-components`).
// ─────────────────────────────────────────────────────────────────────

import { useMemo, type ReactNode } from 'react'
import { motion } from 'motion/react'
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
  /** Decorative icon — shown top-left. Should be stroke-only. */
  icon: ReactNode
  /** Accent tone — drives the top stripe, icon tint, and glow. */
  tone: Tone
  /** Optional absolute ceiling (e.g. 全部 users) for context. */
  meta?: ReactNode
  /** Optional caller-computed relative chip. Wins only when `trend`
      is absent; otherwise the trend-derived chip takes the slot. */
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
  /** Animation delay in seconds for staggered entrance. Defaults to 0. */
  delay?: number
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
  delay = 0,
  className,
}: AdminStatProps) {
  // Self-contained delta computation. Caller passes `trend` and we
  // derive the chip; the explicit `delta` slot stays available for
  // call-sites where the consumer prefers a pre-computed label or the
  // delta isn't series-bound (e.g. cross-system comparisons).
  const trendDelta = useMemo(() => computeDelta(trend ?? null), [trend])

  // CSS variables for the tone's foreground + background colors.
  // Used in inline styles for the top stripe and radial glow so we
  // don't need to add new Tailwind JIT entries per tone — the tokens
  // are already defined in index.css and handle light/dark switching.
  const toneFg = `var(--status-${tone}-fg)`
  const toneBg = `var(--status-${tone}-bg)`

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={cn(
        'group relative overflow-hidden rounded-xl bg-card/60 p-4 sm:p-5',
        'ring-1 ring-foreground/10',
        'transition-shadow duration-200 hover:shadow-lg hover:shadow-foreground/5 hover:ring-foreground/20',
        className,
      )}
      data-tone={tone}
      role="group"
      aria-label={label}
      data-testid="admin-stat-card"
    >
      {/* Top accent stripe — 3px tone-colored bar that gives each
          card an identity at a glance. Replaces the v1 left bar. */}
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: toneFg }}
      />

      {/* Radial glow — a subtle tone-colored aura radiating from the
          top center. Uses the tone's bg token so light/dark theme
          switching is automatic. Pointer-events-none so it never
          interferes with hover/click on the card content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 90% 70% at 50% -10%, ${toneBg}, transparent 70%)`,
        }}
      />

      {/* Header row — tone-colored icon container (bigger: h-10 w-10)
          + delta chip on the right. */}
      <div className="relative flex items-start justify-between">
        <span
          aria-hidden
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl',
            toneStyleClasses[tone].bg,
            toneStyleClasses[tone].fg,
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

      {/* Value — big tabular-nums numeral. Bigger than v1 (34–38px vs
          28–32px) for more visual impact. In loading state we render
          a non-collapsing placeholder with the same line-height so the
          card doesn't reflow on data resolve. */}
      <div className="relative mt-3">
        {loading ? (
          <span className="block h-9 w-24 rounded-md bg-muted/60 animate-pulse" />
        ) : (
          <span className="text-[34px] sm:text-[38px] font-semibold text-foreground tabular-nums tracking-[-0.01em] leading-none">
            {value}
          </span>
        )}
      </div>

      {/* Eyebrow + meta — placed BELOW the value so the eye reads
          number-first (Linear / Vercel dashboard pattern). */}
      <div className="relative mt-1.5 flex items-center gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground/80 uppercase">
          {label}
        </span>
        {meta && !loading && (
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {meta}
          </span>
        )}
      </div>

      {/* Sparkline row. Taller than v1 (28px vs 20px) for better
          trend readability. Renders only when `trend` has at least
          2 anchored points AND we're past the loading state. */}
      {trend && !loading && trend.length >= 2 && (
        <div
          className="relative mt-3 h-[28px]"
          data-testid="admin-stat-sparkline"
        >
          <Sparkline
            points={trend}
            height={28}
            tone={sparkTone ?? tone}
            ariaLabel={`${label} 趋势`}
          />
        </div>
      )}
    </motion.div>
  )
}

export { AdminStat }
