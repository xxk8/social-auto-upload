import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * §12 — Analytics data hooks backed by `/api/analytics/*`.
 *
 * Both hooks accept a date range string ('7d' | '30d' | '90d' | 'all')
 * which is converted to `from`/`to` ISO query params. The summary hook
 * fetches aggregated stats (totals, by_platform, by_day, failure_reasons);
 * the accounts hook fetches per-account activity.
 */

type DateRange = '7d' | '30d' | '90d' | 'all'

/** Local calendar day `YYYY-MM-DD` (not UTC) — matches SQLite task `created` pins. */
function toLocalDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Convert a DateRange preset to `{ from, to }` day strings for the API.
 *  Exported so AnalyticsPage's CSV export handler can reuse the same
 *  conversion without duplicating the logic. */
export function rangeToParams(range: DateRange): { from?: string; to?: string } {
  if (range === 'all') return {}
  const now = new Date()
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  // Local day bounds — UTC `toISOString()` was dropping "today" tasks near
  // midnight in UTC+8 (SPA to=22nd UTC while SQLite created=23rd local).
  return { from: toLocalDay(from), to: toLocalDay(now) }
}

/** Analytics summary data (totals, by_platform, by_day, failure_reasons). */
export type AnalyticsSummary = {
  total: number
  success: number
  failed: number
  today: number
  prev_total: number
  prev_success: number
  by_platform: Record<string, { success: number; failed: number }>
  by_day: Array<{ date: string; success: number; failed: number }>
  failure_reasons: Array<{ reason: string; count: number }>
}

/** Per-account activity row. */
export type AccountActivity = {
  account: string
  platform: string
  total: number
  success: number
  failed: number
  success_rate: number
  last_active: string
}

function normalizeSummary(raw: Partial<AnalyticsSummary> | null | undefined): AnalyticsSummary {
  const data = raw ?? {}
  const byDay = Array.isArray(data.by_day) ? data.by_day : []
  const byPlatform =
    data.by_platform && typeof data.by_platform === 'object' && !Array.isArray(data.by_platform)
      ? data.by_platform
      : {}
  return {
    total: Number(data.total ?? 0),
    success: Number(data.success ?? 0),
    failed: Number(data.failed ?? 0),
    today: Number(data.today ?? 0),
    prev_total: Number(data.prev_total ?? 0),
    prev_success: Number(data.prev_success ?? 0),
    by_platform: byPlatform as AnalyticsSummary['by_platform'],
    by_day: byDay as AnalyticsSummary['by_day'],
    failure_reasons: Array.isArray(data.failure_reasons) ? data.failure_reasons : [],
  }
}

export function useAnalyticsSummary(range: DateRange) {
  return useQuery<AnalyticsSummary>({
    queryKey: ['analytics', 'summary', range] as const,
    queryFn: async () => {
      const res = await api.analytics.summary(rangeToParams(range))
      if (!res?.success || res.data == null) throw new Error('Failed to fetch analytics summary')
      return normalizeSummary(res.data)
    },
    staleTime: 30_000,
  })
}

export function useAnalyticsAccounts(range: DateRange) {
  return useQuery<AccountActivity[]>({
    queryKey: ['analytics', 'accounts', range] as const,
    queryFn: async () => {
      const res = await api.analytics.accounts(rangeToParams(range))
      if (!res?.success || res.data == null) throw new Error('Failed to fetch account analytics')
      // Support both `{ accounts: [...] }` and bare `[...]` payloads.
      const payload = res.data as { accounts?: AccountActivity[] } | AccountActivity[]
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.accounts)
          ? payload.accounts
          : []
      // success_rate is 0–100 from the API; coerce numerics defensively.
      return list.map((row) => ({
        ...row,
        total: Number(row.total ?? 0),
        success: Number(row.success ?? 0),
        failed: Number(row.failed ?? 0),
        success_rate: Number(row.success_rate ?? 0),
        account: String(row.account ?? ''),
        platform: String(row.platform ?? ''),
        last_active: String(row.last_active ?? ''),
      }))
    },
    staleTime: 30_000,
  })
}
