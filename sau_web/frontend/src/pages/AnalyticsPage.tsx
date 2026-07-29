import { useMemo, useState } from 'react'
import { SectionIcon } from '@/components/ui/section-header'
import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/index'
import { useToast } from '@/components/ui/toast'
import {
  BarChart3,
  Download,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Users,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Percent,
  Sparkles,
  Table2,
  Target,
} from 'lucide-react'
import { pctToTone, type Tone } from '@/lib/tone'
import {
  useAnalyticsSummary,
  useAnalyticsAccounts,
  rangeToParams,
} from '@/hooks/useAnalytics'
import { VolumeTrendChart } from '@/features/analytics/VolumeTrendChart'
import { PlatformPieChart } from '@/features/analytics/PlatformPieChart'
import { FailureReasonChart } from '@/features/analytics/FailureReasonChart'
import { AccountActivityTable } from '@/features/analytics/AccountActivityTable'
import { SuccessRateTrendChart } from '@/features/analytics/SuccessRateTrendChart'
import { MetricsEffectPanel } from '@/features/analytics/MetricsEffectPanel'
import { PlatformBreakdownTable } from '@/features/analytics/PlatformBreakdownTable'
import { DailyBreakdownTable } from '@/features/analytics/DailyBreakdownTable'
import { FailureReasonList } from '@/features/analytics/FailureReasonList'
import { api } from '@/api/client'

/**
 * Analytics page — composed from official shadcn/ui components only:
 * Card, Badge, Button, Tabs, ToggleGroup, Table, Chart, Empty, Progress,
 * Separator, Skeleton, Tooltip, Alert.
 *
 * @see https://ui.shadcn.com/docs/components/card
 * @see https://ui.shadcn.com/docs/components/chart
 * @see https://ui.shadcn.com/docs/components/table
 * @see https://ui.shadcn.com/docs/components/toggle-group
 */

type DateRange = '7d' | '30d' | '90d' | 'all'

const RANGE_TABS: { value: DateRange; label: string }[] = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
  { value: 'all', label: '全部' },
]

function StatsCard({
  label,
  value,
  icon: Icon,
  trend,
  trendDir,
  meta,
  loading,
}: {
  label: string
  value: string | number
  icon: typeof TrendingUp
  trend?: string
  trendDir?: 'up' | 'down' | 'flat'
  meta?: string
  tone?: Tone
  loading?: boolean
}) {
  const TrendIcon =
    trendDir === 'up' ? ArrowUpRight : trendDir === 'down' ? ArrowDownRight : Minus
  const trendVariant =
    trendDir === 'up' ? 'success' : trendDir === 'down' ? 'error' : 'secondary'

  return (
    <Card size="sm" className="card-refined">
      <CardHeader className="flex flex-row items-start justify-between">
        <SectionIcon size="lg"><Icon className="size-[18px]" /></SectionIcon>
        {trend ? (
          <Badge
            variant={trendVariant as 'success' | 'error' | 'secondary'}
            className="gap-0.5 font-normal tabular-nums"
          >
            <TrendIcon className="size-3" />
            {trend}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <CardTitle className="text-2xl font-bold tabular-nums tracking-tight">
            {value}
          </CardTitle>
        )}
        <CardDescription className="mt-1 flex items-center gap-1.5 text-xs">
          <span>{label}</span>
          {meta ? (
            <>
              <Separator orientation="vertical" className="h-3" />
              <span className="tabular-nums">{meta}</span>
            </>
          ) : null}
        </CardDescription>
      </CardContent>
    </Card>
  )
}

export default function AnalyticsPage() {
  const { addToast } = useToast()
  const [range, setRange] = useState<DateRange>('7d')
  const [exporting, setExporting] = useState(false)

  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary(range)
  const { data: accounts, isLoading: accountsLoading } = useAnalyticsAccounts(range)

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
    if (!summary) return null
    const terminal = summary.success + summary.failed
    if (terminal === 0) return null
    return (summary.success / terminal) * 100
  }, [summary])

  const failRate = useMemo(() => {
    if (!summary) return null
    const terminal = summary.success + summary.failed
    if (terminal === 0) return null
    return (summary.failed / terminal) * 100
  }, [summary])

  const activeAccounts = useMemo(() => {
    if (!accounts) return null
    return accounts.filter((a) => a.total > 0).length
  }, [accounts])

  const pendingCount = useMemo(() => {
    if (!summary) return 0
    return Math.max(0, summary.total - summary.success - summary.failed)
  }, [summary])

  const platformCount = useMemo(() => {
    if (!summary?.by_platform) return 0
    return Object.values(summary.by_platform).filter(
      (s) => (s.success ?? 0) + (s.failed ?? 0) > 0,
    ).length
  }, [summary])

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
    <TooltipProvider>
      <PageWrapper>
        <PageHeader
          title="数据分析"
          description="发布趋势、平台表现、账号活跃度与失败归因"
          icon={<BarChart3 className="size-5 text-muted-foreground" />}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void handleExport()}
                  disabled={exporting || !summary}
                >
                  <Download className="size-4" />
                  {exporting ? '导出中…' : '导出 CSV'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>下载当前时间范围的任务明细</TooltipContent>
            </Tooltip>
          }
        />

        {/* Toolbar: Card + ToggleGroup + Badge */}
        <Card size="sm" className="card-refined">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="size-4" />
                <span className="text-xs font-medium">时间范围</span>
              </div>
              <ToggleGroup
                value={[range]}
                onValueChange={(values) => {
                  const next = values[values.length - 1] as DateRange | undefined
                  if (next) setRange(next)
                }}
                variant="outline"
                size="sm"
                spacing={0}
              >
                {RANGE_TABS.map((t) => (
                  <ToggleGroupItem key={t.value} value={t.value}>
                    {t.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {summary && !summaryLoading ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="font-normal tabular-nums">
                  总 {summary.total}
                </Badge>
                <Badge variant="success" className="font-normal tabular-nums">
                  成功 {summary.success}
                </Badge>
                <Badge variant="error" className="font-normal tabular-nums">
                  失败 {summary.failed}
                </Badge>
                {pendingCount > 0 ? (
                  <Badge variant="warning" className="font-normal tabular-nums">
                    进行中 {pendingCount}
                  </Badge>
                ) : null}
                {platformCount > 0 ? (
                  <Badge variant="info" className="font-normal tabular-nums">
                    {platformCount} 平台
                  </Badge>
                ) : null}
              </div>
            ) : summaryLoading ? (
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5">
              <Sparkles className="size-3.5" />
              概览
            </TabsTrigger>
            <TabsTrigger value="tables" className="gap-1.5">
              <Table2 className="size-3.5" />
              数据表
            </TabsTrigger>
            <TabsTrigger value="effect" className="gap-1.5">
              <Target className="size-3.5" />
              效果
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
              <StatsCard
                label="总发布"
                value={summary?.total ?? '—'}
                icon={TrendingUp}
                trend={trendPct}
                trendDir={trendDir}
                meta={
                  summary?.prev_total != null
                    ? `上期 ${summary.prev_total}`
                    : undefined
                }
                loading={summaryLoading}
              />
              <StatsCard
                label="成功"
                value={summary?.success ?? '—'}
                icon={CheckCircle2}
                meta={
                  successRate != null ? `${successRate.toFixed(0)}%` : undefined
                }
                loading={summaryLoading}
              />
              <StatsCard
                label="失败"
                value={summary?.failed ?? '—'}
                icon={XCircle}
                meta={failRate != null ? `${failRate.toFixed(0)}%` : undefined}
                loading={summaryLoading}
              />
              <StatsCard
                label="成功率"
                value={
                  successRate != null ? `${successRate.toFixed(1)}%` : '—'
                }
                icon={Percent}
                meta={
                  summary
                    ? `${summary.success}/${summary.success + summary.failed}`
                    : undefined
                }
                tone={successRate != null ? pctToTone(successRate) : 'neutral'}
                loading={summaryLoading}
              />
              <StatsCard
                label="活跃账号"
                value={activeAccounts ?? '—'}
                icon={Users}
                meta={accounts ? `共 ${accounts.length}` : undefined}
                loading={accountsLoading}
              />
              <StatsCard
                label="今日"
                value={summary?.today ?? '—'}
                icon={Calendar}
                meta={pendingCount > 0 ? `进行中 ${pendingCount}` : undefined}
                loading={summaryLoading}
              />
            </div>

            <SuccessRateTrendChart
              data={summary?.by_day ?? []}
              loading={summaryLoading}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <VolumeTrendChart
                data={summary?.by_day ?? []}
                loading={summaryLoading}
              />
              <PlatformPieChart
                data={summary?.by_platform ?? {}}
                loading={summaryLoading}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
              <div className="xl:col-span-2">
                <FailureReasonChart
                  data={summary?.failure_reasons ?? []}
                  loading={summaryLoading}
                />
              </div>
              <div className="xl:col-span-3">
                <AccountActivityTable
                  data={accounts ?? []}
                  loading={accountsLoading}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="tables" className="mt-4 space-y-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <PlatformBreakdownTable
                data={summary?.by_platform ?? {}}
                loading={summaryLoading}
              />
              <FailureReasonList
                data={summary?.failure_reasons ?? []}
                loading={summaryLoading}
                limit={15}
              />
            </div>
            <DailyBreakdownTable
              data={summary?.by_day ?? []}
              loading={summaryLoading}
            />
            <AccountActivityTable
              data={accounts ?? []}
              loading={accountsLoading}
            />
          </TabsContent>

          <TabsContent value="effect" className="mt-4">
            <MetricsEffectPanel
              range={range}
              summary={summary}
              accounts={accounts}
              loading={summaryLoading || accountsLoading}
            />
          </TabsContent>
        </Tabs>
      </PageWrapper>
    </TooltipProvider>
  )
}
