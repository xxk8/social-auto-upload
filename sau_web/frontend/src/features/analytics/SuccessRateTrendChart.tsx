import { memo, useMemo } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
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
import { TrendingUp } from 'lucide-react'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'
import { computeSuccessRates } from './format'

/**
 * Official shadcn Chart pattern — Line chart.
 * @see https://ui.shadcn.com/docs/components/chart
 */

const chartConfig = {
  rate: {
    label: '成功率',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig

interface SuccessRateTrendChartProps {
  data: AnalyticsSummary['by_day']
  loading: boolean
}

export const SuccessRateTrendChart = memo(function SuccessRateTrendChart({
  data,
  loading,
}: SuccessRateTrendChartProps) {
  const chartData = useMemo(() => computeSuccessRates(data), [data])
  const avgRate = useMemo(() => {
    const valid = chartData.filter((d) => d.rate != null) as Array<{ rate: number }>
    if (valid.length === 0) return null
    return valid.reduce((s, d) => s + d.rate, 0) / valid.length
  }, [chartData])

  return (
    <Card>
      <CardHeader>
        <CardTitle>成功率趋势</CardTitle>
        <CardDescription>
          {loading
            ? '加载中…'
            : avgRate != null
              ? `区间日均成功率 ${avgRate.toFixed(1)}%`
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
                <TrendingUp />
              </EmptyMedia>
              <EmptyTitle>暂无发布数据</EmptyTitle>
              <EmptyDescription>在选定时间范围内没有任务记录</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <LineChart
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
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={36}
                tickFormatter={(v: number) => `${v}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="line"
                    formatter={(value) =>
                      value == null ? '无任务' : `${value}%`
                    }
                  />
                }
              />
              <Line
                dataKey="rate"
                type="monotone"
                stroke="var(--color-rate)"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
})
