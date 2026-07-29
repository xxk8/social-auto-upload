import { useMemo } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Separator,
  Skeleton,
} from '@/components/ui/index'
import {
  CheckCircle2,
  XCircle,
  Target,
  Flame,
  Clock,
  BarChart3,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneTextClass, pctToTone } from '@/lib/tone'
import type { AnalyticsSummary, AccountActivity } from '@/hooks/useAnalytics'
import { PlatformBreakdownTable } from './PlatformBreakdownTable'
import { DailyBreakdownTable } from './DailyBreakdownTable'
import { AccountActivityTable } from './AccountActivityTable'
import { FailureReasonList } from './FailureReasonList'

/** Composed only from shadcn Card / Badge / Progress / Alert / Separator */

export type MetricsEffectRange = '7d' | '30d' | '90d' | 'all'

interface MetricsEffectPanelProps {
  range: MetricsEffectRange
  summary?: AnalyticsSummary | null
  accounts?: AccountActivity[] | null
  loading?: boolean
}

const RANGE_LABELS: Record<MetricsEffectRange, string> = {
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
  all: '全部',
}

function EffectMetricCard({
  icon: Icon,
  label,
  value,
  sub,
  valueClassName,
}: {
  icon: typeof Target
  label: string
  value: string
  sub?: string
  valueClassName?: string
}) {
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <CardDescription className="text-xs uppercase tracking-wide">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className={cn('text-2xl font-bold tabular-nums tracking-tight', valueClassName)}>
          {value}
        </p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

export function MetricsEffectPanel({
  range,
  summary,
  accounts,
  loading = false,
}: MetricsEffectPanelProps) {
  const metrics = useMemo(() => {
    if (!summary) {
      return {
        successRate: null as number | null,
        failRate: null as number | null,
        avgPerDay: null as number | null,
        peakDay: null as { date: string; total: number } | null,
        bestPlatform: null as { name: string; rate: number; total: number } | null,
        worstPlatform: null as { name: string; rate: number; total: number } | null,
        terminal: 0,
        pending: 0,
      }
    }

    const terminal = summary.success + summary.failed
    const pending = Math.max(0, summary.total - terminal)
    const successRate = terminal > 0 ? (summary.success / terminal) * 100 : null
    const failRate = terminal > 0 ? (summary.failed / terminal) * 100 : null
    const days = summary.by_day?.length ?? 0
    const avgPerDay = days > 0 ? summary.total / days : null

    let peakDay: { date: string; total: number } | null = null
    for (const d of summary.by_day ?? []) {
      const t = (d.success ?? 0) + (d.failed ?? 0)
      if (!peakDay || t > peakDay.total) peakDay = { date: d.date, total: t }
    }

    const platforms = Object.entries(summary.by_platform ?? {})
      .map(([name, s]) => {
        const total = (s.success ?? 0) + (s.failed ?? 0)
        const rate = total > 0 ? ((s.success ?? 0) / total) * 100 : 0
        return { name, rate, total }
      })
      .filter((p) => p.total >= 1)
      .sort((a, b) => b.rate - a.rate || b.total - a.total)

    return {
      successRate,
      failRate,
      avgPerDay,
      peakDay,
      bestPlatform: platforms[0] ?? null,
      worstPlatform:
        platforms.length > 1 ? platforms[platforms.length - 1] : platforms[0] ?? null,
      terminal,
      pending,
    }
  }, [summary])

  const topAccount = useMemo(() => {
    if (!accounts?.length) return null
    return [...accounts].sort((a, b) => b.total - a.total)[0] ?? null
  }, [accounts])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>发布效果总览</CardTitle>
          <CardDescription>
            统计区间：{RANGE_LABELS[range]}
            {summary ? ` · 总任务 ${summary.total}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <EffectMetricCard
                  icon={CheckCircle2}
                  label="终态成功率"
                  value={
                    metrics.successRate != null
                      ? `${metrics.successRate.toFixed(1)}%`
                      : '—'
                  }
                  sub={
                    metrics.terminal > 0
                      ? `${summary?.success ?? 0} / ${metrics.terminal} 终态`
                      : '尚无终态任务'
                  }
                  valueClassName={
                    metrics.successRate != null
                      ? toneTextClass(pctToTone(metrics.successRate))
                      : undefined
                  }
                />
                <EffectMetricCard
                  icon={XCircle}
                  label="失败率"
                  value={
                    metrics.failRate != null
                      ? `${metrics.failRate.toFixed(1)}%`
                      : '—'
                  }
                  sub={`${summary?.failed ?? 0} 次失败`}
                  valueClassName="text-destructive"
                />
                <EffectMetricCard
                  icon={BarChart3}
                  label="日均发布"
                  value={
                    metrics.avgPerDay != null
                      ? metrics.avgPerDay.toFixed(1)
                      : '—'
                  }
                  sub={
                    metrics.peakDay
                      ? `峰值 ${metrics.peakDay.total}（${metrics.peakDay.date.slice(5)}）`
                      : undefined
                  }
                />
                <EffectMetricCard
                  icon={Flame}
                  label="最活跃账号"
                  value={topAccount?.account?.slice(0, 14) || '—'}
                  sub={
                    topAccount
                      ? `${topAccount.total} 次 · ${topAccount.platform}`
                      : '暂无账号'
                  }
                />
              </div>

              {summary && summary.total > 0 ? (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <TrendingUp className="size-4 text-muted-foreground" />
                        任务状态构成
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        成功 {summary.success} · 失败 {summary.failed}
                        {metrics.pending > 0 ? ` · 进行中 ${metrics.pending}` : ''}
                      </p>
                    </div>
                    <Progress
                      value={summary.success}
                      max={summary.total}
                      className="h-3"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="success" className="font-normal">
                        成功 {((summary.success / summary.total) * 100).toFixed(1)}%
                      </Badge>
                      <Badge variant="error" className="font-normal">
                        失败 {((summary.failed / summary.total) * 100).toFixed(1)}%
                      </Badge>
                      {metrics.pending > 0 ? (
                        <Badge variant="warning" className="font-normal">
                          进行中{' '}
                          {((metrics.pending / summary.total) * 100).toFixed(1)}%
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              {(metrics.bestPlatform || metrics.worstPlatform) && (
                <>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {metrics.bestPlatform ? (
                      <Card size="sm">
                        <CardHeader>
                          <Badge variant="success" className="w-fit font-normal">
                            最佳平台
                          </Badge>
                          <CardTitle>{metrics.bestPlatform.name}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Progress
                              value={metrics.bestPlatform.rate}
                              className="h-2 flex-1"
                            />
                            <span className="text-sm font-semibold tabular-nums">
                              {metrics.bestPlatform.rate.toFixed(1)}%
                            </span>
                          </div>
                          <CardDescription>
                            {metrics.bestPlatform.total} 次任务
                          </CardDescription>
                        </CardContent>
                      </Card>
                    ) : null}
                    {metrics.worstPlatform &&
                    metrics.worstPlatform.name !== metrics.bestPlatform?.name ? (
                      <Card size="sm">
                        <CardHeader>
                          <Badge variant="error" className="w-fit font-normal">
                            待提升平台
                          </Badge>
                          <CardTitle>{metrics.worstPlatform.name}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Progress
                              value={metrics.worstPlatform.rate}
                              className="h-2 flex-1"
                            />
                            <span className="text-sm font-semibold tabular-nums">
                              {metrics.worstPlatform.rate.toFixed(1)}%
                            </span>
                          </div>
                          <CardDescription>
                            {metrics.worstPlatform.total} 次任务
                          </CardDescription>
                        </CardContent>
                      </Card>
                    ) : null}
                  </div>
                </>
              )}

              {metrics.pending > 0 ? (
                <Alert variant="warning">
                  <Clock className="size-4" />
                  <AlertTitle>进行中任务</AlertTitle>
                  <AlertDescription>
                    尚有 {metrics.pending} 个任务处于进行中 / 排队，未计入终态成功率。
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PlatformBreakdownTable
          data={summary?.by_platform ?? {}}
          loading={loading}
        />
        <FailureReasonList
          data={summary?.failure_reasons ?? []}
          loading={loading}
          limit={12}
        />
      </div>

      <DailyBreakdownTable data={summary?.by_day ?? []} loading={loading} />
      <AccountActivityTable data={accounts ?? []} loading={loading} />
    </div>
  )
}
