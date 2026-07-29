import { useEffect, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api, type CalendarTaskItem, type CalendarSummary } from '../api/client'

export interface UseCalendarTasksParams {
  /** Inclusive start date, `YYYY-MM-DD`. */
  start: string
  /** Exclusive end date, `YYYY-MM-DD`. */
  end: string
  /** CSV string, e.g. `"douyin,bilibili"`. Empty string = no filter. */
  platform?: string
  /** CSV string, e.g. `"work1,work2"`. Empty string = no filter. */
  account?: string
}

const emptySummary: CalendarSummary = { total: 0, by_platform: {}, by_status: {} }

export interface CalendarTasksData {
  tasks: CalendarTaskItem[]
  summary: CalendarSummary
}

/**
 * Calendar tasks query — limited retries, poll only when pending/running.
 */
export function useCalendarTasks(params: UseCalendarTasksParams) {
  const { start, end, platform = '', account = '' } = params
  const enabled = !!start && !!end
  const [tabVisible, setTabVisible] = useState(
    () => (typeof document === 'undefined' ? true : !document.hidden),
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return useQuery<CalendarTasksData>({
    queryKey: ['calendar-tasks', start, end, platform, account] as const,
    queryFn: async () => {
      const res = await api.getCalendarTasks({ start, end, platform, account })
      return {
        tasks: res?.tasks ?? [],
        summary: res?.summary ?? emptySummary,
      }
    },
    enabled,
    placeholderData: keepPreviousData,
    // Avoid hammering a failing API (was retrying forever on 500).
    retry: 1,
    retryDelay: 1500,
    refetchInterval: (query) => {
      if (!tabVisible) return false
      if (query.state.status === 'error') return false
      const data = query.state.data
      if (!data) return false
      const hasPending = data.tasks.some(
        (t) => t.status === 'pending' || t.status === 'running',
      )
      return hasPending ? 5_000 : false
    },
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  })
}
