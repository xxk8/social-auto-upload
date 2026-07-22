import { useCallback, useMemo } from 'react'
import { useSearchParams } from '@/lib/router/useSearchParams'

export type PresetRange = 'all' | 'today' | 'week' | 'month' | 'custom'

export const TIME_RANGE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
] as const

function _todayInputValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Syncs time-range filter state with URL query params so a page refresh
 * preserves the selected filter.
 *
 * URL params:
 *   range = all | today | week | month | custom   (default: all)
 *   start = YYYY-MM-DD                            (default: today)
 *   end   = YYYY-MM-DD                            (default: today)
 *
 * Uses replaceState (not pushState) so filter changes don't clutter
 * browser history.
 *
 * Batch update (`updateTimeRangeAndPage`) performs a single setSearchParams
 * call so range + page mutations don't race each other.
 */
export function useTimeRangeFilter() {
  const [searchParams, setSearchParams] = useSearchParams()

  const timeRange = useMemo<PresetRange>(() => {
    const r = searchParams.get('range')
    if (r === 'today' || r === 'week' || r === 'month' || r === 'custom') {
      return r
    }
    return 'all'
  }, [searchParams])

  const customStart = useMemo(() => {
    return searchParams.get('start') ?? _todayInputValue()
  }, [searchParams])

  const customEnd = useMemo(() => {
    return searchParams.get('end') ?? _todayInputValue()
  }, [searchParams])

  const updateTimeRange = useCallback(
    (range: PresetRange) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('range', range)
          if (range !== 'custom') {
            next.delete('start')
            next.delete('end')
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const updateTimeRangeAndPage = useCallback(
    (range: PresetRange, page: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('range', range)
          next.set('page', String(page))
          if (range !== 'custom') {
            next.delete('start')
            next.delete('end')
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const updateCustomStart = useCallback(
    (start: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('start', start)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const updateCustomStartAndPage = useCallback(
    (start: string, page: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('start', start)
          next.set('page', String(page))
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const updateCustomEnd = useCallback(
    (end: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('end', end)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const updateCustomEndAndPage = useCallback(
    (end: string, page: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('end', end)
          next.set('page', String(page))
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  return {
    timeRange,
    customStart,
    customEnd,
    updateTimeRange,
    updateTimeRangeAndPage,
    updateCustomStart,
    updateCustomStartAndPage,
    updateCustomEnd,
    updateCustomEndAndPage,
    clearFilters,
  }
}
