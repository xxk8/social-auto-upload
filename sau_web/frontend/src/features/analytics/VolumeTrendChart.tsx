import { memo, useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
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
import { BarChart3 } from 'lucide-react'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'
import { formatDay } from './format'

/**
 * Official shadcn Chart pattern:
 * Card + ChartContainer + AreaChart + ChartTooltip + ChartLegend
 * @see https://ui.shadcn.com/docs/components/chart
 */

const chartConfig = {
  success: {
    label: '成功',
    color: 'var(--chart-2)',
  },
  failed: {
    label: '失败',
    color: 'var(--chart-4)',
  },
} satisfies ChartConfig

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
      })),
    [data],
  )

  const totals = useMemo(() => {
    const success = chartData.reduce((s, d) => s + d.success, 0)
    const failed = chartData.reduce((s, d) => s + d.failed, 0)
    return { success, failed, total: success + failed }
  }, [chartData])

  return (
    <Card>
      <CardHeader>
        <CardTitle>发布趋势</CardTitle>
        <CardDescription>
          {loading
            ? '加载中…'
            : chartData.length > 0
              ? `区间合计 ${totals.total} · 成功 ${totals.success} · 失败 ${totals.failed}`
              : '暂无数据'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : chartData.length === 0 ? (
          <Empty className="h-[280px] border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 />
              </EmptyMedia>
              <EmptyTitle>暂无发布数据</EmptyTitle>
              <EmptyDescription>在选定时间范围内没有任务记录</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart
              accessibilityLayer
              data={chartData}
              margin={{ left: 12, right: 12, top: 12 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={28}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <ChartLegend content={<ChartLegendContent />} />
              <defs>
                <linearGradient id="fillSuccess" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-failed)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-failed)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <Area
                dataKey="success"
                type="natural"
                fill="url(#fillSuccess)"
                stroke="var(--color-success)"
                stackId="a"
              />
              <Area
                dataKey="failed"
                type="natural"
                fill="url(#fillFailed)"
                stroke="var(--color-failed)"
                stackId="a"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
})
