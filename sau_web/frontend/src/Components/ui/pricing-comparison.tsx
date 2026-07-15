/* ──────────────────────────────────────────────────────────────────────
 * PricingComparison — shared feature-comparison matrix (✓ / ✗).
 *
 * Used on both `/pricing` and `/login` (session-expired pitch) so a
 * visitor can quickly scan which tier includes what. Boolean cells
 * render a green check (included) or grey cross (not included);
 * string cells render the literal value (e.g. "最多 12 个").
 *
 * Data is module-local; the three columns are aligned to the canonical
 * tier order personal → team → enterprise.
 * ────────────────────────────────────────────────────────────────────── */

import type { PricingTierProps } from '@/Components/ui/pricing-tier'
import { SectionHeading } from '@/Components/ui/section-heading'
import { Check, X } from 'lucide-react'

type CompareCell = boolean | string

const COMPARISON_ROWS: ReadonlyArray<{
  feature: string
  values: readonly [CompareCell, CompareCell, CompareCell, CompareCell]
}> = [
  { feature: '接入平台账号数', values: ['1 个', '5 个', '12 个', '不限'] },
  { feature: '每月发布额度', values: ['10 条 / 月', '200 条 / 月', '不限', '不限'] },
  { feature: 'AI 文案生成', values: ['基础模型', '基础模型', '多模型切换', '私有模型可选'] },
  { feature: '定时发布', values: [true, true, true, true] },
  { feature: '任务追踪', values: [true, true, true, true] },
  { feature: '失败自动重试', values: [false, false, true, true] },
  { feature: '账号组管理', values: [false, true, true, true] },
  { feature: '多人协作', values: [false, false, true, true] },
  { feature: '多团队 · 角色权限', values: [false, false, false, true] },
  { feature: 'SSO / SCIM / 审计日志', values: [false, false, false, true] },
  { feature: '本地部署 · 数据归属您', values: [true, true, true, true] },
  { feature: '私有化部署', values: [false, false, false, true] },
  { feature: '定制开发支持', values: [false, false, false, true] },
]

function CompareCellView({ value }: { value: CompareCell }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="mx-auto h-4 w-4 text-[var(--status-success-fg)]" aria-hidden />
    ) : (
      <X className="mx-auto h-4 w-4 text-muted-foreground/40" aria-hidden />
    )
  }
  return <span className="text-[13px] font-medium text-foreground">{value}</span>
}

export interface PricingComparisonProps {
  /** The 3 tiers, in personal → team → enterprise order. */
  tiers: ReadonlyArray<PricingTierProps>
  eyebrow?: string
  title?: string
  description?: string
  /** Extra classes for the outer <section>. */
  className?: string
  /**
   * Opt the section out of `useVisitorMotion`'s ambient
   * section parallax. Default `true` because PricingComparison
   * is a data table — a continuously scrubbing -24px translate
   * would shift the prices and check/X cells as the user reads,
   * which is actively distracting. Round-unify-grammar default.
   */
  noParallax?: boolean
}

export function PricingComparison({
  tiers,
  eyebrow = '功能对比',
  title = '一表看清差异',
  description = '横向对比四个版本的核心能力,绿色对勾代表包含,灰色叉号代表不包含。',
  className = '',
  noParallax = true,
}: PricingComparisonProps) {
  return (
    <section
      data-no-parallax={noParallax ? '' : undefined}
      className={`border-b border-border/40 px-6 py-16 sm:py-20 ${className}`}
    >
      <div className="mx-auto max-w-4xl">
        <SectionHeading variant="landing" eyebrow={eyebrow} title={title} description={description} />
        <div data-reveal-group className="mt-10 overflow-x-auto rounded-xl border border-border/40 bg-card/40">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/40">
                <th className="px-5 py-4 text-[13px] font-semibold text-muted-foreground">功能</th>
                {tiers.map((t) => (
                  <th
                    key={t.id}
                    data-tier-card={t.id}
                    className={`px-5 py-4 text-center text-[13px] font-semibold text-foreground ${
                      t.highlight ? 'bg-card/60' : ''
                    }`}
                  >
                    {t.name}
                    {t.highlight && (
                      <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wider text-primary">
                        {t.badgeText}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row, i) => (
                <tr
                  key={row.feature}
                  data-reveal-cell
                  className={`border-b border-border/30 last:border-0 ${i % 2 === 1 ? 'bg-background/40' : ''}`}
                >
                  <td className="px-5 py-3.5 text-[13px] text-foreground">{row.feature}</td>
                  {row.values.map((v, idx) => {
                    const tier = tiers[idx]
                    return (
                      <td
                        key={tier.id}
                        className={`px-5 py-3.5 text-center ${tier.highlight ? 'bg-card/60' : ''}`}
                      >
                        <CompareCellView value={v} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}