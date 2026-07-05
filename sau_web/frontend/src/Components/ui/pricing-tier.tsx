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
 *   │                                                  │
 *   │  • feature                                       │
 *   │  • feature                                       │
 *   │  • feature                                       │
 *   │                                                  │
 *   │  [CTA → ctaTo]                                   │
 *   └──────────────────────────────────────────────────┘
 *
 * Highlight differences (recommended/team tier):
 *   - chrome: `border-foreground/45 bg-card/85 .tier-recommended-accent`
 *   - default: `border-border/40 bg-card/40 hover:border-foreground/30 hover:bg-card/70`
 *
 * Future surfaces: `/login?plan=personal|team|enterprise` progress
 * pages can compose the same primitive for "you picked team" surfacing.
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
   * anchor to the slug rather than the copy-bound `tier.name`. Required
   * at the type level — a future tier that omits an `id` would render no
   * `data-tier-card` and break spec selectors on irrelevant grounds
   * (when copy shifts). The slug is the contract; `name` is the
   * marketing surface.
   */
  id: 'personal' | 'team' | 'enterprise'
  /** The tier name, rendered in stat-eyebrow style (uppercase sans). */
  name: string
  /** The supporting tagline below the name — short product-positioning line. */
  tagline: string
  /** The quantitative price (e.g. `¥0`, `¥199`, `联系销售`). */
  price: ReactNode
  /** The rate unit next to the price (e.g. `永久免费`, `/ 月`, `定制方案`). */
  priceUnit: ReactNode
  /** The feature bullets list — each line a checkmarkable claim. */
  features: ReadonlyArray<string>
  /** CTA button label (e.g. `立即开始 →`, `升级团队版 →`). */
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
  features,
  ctaLabel,
  ctaTo,
  highlight = false,
  badgeText,
}: PricingTierProps) {
  return (
    <div
      className={`${CARD_BASE} ${highlight ? HIGHLIGHT_CHROME : DEFAULT_CHROME}`}
      // Round-11 test-id hooks (decouple e2e specs from copy drift).
      // · `data-tier-card={id}`     — one stable selector per tier.
      // · `data-recommended`        — emitted only on the highlight
      //   tier (`true`); omitted on the rest so the recommended
      //   card is grep-targetable without a class-name dance or
      //   boolean-as-string gymnastics in the spec.
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
      <Stat variant="inline" size="md" value={price} caption={priceUnit} />
      <ul className="space-y-2 text-[13px] text-muted-foreground">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-foreground/60" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">
        <Button asChild size="lg" className="h-11 w-full text-sm font-medium">
          <Link to={ctaTo}>{ctaLabel}</Link>
        </Button>
      </div>
    </div>
  )
}

export { PricingTier }
