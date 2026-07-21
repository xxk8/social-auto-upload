// ──────────────────────────────────────────────────────────────────────────
// Components/AiRightPanel/AiPaywallBanner.tsx
//
// round-AI-paywall-v1 — Stripe-style tier-required banner surfaced in
// the AI sidebar whenever `tier === 'free'`. Mirrors the chrome language
// already established by `SettingsTab.UpgradeBanner` (2-px sodium-amber
// left strip, hairline border-primary/45, opaque bg-card) so the user
// recognizes the upgrade CTA across surfaces.
//
// Two variants:
//
//   • `full`   — replaces the chat viewport in <PublishAiSidebar>
//                expanded mode. Holds headline + 3-bullet list + price +
//                a single primary CTA → /pricing?from=ai .
//                Layout: stacked headline/body + 1 CTA on the right.
//
//   • `compact` — slotted inside a `PopoverContent` (the collapsed
//                 rail's image-search / quick-send popovers). Strips
//                 the price block + the long bullet list; keeps the
//                 headline + a single 1-line tagline + the CTA.
//
// data-testid invariant: `ai-paywall-banner` + `data-variant={variant}`
// on the outer wrapper, so e2e / unit tests can anchor on a single
// selector across both shapes and assert the AI paywall is the only
// thing rendered (NOT the chat viewport composer).
//
// Why a single component for two shapes (instead of just two):
//   • The bullet list + headline + CTA copy stays consistent across
//     the two surfaces — easy for marketing to revise once and have
//     both surfaces auto-propagate.
//   • Compact variant auto-hides the price block so it fits in a 288px
//     popover without horizontal overflow — documented invariant.
// ──────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/Components/ui/button'
import { cn } from '@/lib/utils'

export type AiPaywallVariant = 'full' | 'compact'

export interface AiPaywallBannerProps {
  /**
   * `full` replaces the chat viewport (PublishAiSidebar expanded mode).
   * `compact` slots into a PopoverContent (rail popovers).
   * Default: `full`.
   */
  variant?: AiPaywallVariant
  /**
   * CTA URL — caller overrides only for tests; default routes free-tier
   * users to the visitor-facing /pricing surface with `?from=ai` so
   * marketing can attribute the visit source.
   */
  upgradeUrl?: string
  /** Headline above the bullet list (full only). Default upgrade copy. */
  headline?: string
  /** Sub-headline (full) / one-liner (compact) below the headline. */
  subline?: string
  /** Bulleted value props (full only). Defaults to pro-tier features. */
  bullets?: ReadonlyArray<string>
  /** Price string (full only). Default pro tier price. */
  price?: string
  /** Optional className for the outer wrapper. */
  className?: string
  /**
   * If supplied, render this instead of the default Link + ArrowRight
   * primary CTA — useful in tests where the parent provides its own
   * navigation handler.
   */
  ctaSlot?: ReactNode
}

const DEFAULT_HEADLINE = '解锁 AI 助手'
const DEFAULT_SUBLINE_FULL =
  '升级专业版后,AI 内容生成 · 图片素材搜索 · 多平台适配一键多套文案,全部解锁。'
const DEFAULT_SUBLINE_COMPACT = 'AI 功能仅向专业版及以上用户开放。'
const DEFAULT_BULLETS: ReadonlyArray<string> = [
  'AI 自动生成（200 次 / 月）',
  '图片素材搜索（Pexels + Pixabay）',
  '多平台适配 · 一键多套文案',
]
const DEFAULT_PRICE = '¥99 / 月'

export function AiPaywallBanner({
  variant = 'full',
  upgradeUrl = '/pricing?from=ai',
  headline = DEFAULT_HEADLINE,
  subline,
  bullets = DEFAULT_BULLETS,
  price = DEFAULT_PRICE,
  className,
  ctaSlot,
}: AiPaywallBannerProps) {
  const resolvedSubline =
    subline ?? (variant === 'compact' ? DEFAULT_SUBLINE_COMPACT : DEFAULT_SUBLINE_FULL)
  const isCompact = variant === 'compact'

  return (
    <div
      data-testid="ai-paywall-banner"
      data-variant={variant}
      data-cta-url={upgradeUrl}
      className={cn(
        'relative flex flex-col gap-4 rounded-xl border border-primary/45 bg-card shadow-sm',
        isCompact ? 'p-3.5' : 'p-5',
        className,
      )}
    >
      {/* ── Sodium-amber left strip (mirrors SettingsTab UpgradeBanner) ── */}
      <div
        aria-hidden
        className={cn(
          'absolute left-0 bg-primary rounded-r-full',
          isCompact ? 'top-2.5 bottom-2.5 w-[2px]' : 'top-3 bottom-3 w-[2px]',
        )}
      />

      {/* ── Brand mark + headline row (full + compact share) ── */}
      <div className="flex items-start gap-2.5 pl-2">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
            isCompact ? 'h-7 w-7' : 'h-9 w-9',
          )}
          aria-hidden="true"
        >
          <Sparkles className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'font-semibold tracking-tight text-foreground',
              isCompact ? 'text-[13px]' : 'text-[15px]',
            )}
          >
            {headline}
          </h3>
          <p
            className={cn(
              'mt-1 text-muted-foreground leading-relaxed',
              isCompact ? 'text-[11px]' : 'text-[13px]',
            )}
          >
            {resolvedSubline}
          </p>
        </div>
      </div>

      {/* ── Bullets (full only) ── */}
      {!isCompact && (
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground pl-2">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2">
              <Check
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Price + CTA (full only shows price; compact hides it
              for 288px popover fit) ── */}
      <div
        className={cn(
          'flex items-center gap-3 pl-2',
          isCompact ? 'justify-end' : 'justify-between',
        )}
      >
        {!isCompact && (
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground">
              {price.split(' ')[0]}
            </span>
            <span className="text-xs text-muted-foreground">
              {price.split(' ').slice(1).join(' ') || '/ 月'}
            </span>
          </div>
        )}
        {ctaSlot ?? (
          <Button
            asChild={!ctaSlot}
            size={isCompact ? 'sm' : 'default'}
            className={cn(
              'gap-1.5 font-medium',
              isCompact ? 'h-8 text-[12px]' : 'h-9 text-[13px]',
            )}
            data-testid="ai-paywall-banner-cta"
          >
            <Link to={upgradeUrl}>
              {isCompact ? '了解专业版' : '查看套餐'}
              <ArrowRight className={isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
