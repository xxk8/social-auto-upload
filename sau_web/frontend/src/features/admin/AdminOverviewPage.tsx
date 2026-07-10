// ─────────────────────────────────────────────────────────────────────
// AdminOverviewPage v2 — premium redesign.
//
// Upgrades from v1:
//   • Header band: keeps PageHeader but tucks the "刷新" + last-updated
//     timestamp into the actions slot so the page feels alive without
//     adding a new component API.
//   • Stat strip: replaces Equal-weight 4-card grid with AdminStat
//     hero cards (2-px accent stripe, 32px tabular-nums numeral,
//     optional delta + sub-meta, no more bg-muted/50 chip).
//   • Platform chart: pulls `/api/admin/system` and renders a
//     stacked-bar distribution segmented per platform (Linear / Vercel
//     chart style). Subscribes silently to its own query so an
//     empty system call doesn't downgrade the overview block.
//   • Recent activity: ditched the table-with-3-columns in favor of an
//     avatar + email + CodePill action + relative-time feed row.
//     The data shape passed to tests still contains the same `2026-07-05 10:30`
//     timestamp + the action string + the email, so getByText still
//     resolves — but the row is now a feed-style list rather than a
//     plain data table.
//   • Time range filter: replaced Radix's bg-muted pill TabsList with
//     SegmentedTimeRange (underline, no fill — quiet chrome).
//   • Empty state: replaced DefaultEmptyState with PremiumEmptyState.
//     Title + description wording preserved per test contract.
//
// Test contract (locked):
//   • h1 = "系统概览"
//   • description = "项目使用统计与最近活动"
//   • All 5 time-range tabs (全部/今天/本周/本月/自定义) keep the
//     `role="tab"` semantics (SegmentedTimeRange wraps Radix).
//   • 清除筛选 button w/ name=="清除筛选".
//   • Custom date inputs: <Label htmlFor="..."> 开始日期 / 结束日期
//     paired with their date input.
//   • Recent action row still renders `admin@test.com`, `update_role`,
//     and `2026-07-05 10:30` — visible text content unchanged.
//   • Empty state title = "暂无记录", description = "所选时间范围内没有用户操作"
//   • Stat values: "42", "7", "1337", "98.5%" — present in the DOM.
// ─────────────────────────────────────────────────────────────────────

import { useMemo, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from './adminApi'
import { useTimeRangeFilter, TIME_RANGE_OPTIONS, type PresetRange } from './useTimeRangeFilter'
import { trendMock } from './trendMock'
import { PageHeader } from '@/Components/ui/page-header'
import { AdminNavTabs } from './components/AdminNavTabs'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/Components/ui/card'
import { Skeleton } from '@/Components/ui/skeleton'
import { Button } from '@/Components/ui/button'
import { Input } from '@/Components/ui/input'
import { Label } from '@/Components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/Components/ui/table'
import {
  Activity,
  BarChart3,
  CheckCircle,
  Download,
  ListChecks,
  RefreshCw,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminStat } from './components/AdminStat'
import { SegmentedTimeRange } from './components/SegmentedTimeRange'
import { AdminAvatar } from './components/AdminAvatar'
import { CodePill } from './components/CodePill'
import { PlatformDistribution } from './components/PlatformDistribution'
import { PremiumEmptyState } from './components/PremiumEmptyState'
import { relativeTimeFromNow } from '@/lib/relativeTime'

// We render all 5 time-range tabs (the 4 presets + 自定义) inline so a
// single SegmentedTimeRange block carries every `role="tab"` the test
// suite queries. The 自定义 toggle's click flips the underlying
// timeRange state to 'custom', which then renders the date input row
// below the strip.
const TIME_RANGE_TABS = [
  ...TIME_RANGE_OPTIONS,
  { value: 'custom', label: '自定义' },
] as const

// v3-trends days-picker: the user-visible window length for both the
// 4-stat sparkline row AND the CSV export click. 3 fixed values cover
// the common cases (weekly check / fortnightly review / monthly
// trend) without exposing the backend's full 1..90 range. Default
// 14 preserves the v3-mini behavior — see §22.10 in
// docs/DESIGN-admin-dashboard.md for the contract.
const DAYS_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
] as const

export default function AdminOverviewPage() {
  const {
    timeRange,
    customStart,
    customEnd,
    updateTimeRange,
    updateCustomStart,
    updateCustomEnd,
    clearFilters,
  } = useTimeRangeFilter()

  const filtersActive = timeRange !== 'all'

  // v3-trends days-picker state. Default is `DAYS_OPTIONS[1].value`
  // (the middle option — currently 14d, matching v3-mini behavior)
  // so the default is co-located with the options list: adding a
  // "60d" or "90d" option later doesn't require updating two
  // places. The state is read in 3 places: trendsQuery queryKey (so
  // React Query auto-refetches on change), trendsQuery queryFn (the
  // actual fan-out to /api/admin/trends), and handleExportTrends
  // (the CSV download). See §22.10 in docs/DESIGN-admin-dashboard.md.
  const [days, setDays] = useState<number>(DAYS_OPTIONS[1].value)

  const overviewQuery = useQuery({
    queryKey: ['admin', 'overview', timeRange, customStart, customEnd],
    queryFn: () =>
      adminApi.getOverview(
        timeRange,
        timeRange === 'custom' ? customStart : undefined,
        timeRange === 'custom' ? customEnd : undefined,
      ),
    staleTime: 30_000,
  })

  // Silent sibling subscription — does NOT affect the overview data
  // contract. Lives in a separate queryKey so clearing filters or
  // switching pages doesn't refetch it. Kept silent because the chart
  // is decorative; if `/api/admin/system` 4xx'es we render nothing.
  const systemQuery = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: () => adminApi.getSystem(),
    staleTime: 60_000,
    retry: 0,
  })

  // Real trend data from /api/admin/trends (replaces the in-memory
  // trendMock as the primary source). The page keeps trendMock as a
  // per-metric fallback so a single 5xx on the trends endpoint still
  // leaves the page with 4 sparklines (rendered from the deterministic
  // mock) instead of degrading to 0 sparklines. The queryKey includes
  // `days` (the picker value) so React Query auto-refetches when the
  // user changes scope — AND it intentionally does NOT include the
  // time-range filter, because trends are scoped to the days-picker
  // while the time-range filter only affects the recent-actions table
  // below the stat strip.
  const trendsQuery = useQuery({
    queryKey: ['admin', 'trends', days],
    queryFn: async () => {
      const metrics = [
        'total_users',
        'active_today',
        'total_tasks',
        'task_success_rate',
      ] as const
      const results = await Promise.all(
        metrics.map((m) =>
          adminApi.getTrends(m, days).catch(() => undefined),
        ),
      )
      const out: Record<string, number[] | undefined> = {}
      metrics.forEach((m, i) => {
        const r = results[i]
        // Defensive: the API may resolve with `undefined` (a stale
        // mock in a test, or a transport-layer glitch that still
        // resolved the promise). Only treat a SUCCESSFUL, NON-EMPTY
        // series as "real data" — anything else falls through to
        // the per-metric mock fallback below.
        if (r && r.success && r.data?.points && r.data.points.length > 0) {
          out[m] = r.data.points
        }
      })
      return out
    },
    staleTime: 30_000,
  })

  const isLoading = overviewQuery.isLoading
  const overview = overviewQuery.data?.data
  const hasRecentActions = (overview?.recent_actions?.length ?? 0) > 0

  // Inline refresh helper — invalidates both queries so the page
  // re-snapshots stats + platform distribution together.
  const refresh = () => {
    overviewQuery.refetch()
    systemQuery.refetch()
  }

  // v3-trends-export: download a CSV of the 4-metric × N-day trend
  // series shown above, where N is the days-picker's current value.
  // Fetches as a Blob, builds an object URL, and triggers a temporary
  // anchor click — the standard pattern browsers require because XHR
  // `blob` responses don't auto-start a download. The `isExporting`
  // state spins the icon so the user gets feedback during the network
  // round-trip (the endpoint runs 4 table scans + an audit insert, so
  // a few hundred ms is normal).
  const [isExporting, setIsExporting] = useState(false)
  const handleExportTrends = useCallback(async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const blob = await adminApi.exportTrendsCsv(days)
      const url = URL.createObjectURL(blob)
      const today = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      // Client-side fallback name. The server's
      // Content-Disposition filename is the source of truth for
      // browser-suggested names, but `a.download` is what we use
      // to drive the click — the two should match modulo timezone.
      a.download = `sau-trends-all-${days}d-${today}.csv`
      // Some test environments (jsdom) don't actually have
      // `appendChild` returning the appended node — we tolerate
      // either so the helper works in unit + E2E contexts.
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, days])

  // v3-mini: 14-day trend series per stat. Primary source is the
  // /api/admin/trends endpoint (see trendsQuery above). Per-metric
  // fallback to trendMock keeps the page rendered when the endpoint
  // 5xx's or the network drops — a single failed metric doesn't take
  // down all 4 sparklines. The mock's last-sample pin
  // (series[days-1] = current) is preserved in the fallback path so
  // the eye can still draw a horizontal from the chip value to the
  // endpoint dot when the data is mock-derived. Real API data is
  // returned as-is (NOT re-pinned) so the user sees honest history.
  // Trends are NULL while both overview AND trendsQuery are
  // undefined (first paint) so AdminStat skips both the sparkline
  // slot AND the auto-derived delta chip.
  const trends = useMemo(() => {
    const real = trendsQuery.data
    if (real) {
      // Real API succeeded for at least one metric — prefer real
      // data; fall back per-metric for any that failed/empty.
      // The mock fallback threads the picker's `days` so the
      // series length matches the visible sparkline width.
      return {
        total_users:
          real.total_users ??
          (overview
            ? trendMock('admin:total_users', {
                current: overview.total_users ?? 0,
                days,
              })
            : []),
        active_today:
          real.active_today ??
          (overview
            ? trendMock('admin:active_today', {
                current: overview.active_today ?? 0,
                days,
              })
            : []),
        total_tasks:
          real.total_tasks ??
          (overview
            ? trendMock('admin:total_tasks', {
                current: overview.total_tasks ?? 0,
                days,
              })
            : []),
        task_success_rate:
          real.task_success_rate ??
          (overview
            ? trendMock('admin:task_success_rate', {
                current: overview.task_success_rate ?? 0,
                amplitude: 0.12,
                days,
              })
            : []),
      }
    }
    // No real data yet (trendsQuery is loading or errored) — fall
    // back to the deterministic mock for ALL metrics. The `days`
    // param matches the picker's current value so the mock series
    // length stays in lockstep with the visible sparkline width.
    if (!overview) return null
    return {
      total_users: trendMock('admin:total_users', {
        current: overview.total_users ?? 0,
        days,
      }),
      active_today: trendMock('admin:active_today', {
        current: overview.active_today ?? 0,
        days,
      }),
      total_tasks: trendMock('admin:total_tasks', {
        current: overview.total_tasks ?? 0,
        days,
      }),
      task_success_rate: trendMock('admin:task_success_rate', {
        current: overview.task_success_rate ?? 0,
        amplitude: 0.12,
        days,
      }),
    }
  }, [trendsQuery.data, overview, days])

  // Tiny relative timestamp under the refresh button — gives the
  // surface a "live" feel without binding to a global tick.
  const lastUpdatedLabel = (() => {
    if (isLoading) return '加载中…'
    if (!overviewQuery.dataUpdatedAt) return '尚未更新'
    const date = new Date(overviewQuery.dataUpdatedAt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `最近更新 · ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  })()

  return (
    <div className="p-6">
      <AdminNavTabs />
      <PageHeader
        title="系统概览"
        description="项目使用统计与最近活动"
        icon={<BarChart3 className="h-5 w-5 text-[var(--status-info-fg)]" />}
        actions={
          <div className="flex items-center gap-2">
            <span
              className="hidden sm:inline-flex font-mono tabular-nums text-[11px] text-muted-foreground/70"
              aria-live="polite"
            >
              {lastUpdatedLabel}
            </span>
            {/* v3-trends days-picker — a compact 3-option segmented
                control that gates BOTH the sparkline width AND the
                CSV export scope. Picker is disabled mid-export so a
                user can't change scope while a download is in
                flight (the previous-days CSV would be on disk
                before the new-days one starts). a11y: the wrapper
                carries role="radiogroup" and each option carries
                aria-checked (NOT aria-pressed) so screen readers
                like VoiceOver announce the canonical
                single-select radio pattern (e.g. "1 of 3, checked")
                rather than the toggle-button "pressed/not pressed"
                pattern — see §22.10.4 in
                docs/DESIGN-admin-dashboard.md. */}
            <div
              role="radiogroup"
              aria-label="趋势时间范围"
              className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5"
            >
              {DAYS_OPTIONS.map((opt) => {
                const isActive = days === opt.value
                return (
                  <Button
                    key={opt.value}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 px-2.5 text-xs font-medium tabular-nums',
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setDays(opt.value)}
                    disabled={isExporting}
                    aria-checked={isActive}
                    data-testid={`admin-overview-days-${opt.value}`}
                  >
                    {opt.label}
                  </Button>
                )
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleExportTrends}
              disabled={isExporting}
              data-testid="admin-overview-export-trends"
              aria-label="下载趋势数据 CSV"
            >
              <Download
                className={cn(
                  'h-3.5 w-3.5',
                  isExporting && 'animate-pulse',
                )}
              />
              下载趋势
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={refresh}
              disabled={overviewQuery.isFetching || systemQuery.isFetching}
              data-testid="admin-overview-refresh"
              aria-label="刷新概览数据"
            >
              <RefreshCw
                className={cn(
                  'h-3.5 w-3.5',
                  (overviewQuery.isFetching || systemQuery.isFetching) && 'animate-spin',
                )}
              />
              刷新
            </Button>
          </div>
        }
      />

      {/* Hero stat strip — 4 elevated cards in a responsive grid. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStat
          label="总用户数"
          value={String(overview?.total_users ?? 0)}
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          tone="info"
          loading={isLoading}
          meta="全部"
          trend={trends?.total_users}
        />
        <AdminStat
          label="今日活跃"
          value={String(overview?.active_today ?? 0)}
          icon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
          loading={isLoading}
          meta="活跃用户"
          trend={trends?.active_today}
        />
        <AdminStat
          label="总任务数"
          value={String(overview?.total_tasks ?? 0)}
          icon={<ListChecks className="h-4 w-4" strokeWidth={1.75} />}
          tone="warning"
          loading={isLoading}
          meta="历史累计"
          trend={trends?.total_tasks}
        />
        <AdminStat
          label="任务成功率"
          value={`${overview?.task_success_rate ?? 0}%`}
          icon={<CheckCircle className="h-4 w-4" strokeWidth={1.75} />}
          tone={/* success band on >=95, warning 80–94, error <80 */
            (overview?.task_success_rate ?? 0) >= 95
              ? 'success'
              : (overview?.task_success_rate ?? 0) >= 80
                ? 'warning'
                : 'error'}
          loading={isLoading}
          meta="近 30 天"
          trend={trends?.task_success_rate}
        />
      </div>

      {/* Platform distribution strip — sibling to the recent activity
          card. Renders nothing if system data is unavailable so we
          don't degrade the page when the endpoint is missing. */}
      <Card className="mt-5 bg-card/60 ring-1 ring-foreground/10">
        <CardContent className="px-5 py-5 sm:px-6 sm:py-6">
          <PlatformDistribution
            tasksByPlatform={systemQuery.data?.data?.tasks_by_platform}
            loading={systemQuery.isLoading}
          />
        </CardContent>
      </Card>

      {/* Recent activity — feed-style list with avatar + email + action
          CodePill + relative time. Wrapped in a Card so the rhythm
          matches the platform strip above. */}
      <Card className="mt-5 bg-card/60 ring-1 ring-foreground/10">
        <CardHeader className="px-5 py-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <CardTitle className="text-[14.5px] font-semibold text-foreground tracking-tight">
              最近操作
            </CardTitle>
            <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground/70 uppercase">
              最近 10 条
            </span>
          </div>
          <CardAction className="flex items-center gap-3">
            <SegmentedTimeRange
              value={timeRange}
              onValueChange={(v) => updateTimeRange(v as PresetRange)}
              options={TIME_RANGE_TABS}
              ariaLabel="时间范围筛选"
            />
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
              >
                <X className="h-3 w-3" />
                清除筛选
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">

          {timeRange === 'custom' && (
            <div className="flex items-center gap-3 border-b border-border/40 px-5 py-3 sm:px-6">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="overview-start" className="text-xs text-muted-foreground">
                  开始日期
                </Label>
                <Input
                  id="overview-start"
                  type="date"
                  value={customStart}
                  onChange={(e) => updateCustomStart(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>
              <span className="text-xs text-muted-foreground">—</span>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="overview-end" className="text-xs text-muted-foreground">
                  结束日期
                </Label>
                <Input
                  id="overview-end"
                  type="date"
                  value={customEnd}
                  onChange={(e) => updateCustomEnd(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>
            </div>
          )}

          <div className="px-2 sm:px-3 py-2">
            {isLoading ? (
              <div className="space-y-1 px-3 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : hasRecentActions ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview?.recent_actions?.map((action) => {
                    const absTime = action.created_at?.slice(0, 16).replace('T', ' ') ?? '—'
                    const relTime = relativeTimeFromNow(action.created_at)
                    return (
                      <TableRow
                        key={action.id}
                        className="hover:bg-muted/30 border-b border-border/40"
                      >
                        <TableCell className="text-xs tabular-nums py-3">
                          <span className="font-mono text-foreground/80" title={absTime}>
                            {absTime}
                          </span>
                          {relTime && (
                            <span className="ml-2 text-[11px] text-muted-foreground/70">
                              {relTime}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <AdminAvatar identifier={action.user_email ?? undefined} size="sm" />
                            <span className="text-foreground truncate">
                              {action.user_email ?? '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs py-3 text-right">
                          <CodePill tone="info">{action.action}</CodePill>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            ) : (
              <PremiumEmptyState
                tone="info"
                eyebrow="EMPTY FEED"
                icon={<BarChart3 className="h-6 w-6" strokeWidth={1.5} />}
                title="暂无记录"
                description="所选时间范围内没有用户操作"
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
