import { request } from './client'
import type { CalendarTaskItem, CalendarSummary } from './types'

/**
 * Calendar-specific fetch — the route (`web_runner/routes/calendar.py`)
 * returns tasks whose effective_date is in `[start, end)` plus a
 * precomputed summary. Mirrors `web_runner/routes/calendar.py`'s
 * contract; see that file's docstring for the effective-date
 * semantics (scheduled_at wins over created for the calendar pin).
 *
 * Filters:
 *   - platform — CSV string; empty = no filter
 *   - account  — CSV string; empty = no filter
 *
 * Date args are inclusive-start / exclusive-end (`YYYY-MM-DD`). The
 * CalendarPage adopters always supply an inclusive month range, so
 * callers don't need to subtract 1 day — pass `2026-07-01` /
 * `2026-08-01` for the July view.
 *
 * Returns the inner `data` (`{tasks, summary}`); callers destructure
 * both. Standard envelope: `{'success': true, 'data': ...}` matches
 * the `/api/tasks` + `/api/tasks/scheduled` family.
 */
export interface GetCalendarTasksParams {
  start: string
  end: string
  platform?: string
  account?: string
}

export interface GetCalendarTasksResult {
  tasks: CalendarTaskItem[]
  summary: CalendarSummary
}

export const calendarApi = {
  list(params: GetCalendarTasksParams): Promise<GetCalendarTasksResult> {
    return request
      .get('/api/calendar/tasks', { params })
      .then((res) => res.data?.data ?? { tasks: [], summary: emptySummary() })
  },
}

function emptySummary(): CalendarSummary {
  return { total: 0, by_platform: {}, by_status: {} }
}
