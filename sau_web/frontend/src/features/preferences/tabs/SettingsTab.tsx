// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/SettingsTab.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): SettingsTab is the
// 'settings' tab body for the PreferencesDialog. Mirrors /app/settings
// route surface so both stay in lockstep through the same useAuth()
// hook + TIER_MAP. The free→pro upgrade banner lives as a private
// helper inside this file (only the 'settings' pane renders it).
//
// Mounted by:
//   • `<PreferencesDialog>`'s `<Tabs.Content value="settings">` pane
//   • `/app/settings` route → `<SettingsPage>` (thin wrapper)
//
// data-testid invariants (`settings-upgrade-banner` + `data-tier`)
// stay on the UpgradeBanner element so PreferencesDialog.test.tsx
// (k/l/m/n) keeps pinning the same selectors regardless of file
// location.
// ──────────────────────────────────────────────────────────────────────────

import { Link } from 'react-router-dom'
import { ArrowRight, FileText, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/Components/ui/card'
import { Button } from '@/Components/ui/button'
import { useAuth } from '@/features/auth/useAuth'

// ── TIER_MAP (SettingsTab-local source-of-truth) ─────────────────────
// `as const`-style strict typing keeps TierKey exhaustive at compile
// time — adding a future tier ('team') requires updating this map
// first. The pro tier's `features[]` ALSO drives the upgrade-banner
// bullet list (auto-propagation: future copy revisions land once
// and the dialog and any future PricingVisitor surface inherit in
// lockstep).
type TierKey = 'free' | 'pro' | 'legacy'

interface TierMeta {
  name: string
  price: string
  tagline: string
  features: string[]
}

const TIER_MAP: Record<TierKey, TierMeta> = {
  free: {
    name: '自由版',
    price: '¥0 / 永久免费',
    tagline: '本地部署 · 数据归属您',
    features: [
      '多账号统一管理（≤ 6 个）',
      '视频内容发布',
      '运行日志 + 数据分析',
    ],
  },
  pro: {
    name: '专业版',
    price: '¥99 / 月 · 升级后解除多账号上限 + AI 配额',
    tagline: '面向多账号矩阵 + AI 内容生成',
    features: [
      '多账号统一管理（≤ 30 个）',
      'AI 自动生成（200 次 / 月）',
      '数据分析窗口延长至 90 天',
    ],
  },
  legacy: {
    name: '社区版',
    price: '感谢您的早期支持',
    tagline: '认证用户专享 · 历史数据永保',
    features: [
      '包含自由版所有功能',
      '历史数据永久保留',
      '升级至专业版可享首月半价',
    ],
  },
}

export function SettingsTab() {
  const { user: authUser } = useAuth()
  const tierKey = (authUser?.tier ?? 'legacy') as TierKey
  const plan = TIER_MAP[tierKey] ?? TIER_MAP.legacy

  return (
    <div className="space-y-4">
      {/* Free→pro upgrade banner, gated on tier=free or tier=legacy
          (pro already paying, no nag). data-testid="settings-upgrade-banner"
          + data-tier={tierKey} locks e2e via a single selector. */}
      {(tierKey === 'free' || tierKey === 'legacy') && (
        <UpgradeBanner tierKey={tierKey} />
      )}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">当前套餐</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Plan identity row — bigger plan name + bigger price + 1-line
              tagline so the reader sees a single coherent card. */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70">
                套餐
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-semibold tracking-tight text-foreground">
                  {plan.name}
                </span>
                {tierKey === 'pro' && (
                  <Sparkles className="h-4 w-4 text-primary" aria-label="专业版标识" />
                )}
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
                {plan.tagline}
              </p>
            </div>
            {/* CTA aligned to right edge so plan identity anchors left
                + action anchors right — matches visitor-surface
                PricingPage layout pattern. */}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5 flex-shrink-0"
            >
              <Link to="/pricing">
                {tierKey === 'pro' ? '管理订阅' : '升级套餐'}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          {/* Divider + price + features — separated so each fact
              reads as its own row instead of all four competing on
              one line. */}
          <div className="border-t border-border/30 pt-4 space-y-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70">
                价格
              </span>
              <p className="mt-1 text-sm text-foreground">{plan.price}</p>
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70">
                已包含
              </span>
              <ul className="mt-2 space-y-1.5 text-sm text-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1.5 h-1 w-1 rounded-full bg-primary flex-shrink-0"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">相关页面</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
          >
            <Link to="/app/logs">
              <FileText className="h-4 w-4 text-muted-foreground" />
              查看运行日志
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ── UpgradeBanner (SettingsTab-private helper) ───────────────────────
// free→pro 引导 banner, only renders for tier=free or tier=legacy.
// Chrome per DESIGN.md chrome-patterns: 2-px sodium-amber left strip
// (NOT a glow, NOT a full perimeter), hairline border-primary/45,
// bg-card opaque (reads distinct from the plan-card below it via
// the border color, not the bg color), rounded-xl. source-of-truth
// for bullets: TIER_MAP.pro.features (auto-propagates).
function UpgradeBanner({ tierKey }: { tierKey: TierKey }) {
  const bullets = TIER_MAP.pro.features
  return (
    <div
      data-testid="settings-upgrade-banner"
      data-tier={tierKey}
      className="relative flex flex-col gap-4 rounded-xl border border-primary/45 bg-card py-5 pl-6 pr-5 shadow-sm sm:flex-row sm:items-start"
    >
      <div
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full bg-primary"
      />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
          升级套餐
        </span>
        <h3 className="mt-1.5 text-[15px] font-semibold tracking-tight text-foreground">
          解锁专业版
        </h3>
        <ul className="mt-2.5 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
          {bullets.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary"
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 flex-row items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-start">
        <div className="flex items-baseline gap-1">
          <span
            data-testid="settings-upgrade-banner-price"
            className="font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground"
          >
            ¥99
          </span>
          <span className="text-xs text-muted-foreground">/ 月</span>
        </div>
        <Button
          asChild
          size="sm"
          className="h-9 gap-1.5 font-medium"
          data-testid="settings-upgrade-banner-cta"
        >
          <Link to="/pricing">
            查看套餐
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
