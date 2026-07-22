import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/index'
import { useToast } from '@/components/ui/toast'
import {
  BarChart3,
  Download,
  TrendingUp,
  CheckCircle2,
  Users,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAnalyticsSummary, useAnalyticsAccounts, rangeToParams } from '@/hooks/useAnalytics'
import { VolumeTrendChart } from '@/features/analytics/VolumeTrendChart'
import { PlatformPieChart } from '@/features/analytics/PlatformPieChart'
import { FailureReasonChart } from '@/features/analytics/FailureReasonChart'
import { AccountActivityTable } from '@/features/analytics/AccountActivityTable'
import { SuccessRateTrendChart } from '@/features/analytics/SuccessRateTrendChart'
import { MetricsEffectPanel } from '@/features/analytics/MetricsEffectPanel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/api/client'

/**
 * §12 — Analytics Dashboard page.
 *
 * Wires together:
 *   - useAnalyticsSummary / useAnalyticsAccounts hooks (TanStack Query)
 *   - 4 StatsCards with real counts + trend indicators
 *   - VolumeTrendChart (recharts AreaChart, stacked success/failed)
 *   - PlatformPieChart (recharts PieChart donut)
 *   - FailureReasonChart (recharts horizontal BarChart, top 5)
 *   - AccountActivityTable (sortable table with success-rate highlighting)
 *   - CSV export button (downloads via api.analytics.exportCsv)
 *
 * Date range selector controls the query params for both hooks.
 */

type DateRange = '7d' | '30d' | '90d' | 'all'

const RANGE_LABELS: Record<DateRange, string> = {
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
  all: '全部',
}

/** Stats card — one of 4 summary tiles with gradient + trend indicator. */
const STATS_GRADIENTS: Record<string, string> = {
  total: 'from-blue-500/10 to-blue-500/5',
  success: 'from-emerald-500/10 to-emerald-500/5',
  accounts: 'from-violet-500/10 to-violet-500/5',
  today: 'from-amber-500/10 to-amber-500/5',
}

const STATS_ICON_BG: Record<string, string> = {
  total: 'bg-blue-500/15',
  success: 'bg-emerald-500/15',
  accounts: 'bg-violet-500/15',
  today: 'bg-amber-500/15',
}

const STATS_ICON_COLOR: Record<string, string> = {
  total: 'text-blue-500',
  success: 'text-emerald-500',
  accounts: 'text-violet-500',
  today: 'text-amber-500',
}

function StatsCard({
  label,
  value,
  icon: Icon,
  trend,
  trendDir,
  variant = 'total',
}: {
  label: string
  value: string | number
  icon: typeof TrendingUp
  trend?: string
  trendDir?: 'up' | 'down' | 'flat'
  variant?: 'total' | 'success' | 'accounts' | 'today'
}) {
  const TrendIcon = trendDir === 'up' ? ArrowUpRight : trendDir === 'down' ? ArrowDownRight : Minus
  const trendColor =
    trendDir === 'up' ? 'text-emerald-500' : trendDir === 'down' ? 'text-destructive' : 'text-muted-foreground'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className={cn(
        'relative overflow-hidden bg-gradient-to-br ring-1 ring-foreground/5 hover:ring-foreground/10 transition-all',
        STATS_GRADIENTS[variant],
      )}>
        <div className="flex items-center gap-3 px-4 py-4">
          <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl shrink-0', STATS_ICON_BG[variant])}>
            <Icon className={cn('h-5 w-5', STATS_ICON_COLOR[variant])} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold leading-none tabular-nums tracking-tight">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-1.5">{label}</p>
          </div>
          {trend && (
            <div className={cn('flex items-center gap-0.5 text-[11px] font-medium shrink-0', trendColor)}>
              <TrendIcon className="h-3 w-3" />
              {trend}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

export default function AnalyticsPage() {
  const { addToast } = useToast()
  const [range, setRange] = useState<DateRange>('7d')
  const [exporting, setExporting] = useState(false)

  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary(range)
  const { data: accounts, isLoading: accountsLoading } = useAnalyticsAccounts(range)

  // Derive trend direction: compare current period total vs previous period.
  const trendDir = useMemo(() => {
    if (!summary || summary.prev_total === 0) return 'flat' as const
    if (summary.total > summary.prev_total) return 'up' as const
    if (summary.total < summary.prev_total) return 'down' as const
    return 'flat' as const
  }, [summary])

  const trendPct = useMemo(() => {
    if (!summary || summary.prev_total === 0) return undefined
    const pct = ((summary.total - summary.prev_total) / summary.prev_total) * 100
    return `${Math.abs(pct).toFixed(0)}%`
  }, [summary])

  const successRate = useMemo(() => {
    if (!summary || summary.total === 0) return '—'
    return `${((summary.success / summary.total) * 100).toFixed(0)}%`
  }, [summary])

  const activeAccounts = useMemo(() => {
    if (!accounts) return '—'
    return accounts.filter((a) => a.total > 0).length
  }, [accounts])

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = rangeToParams(range)
      const blob = await api.analytics.exportCsv(params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      addToast('CSV 已导出', 'success')
    } catch {
      addToast('导出失败，请重试', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <PageWrapper>
      <PageHeader
        title="数据分析"
        description="发布趋势、平台表现、账号活跃度"
        icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void handleExport()}
            disabled={exporting || !summary}
          >
            <Download className="h-4 w-4" />
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
        }
      />

      {/* TODO §12.8: Add QuotaUpgradeBanner for free-tier users here —
          shown when tier === 'free' and range is clamped to 7 days. */}

      {/* ── Date range selector — distinct toolbar ───────── */}
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
        <Calendar className="h-4 w-4 text-muted-foreground/70" />
        <span className="text-xs font-medium text-muted-foreground/80 mr-1">时间范围</span>
        <div className="flex items-center gap-1">
          {(Object.keys(RANGE_LABELS) as DateRange[]).map((r) => (
            <Button
              key={r}
              variant={range === r ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setRange(r)}
              className={cn('text-xs h-7', range === r ? 'font-medium' : 'text-muted-foreground')}
            >
              {RANGE_LABELS[r]}
            </Button>
          ))}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="effect">效果</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
      {/* ── Stats cards (4) ─────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="总发布"
          value={summary?.total ?? '—'}
          icon={TrendingUp}
          trend={trendPct}
          trendDir={trendDir}
          variant="total"
        />
        <StatsCard
          label="成功率"
          value={successRate}
          icon={CheckCircle2}
          trend={summary ? `${summary.success}/${summary.total}` : undefined}
          trendDir="flat"
          variant="success"
        />
        <StatsCard
          label="活跃账号"
          value={activeAccounts}
          icon={Users}
          variant="accounts"
        />
        <StatsCard
          label="今日"
          value={summary?.today ?? '—'}
          icon={BarChart3}
          variant="today"
        />
      </div>

      {/* ── Success rate trend (full-width) ─────────────── */}
      <div className="mt-6">
        <SuccessRateTrendChart data={summary?.by_day ?? []} loading={summaryLoading} />
      </div>

      {/* ── Charts row: Volume trend + Platform pie ─────── */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VolumeTrendChart
          data={summary?.by_day ?? []}
          loading={summaryLoading}
        />
        <PlatformPieChart
          data={summary?.by_platform ?? {}}
          loading={summaryLoading}
        />
      </div>

      {/* ── Failure reasons + Account activity table ────── */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FailureReasonChart
          data={summary?.failure_reasons ?? []}
          loading={summaryLoading}
        />
        <AccountActivityTable
          data={accounts ?? []}
          loading={accountsLoading}
        />
        </div>
        </TabsContent>
        <TabsContent value="effect">
          <MetricsEffectPanel range={range} />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  )
}
