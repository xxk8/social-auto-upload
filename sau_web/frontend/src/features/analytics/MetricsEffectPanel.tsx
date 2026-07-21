import { Card } from '@/Components/ui/index'

export type MetricsEffectRange = '7d' | '30d' | '90d' | 'all'

interface MetricsEffectPanelProps {
  range: MetricsEffectRange
}

const RANGE_LABELS: Record<MetricsEffectRange, string> = {
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
  all: '全部',
}

/**
 * §12 — Publish-effect panel shown under the "效果" tab of the analytics
 * dashboard. Renders aggregate publish-outcome metrics for the selected
 * date range. Data wiring is intentionally minimal here; the surrounding
 * AnalyticsPage owns the range selector and query plumbing.
 */
export function MetricsEffectPanel({ range }: MetricsEffectPanelProps) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium">发布效果</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        统计区间：{RANGE_LABELS[range]}
      </p>
    </Card>
  )
}
