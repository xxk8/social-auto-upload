import { memo, useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  type ChartConfig,
} from '@/components/ui/index'
import { XCircle } from 'lucide-react'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'

/**
 * Official shadcn Chart pattern — horizontal BarChart.
 * @see https://ui.shadcn.com/docs/components/chart
 */

const chartConfig = {
  count: {
    label: '失败次数',
    color: 'var(--chart-4)',
  },
  reason: {
    label: '原因',
  },
} satisfies ChartConfig

interface FailureReasonChartProps {
  data: AnalyticsSummary['failure_reasons']
  loading: boolean
}

function truncate(reason: string): string {
  return reason.length > 18 ? `${reason.slice(0, 16)}…` : reason
}

export const FailureReasonChart = memo(function FailureReasonChart({
  data,
  loading,
}: FailureReasonChartProps) {
  const chartData = useMemo(
    () =>
      data
        .slice(0, 5)
        .map((d) => ({
          reason: truncate(d.reason),
          fullReason: d.reason,
          count: d.count,
        }))
        .reverse(),
    [data],
  )

  const totalShown = useMemo(
    () => chartData.reduce((s, d) => s + d.count, 0),
    [chartData],
  )

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>失败原因 Top 5</CardTitle>
        <CardDescription>
          {loading
            ? '加载中…'
            : chartData.length > 0
              ? `展示合计 ${totalShown} 次失败`
              : '无失败记录'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[220px] w-full rounded-lg" />
        ) : chartData.length === 0 ? (
          <Empty className="h-[220px] border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <XCircle />
              </EmptyMedia>
              <EmptyTitle>无失败记录</EmptyTitle>
              <EmptyDescription>在选定时间范围内没有失败任务</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto w-full"
            style={{ height: Math.max(200, chartData.length * 44) }}
          >
            <BarChart
              accessibilityLayer
              data={chartData}
              layout="vertical"
              margin={{ left: 0, right: 12 }}
            >
              <CartesianGrid horizontal={false} />
              <YAxis
                dataKey="reason"
                type="category"
                tickLine={false}
                axisLine={false}
                width={110}
                tickMargin={8}
              />
              <XAxis type="number" hide />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(_label, payload) => {
                      const item = payload?.[0]?.payload as
                        | { fullReason?: string }
                        | undefined
                      return item?.fullReason ?? ''
                    }}
                  />
                }
              />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
})
