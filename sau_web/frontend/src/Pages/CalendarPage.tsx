import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ComponentType,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Calendar, dateFnsLocalizer, Views, type View, type Event } from 'react-big-calendar'
// react-big-calendar v1 ships drag-and-drop as an opt-in HOC addon
// that is NOT re-exported from the package root nor typed by
// `@types/react-big-calendar`. Wrap the base `Calendar` so the
// `draggableAccessor` / `onEventDrop` props become available.
//
// The subpath has no bundled types, and Vite's CJS interop exports
// the module *namespace* as default (`export default module.exports`
// → `{ default: fn }`). So we deep-unwrap `.default` until we reach
// the actual HOC function. The loop is defensive against either
// interop shape (single or double `.default` nesting).
// @ts-ignore - untyped drag-and-drop subpath
import * as dndAddon from 'react-big-calendar/lib/addons/dragAndDrop/withDragAndDrop'

function resolveDnDHoc(mod: unknown): (c: ComponentType<any>) => ComponentType<any> {
  let cur: any = mod
  for (let i = 0; i < 4 && cur && typeof cur !== 'function'; i++) {
    const next = cur.default
    if (next === cur || next === undefined) break
    cur = next
  }
  return cur as (c: ComponentType<any>) => ComponentType<any>
}

const withDragAndDrop = resolveDnDHoc(dndAddon)

const BigCalendar = withDragAndDrop(Calendar) as ComponentType<any>
import {
  format,
  parse,
  startOfWeek,
  getDay,
  startOfMonth,
  addMonths,
  addWeeks,
  subMonths,
  subWeeks,
  addDays,
  startOfDay,
} from 'date-fns'
import { enUS } from 'date-fns/locale'
import {
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  AlertTriangle,
  Copy,
  CalendarPlus,
} from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import '../calendar-dark.css'

import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
import { Button } from '@/Components/ui/button'
import { Badge } from '@/Components/ui/badge'
import { Checkbox } from '@/Components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useCalendarTasks } from '@/hooks/useCalendarTasks'
import { platformHex } from '@/Components/ui/platform-icon.helpers'
import { PlatformIcon } from '@/Components/ui/platform-icon'
import { PLATFORMS, type PlatformOption, type CalendarTaskItem } from '@/api/types'
import { api } from '@/api/client'
import { useToast } from '@/Components/ui/toast'

// Lazy-load the existing TaskDrawer rather than importing synchronously —
// TaskDrawer pulls in @tanstack/react-query, the TaskDrawer accordion,
// CliCommandBlock, and other heavyweight surfaces that the calendar
// doesn't need at initial paint. Following the same pattern as
// `TasksPage` (which itself lazy-loads AddTaskDialog inside the page
// body), the calendar pays the bundle cost only when the user clicks
// an event to open the drawer.
const TaskDrawer = lazy(() =>
  import('@/features/tasks/TaskDrawer').then((m) => ({ default: m.TaskDrawer })),
)

const locales = { 'en-US': enUS }
// We pass `parse` / `format` as direct references; dateFnsLocalizer
// wraps them so date-fns v4's `parse(value, formatString, refDate)`
// signature is satisfied. No `today` option override — the calendar
// uses the default `new Date()` refDate, matching the project's
// other date-picker surfaces.
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
})

interface CalendarEventResource extends CalendarTaskItem {
  /** Set when this task shares its calendar pin with other publish-eligible tasks. */
  __conflict?: boolean
  /** How many publish-eligible tasks collide on the same day. */
  __conflictCount?: number
}

interface CalendarEvent extends Event {
  resource: CalendarEventResource
}

/** Number of same-day publish-eligible tasks that triggers a rate-limit warning. */
const CONFLICT_THRESHOLD = 2

/**
 * Build an ISO-8601 (naive, local) timestamp for a moved/copied task.
 * Preserves the source task's time-of-day when it already has a
 * `scheduled_at`; otherwise keeps whatever time the calendar dropped it at.
 * Mirrors the backend `datetime.fromisoformat` expectation (no tz suffix).
 */
function buildScheduledAt(task: CalendarTaskItem, target: Date): string {
  const base = task.scheduled_at ? new Date(task.scheduled_at) : null
  const d = new Date(target)
  if (base) {
    d.setHours(base.getHours(), base.getMinutes(), 0, 0)
  } else {
    d.setSeconds(0, 0)
  }
  return format(d, "yyyy-MM-dd'T'HH:mm:ss")
}

/**
 * Right-click context menu for a calendar event. Provided via context
 * (rather than props) so the per-event custom cell component can open
 * it without being re-created on every render — recreating the
 * component type would remount every event and break drag state.
 */
interface EventMenuApi {
  open: (taskId: string, x: number, y: number) => void
}
const EventMenuContext = createContext<EventMenuApi | null>(null)

/**
 * /dashboard/calendar — content-calendar view (Phases 0+1+3 of
 * `docs/DESIGN-content-calendar.md`).
 *
 * Surfaces:
 *  - Month view + week view (Phase 0+1) — react-big-calendar.
 *  - Platform color per event (Phase 0) — `eventPropGetter` reads
 *    `PLATFORM_HEX` from the existing design-token SSoT.
 *  - Click an event → TaskDrawer (Phase 1) — same drawer that
 *    TasksPage uses, reused via lazy import.
 *  - Platform filter + account filter (Phase 3) — multi-select
 *    checkboxes in the toolbar. Filters apply via URL-stable
 *    comma-separated strings that the backend already supports.
 *  - Summary footer (Phase 3) — server-side aggregated `summary`
 *    block (total, by_platform, by_status) rendered as a tight
 *    strip beneath the calendar.
 *
 * Phase 2 (added after initial landing):
 *  - drag-to-reschedule (PUT `/api/tasks/reschedule`) — only
 *    pending/scheduled events are draggable; the drop preserves the
 *    source task's time-of-day.
 *  - same-day conflict warning — publish-eligible tasks sharing an
 *    `effective_date` are flagged (amber ring + banner) because
 *    "同一时间发多条" risks platform rate-limiting.
 *  - right-click "复制到另一天" — clones the task onto a new day via
 *    `/api/tasks/copy`, preserving argv + time-of-day.
 */
export default function CalendarPage() {
  const [view, setView] = useState<View>(Views.MONTH)
  const [date, setDate] = useState<Date>(new Date())
  const [platformFilter, setPlatformFilter] = useState<string[]>([])
  const [accountFilter, setAccountFilter] = useState<string[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const navigate = useNavigate()
  // Calendar is read-only — when the operator clicks "Retry" inside
  // the TaskDrawer (rendered for failed tasks), bounce them to the
  // tasks page with the URL `?focus=<taskId>` deep-link instead.
  // TasksPage's `useTaskTableState` reads `?focus=` and auto-opens
  // the same task's drawer on mount — verified in
  // `src/Pages/PublishPage.test.tsx` (NT-22 deep-link contract) and
  // a future `tests/test_focus_deeplink.spec` (see suggest_followups).
  const handleRetryFromDrawer = () => {
    if (selectedTaskId) {
      navigate(`/dashboard/tasks?focus=${selectedTaskId}`)
    }
  }

  // Compute the date-range for the backend query — Month view
  // spans the visible month (first → first of next); week view
  // spans Mon → next-Mon. The backend endpoint is half-open
  // (`[start, end)`), so we never need to subtract 1 day.
  const { start, end } = useMemo(() => {
    if (view === Views.WEEK) {
      return {
        start: format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        end: format(addWeeks(startOfWeek(date, { weekStartsOn: 1 }), 1), 'yyyy-MM-dd'),
      }
    }
    return {
      start: format(startOfMonth(date), 'yyyy-MM-dd'),
      end: format(addMonths(startOfMonth(date), 1), 'yyyy-MM-dd'),
    }
  }, [date, view])

  const { data, isLoading, refetch, isFetching } = useCalendarTasks({
    start,
    end,
    platform: platformFilter.join(','),
    account: accountFilter.join(','),
  })

  const queryClient = useQueryClient()
  const { addToast } = useToast()

  const tasks = data?.tasks ?? []
  const summary = data?.summary

  // Same-day collision detection (rate-limit guard). Group only the
  // publish-eligible rows (pending/scheduled) by their calendar pin
  // (`effective_date`). When ≥ CONFLICT_THRESHOLD land on one day the
  // operator risks getting throttled for "同一时间发多条", so we flag
  // every member of that day and surface a banner below the grid.
  const conflictInfo = useMemo(() => {
    const byDate = new Map<string, string[]>()
    for (const t of tasks) {
      if (t.status !== 'pending' && t.status !== 'scheduled') continue
      if (!t.effective_date) continue
      const arr = byDate.get(t.effective_date) ?? []
      arr.push(t.task_id)
      byDate.set(t.effective_date, arr)
    }
    const conflictTaskIds = new Set<string>()
    const conflictDays: { date: string; count: number }[] = []
    for (const [date, ids] of byDate) {
      if (ids.length >= CONFLICT_THRESHOLD) {
        ids.forEach((id) => conflictTaskIds.add(id))
        conflictDays.push({ date, count: ids.length })
      }
    }
    conflictDays.sort((a, b) => a.date.localeCompare(b.date))
    return { conflictTaskIds, conflictDays }
  }, [tasks])

  // `react-big-calendar`'s event prop is `Date | string`; we map our
  // ISO strings to JS Date here. Defensive: tasks created via
  // legacy flows may have malformed `effective_date` (e.g. just
  // "2026-07-08" with no time). `new Date('YYYY-MM-DD')` parses
  // it as UTC midnight, which lines up with the calendar's date
  // placement. We also stamp the conflict flag onto the resource so
  // the custom event cell can render a warning chip.
  const events = useMemo<CalendarEvent[]>(() => {
    return tasks
      .filter((t) => t.effective_date)
      .map((t) => {
        const conflict = conflictInfo.conflictTaskIds.has(t.task_id)
        return {
          title: t.title || `${t.platform}·${t.task_id.slice(-6)}`,
          start: new Date(t.effective_date),
          end: new Date(t.effective_date),
          resource: {
            ...t,
            __conflict: conflict,
            __conflictCount: conflict
              ? conflictInfo.conflictDays.find((d) => d.date === t.effective_date)?.count
              : undefined,
          },
        }
      })
  }, [tasks, conflictInfo])

  // Right-click "copy to another day" menu state — {taskId, x, y} in
  // viewport coordinates so the floating menu can be fixed-positioned
  // at the cursor.
  const [menu, setMenu] = useState<{ taskId: string; x: number; y: number } | null>(null)
  const openMenu = useCallback((taskId: string, x: number, y: number) => {
    setMenu({ taskId, x, y })
  }, [])

  // Drag-and-drop reschedule (Phase 2). Only publish-eligible rows
  // are draggable — the backend rejects rescheduling anything but
  // `pending`, so we pre-filter to avoid a doomed drop + error toast.
  const draggableAccessor = (event: Event) => {
    const r = (event as unknown as CalendarEvent).resource
    return r.status === 'pending' || r.status === 'scheduled'
  }

  const handleEventDrop = async ({
    event,
    start,
  }: {
    event: Event
    start: Date
  }) => {
    const t = (event as unknown as CalendarEvent).resource
    const newIso = buildScheduledAt(t, new Date(start))
    try {
      await api.tasks.reschedule(t.task_id, newIso)
      addToast(`已改期至 ${format(new Date(newIso), 'yyyy-MM-dd HH:mm')}`, 'success')
    } catch (e: any) {
      addToast(e?.response?.data?.message ?? '改期失败', 'error')
    } finally {
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
    }
  }

  // Right-click copy → clone the task onto a new day. We preserve the
  // source's time-of-day (or default to 09:00 when none) and let the
  // backend `/api/tasks/copy` faithfully duplicate the argv.
  const handleCopy = async (taskId: string, target: Date) => {
    const t = tasks.find((x) => x.task_id === taskId)
    if (!t) return
    const base = t.scheduled_at ? new Date(t.scheduled_at) : null
    const d = startOfDay(target)
    d.setHours(base ? base.getHours() : 9, base ? base.getMinutes() : 0, 0, 0)
    const newIso = format(d, "yyyy-MM-dd'T'HH:mm:ss")
    try {
      await api.tasks.copy(taskId, newIso)
      addToast(`已复制到 ${format(d, 'yyyy-MM-dd')}`, 'success')
    } catch (e: any) {
      addToast(e?.response?.data?.message ?? '复制失败', 'error')
    } finally {
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
    }
  }

  // Unique accounts seen in the current window — drives the
  // account filter UI. The backend already filters; here we just
  // enumerate the available options. Sorted alphabetically so the
  // filter dropdown reads deterministically across renders.
  const availableAccounts = useMemo<string[]>(() => {
    const set = new Set<string>()
    for (const t of tasks) if (t.account) set.add(t.account)
    return [...set].sort()
  }, [tasks])

  const eventPropGetter = (event: CalendarEvent) => {
    const platform = event.resource.platform
    const bg = platformHex(platform)
    const conflict = !!event.resource.__conflict
    return {
      style: {
        // Round OPT-cal-fill-revert (2026-07-10, 3rd pass): operator
        // escalation 「我说的是边框太艳了，再暗色的时候」 clarified
        // that the original complaint was about *borders*, not the brand-
        // colour event fills. The fill softening introduced in round 2
        // (`${bg}B3` 70% alpha + 1px brand ring) was rolled back; event
        // chips now restore full-saturation background + 3px accent bar.
        // Border softness lives in `index.css::--rbc-grid-line` (now
        // 18% mix) + `CalendarPage.tsx` wrapper border /12 instead.
        backgroundColor: bg,
        borderLeft: conflict ? `3px solid #fbbf24` : `3px solid ${bg}`,
        // A 1px amber ring makes colliding (rate-limit-risk) events pop
        // without washing out the brand fill.
        boxShadow: conflict ? 'inset 0 0 0 1px rgba(251,191,36,0.9)' : undefined,
        color: '#ffffff',
        fontSize: '11px',
        padding: '2px 6px',
        borderRadius: '3px',
        cursor: 'grab',
      },
    }
  }

  const goToday = () => setDate(new Date())
  const navBack = () => {
    setDate((d) => (view === Views.WEEK ? subWeeks(d, 1) : subMonths(d, 1)))
  }
  const navForward = () => {
    setDate((d) => (view === Views.WEEK ? addWeeks(d, 1) : addMonths(d, 1)))
  }

  return (
    <PageWrapper spacing="sm">
      <PageHeader
        title="内容日历"
        description="按时间维度查看排期和发布节奏，支持周/月切换、平台筛选和统计摘要。"
        icon={<CalendarIcon className="h-5 w-5 text-foreground/85" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="刷新日历"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            刷新
          </Button>
        }
      />

      {/* Toolbar: navigation + view toggle + filters. Stacked rows
          so each cluster (nav, view, filter) gets its own scan-line;
          a single combined row reads as visual mud. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={navBack} aria-label="上一个">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            今日
          </Button>
          <Button variant="outline" size="sm" onClick={navForward} aria-label="下一个">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 font-mono text-[12px] text-muted-foreground tabular-nums" data-testid="calendar-current-period">
            {format(date, view === Views.WEEK ? 'yyyy 年 第 w 周' : 'yyyy 年 M 月')}
          </span>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {/* Filter row: platform + account checkboxes. Inline rather
          than in a dropdown so the active set is visible at a glance.
          Each entry trims to its brand color (3 px wide square) so
          the operator can spot the platform without reading the label.
          Border softened from `/40` to `/25` (round OPT-cal-dark-soften,
          2026-07-10) so the per-mode contrast over the dark canvas
          reads as a hairline panel edge rather than a hard frame. */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-md border border-border/40 bg-muted/20 p-3">
        <FilterGroup
          title="平台"
          options={PLATFORMS as readonly PlatformOption[]}
          selected={platformFilter}
          withPlatformIcon
          onToggle={(v) =>
            setPlatformFilter((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
          }
        />
        {availableAccounts.length > 0 && (
          <FilterGroup
            title="账号"
            options={availableAccounts.map((a) => ({ label: a, value: a }))}
            selected={accountFilter}
            onToggle={(v) =>
              setAccountFilter((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
            }
          />
        )}
        {(platformFilter.length > 0 || accountFilter.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPlatformFilter([])
              setAccountFilter([])
            }}
            className="self-center"
          >
            清除筛选
          </Button>
        )}
      </div>

      <div className="rounded-md bg-card overflow-hidden border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载日历中…
          </div>
        ) : (
          <EventMenuContext.Provider value={{ open: openMenu }}>
            <BigCalendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              view={view}
              onView={setView}
              date={date}
              onNavigate={setDate}
              views={[Views.MONTH, Views.WEEK]}
              eventPropGetter={eventPropGetter}
              onSelectEvent={(event: Event) => setSelectedTaskId((event as unknown as CalendarEvent).resource.task_id)}
              draggableAccessor={draggableAccessor}
              onEventDrop={handleEventDrop}
              // Re-center drop times to the slot start (no partial-hour drift).
              slotDuration={30 * 60 * 1000}
              components={{ event: CalendarEventCell }}
              popup
              style={{ height: 720 }}
            />
            {menu && (
              <EventContextMenu
                taskId={menu.taskId}
                x={menu.x}
                y={menu.y}
                onClose={() => setMenu(null)}
                onCopy={(target) => {
                  handleCopy(menu.taskId, target)
                  setMenu(null)
                }}
              />
            )}
          </EventMenuContext.Provider>
        )}
      </div>

      {conflictInfo.conflictDays.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs"
          role="alert"
        >
          <span className="inline-flex items-center gap-1.5 font-medium text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            同日多发可能触发平台限流
          </span>
          <span className="text-muted-foreground">
            以下日期排期过密，建议错峰发布：
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {conflictInfo.conflictDays.map((d) => (
              <span
                key={d.date}
                className="inline-flex items-center gap-1 rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono tabular-nums text-amber-200"
              >
                {d.date}
                <Badge variant="secondary" className="h-4 px-1 text-[9px] text-amber-200">
                  {d.count} 条
                </Badge>
              </span>
            ))}
          </div>
        </div>
      )}

      <CalendarSummary summary={summary} isLoading={!summary} />

      <Suspense fallback={null}>
        <TaskDrawer
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onRetry={handleRetryFromDrawer}
          // TaskDrawer subscribes to its parent's cache via
          // useTaskFromCache internally; this `retrying=null` keeps
          // the drawer's retry button hidden because `selectedTaskId`
          // is always null at click time (no in-flight retry from
          // the calendar surface). The retry action itself just
          // navigates to /dashboard/tasks?focus=... instead.
          retrying={null}
        />
      </Suspense>
    </PageWrapper>
  )
}

// ── View toggle — segment-style two-button group ─────────────────────────
//
// Inline component (NOT exported) because only the page consumes it.
// Splitting would require lifting `view` state up + passing
// `onChange` callback in props — extra ceremony for one consumer.
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div
      role="group"
      aria-label="视图切换"
      className="inline-flex rounded-md p-0.5 bg-muted/30 border border-border/40"
    >
      <ViewButton active={view === Views.WEEK} onClick={() => onChange(Views.WEEK)}>
        周
      </ViewButton>
      <ViewButton active={view === Views.MONTH} onClick={() => onChange(Views.MONTH)}>
        月
      </ViewButton>
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'px-3 py-1 text-xs font-medium rounded-sm transition-colors',
        active
          ? 'bg-foreground text-background shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function FilterGroup({
  title,
  options,
  selected,
  onToggle,
  withPlatformIcon = false,
}: {
  title: string
  options: ReadonlyArray<{ label: string; value: string; color?: string }>
  selected: string[]
  onToggle: (v: string) => void
  /** Render the platform's official brand logo (via `PlatformIcon`) instead of a color swatch. */
  withPlatformIcon?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt.value)
          return (
            <label
              key={opt.value}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer select-none transition-colors',
                active
                  ? 'border-foreground/30 bg-foreground/5 text-foreground'
                  : 'border-border/30 hover:border-foreground/20 text-muted-foreground',
              )}
            >
              <Checkbox
                checked={active}
                onCheckedChange={() => onToggle(opt.value)}
                aria-label={`筛选 ${title} ${opt.label}`}
                className="h-3.5 w-3.5"
              />
              {withPlatformIcon && (
                <span
                  aria-hidden
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm"
                  style={{ backgroundColor: platformHex(opt.value) }}
                >
                  <PlatformIcon platform={opt.value} variant="dark" className="h-2.5 w-2.5" />
                </span>
              )}
              {opt.label}
              {active && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
                  ✓
                </Badge>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── Custom event cell ────────────────────────────────────────────────────
//
// Rendered inside the brand-colored chip (the wrapper style comes from
// `eventPropGetter`). Adds a conflict warning glyph + a right-click
// handler that opens the copy-to-another-day context menu.
function CalendarEventCell({ event }: { event: CalendarEvent }) {
  const menu = useContext(EventMenuContext)
  const r = event.resource
  const conflict = !!r.__conflict
  return (
    <div
      className="flex items-center gap-1 truncate"
      onContextMenu={(e) => {
        e.preventDefault()
        menu?.open(r.task_id, e.clientX, e.clientY)
      }}
      title={
        conflict
          ? `${r.title} · 同日多发 ${r.__conflictCount} 条，可能触发平台限流`
          : r.title
      }
    >
      <span className="truncate">{event.title}</span>
      {conflict && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-200" />}
    </div>
  )
}

// ── Right-click context menu (copy to another day) ────────────────────────
//
// Fixed-positioned at the cursor. Closes on outside mousedown, Escape,
// or any scroll. Position is clamped to the viewport so it never
// overflows off-screen.
function EventContextMenu({
  taskId,
  x,
  y,
  onClose,
  onCopy,
}: {
  taskId: string
  x: number
  y: number
  onClose: () => void
  onCopy: (target: Date) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const now = startOfDay(new Date())
  const targets: { label: string; date: Date }[] = [
    { label: '明天', date: addDays(now, 1) },
    { label: '本周五', date: addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 4) },
    { label: '下周同一天', date: addWeeks(now, 1) },
  ]

  // Clamp so the 192px-wide / ~ 224px-tall menu stays on-screen.
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - 230)

  const itemCls =
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-foreground/10 transition-colors'

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-48 rounded-md border border-border/40 bg-popover p-1 shadow-lg"
      style={{ left, top }}
    >
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
        复制到另一天
      </div>
      {targets.map((t) => (
        <button key={t.label} type="button" role="menuitem" className={itemCls} onClick={() => onCopy(t.date)}>
          <CalendarPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{t.label}</span>
          <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
            {format(t.date, 'MM-dd')}
          </span>
        </button>
      ))}
      <label className={cn(itemCls, 'cursor-pointer')}>
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>选择日期</span>
        <input
          type="date"
          className="ml-auto bg-transparent text-[10px] text-muted-foreground outline-none"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.value) onCopy(new Date(`${e.target.value}T00:00`))
          }}
        />
      </label>
      <div className="mt-1 border-t border-border/40 px-2 pt-1 text-[10px] text-muted-foreground/60">
        任务 {taskId.slice(-6)}
      </div>
    </div>
  )
}

function CalendarSummary({
  summary,
  isLoading,
}: {
  summary:
    | {
        total: number
        by_platform: Record<string, number>
        by_status: Record<string, number>
      }
    | undefined
  isLoading: boolean
}) {
  if (isLoading) return null
  const platformEntries = Object.entries(summary?.by_platform ?? {}).sort((a, b) => b[1] - a[1])
  const statusEntries = Object.entries(summary?.by_status ?? {}).sort((a, b) => b[1] - a[1])
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-md border border-border/40 bg-muted/20 px-4 py-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">共</span>
        <span className="font-mono font-semibold text-foreground tabular-nums" data-testid="calendar-summary-total">
          {summary?.total ?? 0}
        </span>
        <span className="text-muted-foreground">个任务</span>
      </div>
      {platformEntries.length > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <div className="flex flex-wrap items-center gap-3" data-testid="calendar-summary-platforms">
            {platformEntries.map(([p, n]) => {
              const label = (PLATFORMS.find((x) => x.value === p)?.label ?? p)
              const hex = platformHex(p)
              // Suppress the `(none)` placeholder from rendering —
              // null-platform rows shouldn't read as "no platform"
              // to the operator.
              if (p === '(none)') return null
              return (
                <span key={p} className="flex items-center gap-1.5">
                  {hex && (
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: hex }}
                    />
                  )}
                  <span className="font-mono tabular-nums text-foreground">{n}</span>
                  <span className="text-muted-foreground">{label}</span>
                </span>
              )
            })}
          </div>
        </>
      )}
      {statusEntries.length > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <div className="flex flex-wrap items-center gap-3" data-testid="calendar-summary-statuses">
            {statusEntries.map(([s, n]) => (
              <span key={s} className="flex items-center gap-1.5" title={`status: ${s}`}>
                <span className="font-mono tabular-nums text-foreground">{n}</span>
                <span className="text-muted-foreground">{STATUS_LABEL[s] ?? s}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  success: '已发布',
  failed: '失败',
  pending: '待执行',
  scheduled: '已排期',
  running: '运行中',
  error: '异常',
}
