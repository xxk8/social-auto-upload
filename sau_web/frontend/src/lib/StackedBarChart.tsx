/**
 * StackedBarChart — reusable vertical stacked bar with hidden axes.
 *
 * Extracts the repeated recharts pattern shared by:
 *   • TaskProgressBar            — task status distribution (done/active/failed)
 *   • PlatformDistribution       — platform share (douyin/xhs/…)
 *   • CrawlPage SentimentBar     — sentiment distribution (positive/negative/…)
 *   • CrawlPage CommentsTab      — mini sentiment summary
 *
 * The shared pattern across all four consumers:
 *   - `layout="vertical"` BarChart with `barCategoryGap={0}`
 *   - Hidden `<XAxis type="number" hide />` + `<YAxis type="category" dataKey="name" hide />`
 *   - `<Tooltip cursor={false} contentStyle={CHART_TOOLTIP_STYLE} />`
 *   - One `<Bar stackId="a">` per segment, each with a `<Cell fill={color}>`
 *   - Animation via `isAnimationActive` + `animationDuration`
 *
 * Before this component, the same ~25 lines of JSX were copy-pasted across
 * 4 sites. Now each consumer passes `segments` + an optional `tooltipFormatter`
 * and the chart internals are centralised here.
 *
 * Module exports ONLY the component (no constants) so Fast Refresh stays
 * happy (`react-refresh/only-export-components`).
 */

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CHART_TOOLTIP_STYLE,
  CHART_ANIMATION_DURATION,
} from '@/lib/recharts-theme'

/** A single coloured segment in the stacked bar. */
export interface StackedBarSegment {
  /** Unique key — used as the recharts `dataKey` and for Tooltip lookup. */
  key: string
  /** Numeric value for this segment. */
  count: number
  /** Fill colour for the segment (hex, hsl, or CSS var string). */
  color: string
}

export interface StackedBarChartProps {
  /** Segments to render, left-to-right. Zero-count segments are filtered out. */
  segments: StackedBarSegment[]
  /** The `name` field on the single data row (e.g. 'tasks', 'sentiment'). */
  name?: string
  /**
   * Custom Tooltip formatter — receives the numeric value and the segment
   * key, returns a `[label, '']` tuple (the second element suppresses the
   * default recharts name column).
   *
   * If omitted, the Tooltip shows `${key}: ${count}`.
   */
  tooltipFormatter?: (value: number, key: string) => [string, string]
  /** Animation duration in ms. Defaults to `CHART_ANIMATION_DURATION` (500). */
  animationDuration?: number
  /** Optional className for the outer `<div>` wrapper. */
  className?: string
}

/**
 * Renders a single-row vertical stacked bar chart with hidden axes.
 *
 * The caller is responsible for sizing the container (e.g.
 * `<div className="h-10 w-full"><StackedBarChart … /></div>`).
 * `ResponsiveContainer` fills 100% of the parent.
 */
export function StackedBarChart({
  segments,
  name = 'bar',
  tooltipFormatter,
  animationDuration = CHART_ANIMATION_DURATION,
  className,
}: StackedBarChartProps) {
  const visible = segments.filter((s) => s.count > 0)

  if (visible.length === 0) return null

  const chartData = [
    {
      name,
      ...Object.fromEntries(visible.map((s) => [s.key, s.count])),
    },
  ]

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={0}
        >
          {/* Hidden axes — recharts needs coordinate references for
              the vertical layout to position the stacked bar correctly.
              `hide` keeps them visually invisible. */}
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            cursor={false}
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value, _name) => {
              const key = _name as string
              if (tooltipFormatter) {
                return tooltipFormatter(value as number, key)
              }
              return [`${key}: ${value}`, '']
            }}
          />
          {visible.map((seg) => (
            <Bar
              key={seg.key}
              dataKey={seg.key}
              stackId="a"
              isAnimationActive
              animationDuration={animationDuration}
            >
              <Cell fill={seg.color} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
