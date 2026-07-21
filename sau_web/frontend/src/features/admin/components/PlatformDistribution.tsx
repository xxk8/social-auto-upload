// ─────────────────────────────────────────────────────────────────────
// PlatformDistribution v3 — recharts-powered stacked bar chart.
//
// Replaces the hand-written div + motion.span bar with recharts'
// BarChart + multiple stacked Bar layers, keeping the same exported
// props interface (`tasksByPlatform`, `loading`, `className`) and
// test contract (data-testid, null when total===0, loading skeleton).
//
// Visual contract (unchanged from v2):
//  - No axes, no grid — just the stacked bar.
//  - Tooltip on hover showing platform · count (pct%).
//  - Legend below with color dot + label + count.
//  - Loading state shows a shimmer skeleton bar + skeleton legend.
//  - Returns null when total === 0 and not loading.
//
// Module exports ONLY the component.
// ─────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { stableStringHash } from '@/lib/hash'
import { CHART_PALETTE } from '@/lib/recharts-theme'
import { StackedBarChart } from '@/lib/StackedBarChart'

interface PlatformDistributionProps {
  /** Map of platform key → count. Undefined or empty hides the chart. */
  tasksByPlatform?: Record<string, number>
  /** Loading dim state — fade the chart and show a single shimmer. */
  loading?: boolean
  className?: string
}

// Same hash strategy as AdminAvatar so platform colors are stable
// across renders and aligned to the avatar palette set.
// Now imports from the shared recharts-theme palette so colour changes
// are a 1-file edit.
const PALETTE = CHART_PALETTE

// Human-readable label map — best-effort display names for
// platforms we ship today; unknown platforms fall back to the raw key.
const LABEL_MAP: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  bilibili: '哔哩哔哩',
  tencent: '腾讯视频',
  kuaishou: '快手',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  baijiahao: '百家号',
}



function PlatformDistribution({ tasksByPlatform, loading, className }: PlatformDistributionProps) {
  const { total, entries } = useMemo(() => {
    if (!tasksByPlatform) return { total: 0, entries: [] as Array<{ key: string; count: number; pct: number; label: string; color: string }> }
    const sum = Object.values(tasksByPlatform).reduce((a, b) => a + b, 0)
    const pairs = Object.entries(tasksByPlatform)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
    return {
      total: sum,
      entries: pairs.map(([key, count]) => {
        const idx = stableStringHash(key) % PALETTE.length
        return {
          key,
          count,
          pct: sum === 0 ? 0 : (count / sum) * 100,
          label: LABEL_MAP[key] ?? key,
          color: PALETTE[idx],
        }
      }),
    }
  }, [tasksByPlatform])

  if (!loading && total === 0 && entries.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn('relative', loading && 'opacity-60', className)}
      data-testid="admin-platform-distribution"
    >
      {/* Eyebrow + total */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground/80 uppercase">
          平台分布
        </div>
        {!loading && (
          <div className="font-mono tabular-nums text-[11px] text-muted-foreground/70">
            合计 {total.toLocaleString()}
          </div>
        )}
      </div>

      {/* Stacked bar chart — recharts BarChart with no axes.
          Each platform is a separate stacked segment with its
          own colour. Height is fixed at 48px (taller than
          the v2 h-3 strip for better Tooltip hit area). */}
      {loading ? (
        <div className="mt-3 h-12 w-full rounded-full bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40 animate-pulse" />
      ) : total > 0 ? (
        <div className="mt-3 h-12 w-full">
          <StackedBarChart
            segments={entries.map((e) => ({ key: e.key, count: e.count, color: e.color }))}
            name="platforms"
            animationDuration={600}
            tooltipFormatter={(value, key) => {
              const e = entries.find((en) => en.key === key)
              if (e) {
                return [`${e.label} · ${value} (${e.pct.toFixed(1)}%)`, '']
              }
              return [`${value}`, '']
            }}
          />
        </div>
      ) : (
        <div className="mt-3 h-12 w-full rounded-lg bg-muted/40" />
      )}

      {/* Legend — same as v2, kept as plain HTML for crisp text
          rendering (recharts legend would add axis-level chrome). */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="block h-2 w-2 rounded-full bg-muted/60" />
              <span className="block h-3 w-16 rounded bg-muted/40 animate-pulse" />
            </div>
          ))
        ) : (
          entries.map((e, i) => (
            <motion.div
              key={e.key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.3,
                delay: 0.3 + i * 0.06,
                ease: 'easeOut',
              }}
              className="flex items-center gap-2 min-w-0"
            >
              <span
                aria-hidden
                className="block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/5"
                style={{ backgroundColor: e.color }}
              />
              <span className="text-[12px] text-foreground/80 truncate">{e.label}</span>
              <span className="ml-auto font-mono tabular-nums text-[11px] text-muted-foreground/70">
                {e.count}
              </span>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  )
}

export { PlatformDistribution }
