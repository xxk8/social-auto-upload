/**
 * Pure tooltip formatter for the TaskProgressBar recharts BarChart.
 *
 * Extracted from the component so it can be unit-tested without
 * rendering the chart (recharts' ResponsiveContainer needs a real
 * DOM layout that jsdom doesn't provide).
 *
 * @param value  - the numeric count for the segment (from recharts)
 * @param name   - the dataKey string identifying which segment
 *                 ('done' | 'active' | 'failed' | 'empty')
 * @param segs   - the resolved segment array (label + count per key)
 * @param total  - total task count for percentage calculation
 * @returns `[label · count (pct%), '']` — the recharts formatter tuple
 *          where the second element suppresses the default name column.
 */
export type TooltipSegment = {
  key: string
  label: string
  count: number
}

export function formatTaskTooltip(
  value: number,
  name: string,
  segs: TooltipSegment[],
  total: number,
): [string, string] {
  const seg = segs.find((s) => s.key === name)
  if (seg) {
    const pct = total > 0 ? (seg.count / total) * 100 : 0
    return [`${seg.label} · ${value} (${pct.toFixed(0)}%)`, '']
  }
  return [`${value}`, '']
}
