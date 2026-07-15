// Sparkline — recharts-powered mini area chart for AdminStat cards.
//
// Replaces the hand-written SVG path math with recharts' AreaChart,
// keeping the same exported props interface (`points`, `height`, `tone`,
// `className`, `ariaLabel`) so AdminStat doesn't need any changes.
//
// Visual contract (unchanged from v1):
//  - No axes, no grid, no legend — just the area + line + endpoint dot.
//  - Area fill is a tone-tinted gradient at 15% opacity.
//  - Line stroke is 1.5px, tone-coloured, rounded caps.
//  - Endpoint dot is a 2px-radius circle on the last data point.
//  - viewBox auto-scales via ResponsiveContainer so any card width works.
//
// Module exports ONLY the component so Fast Refresh stays happy
// (react-refresh/only-export-components).

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'
import { toneFgVar, type Tone } from '@/lib/tone'

interface SparklineProps {
  /** Series of data points, ordered oldest -> newest. Min 2 to render. */
  points: number[]
  /** Height of the rendered chart in pixels. Defaults to 24 (card-slot). */
  height?: number
  /** Tinted stroke + dot. Falls back to muted-foreground when nullish. */
  tone?: Tone | null
  /** Tailwind class for the wrapping div. */
  className?: string
  /** Aria label - typically "14 天趋势" or "趋势 · +12.4%". */
  ariaLabel?: string
}

function Sparkline({
  points,
  height = 24,
  tone,
  className,
  ariaLabel,
}: SparklineProps) {
  // Transform the flat number[] into recharts' expected data shape.
  // Each point gets an `idx` (x-axis key) and `v` (y-axis value).
  const data = useMemo(
    () => (points ?? []).map((v, idx) => ({ idx, v })),
    [points],
  )

  // Unique gradient id per instance so multiple sparklines on the same
  // page don't collide. Uses a stable hash of the points array so the
  // id stays consistent across re-renders (avoids gradient ref churn).
  const gradId = useMemo(() => {
    const hash = (points ?? []).reduce((a, v) => a + Math.round(v * 100), 0)
    return `spark-grad-${hash}-${tone ?? 'muted'}`
  }, [points, tone])

  // Resolve the stroke/fill colour. Uses CSS var tokens so light/dark
  // theme switching is automatic. Falls back to muted-foreground.
  const color = tone ? toneFgVar(tone) : 'var(--muted-foreground)'

  if (!points || points.length < 2) return null

  return (
    <div
      className={cn('block', className)}
      role="img"
      aria-label={ariaLabel ?? '趋势'}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            // Endpoint dot — only render on the LAST data point so it
            // reads as a "live" cue. Use a plain <circle> to avoid
            // recharts' <Dot> prop-type friction with the `key` field.
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const isLast = props.index === data.length - 1
              if (!isLast) return <></>
              return (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={2}
                  fill={color}
                  stroke="none"
                />
              )
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export { Sparkline }
