import { memo, useMemo } from 'react'
import { Cell, Label, Pie, PieChart } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { PieChart as PieIcon } from 'lucide-react'
import { PLATFORMS } from '@/api/client'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'

/**
 * Official shadcn Chart pattern — Pie / donut.
 * @see https://ui.shadcn.com/docs/components/chart
 */

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

interface PlatformPieChartProps {
  data: AnalyticsSummary['by_platform']
  loading: boolean
}

export const PlatformPieChart = memo(function PlatformPieChart({
  data,
  loading,
}: PlatformPieChartProps) {
  const platformLabel = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])),
    [],
  )

  const { chartData, chartConfig, total } = useMemo(() => {
    const rows = Object.entries(data)
      .map(([platform, stats]) => ({
        platform,
        label: platformLabel[platform] ?? platform,
        value: (stats.success ?? 0) + (stats.failed ?? 0),
        success: stats.success ?? 0,
        failed: stats.failed ?? 0,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)

    const config: ChartConfig = {
      value: { label: '任务数' },
    }
    rows.forEach((row, i) => {
      config[row.platform] = {
        label: row.label,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }
    })

    const withFill = rows.map((row) => ({
      ...row,
      fill: `var(--color-${row.platform})`,
    }))

    return {
      chartData: withFill,
      chartConfig: config,
      total: rows.reduce((s, r) => s + r.value, 0),
    }
  }, [data, platformLabel])

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>平台分布</CardTitle>
        <CardDescription>
          {loading
            ? '加载中…'
            : chartData.length > 0
              ? `${chartData.length} 个平台 · 共 ${total} 次`
              : '暂无数据'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        {loading ? (
          <Skeleton className="mx-auto h-[250px] w-full max-w-[250px] rounded-full" />
        ) : chartData.length === 0 ? (
          <Empty className="h-[250px] border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PieIcon />
              </EmptyMedia>
              <EmptyTitle>暂无平台数据</EmptyTitle>
              <EmptyDescription>在选定时间范围内没有任务记录</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="mx-auto aspect-square max-h-[250px]"
          >
            <PieChart>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    nameKey="platform"
                    hideLabel
                    formatter={(value, _name, item) => {
                      const p = item?.payload as {
                        success?: number
                        failed?: number
                        label?: string
                      }
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{p?.label}</span>
                          <span className="text-muted-foreground">
                            {value} 次（成功 {p?.success ?? 0} / 失败 {p?.failed ?? 0}）
                          </span>
                        </div>
                      )
                    }}
                  />
                }
              />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="platform"
                innerRadius={60}
                strokeWidth={2}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.platform} fill={entry.fill} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground text-3xl font-bold"
                          >
                            {total.toLocaleString()}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 24}
                            className="fill-muted-foreground text-xs"
                          >
                            总任务
                          </tspan>
                        </text>
                      )
                    }
                    return null
                  }}
                />
              </Pie>
              <ChartLegend
                content={<ChartLegendContent nameKey="platform" />}
                className="-translate-y-2 flex-wrap gap-2 *:basis-1/4 *:justify-center"
              />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
      {chartData[0] && !loading ? (
        <CardFooter className="flex-col gap-1 text-sm">
          <div className="flex items-center gap-2 font-medium leading-none">
            领先平台 {chartData[0].label}
          </div>
          <div className="text-muted-foreground leading-none">
            {chartData[0].value} 次 ·{' '}
            {total > 0
              ? `${((chartData[0].value / total) * 100).toFixed(1)}%`
              : '0%'}
          </div>
        </CardFooter>
      ) : null}
    </Card>
  )
})
