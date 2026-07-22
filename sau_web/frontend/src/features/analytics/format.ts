import type { AnalyticsSummary } from '@/hooks/useAnalytics'

/** Format an ISO date string to MM-DD for chart axes / tooltips. */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Per-day success rate (percentage) derived from `by_day`.
 *  Days with no tasks map to `null` so charts can skip them (no false 0). */
export function computeSuccessRates(
  byDay: AnalyticsSummary['by_day'] | null | undefined,
): Array<{ date: string; rate: number | null }> {
  if (!Array.isArray(byDay)) return []
  return byDay.map((d) => {
    const total = (d?.success ?? 0) + (d?.failed ?? 0)
    return {
      date: formatDay(d?.date ?? ''),
      rate: total > 0 ? Math.round(((d.success ?? 0) / total) * 100 * 10) / 10 : null,
    }
  })
}
