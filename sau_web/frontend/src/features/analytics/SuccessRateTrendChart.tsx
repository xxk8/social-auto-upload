import { memo, useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/Components/ui/index'
import { EmptyState } from '@/Components/ui/empty-state'
import { TrendingUp } from 'lucide-react'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'
import { computeSuccessRates } from './format'
import { CHART_TOOLTIP_STYLE, CHART_TICK_STYLE, CHART_AXIS_LINE } from '@/lib/recharts-theme'

/**
 * §12.6 — SuccessRateTrendChart: line chart showing the daily publish
 * success rate (success / (success + failed)) as a percentage. Days with
 * no tasks render as `null` and are skipped (`connectNulls={false}`) so
 * the line never falsely drops to 0.
 */

interface SuccessRateTrendChartProps {
  data: AnalyticsSummary['by_day']
  loading: boolean
}

interface SuccessRateTooltipProps {
  active?: boolean
  label?: string | number
  payload?: Array<{ value: number | null }>
}

function SuccessRateTooltip({ active, label, payload }: SuccessRateTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const rate = payload[0]?.value
  return (
    <div style={CHART_TOOLTIP_STYLE} className="px-3 py-2">
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>
      <p>{rate === null || rate === undefined ? '无任务' : `成功率 ${rate}%`}</p>
    </div>
  )
}

export const SuccessRateTrendChart = memo(function SuccessRateTrendChart({
  data,
  loading,
}: SuccessRateTrendChartProps) {
  const chartData = useMemo(() => computeSuccessRates(data), [data])
  const hasData = chartData.length > 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          成功率趋势
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
            <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
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
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                allowDecimals={false}
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip content={<SuccessRateTooltip />} />
              <Line
                type="monotone"
                dataKey="rate"
                name="成功率"
                stroke="var(--status-success-fg)"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
})
