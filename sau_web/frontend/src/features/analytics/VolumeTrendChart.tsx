import { memo, useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/Components/ui/index'
import { EmptyState } from '@/Components/ui/empty-state'
import { BarChart3 } from 'lucide-react'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'
import { formatDay } from './format'
import { CHART_TOOLTIP_STYLE, CHART_TICK_STYLE, CHART_AXIS_LINE } from '@/lib/recharts-theme'

/**
 * §12.3 — VolumeTrendChart: stacked area chart showing daily publish
 * volume with success (green) and failed (red) series. Hover tooltips
 * show per-day breakdown.
 */

interface VolumeTrendChartProps {
  data: AnalyticsSummary['by_day']
  loading: boolean
}

export const VolumeTrendChart = memo(function VolumeTrendChart({
  data,
  loading,
}: VolumeTrendChartProps) {
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        date: formatDay(d.date),
        success: d.success,
        failed: d.failed,
        total: d.success + d.failed,
      })),
    [data],
  )

  const hasData = chartData.length > 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" />
          发布趋势
        </CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : !hasData ? (
          <EmptyState
            className="h-[280px]"
            title="暂无发布数据"
            description="在选定时间范围内没有任务记录"
          />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-success" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--status-success-fg)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--status-success-fg)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="grad-failed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--status-error-fg)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--status-error-fg)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                opacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={CHART_AXIS_LINE}
              />
              <YAxis
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={28}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              />
              <Area
                type="monotone"
                dataKey="success"
                name="成功"
                stackId="1"
                stroke="var(--status-success-fg)"
                strokeWidth={2}
                fill="url(#grad-success)"
              />
              <Area
                type="monotone"
                dataKey="failed"
                name="失败"
                stackId="1"
                stroke="var(--status-error-fg)"
                strokeWidth={2}
                fill="url(#grad-failed)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
})
