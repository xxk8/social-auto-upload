// ──────────────────────────────────────────────────────────────────────────
// Components/Studio/StudioRenderQuotaPill.tsx
//
// Round-OPT-MONETIZE-v1 — top-of-page quota chip for /dashboard/studio/:id.
//
// Mirrors the chrome language established by the TTS health pill in
// StudioDetailPage: 9px / 2.5px padded chip, sodium-amber-500/15 alert
// tone at-limit + emerald-500/15 healthy tone under-limit, hairline border.
// Tap → "/pricing?from=studio?upgrade=at-quota" for free-tier at-limit so
// marketing can attribute the CTA path. Plain at-quota for pro users
// (no upsell, "wait until tomorrow" is the honest answer).
//
// Three render states:
//   1. data absent (useQuery still loading or auth-disabled mode):
//      render a low-key skeleton chip "— / —" so the page layout
//      doesn't shift when the fetch resolves.
//   2. is_unlimited (legacy / dev): "不限" with no border-tone.
//   3. concrete limit:
//      green (low) / amber (≥80% used) / red (at limit, free-tier)
//      with optional upsell CTA.
// ──────────────────────────────────────────────────────────────────────────

import { Link } from 'react-router-dom'
import { ArrowRight, Film } from 'lucide-react'
import { Button } from '@/Components/ui/button'
import type { StudioQuotaEnvelope } from '@/api/studio'

export interface StudioRenderQuotaPillProps {
  /**
   * The .data of `studioApi.getQuota()`'s envelope (`{ tier, quotas }`).
   * Undefined while ``useQuery`` is loading.
   */
  quota: StudioQuotaEnvelope | undefined
  /** Whether to surface the "升级专业版" CTA inside the pill. */
  canUpgradeCta?: boolean
}

/**
 * Studio render quota chip — three colour states + an optional inline
 * CTA to /pricing.
 */
export function StudioRenderQuotaPill({
  quota,
  canUpgradeCta = true,
}: StudioRenderQuotaPillProps) {
  // Loading / unauthenticated: low-key skeleton. The render button is
  // a much louder signal — there's no value in a red pill that races
  // the fetch; we just hold a tiny skeleton until the numbers arrive.
  if (!quota) {
    return (
      <div
        data-testid="studio-render-quota-pill"
        data-state="loading"
        className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground/60 font-mono tabular-nums"
      >
        <Film className="h-3 w-3" aria-hidden />
        <span aria-label="渲染配额载入中">今日已渲染 — / —</span>
      </div>
    )
  }

  const slot = quota.quotas.studio_render
  const used = slot.used
  const limit = slot.limit

  // Unlimited tier (legacy / dev). No CTA, no border-tone.
  if (slot.is_unlimited) {
    return (
      <div
        data-testid="studio-render-quota-pill"
        data-state="unlimited"
        data-tier={quota.tier}
        className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-card px-2.5 py-1 text-[11px] text-muted-foreground font-mono tabular-nums"
      >
        <Film className="h-3 w-3" aria-hidden />
        <span>今日已渲染 {used} / 不限次</span>
      </div>
    )
  }

  // Tier-blocked (shouldn't happen for studio_render since the
  // soft-paywall path always carries limit>0 for free, but defensive:
  // a future round that hard-blocks studio_render would land here).
  if (limit === 0) {
    return (
      <div
        data-testid="studio-render-quota-pill"
        data-state="blocked"
        data-tier={quota.tier}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-700 dark:text-amber-300 font-mono tabular-nums"
      >
        <Film className="h-3 w-3" aria-hidden />
        <span>剧本工坊渲染仅向专业版及以上用户开放</span>
      </div>
    )
  }

  const remaining = slot.remaining
  const atLimit = used >= limit
  const approaching = !atLimit && limit > 0 && used / limit >= 0.8

  // State → colour mapping (matches the TTS pill vocabulary so the
  // operator sees consistency across surfaces):
  //   healthy   → emerald-500/15 + emerald text
  //   approaching → amber-500/15 + amber text
  //   at-limit (free) → amber-500/40 border + amber text + CTA
  //   at-limit (pro)  → amber-500/15 (no CTA — wait until tomorrow)
  const tone =
    atLimit
      ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
      : approaching
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'

  const shouldShowCta = atLimit && slot.can_upgrade && canUpgradeCta

  return (
    <div
      data-testid="studio-render-quota-pill"
      data-state={atLimit ? 'at-limit' : approaching ? 'approaching' : 'healthy'}
      data-tier={quota.tier}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-mono tabular-nums ${tone}`}
    >
      <Film className="h-3 w-3" aria-hidden />
      <span>
        今日已渲染{' '}
        <span className="font-semibold">{used}</span> / {limit} 次
        {atLimit
          ? ` · 明日 ${new Date(slot.resets_at ?? '').toLocaleDateString('zh-CN')} 重置`
          : ''}
      </span>
      {shouldShowCta && (
        <Button
          asChild
          size="sm"
          className="ml-1 h-6 gap-1 px-2 text-[10px]"
          data-testid="studio-quota-upgrade-button"
        >
          <Link to="/pricing?from=studio&upgrade=at-quota">
            升级专业版
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      )}
    </div>
  )
}
