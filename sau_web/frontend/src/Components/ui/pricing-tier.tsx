/* ──────────────────────────────────────────────────────────────────────
 * PricingTier — visitor-surface tier-card primitive (round 9).
 *
 * Lives alongside `<SectionHeading>` in `@/Components/ui/`. Mirror
 * of the canonical pattern set by `section-heading.tsx`:
 *   - Type-only `PricingTierProps` interface (Fast Refresh safe).
 *   - Single runtime export (`PricingTier`).
 *   - Module-local class-string mapping for the highlight chrome
 *     swap (no `cva()` recipe exported).
 *
 * Card anatomy:
 *   ┌── tier-recommended-accent (only if highlight) ──┐
 *   │ [badgeText?]                                     │
 *   │  ─────────                                       │
 *   │  {name · stat-eyebrow caps}                      │
 *   │  {tagline}                                       │
 *   │                                                  │
 *   │  {price ┃ priceUnit}   ← composes <Stat inline>   │
 *   │  {priceMeta?}            ← yearly hint            │
 *   │  {trial?}                 ← trial pill            │
 *   │  ───────── (divider)                             │
 *   │  包含权限                                        │
 *   │  • feature                                       │
 *   │  • feature                                       │
 *   │  [CTA → ctaTo]                                   │
 *   └──────────────────────────────────────────────────┘
 *
 * Highlight differences (recommended/team tier):
 *   - chrome: `border-foreground/45 bg-card/85 .tier-recommended-accent`
 *   - default: `border-border/40 bg-card/40 hover:border-foreground/30 hover:bg-card/70`
 * ────────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/Components/ui/badge'
import { Button } from '@/Components/ui/button'
import { Stat } from '@/Components/ui/stat'

export interface PricingTierProps {
  /**
   * Stable slug identifier for the tier (round-11 test-id invariant).
   * Emitted as `data-tier-card={id}` on the outer wrapper so e2e specs
   * anchor to the slug rather than the copy-bound `tier.name`.
   */
  id: 'free' | 'personal' | 'team' | 'enterprise'
  /** The tier name, rendered in stat-eyebrow style (uppercase sans). */
  name: string
  /** The supporting tagline below the name — short product-positioning line. */
  tagline: string
  /** The quantitative price (e.g. `¥0`, `¥199`, `联系销售`). */
  price: ReactNode
  /** The rate unit next to the price (e.g. `永久免费`, `/ 月`, `定制方案`). */
  priceUnit: ReactNode
  /** Optional yearly price hint rendered under the monthly price (e.g. `¥399/年 ≈ ¥33/月`). */
  priceMeta?: ReactNode
  /** Optional trial note rendered as a pill under the price (e.g. `14 天免费试用`). */
  trial?: string
  /** The feature bullets list — each line a checkmarkable claim. */
  features: ReadonlyArray<string>
  /** CTA button label (e.g. `开始试用 →`, `立即订阅 →`). */
  ctaLabel: string
  /** Where the CTA routes to (e.g. `/login?plan=personal`). */
  ctaTo: string
  /** When true, uses the recommended chrome + amber hairline accent. */
  highlight?: boolean
  /** Optional badge text rendered above the card (typically paired with `highlight`). */
  badgeText?: string
}

const CARD_BASE =
  'relative flex flex-col gap-5 rounded-xl border p-6 transition-all duration-200 sm:p-7'
const HIGHLIGHT_CHROME = 'border-foreground/45 bg-card/85 tier-recommended-accent'
const DEFAULT_CHROME =
  'border-border/40 bg-card/40 hover:border-foreground/30 hover:bg-card/70'

function PricingTier({
  id,
  name,
  tagline,
  price,
  priceUnit,
  priceMeta,
  trial,
  features,
  ctaLabel,
  ctaTo,
  highlight = false,
  badgeText,
}: PricingTierProps) {
  return (
    <div
      className={`${CARD_BASE} ${highlight ? HIGHLIGHT_CHROME : DEFAULT_CHROME}`}
      data-tier-card={id}
      data-recommended={highlight ? 'true' : undefined}
    >
      {badgeText && (
        <Badge
          variant="secondary"
          className="absolute -top-2.5 right-5 text-[10px] uppercase tracking-wider"
        >
          {badgeText}
        </Badge>
      )}
      <div>
        <div className="text-stat-eyebrow font-medium tracking-stat-eyebrow text-muted-foreground/70 uppercase">
          {name}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{tagline}</p>
      </div>

      {/* Price block — price + unit, optional yearly hint, optional trial pill */}
      <div>
        <Stat variant="inline" size="md" value={price} caption={priceUnit} />
        {priceMeta && (
          <p className="mt-1 text-[12px] text-muted-foreground/70">{priceMeta}</p>
        )}
        {trial && (
          <span className="mt-2 inline-flex items-center rounded-full border border-primary/30 bg-primary/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-primary">
            {trial}
          </span>
        )}
      </div>

      {/* Divider between price and permission list */}
      <div className="h-px w-full bg-border/40" aria-hidden />

      {/* Permission list */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          包含权限
        </div>
        <ul className="space-y-2 text-[13px] text-muted-foreground">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-foreground/60" aria-hidden />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-2">
        <Button asChild size="lg" className="h-11 w-full text-sm font-medium">
          <Link to={ctaTo}>{ctaLabel}</Link>
        </Button>
      </div>
    </div>
  )
}

export { PricingTier }