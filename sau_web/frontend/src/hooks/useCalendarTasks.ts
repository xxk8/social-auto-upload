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
 * TanStack Query hook mirroring `useTasks`'s pattern (see
 * `src/hooks/useTasks.ts::useTasks`): cache the calendar response
 * under a stable key by `[start, end, platform, account]`, polling
 * every 5 s ONLY while the current visible window contains
 * pending/running tasks (consistent cadence with the list view's
 * 3 s throttle — calendar is a read-only browse surface, can afford
 * a slightly slower tick).
 *
 * Returns `{tasks, summary}` directly (NOT a full `ApiResponse<T>`
 * envelope) — callers destructure this.{tasks,summary}, no extra
 * `.data?.data` chain.
 *
 * Empty-start guard: when `start` or `end` is the empty string
 * (initial render before useState hydrates), the query disables
 * so the server doesn't 400. This is preferable to guarding at the
 * call site — letting useQuery's `enabled` flag short-circuit
 * cleanly trims the request from the network panel.
 */
export function useCalendarTasks(params: UseCalendarTasksParams) {
  const { start, end, platform = '', account = '' } = params
  const enabled = !!start && !!end

  return useQuery<CalendarTasksData>({
    queryKey: ['calendar-tasks', start, end, platform, account] as const,
    queryFn: async () => {
      const res = await api.getCalendarTasks({ start, end, platform, account })
      // Defensive: backend always returns both `tasks` + `summary`,
      // but a malformed response from a buggy proxy / mocked MSW
      // handler could collapse to `undefined`. Coalesce to the
      // canonical empty shape so the calendar grid renders 0 cells
      // (NOT a TypeError on `.tasks.map(...)`).
      return {
        tasks: res?.tasks ?? [],
        summary: res?.summary ?? emptySummary,
      }
    },
    enabled,
    // Keep the previously-fetched window on screen while a new
    // (filter/view/date) query key loads, so toggling a filter or
    // switching 周/月 doesn't flash the empty "加载日历中…" spinner
    // between unmount/remount of the <BigCalendar>.
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      const hasPending = data.tasks.some(
        (t) => t.status === 'pending' || t.status === 'running',
      )
      return hasPending ? 5_000 : false
    },
    // Calendar is a high-level summary view — slightly stale data
    // (10 s) is fine because operators don't act on it in real-time.
    // Tightening to 0 would force redundant rechecks on every nav
    // focus / hover. The refetchInterval above replaces real-time
    // claims.
    staleTime: 10_000,
  })
}
