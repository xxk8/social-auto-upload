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

/** Convert a DateRange preset to `{ from, to }` ISO strings for the API.
 *  Exported so AnalyticsPage's CSV export handler can reuse the same
 *  conversion without duplicating the logic. */
export function rangeToParams(range: DateRange): { from?: string; to?: string } {
  if (range === 'all') return {}
  const now = new Date()
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: now.toISOString() }
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

export function useAnalyticsSummary(range: DateRange) {
  return useQuery<AnalyticsSummary>({
    queryKey: ['analytics', 'summary', range] as const,
    queryFn: async () => {
      const res = await api.analytics.summary(rangeToParams(range))
      if (!res.success || !res.data) throw new Error('Failed to fetch analytics summary')
      return res.data
    },
    staleTime: 30_000,
  })
}

export function useAnalyticsAccounts(range: DateRange) {
  return useQuery<AccountActivity[]>({
    queryKey: ['analytics', 'accounts', range] as const,
    queryFn: async () => {
      const res = await api.analytics.accounts(rangeToParams(range))
      if (!res.success || !res.data) throw new Error('Failed to fetch account analytics')
      return res.data.accounts
    },
    staleTime: 30_000,
  })
}
