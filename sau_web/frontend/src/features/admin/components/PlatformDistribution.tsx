// ─────────────────────────────────────────────────────────────────────
// PlatformDistribution — horizontal stacked bar chart visualizing the
// `tasks_by_platform` system data. Lives on AdminOverviewPage below
// the Recent Activity feed.
//
// Visual contract:
//   • Strip-style horizontal bar: each platform gets a tinted segment
//     with width = pct of total tasks.
//   • Legend below the bar: per-platform label, count, pct.
//   • Nothing renders if the total is 0 — caller decides whether to
//     show an empty state instead (we don't replace PremiumEmptyState
//     here, we degrade silently so the loading skeleton keeps its
//     shape).
//
// Color palette: 6 deterministic hue families that match AdminAvatar's
// set so a stripe = (user, avatar hue) shows consistent identity.
//
// Module exports ONLY the component.
// ─────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { stableStringHash } from '@/lib/hash'

interface PlatformDistributionProps {
  /** Map of platform key → count. Undefined or empty hides the chart. */
  tasksByPlatform?: Record<string, number>
  /** Loading dim state — fade the chart and show a single shimmer. */
  loading?: boolean
  className?: string
}

// Same hash strategy as AdminAvatar so platform colors are stable
// across renders and aligned to the avatar palette set.
const PALETTE: ReadonlyArray<{ hue: string; bg: string }> = [
  { hue: 'hsl(220 60% 55%)',  bg: 'bg-[hsl(220_60%_55%)]' },
  { hue: 'hsl(330 60% 60%)',  bg: 'bg-[hsl(330_60%_60%)]' },
  { hue: 'hsl(15 70% 60%)',   bg: 'bg-[hsl(15_70%_60%)]'  },
  { hue: 'hsl(45 75% 55%)',   bg: 'bg-[hsl(45_75%_55%)]'  },
  { hue: 'hsl(165 55% 50%)',  bg: 'bg-[hsl(165_55%_50%)]' },
  { hue: 'hsl(265 55% 60%)',  bg: 'bg-[hsl(265_55%_60%)]' },
  { hue: 'hsl(195 60% 50%)',  bg: 'bg-[hsl(195_60%_50%)]' },
  { hue: 'hsl(105 50% 50%)',  bg: 'bg-[hsl(105_50%_50%)]' },
]

// Human-readable label map — best-effort Latin 1 display names for
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
    if (!tasksByPlatform) return { total: 0, entries: [] as Array<{ key: string; count: number; pct: number; label: string; hue: string; bg: string }> }
    const sum = Object.values(tasksByPlatform).reduce((a, b) => a + b, 0)
    const pairs = Object.entries(tasksByPlatform)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
    return {
      total: sum,
      entries: pairs.map(([key, count]) => {
        const idx = stableStringHash(key) % PALETTE.length
        const slot = PALETTE[idx]
        return {
          key,
          count,
          pct: sum === 0 ? 0 : (count / sum) * 100,
          label: LABEL_MAP[key] ?? key,
          hue: slot.hue,
          bg: slot.bg,
        }
      }),
    }
  }, [tasksByPlatform])

  if (!loading && total === 0 && entries.length === 0) return null

  return (
    <div
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

      {/* Bar strip — each segment's width is the platform's pct. We
          don't animate widths because the data is fetched via React
          Query and changes are usually small; transitions would add
          noise. */}
      <div
        className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40 ring-1 ring-inset ring-border/40"
        role="img"
        aria-label={loading ? '加载中' : `平台任务分布 · 合计 ${total}`}
      >
        {loading ? (
          <div className="h-full w-full bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40 animate-pulse" />
        ) : (
          entries.map((e) => (
            <span
              key={e.key}
              className={cn('h-full block', e.bg)}
              style={{ width: `${e.pct}%` }}
              title={`${e.label} · ${e.count} (${e.pct.toFixed(1)}%)`}
            />
          ))
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="block h-2 w-2 rounded-full bg-muted/60" />
              <span className="block h-3 w-16 rounded bg-muted/40 animate-pulse" />
            </div>
          ))
        ) : (
          entries.map((e) => (
            <div key={e.key} className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden
                className={cn('block h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/5', e.bg)}
              />
              <span className="text-[12px] text-foreground/80 truncate">{e.label}</span>
              <span className="ml-auto font-mono tabular-nums text-[11px] text-muted-foreground/70">
                {e.count}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export { PlatformDistribution }
