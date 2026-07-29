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
  type ReactNode,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from '@/lib/router/useSearchParams'
import {
  Calendar,
  dateFnsLocalizer,
  Views,
  type View,
  type Event,
} from 'react-big-calendar'

/** rbc slot selection payload (not always exported from package types). */
type SlotInfo = {
  start: Date
  end: Date
  slots: Date[]
  action: 'select' | 'click' | 'doubleClick'
}
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
  isToday,
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
  Filter,
  X,
  CheckCircle2,
  Clock,
  XCircle,
  ListTodo,
  Plus,
  Sparkles,
  Search,
} from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import '../calendar-dark.css'

import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/index'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TaskItem } from '@/api/types'
import { cn } from '@/lib/utils'
import { useCalendarTasks, type CalendarTasksData } from '@/hooks/useCalendarTasks'
import { platformHex } from '@/components/ui/platform-icon.helpers'
import { PlatformIcon } from '@/components/ui/platform-icon'
import { PLATFORMS, type CalendarTaskItem } from '@/api/types'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { ROUTES } from '@/routes'

const TaskDrawer = lazy(() =>
  import('@/features/tasks/TaskDrawer').then((m) => ({ default: m.TaskDrawer })),
)

const locales = { 'en-US': enUS }
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
})

interface CalendarEventResource extends CalendarTaskItem {
  __conflict?: boolean
  __conflictCount?: number
  /** Synthetic month-view aggregate chip */
  __aggregate?: boolean
  /** All task ids for that calendar day (for "+N more" sheet). */
  __aggregateIds?: string[]
  /** `YYYY-MM-DD` pin for the aggregate day. */
  __aggregateDay?: string
}

interface CalendarEvent extends Event {
  resource: CalendarEventResource
}

const CONFLICT_THRESHOLD = 2
/** Month view: show first N events per day, then one "+M more" aggregate chip. */
const MONTH_EVENT_CAP = 3

const STATUS_LABEL: Record<string, string> = {
  success: '已发布',
  done: '已发布',
  completed: '已发布',
  failed: '失败',
  error: '异常',
  pending: '待执行',
  scheduled: '已排期',
  running: '运行中',
}

function statusDotClass(status: string): string {
  const s = (status || '').toLowerCase()
  if (s === 'success' || s === 'done' || s === 'completed') return 'bg-emerald-400'
  if (s === 'failed' || s === 'error') return 'bg-rose-400'
  if (s === 'running') return 'bg-sky-400'
  if (s === 'scheduled') return 'bg-violet-400'
  if (s === 'pending') return 'bg-amber-400'
  return 'bg-muted-foreground'
}

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

function formatEventTime(task: CalendarTaskItem): string | null {
  const raw = task.scheduled_at || task.created
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  // Date-only pins hide clock
  if (raw.length <= 10) return null
  return format(d, 'HH:mm')
}

/** Map calendar row → TaskItem seed for TaskDrawer (when list cache misses). */
function calendarToTaskSeed(t: CalendarTaskItem): TaskItem {
  return {
    task_id: t.task_id,
    platform: t.platform,
    account: t.account,
    action: t.action ?? undefined,
    status: t.status,
    created: t.created,
  }
}

function viewToParam(view: View): string {
  if (view === Views.WEEK) return 'week'
  if (view === Views.AGENDA) return 'agenda'
  return 'month'
}

function paramToView(raw: string | null): View {
  if (raw === 'week') return Views.WEEK
  if (raw === 'agenda') return Views.AGENDA
  return Views.MONTH
}

function parseCsvParam(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseDateParam(raw: string | null): Date {
  if (!raw) return new Date()
  // Accept yyyy-MM-dd or yyyy-MM
  const m = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/)
  if (!m) return new Date()
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = m[3] ? Number(m[3]) : 1
  const dt = new Date(y, mo, d)
  return Number.isNaN(dt.getTime()) ? new Date() : dt
}

interface EventMenuApi {
  open: (taskId: string, x: number, y: number) => void
}
const EventMenuContext = createContext<EventMenuApi | null>(null)

/** Open the day-task sheet from the "+N more" chip (or any day drill-in). */
interface DayListApi {
  open: (day: string) => void
}
const DayListContext = createContext<DayListApi | null>(null)

export default function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  // Hydrate from URL so share / refresh keeps view + filters.
  const [view, setView] = useState<View>(() =>
    paramToView(searchParams.get('view')),
  )
  const [date, setDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('date')),
  )
  const [platformFilter, setPlatformFilter] = useState<string[]>(() =>
    parseCsvParam(searchParams.get('platform')),
  )
  const [accountFilter, setAccountFilter] = useState<string[]>(() =>
    parseCsvParam(searchParams.get('account')),
  )
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [highlightDay, setHighlightDay] = useState<string | null>(null)
  /** Day list sheet opened by "+N more" (or day drill-in). */
  const [daySheet, setDaySheet] = useState<string | null>(null)
  /** Confirm dialog before navigating to publish from an empty day click. */
  const [createConfirmDay, setCreateConfirmDay] = useState<string | null>(null)
  /** Pending drag drop that would create/worsen a same-day conflict. */
  const [dropConfirm, setDropConfirm] = useState<{
    task: CalendarEventResource
    start: Date
    newIso: string
    newDay: string
    peerCount: number
  } | null>(null)
  const urlSyncReady = useRef(false)

  // Persist calendar chrome to the URL (replace, no history spam).
  useEffect(() => {
    // Skip the first paint write if URL already matches (avoid churn).
    const next = new URLSearchParams(searchParams)
    next.set('view', viewToParam(view))
    next.set('date', format(date, 'yyyy-MM-dd'))
    if (platformFilter.length) next.set('platform', platformFilter.join(','))
    else next.delete('platform')
    if (accountFilter.length) next.set('account', accountFilter.join(','))
    else next.delete('account')

    const cur = searchParams.toString()
    const tgt = next.toString()
    if (cur === tgt) {
      urlSyncReady.current = true
      return
    }
    // On first mount, only write if URL was empty of our keys.
    if (!urlSyncReady.current) {
      urlSyncReady.current = true
      if (
        searchParams.has('view') ||
        searchParams.has('date') ||
        searchParams.has('platform') ||
        searchParams.has('account')
      ) {
        // URL already drove state — only push when user changes later.
        return
      }
    }
    setSearchParams(next, { replace: true })
  }, [view, date, platformFilter, accountFilter, searchParams, setSearchParams])

  const openDaySheet = useCallback((day: string) => {
    setDaySheet(day)
    setHighlightDay(day)
  }, [])

  const goPublishWithDay = useCallback(
    (day: string) => {
      navigate({
        to: `${ROUTES.dashboard.publish}?schedule=${day}` as never,
      })
    },
    [navigate],
  )

  const handleRetryFromDrawer = () => {
    if (selectedTaskId) {
      navigate({ to: `${ROUTES.dashboard.tasks}?focus=${selectedTaskId}` as never })
    }
  }

  const { start, end } = useMemo(() => {
    if (view === Views.WEEK) {
      const weekStart = startOfWeek(date, { weekStartsOn: 1 })
      return {
        start: format(weekStart, 'yyyy-MM-dd'),
        end: format(addWeeks(weekStart, 1), 'yyyy-MM-dd'),
      }
    }
    if (view === Views.AGENDA) {
      // Agenda: current month window (same as month for fetch)
      return {
        start: format(startOfMonth(date), 'yyyy-MM-dd'),
        end: format(addMonths(startOfMonth(date), 1), 'yyyy-MM-dd'),
      }
    }
    return {
      start: format(startOfMonth(date), 'yyyy-MM-dd'),
      end: format(addMonths(startOfMonth(date), 1), 'yyyy-MM-dd'),
    }
  }, [date, view])

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useCalendarTasks({
    start,
    end,
    platform: platformFilter.join(','),
    account: accountFilter.join(','),
  })

  const tasks = data?.tasks ?? []
  const summary = data?.summary

  const selectedSeedTask = useMemo(() => {
    if (!selectedTaskId) return null
    const hit = tasks.find((t) => t.task_id === selectedTaskId)
    return hit ? calendarToTaskSeed(hit) : null
  }, [selectedTaskId, tasks])

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
    for (const [d, ids] of byDate) {
      if (ids.length >= CONFLICT_THRESHOLD) {
        ids.forEach((id) => conflictTaskIds.add(id))
        conflictDays.push({ date: d, count: ids.length })
      }
    }
    conflictDays.sort((a, b) => a.date.localeCompare(b.date))
    return { conflictTaskIds, conflictDays }
  }, [tasks])

  // Full event list (week / agenda / drag source of truth)
  const allEvents = useMemo<CalendarEvent[]>(() => {
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

  // Month view: cap per-day density with aggregate chip
  const events = useMemo<CalendarEvent[]>(() => {
    if (view !== Views.MONTH) return allEvents
    const byDay = new Map<string, CalendarEvent[]>()
    for (const ev of allEvents) {
      const key = format(ev.start as Date, 'yyyy-MM-dd')
      const arr = byDay.get(key) ?? []
      arr.push(ev)
      byDay.set(key, arr)
    }
    const out: CalendarEvent[] = []
    for (const [dayKey, dayEvents] of byDay) {
      if (dayEvents.length <= MONTH_EVENT_CAP) {
        out.push(...dayEvents)
        continue
      }
      // Show first 2 chips; "+N 更多" opens a full day list sheet.
      const head = dayEvents.slice(0, MONTH_EVENT_CAP - 1)
      const rest = dayEvents.slice(MONTH_EVENT_CAP - 1)
      out.push(...head)
      const first = rest[0]
      out.push({
        title: `+${rest.length} 更多`,
        start: first.start,
        end: first.end,
        resource: {
          ...first.resource,
          title: `+${rest.length} 条任务`,
          __aggregate: true,
          __aggregateDay: dayKey,
          // Full day ids — sheet shows every task that day, not only "rest".
          __aggregateIds: dayEvents.map((e) => e.resource.task_id),
          __conflict: dayEvents.some((e) => e.resource.__conflict),
        },
      })
    }
    return out
  }, [allEvents, view])

  const daySheetTasks = useMemo(() => {
    if (!daySheet) return []
    return tasks
      .filter((t) => (t.effective_date || '').slice(0, 10) === daySheet)
      .slice()
      .sort((a, b) => {
        const ta = a.scheduled_at || a.created || ''
        const tb = b.scheduled_at || b.created || ''
        return ta.localeCompare(tb)
      })
  }, [daySheet, tasks])

  const daysWithEvents = useMemo(() => {
    const set = new Set<string>()
    for (const t of tasks) {
      if (t.effective_date) set.add(t.effective_date.slice(0, 10))
    }
    return set
  }, [tasks])

  const [menu, setMenu] = useState<{ taskId: string; x: number; y: number } | null>(null)
  const openMenu = useCallback((taskId: string, x: number, y: number) => {
    setMenu({ taskId, x, y })
  }, [])

  const draggableAccessor = (event: Event) => {
    const r = (event as unknown as CalendarEvent).resource
    if (r.__aggregate) return false
    return r.status === 'pending' || r.status === 'scheduled'
  }

  const countPublishPeersOnDay = useCallback(
    (day: string, excludeId: string) => {
      return tasks.filter((row) => {
        if (row.task_id === excludeId) return false
        if ((row.effective_date || '').slice(0, 10) !== day) return false
        return row.status === 'pending' || row.status === 'scheduled'
      }).length
    },
    [tasks],
  )

  const commitReschedule = useCallback(
    async (t: CalendarEventResource, newIso: string, newDay: string) => {
      const liveKey = [
        'calendar-tasks',
        start,
        end,
        platformFilter.join(','),
        accountFilter.join(','),
      ] as const

      await queryClient.cancelQueries({ queryKey: liveKey })
      const previous = queryClient.getQueryData<CalendarTasksData>(liveKey)
      if (previous) {
        queryClient.setQueryData<CalendarTasksData>(liveKey, {
          ...previous,
          tasks: previous.tasks.map((row) =>
            row.task_id === t.task_id
              ? {
                  ...row,
                  scheduled_at: newIso,
                  effective_date: newDay,
                }
              : row,
          ),
        })
      }

      try {
        await api.tasks.reschedule(t.task_id, newIso)
        addToast(
          `已改期至 ${format(new Date(newIso), 'yyyy-MM-dd HH:mm')}`,
          'success',
        )
      } catch (e: any) {
        if (previous) queryClient.setQueryData(liveKey, previous)
        addToast(e?.response?.data?.message ?? '改期失败', 'error')
      } finally {
        void queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
      }
    },
    [accountFilter, addToast, end, platformFilter, queryClient, start],
  )

  const handleEventDrop = async ({
    event,
    start: dropStart,
  }: {
    event: Event
    start: Date
  }) => {
    const t = (event as unknown as CalendarEvent).resource
    if (t.__aggregate) return
    const newIso = buildScheduledAt(t, new Date(dropStart))
    const newDay = format(new Date(dropStart), 'yyyy-MM-dd')
    const peers = countPublishPeersOnDay(newDay, t.task_id)
    // Dropping onto a day that already has publish-eligible tasks → warn.
    if (peers + 1 >= CONFLICT_THRESHOLD) {
      setDropConfirm({
        task: t,
        start: new Date(dropStart),
        newIso,
        newDay,
        peerCount: peers,
      })
      // Revert visual by invalidating — rbc already moved optimistically in UI
      // until we confirm; we re-fetch so the chip snaps back if user cancels.
      void queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
      return
    }
    await commitReschedule(t, newIso, newDay)
  }

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

  const availableAccounts = useMemo<string[]>(() => {
    const set = new Set<string>()
    for (const t of tasks) if (t.account) set.add(t.account)
    return [...set].sort()
  }, [tasks])

  const eventPropGetter = (event: CalendarEvent) => {
    const r = event.resource
    if (r.__aggregate) {
      return {
        style: {
          backgroundColor: 'color-mix(in oklab, var(--muted) 80%, transparent)',
          borderLeft: '3px solid var(--primary)',
          color: 'var(--foreground)',
          fontSize: '11px',
          padding: '2px 6px',
          borderRadius: '4px',
          cursor: 'pointer',
        },
      }
    }
    const bg = platformHex(r.platform)
    const conflict = !!r.__conflict
    return {
      style: {
        backgroundColor: bg,
        borderLeft: conflict ? `3px solid #fbbf24` : `3px solid ${bg}`,
        boxShadow: conflict ? 'inset 0 0 0 1px rgba(251,191,36,0.9)' : undefined,
        color: '#ffffff',
        fontSize: '11px',
        padding: '2px 6px',
        borderRadius: '4px',
        cursor: 'grab',
      },
    }
  }

  const dayPropGetter = useCallback(
    (day: Date) => {
      const key = format(day, 'yyyy-MM-dd')
      const classes: string[] = []
      if (isToday(day)) classes.push('sau-cal-today')
      if (daysWithEvents.has(key)) classes.push('sau-cal-has-events')
      if (highlightDay === key) classes.push('sau-cal-highlight')
      return { className: classes.join(' ') }
    },
    [daysWithEvents, highlightDay],
  )

  const goToday = () => {
    setDate(new Date())
    setHighlightDay(format(new Date(), 'yyyy-MM-dd'))
  }
  const navBack = () => {
    setDate((d) =>
      view === Views.WEEK ? subWeeks(d, 1) : subMonths(d, 1),
    )
  }
  const navForward = () => {
    setDate((d) =>
      view === Views.WEEK ? addWeeks(d, 1) : addMonths(d, 1),
    )
  }

  const jumpToConflictDay = (dayStr: string) => {
    const d = new Date(`${dayStr}T12:00:00`)
    setDate(d)
    setHighlightDay(dayStr)
    if (view === Views.AGENDA) setView(Views.MONTH)
  }

  const handleSelectEvent = (event: Event) => {
    const r = (event as unknown as CalendarEvent).resource
    if (r.__aggregate) {
      const day =
        r.__aggregateDay ||
        (r.effective_date || '').slice(0, 10) ||
        format((event as CalendarEvent).start as Date, 'yyyy-MM-dd')
      openDaySheet(day)
      return
    }
    setSelectedTaskId(r.task_id)
  }

  /**
   * Empty-slot interaction (anti-misclick):
   *  - doubleClick → go publish with that day
   *  - single click on a day with tasks → open day sheet
   *  - single click on empty day → confirm dialog (not instant navigate)
   */
  const handleSelectSlot = (slot: SlotInfo) => {
    const day = format(slot.start, 'yyyy-MM-dd')
    setHighlightDay(day)

    if (slot.action === 'doubleClick') {
      goPublishWithDay(day)
      return
    }

    if (daysWithEvents.has(day)) {
      openDaySheet(day)
      return
    }

    setCreateConfirmDay(day)
  }

  const periodLabel = useMemo(() => {
    if (view === Views.WEEK) return format(date, 'yyyy 年 第 w 周')
    if (view === Views.AGENDA) return format(date, 'yyyy 年 M 月 · 议程')
    return format(date, 'yyyy 年 M 月')
  }, [date, view])

  const kpis = useMemo(() => {
    const by = summary?.by_status ?? {}
    const success =
      (by.success ?? 0) + (by.done ?? 0) + (by.completed ?? 0)
    const failed = (by.failed ?? 0) + (by.error ?? 0)
    const pending = (by.pending ?? 0) + (by.running ?? 0)
    const scheduled = by.scheduled ?? 0
    return {
      total: summary?.total ?? 0,
      success,
      failed,
      pending,
      scheduled,
    }
  }, [summary])

  const calendarHeight =
    'min(max(480px, 72vh), 800px)'

  return (
    <PageWrapper spacing="sm">
      <PageHeader
        title="内容日历"
        description="按时间维度查看排期与发布节奏 · 拖拽改期 · 冲突预警"
        icon={<CalendarIcon className="h-5 w-5 text-muted-foreground" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
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
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const day = format(date, 'yyyy-MM-dd')
                navigate({
                  to: `${ROUTES.dashboard.publish}?schedule=${day}` as never,
                })
              }}
            >
              <Plus className="h-4 w-4" />
              新建排期
            </Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard
          label="本窗任务"
          value={isLoading ? null : kpis.total}
          icon={<ListTodo className="size-4" />}
        />
        <KpiCard
          label="已排期"
          value={isLoading ? null : kpis.scheduled}
          icon={<CalendarPlus className="size-4" />}
          tone="info"
        />
        <KpiCard
          label="待执行"
          value={isLoading ? null : kpis.pending}
          icon={<Clock className="size-4" />}
          tone="warning"
        />
        <KpiCard
          label="已发布"
          value={isLoading ? null : kpis.success}
          icon={<CheckCircle2 className="size-4" />}
          tone="success"
        />
        <KpiCard
          label="失败"
          value={isLoading ? null : kpis.failed}
          icon={<XCircle className="size-4" />}
          tone="error"
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* Unified toolbar */}
      <Card size="sm">
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
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
            </div>
            <span
              className="font-mono text-xs text-muted-foreground tabular-nums sm:text-sm"
              data-testid="calendar-current-period"
            >
              {periodLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              value={[view === Views.WEEK ? 'week' : view === Views.AGENDA ? 'agenda' : 'month']}
              onValueChange={(values) => {
                const next = values[values.length - 1]
                if (next === 'week') setView(Views.WEEK)
                else if (next === 'agenda') setView(Views.AGENDA)
                else if (next === 'month') setView(Views.MONTH)
              }}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="视图切换"
            >
              <ToggleGroupItem value="week">周</ToggleGroupItem>
              <ToggleGroupItem value="month">月</ToggleGroupItem>
              <ToggleGroupItem value="agenda">议程</ToggleGroupItem>
            </ToggleGroup>

            <FilterPopover
              platformFilter={platformFilter}
              accountFilter={accountFilter}
              availableAccounts={availableAccounts}
              onPlatformToggle={(v) =>
                setPlatformFilter((cur) =>
                  cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                )
              }
              onAccountToggle={(v) =>
                setAccountFilter((cur) =>
                  cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                )
              }
              onClear={() => {
                setPlatformFilter([])
                setAccountFilter([])
              }}
            />
          </div>
        </CardContent>

        {(platformFilter.length > 0 || accountFilter.length > 0) && (
          <>
            <Separator />
            <CardContent className="flex flex-wrap items-center gap-1.5 pt-0">
              <span className="text-[11px] text-muted-foreground">已选筛选</span>
              {platformFilter.map((p) => (
                <Badge key={p} variant="secondary" className="gap-1 font-normal">
                  <PlatformIcon platform={p} className="size-3" />
                  {PLATFORMS.find((x) => x.value === p)?.label ?? p}
                  <button
                    type="button"
                    className="ml-0.5 rounded-sm hover:bg-foreground/10"
                    aria-label={`移除 ${p}`}
                    onClick={() =>
                      setPlatformFilter((cur) => cur.filter((x) => x !== p))
                    }
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              {accountFilter.map((a) => (
                <Badge key={a} variant="outline" className="gap-1 font-normal">
                  {a}
                  <button
                    type="button"
                    className="ml-0.5 rounded-sm hover:bg-foreground/10"
                    aria-label={`移除账号 ${a}`}
                    onClick={() =>
                      setAccountFilter((cur) => cur.filter((x) => x !== a))
                    }
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setPlatformFilter([])
                  setAccountFilter([])
                }}
              >
                清除全部
              </Button>
            </CardContent>
          </>
        )}
      </Card>

      {/* Conflict alert — sticky, clickable */}
      {conflictInfo.conflictDays.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertTitle>同日多发可能触发平台限流</AlertTitle>
          <AlertDescription>
            <p className="mb-2">以下日期排期过密，点击日期可跳转并高亮：</p>
            <div className="flex flex-wrap gap-1.5">
              {conflictInfo.conflictDays.map((d) => (
                <Button
                  key={d.date}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 border-amber-500/40 bg-amber-500/10 text-xs hover:bg-amber-500/20"
                  onClick={() => jumpToConflictDay(d.date)}
                >
                  <span className="font-mono tabular-nums">{d.date}</span>
                  <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                    {d.count} 条
                  </Badge>
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Platform density bar */}
      {summary && Object.keys(summary.by_platform).length > 0 && (
        <PlatformDensityBar byPlatform={summary.by_platform} />
      )}

      {/* Calendar surface — single grid; empty is a banner, not a second layout */}
      <Card className="card-refined overflow-hidden p-0 gap-0">
        {isError ? (
          <div className="p-6">
            <Alert variant="error">
              <AlertTriangle className="size-4" />
              <AlertTitle>日历数据加载失败</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {(error as Error)?.message ||
                    '无法获取排期数据，请检查后端或网络后重试。'}
                </span>
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : isLoading ? (
          <CalendarSkeleton />
        ) : (
          <EventMenuContext.Provider value={{ open: openMenu }}>
            <DayListContext.Provider value={{ open: openDaySheet }}>
              {!isLoading && tasks.length === 0 ? (
                <div className="border-b border-border/50 bg-muted/20 px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2 text-sm">
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium">本时段暂无排期</p>
                        <p className="text-xs text-muted-foreground">
                          单击空日期确认新建 · 双击直接去发布 · 或点下方按钮
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => goPublishWithDay(format(date, 'yyyy-MM-dd'))}
                      >
                        <Plus className="size-4" />
                        去发布
                      </Button>
                      {(platformFilter.length > 0 || accountFilter.length > 0) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPlatformFilter([])
                            setAccountFilter([])
                          }}
                        >
                          清除筛选
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="sau-cal-shell p-1 sm:p-2">
                <BigCalendar
                  localizer={localizer}
                  events={events}
                  startAccessor="start"
                  endAccessor="end"
                  view={view}
                  onView={setView}
                  date={date}
                  onNavigate={setDate}
                  views={[Views.MONTH, Views.WEEK, Views.AGENDA]}
                  toolbar={false}
                  eventPropGetter={eventPropGetter}
                  dayPropGetter={dayPropGetter}
                  onSelectEvent={handleSelectEvent}
                  onSelectSlot={handleSelectSlot}
                  selectable
                  draggableAccessor={draggableAccessor}
                  onEventDrop={handleEventDrop}
                  slotDuration={30 * 60 * 1000}
                  components={{ event: CalendarEventCell }}
                  popup
                  style={{ height: calendarHeight }}
                />
              </div>
            </DayListContext.Provider>
            {menu && (
              <EventContextMenu
                taskId={menu.taskId}
                x={menu.x}
                y={menu.y}
                onClose={() => setMenu(null)}
                onCopy={(target) => {
                  void handleCopy(menu.taskId, target)
                  setMenu(null)
                }}
              />
            )}
          </EventMenuContext.Provider>
        )}
      </Card>

      <DayTaskSheet
        day={daySheet}
        tasks={daySheetTasks}
        open={daySheet !== null}
        onOpenChange={(open) => {
          if (!open) setDaySheet(null)
        }}
        onSelectTask={(taskId) => {
          setSelectedTaskId(taskId)
        }}
        onGoToTasks={(taskId) => {
          navigate({
            to: `${ROUTES.dashboard.tasks}?focus=${taskId}` as never,
          })
        }}
        onCreateSchedule={() => {
          if (daySheet) goPublishWithDay(daySheet)
        }}
      />

      <AlertDialog
        open={createConfirmDay !== null}
        onOpenChange={(open) => {
          if (!open) setCreateConfirmDay(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>在该日新建排期？</AlertDialogTitle>
            <AlertDialogDescription>
              {createConfirmDay
                ? `${createConfirmDay} 尚无任务。将跳转到发布中心并预填定时时间（默认 09:00）。也可双击空白日期直接创建。`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (createConfirmDay) goPublishWithDay(createConfirmDay)
                setCreateConfirmDay(null)
              }}
            >
              去发布
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dropConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setDropConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              改期到冲突日？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dropConfirm ? (
                <>
                  <span className="font-mono tabular-nums text-foreground">
                    {dropConfirm.newDay}
                  </span>{' '}
                  已有 {dropConfirm.peerCount} 条待发布/已排期任务。再放入「
                  {dropConfirm.task.title || dropConfirm.task.task_id.slice(-6)}
                  」后共 {dropConfirm.peerCount + 1} 条，可能触发平台限流。
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDropConfirm(null)
                void queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] })
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!dropConfirm) return
                const { task, newIso, newDay } = dropConfirm
                setDropConfirm(null)
                void commitReschedule(task, newIso, newDay)
              }}
            >
              仍要改期
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Suspense fallback={null}>
        <TaskDrawer
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onRetry={handleRetryFromDrawer}
          retrying={null}
          seedTask={selectedSeedTask}
        />
      </Suspense>
    </PageWrapper>
  )
}

// ── KPI card ─────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  tone,
  className,
}: {
  label: string
  value: number | null
  icon: ReactNode
  tone?: 'success' | 'error' | 'warning' | 'info'
  className?: string
}) {
  const iconTone =
    tone === 'success'
      ? 'text-emerald-500 bg-emerald-500/10'
      : tone === 'error'
        ? 'text-rose-500 bg-rose-500/10'
        : tone === 'warning'
          ? 'text-amber-500 bg-amber-500/10'
          : tone === 'info'
            ? 'text-sky-500 bg-sky-500/10'
            : 'text-muted-foreground bg-muted'
  return (
    <Card size="sm" className={className}>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-1">
        <span
          className={cn(
            'flex size-8 items-center justify-center rounded-lg',
            iconTone,
          )}
        >
          {icon}
        </span>
        <CardDescription className="text-[11px] uppercase tracking-wide">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {value === null ? (
          <Skeleton className="h-7 w-12" />
        ) : (
          <CardTitle
            className="text-2xl font-bold tabular-nums"
            data-testid={label === '本窗任务' ? 'calendar-summary-total' : undefined}
          >
            {value}
          </CardTitle>
        )}
      </CardContent>
    </Card>
  )
}

// ── Platform density ─────────────────────────────────────────────────────

function PlatformDensityBar({
  byPlatform,
}: {
  byPlatform: Record<string, number>
}) {
  const entries = Object.entries(byPlatform)
    .filter(([p]) => p !== '(none)')
    .sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1
  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>平台分布</span>
          <span className="tabular-nums" data-testid="calendar-summary-platforms">
            {entries.length} 平台
          </span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {entries.map(([p, n]) => (
            <div
              key={p}
              title={`${PLATFORMS.find((x) => x.value === p)?.label ?? p}: ${n}`}
              style={{
                width: `${(n / total) * 100}%`,
                backgroundColor: platformHex(p) || 'var(--muted-foreground)',
              }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {entries.slice(0, 8).map(([p, n]) => (
            <span key={p} className="inline-flex items-center gap-1 text-muted-foreground">
              <span
                className="size-2 rounded-sm"
                style={{ backgroundColor: platformHex(p) }}
              />
              <span className="tabular-nums text-foreground">{n}</span>
              {PLATFORMS.find((x) => x.value === p)?.label ?? p}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Filter popover ───────────────────────────────────────────────────────

function FilterPopover({
  platformFilter,
  accountFilter,
  availableAccounts,
  onPlatformToggle,
  onAccountToggle,
  onClear,
}: {
  platformFilter: string[]
  accountFilter: string[]
  availableAccounts: string[]
  onPlatformToggle: (v: string) => void
  onAccountToggle: (v: string) => void
  onClear: () => void
}) {
  const count = platformFilter.length + accountFilter.length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="size-3.5" />
          筛选
          {count > 0 ? (
            <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 tabular-nums">
              {count}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">筛选条件</p>
          {count > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
              清除
            </Button>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            平台
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((opt) => {
              const active = platformFilter.includes(opt.value)
              return (
                <label
                  key={opt.value}
                  className={cn(
                    'inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                    active
                      ? 'border-foreground/30 bg-foreground/5 text-foreground'
                      : 'border-border/40 text-muted-foreground hover:border-foreground/20',
                  )}
                >
                  <Checkbox
                    checked={active}
                    onCheckedChange={() => onPlatformToggle(opt.value)}
                    className="size-3.5"
                  />
                  <span
                    className="inline-flex size-3.5 items-center justify-center rounded-sm"
                    style={{ backgroundColor: platformHex(opt.value) }}
                  >
                    <PlatformIcon platform={opt.value} variant="dark" className="size-2.5" />
                  </span>
                  {opt.label}
                </label>
              )
            })}
          </div>
        </div>
        {availableAccounts.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              账号
            </p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {availableAccounts.map((a) => {
                const active = accountFilter.includes(a)
                return (
                  <label
                    key={a}
                    className={cn(
                      'inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                      active
                        ? 'border-foreground/30 bg-foreground/5 text-foreground'
                        : 'border-border/40 text-muted-foreground hover:border-foreground/20',
                    )}
                  >
                    <Checkbox
                      checked={active}
                      onCheckedChange={() => onAccountToggle(a)}
                      className="size-3.5"
                    />
                    {a}
                  </label>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">当前窗口暂无账号数据</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ── Event cell ───────────────────────────────────────────────────────────

function CalendarEventCell({ event }: { event: CalendarEvent }) {
  const menu = useContext(EventMenuContext)
  const dayList = useContext(DayListContext)
  const r = event.resource
  const conflict = !!r.__conflict
  const time = formatEventTime(r)

  if (r.__aggregate) {
    const day =
      r.__aggregateDay ||
      (r.effective_date || '').slice(0, 10) ||
      format(event.start as Date, 'yyyy-MM-dd')
    return (
      <button
        type="button"
        className="flex w-full items-center gap-1 truncate text-left font-medium underline-offset-2 hover:underline"
        title={`查看 ${day} 全部任务`}
        onClick={(e) => {
          // Ensure click works even if rbc onSelectEvent is flaky on synthetic chips.
          e.stopPropagation()
          dayList?.open(day)
        }}
      >
        <ListTodo className="size-3 shrink-0 opacity-80" />
        <span className="truncate">{event.title}</span>
      </button>
    )
  }

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      onContextMenu={(e) => {
        e.preventDefault()
        menu?.open(r.task_id, e.clientX, e.clientY)
      }}
      title={
        conflict
          ? `${r.title} · 同日多发 ${r.__conflictCount} 条，可能触发平台限流`
          : `${r.title}${time ? ` · ${time}` : ''} · ${STATUS_LABEL[r.status] ?? r.status}`
      }
    >
      <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-black/20">
        <PlatformIcon platform={r.platform} variant="dark" className="size-2.5" />
      </span>
      {time ? (
        <span className="shrink-0 font-mono text-[10px] opacity-90 tabular-nums">
          {time}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{event.title}</span>
      <span
        className={cn('size-1.5 shrink-0 rounded-full', statusDotClass(r.status))}
        title={STATUS_LABEL[r.status] ?? r.status}
      />
      {conflict ? (
        <AlertTriangle className="size-3 shrink-0 text-amber-200" />
      ) : null}
    </div>
  )
}

// ── Day task list sheet ("+N 更多") — virtualized for dense days ─────────

const DAY_ROW_ESTIMATE = 76

function DayTaskSheet({
  day,
  tasks,
  open,
  onOpenChange,
  onSelectTask,
  onGoToTasks,
  onCreateSchedule,
}: {
  day: string | null
  tasks: CalendarTaskItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTask: (taskId: string) => void
  onGoToTasks: (taskId: string) => void
  onCreateSchedule?: () => void
}) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setQuery('')
  }, [open, day])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) => {
      const label = PLATFORMS.find((p) => p.value === t.platform)?.label ?? t.platform
      return (
        t.title.toLowerCase().includes(q) ||
        t.account.toLowerCase().includes(q) ||
        t.platform.toLowerCase().includes(q) ||
        label.toLowerCase().includes(q) ||
        t.task_id.toLowerCase().includes(q) ||
        (STATUS_LABEL[t.status] ?? t.status).toLowerCase().includes(q)
      )
    })
  }, [tasks, query])

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => DAY_ROW_ESTIMATE,
    overscan: 12,
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="shrink-0 border-b border-border/60 px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <ListTodo className="size-4 text-muted-foreground" />
            {day ? `${day} 的任务` : '当日任务'}
          </SheetTitle>
          <SheetDescription>
            共 {tasks.length} 条
            {query.trim() ? ` · 筛选后 ${filtered.length} 条` : ''}
            。点击条目查看详情。
          </SheetDescription>
          <div className="relative pt-2">
            <Search className="pointer-events-none absolute left-2.5 top-[calc(50%+4px)] size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题 / 账号 / 平台 / 状态"
              className="h-8 pl-8"
            />
          </div>
          {onCreateSchedule ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full gap-1.5"
              onClick={onCreateSchedule}
            >
              <Plus className="size-3.5" />
              在此日新建排期
            </Button>
          ) : null}
        </SheetHeader>

        {filtered.length === 0 ? (
          <Empty className="min-h-[200px] border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>{query ? '无匹配任务' : '这一天没有任务'}</EmptyTitle>
              <EmptyDescription>
                {query ? '试试其他关键词' : '可在此日新建排期，或切换日期'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-auto px-2 py-2"
            style={{ maxHeight: 'calc(100vh - 12rem)' }}
          >
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const t = filtered[virtualRow.index]
                if (!t) return null
                const time = formatEventTime(t)
                const status = STATUS_LABEL[t.status] ?? t.status
                return (
                  <div
                    key={t.task_id}
                    className="absolute left-0 top-0 w-full px-1"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="flex h-full flex-col justify-center rounded-lg border border-transparent px-1 py-1 hover:border-border/60 hover:bg-muted/40">
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 px-1 py-1 text-left"
                        onClick={() => onSelectTask(t.task_id)}
                      >
                        <span
                          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md"
                          style={{
                            backgroundColor:
                              platformHex(t.platform) || 'var(--muted)',
                          }}
                        >
                          <PlatformIcon
                            platform={t.platform}
                            variant="dark"
                            className="size-4"
                          />
                        </span>
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="line-clamp-1 text-sm font-medium leading-snug">
                            {t.title || `${t.platform}·${t.task_id.slice(-6)}`}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {time ? (
                              <span className="font-mono tabular-nums">{time}</span>
                            ) : null}
                            <span className="truncate max-w-[8rem]">
                              {t.account || '—'}
                            </span>
                            <Badge
                              variant={
                                t.status === 'failed' || t.status === 'error'
                                  ? 'error'
                                  : t.status === 'success' ||
                                      t.status === 'done' ||
                                      t.status === 'completed'
                                    ? 'success'
                                    : t.status === 'scheduled' ||
                                        t.status === 'pending'
                                      ? 'warning'
                                      : 'secondary'
                              }
                              className="h-4 px-1 text-[10px] font-normal"
                            >
                              {status}
                            </Badge>
                          </span>
                        </span>
                        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      </button>
                      <div className="flex justify-end px-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-muted-foreground"
                          onClick={() => onGoToTasks(t.task_id)}
                        >
                          在任务页打开
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Context menu ─────────────────────────────────────────────────────────

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
        <button
          key={t.label}
          type="button"
          role="menuitem"
          className={itemCls}
          onClick={() => onCopy(t.date)}
        >
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

// ── Skeleton ─────────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-8 w-full" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, col) => (
            <Skeleton key={col} className="h-20 w-full rounded-md" />
          ))}
        </div>
      ))}
    </div>
  )
}

