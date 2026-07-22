import { memo, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/index'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { PieChart as PieIcon } from 'lucide-react'
import { PLATFORMS } from '@/api/client'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'
import { CHART_TOOLTIP_STYLE, CHART_SLICE_GAP, PLATFORM_COLORS } from '@/lib/recharts-theme'

/**
 * §12.4 — PlatformPieChart: donut chart showing per-platform publish
 * volume distribution. Each slice uses the platform's brand color.
 * Clicking a slice highlights it (local state only; the parent could
 * extend this to filter the table if desired).
 */

interface PlatformPieChartProps {
  data: AnalyticsSummary['by_platform']
  loading: boolean
}

export const PlatformPieChart = memo(function PlatformPieChart({
  data,
  loading,
}: PlatformPieChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const platformLabel = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])),
    [],
  )

  const chartData = useMemo(() => {
    return Object.entries(data)
      .map(([platform, stats]) => ({
        name: platformLabel[platform] ?? platform,
        platform,
        value: stats.success + stats.failed,
        success: stats.success,
        failed: stats.failed,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [data, platformLabel])

  const hasData = chartData.length > 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <PieIcon className="h-4 w-4 text-primary" />
          平台分布
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : !hasData ? (
          <EmptyState
            className="h-[280px]"
            title="暂无平台数据"
            description="在选定时间范围内没有任务记录"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  onClick={(_, index) =>
                    setActiveIndex((prev) => (prev === index ? null : index))
                  }
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={entry.platform}
                      fill={PLATFORM_COLORS[entry.platform] ?? '#888888'}
                      stroke={CHART_SLICE_GAP}
                      strokeWidth={2}
                      opacity={activeIndex === null || activeIndex === index ? 1 : 0.4}
                      style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value, _name, entry) => {
                    const payload = entry?.payload as { success?: number; failed?: number; name?: string }
                    return [
                      `${value} 次 (成功 ${payload?.success ?? 0} / 失败 ${payload?.failed ?? 0})`,
                      payload?.name ?? '',
                    ]
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Legend chips */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {chartData.map((entry, index) => (
                <button
                  key={entry.platform}
                  type="button"
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
                  onClick={() =>
                    setActiveIndex((prev) => (prev === index ? null : index))
                  }
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: PLATFORM_COLORS[entry.platform] ?? '#888888',
                      opacity: activeIndex === null || activeIndex === index ? 1 : 0.4,
                    }}
                  />
                  <Badge
                    variant={activeIndex === index ? 'info' : 'secondary'}
                    className="text-[11px] font-normal"
                  >
                    {entry.name} {entry.value}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
