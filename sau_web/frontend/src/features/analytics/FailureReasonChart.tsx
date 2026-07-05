import { memo, useMemo } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/Components/ui/index'
import { EmptyState } from '@/Components/ui/empty-state'
import { XCircle } from 'lucide-react'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'

/**
 * §12.5 — FailureReasonChart: horizontal bar chart showing the top 5
 * failure reasons by count. Each bar is colored with the destructive
 * token. Truncates long reason text on the Y axis.
 */

interface FailureReasonChartProps {
  data: AnalyticsSummary['failure_reasons']
  loading: boolean
}

const tooltipStyle = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--popover-foreground)',
} as const

/** Truncate reason text to 20 chars for the Y-axis label. */
function truncate(reason: string): string {
  return reason.length > 20 ? `${reason.slice(0, 18)}…` : reason
}

export const FailureReasonChart = memo(function FailureReasonChart({
  data,
  loading,
}: FailureReasonChartProps) {
  const chartData = useMemo(
    () =>
      data
        .slice(0, 5)
        .map((d) => ({ reason: truncate(d.reason), fullReason: d.reason, count: d.count }))
        .reverse(), // reverse so the largest bar is at the top
    [data],
  )

  const hasData = chartData.length > 0
  const maxCount = useMemo(() => Math.max(...chartData.map((d) => d.count), 0), [chartData])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <XCircle className="h-4 w-4 text-destructive" />
          失败原因 Top 5
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[200px] w-full rounded-lg" />
        ) : !hasData ? (
          <EmptyState
            className="h-[200px]"
            title="无失败记录"
            description="在选定时间范围内没有失败任务"
          />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 42)}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                domain={[0, maxCount]}
              />
              <YAxis
                type="category"
                dataKey="reason"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                width={120}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, _name, entry) => [
                  `${value} 次`,
                  (entry?.payload as { fullReason?: string })?.fullReason ?? '失败',
                ]}
              />
              <Bar dataKey="count" name="失败次数" radius={[0, 4, 4, 0]}>
                {chartData.map((_, index) => (
                  <Cell
                    key={index}
                    fill="var(--status-error-fg)"
                    fillOpacity={0.7 + (index / chartData.length) * 0.3}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
})
