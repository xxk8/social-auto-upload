/* ──────────────────────────────────────────────────────────────────────
 * Stat — visitor-stat cell with attribution rhythm (round 7).
 *
 * Codifies the Hero / Pricing / future-/about stat-row rhythm into a
 * single component + token set (see DESIGN.md `typography-stats` and
 * `boundaries.marketing-surface`). Required `caption` enforces that
 * every stat carries a subject · predicate attribution rather than a
 * bare number; bare-number outcome claims are banned per
 * `boundaries.marketing-surface` and this primitive is the type-level
 * enforcement (TS rejects `<Stat value=… />` calls at the call site).
 *
 * Module exports only the `Stat` React component + the type-only
 * `StatProps` / `StatVariant` / `StatSize` bindings. The single runtime
 * export satisfies `react-refresh/only-export-components`; types are
 * exported with `type` so they're verifiable from conditional types
 * without leaking runtime values.
 * ────────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react'

type StatVariant = 'stack' | 'inline'
type StatSize = 'sm' | 'md'

export interface StatProps {
  /** Optional small uppercase label above the value. Reserved for
   *  surfaces where the stat is preceded by a label (dashboard task
   *  counters, future /about scale proofs). Unused on the current
   *  visitor surfaces but the slot exists so future cells inherit. */
  eyebrow?: ReactNode
  /** The quantitative or qualitative value. Always rendered with
   *  tabular-nums so digits align across rows. */
  value: ReactNode
  /** Subject · predicate attribution. REQUIRED per
   *  `boundaries.marketing-surface` — bare-number outcome claims
   *  (e.g. "每天省下 3 小时" with no subject) are rejected. */
  caption: ReactNode
  /** Layout: `stack` (vertical, Hero row default) | `inline`
   *  (price+unit baseline, Pricing rate block). */
  variant?: StatVariant
  /** Size: `sm` (Hero / 24-30px) | `md` (Pricing / 30-36px). */
  size?: StatSize
}

const VALUE_CLASSES: Record<StatSize, string> = {
  sm: 'text-stat-value-sm sm:text-stat-value',
  md: 'text-stat-value sm:text-stat-value-xl',
}

const CAPTION_CLASSES: Record<StatSize, string> = {
  sm: 'text-stat-caption-sm sm:text-stat-caption',
  md: 'text-stat-caption sm:text-stat-caption',
}

function Stat({
  eyebrow,
  value,
  caption,
  variant = 'stack',
  size = 'sm',
}: StatProps) {
  const isStack = variant === 'stack'
  return (
    <div className={isStack ? 'text-center' : undefined}>
      {eyebrow && (
        <div className="text-stat-eyebrow font-medium tracking-stat-eyebrow text-muted-foreground/70 uppercase">
          {eyebrow}
        </div>
      )}
      {isStack ? (
        <>
          <div
            className={`mt-1 font-semibold tabular-nums tracking-stat-value text-foreground ${VALUE_CLASSES[size]}`}
          >
            {value}
          </div>
          <div className={`mt-1 text-muted-foreground/80 ${CAPTION_CLASSES[size]}`}>
            {caption}
          </div>
        </>
      ) : (
        <div className="flex items-baseline gap-2 py-1">
          <span
            className={`font-semibold tabular-nums tracking-stat-value text-foreground ${VALUE_CLASSES[size]}`}
          >
            {value}
          </span>
          <span className="text-sm text-muted-foreground">{caption}</span>
        </div>
      )}
    </div>
  )
}

export {
  Stat,
  type StatProps,
  type StatVariant,
  type StatSize,
}
