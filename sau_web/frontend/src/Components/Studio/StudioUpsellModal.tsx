// ──────────────────────────────────────────────────────────────────────────
// Components/Studio/StudioUpsellModal.tsx
//
// Round-OPT-MONETIZE-v1 — modal triggered when a free-tier render attempt
// is rejected with HTTP 429 + `can_upgrade: true` (or pre-emptively, when
// StudioDetailPage's quota chip already shows 3/3 and the user clicks
// "渲染成片" anyway).
//
// Chrome mirrors ``Components/AiRightPanel/AiPaywallBanner.tsx`` so the
// two paid-prompts feel like siblings (sodium-amber left strip, hairline
// border-primary/45, bg-card, headline + 3-bullet value-props + price +
// single primary CTA → /pricing?from=studio). The dialog form factor
// (instead of the inline banner) is the modal-level sibling of the AI
// sidebar's `<PopoverContent>`-slot "compact" variant.
//
// Data-testid invariant: `studio-upsell-modal` on the outer DialogContent
// so unit / e2e tests anchor to a stable selector. The headline CTA emits
// `data-cta-url` echoing the upgrade URL for downstream correlation.
//
// Why a single-component shape (vs. just two variants): keeping
// headline/bullets/CTA copy in one source means marketing edits the
// upgrade pitch ONCE and both the inline pill surface AND the modal
// surface auto-propagate. The chip in `<StudioRenderQuotaPill>` is a
// separate component because it's always visible and doesn't need a
// modal container; the modal is for the explicit "you tried to render
// past your limit" affordance.
// ──────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Clapperboard, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/Components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/Components/ui/dialog'

export interface StudioUpsellModalProps {
  /** Radix controlled open state. */
  open: boolean
  /** Open-state change callback. The Dialog close button + Esc both
   *  fire this; the StudioDetailPage mirrors it to local state. */
  onOpenChange: (open: boolean) => void
  /** Override the headline copy. Defaults to the Studio-specific line. */
  headline?: string
  /** Override the sub-line. Defaults to the tier-soft-paywall message. */
  subline?: string
  /** Override the 3-bullet value-props. Defaults to pro-tier features. */
  bullets?: ReadonlyArray<string>
  /** Override the price string (e.g. for a future monthly vs annual toggle). */
  price?: string
  /** CTA URL — defaults to /pricing?from=studio&upgrade=at-quota so
   *  marketing can attribute this specific "blocked-then-upsold" path. */
  upgradeUrl?: string
  /** Optional CTA slot override — useful in tests where the parent
   *  already has its own navigation handler. */
  ctaSlot?: ReactNode
}

const DEFAULT_HEADLINE = '已达今日渲染上限'
const DEFAULT_SUBLINE =
  '免费版每天可在剧本工坊渲染 3 次。升级专业版每天 50 次,\n批处理渲染、Seedance 2.0 模板、高级主题样式全部解锁。'
const DEFAULT_BULLETS: ReadonlyArray<string> = [
  '每天 50 次渲染',
  'AI 续写 + AI 自动生成四幕剧本',
  'Seedance 2.0 分镜一键导出',
]
const DEFAULT_PRICE = '¥99 / 月'
const DEFAULT_UPGRADE_URL = '/pricing?from=studio&upgrade=at-quota'

export function StudioUpsellModal({
  open,
  onOpenChange,
  headline = DEFAULT_HEADLINE,
  subline = DEFAULT_SUBLINE,
  bullets = DEFAULT_BULLETS,
  price = DEFAULT_PRICE,
  upgradeUrl = DEFAULT_UPGRADE_URL,
  ctaSlot,
}: StudioUpsellModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="studio-upsell-modal"
        data-cta-url={upgradeUrl}
        className="border-primary/45"
      >
        {/* Sodium-amber left strip — same visual vocabulary as AiPaywallBanner */}
        <div
          aria-hidden
          className="absolute left-0 top-3 bottom-3 w-[2px] bg-primary rounded-r-full"
        />

        <DialogHeader>
          <div className="flex items-start gap-2.5 pl-2">
            <div
              className="flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary h-9 w-9"
              aria-hidden="true"
            >
              <Clapperboard className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[15px] font-semibold tracking-tight">
                {headline}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-muted-foreground leading-relaxed whitespace-pre-line">
                {subline}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground pl-2 mt-2">
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

        <DialogFooter className="mt-4 sm:justify-between">
          <div className="flex items-baseline gap-1 pl-2">
            <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground">
              {price.split(' ')[0]}
            </span>
            <span className="text-xs text-muted-foreground">
              {price.split(' ').slice(1).join(' ') || '/ 月'}
            </span>
          </div>
          {ctaSlot ?? (
            <Button
              asChild
              className="gap-1.5 font-medium h-9 text-[13px]"
              data-testid="studio-upsell-cta"
            >
              <Link to={upgradeUrl}>
                查看套餐
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
