import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { TaskItem } from '../api/client'
import {
  STATUS_CHIPS,
  type BatchProgress,
  type StatusType,
} from '../features/tasks/shared'
import type { AddTaskFormState } from '../features/tasks/AddTaskDialog'

/**
 * useTaskTableState — table read-model for TasksPage.
 *
 * Extracts the table-level state, derived values, and orchestrating
 * effects out of TasksPage so the page component becomes a thin
 * composer. Owns:
 *
 *   - The full set of table-shape useState slices
 *     (keyword, status, selectedIds, batchProgress, batchDetailOpen,
 *      drawerTaskId, retrying, manualRefreshing, addModalOpen, addForm)
 *   - The 300ms-debounce effect that feeds `debouncedKeyword`
 *   - The `filtered` / `counts` / `chipOptions` derived values
 *   - The URL `?focus=` deep-link effect that opens
 *     `drawerTaskId` when a matching task is present
 *   - The selection-cleanup rAF effect (drops selectedIds that
 *     have been filtered out)
 *
 * Does NOT own action handlers — those live in `useTaskMutations`
 * and `useTaskHotkeys`.
 */
export function useTaskTableState(tasks: TaskItem[]) {
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedKeyword(keyword)
    }, 300)
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [keyword])

  const [status, setStatus] = useState<StatusType>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchProgress, setBatchProgress] = useState<BatchProgress>(null)
  const [batchDetailOpen, setBatchDetailOpen] = useState(false)
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addForm, setAddForm] = useState<AddTaskFormState>({
    platform: '',
    action: '',
    account: '',
    title: '',
  })

  // ── pagination ─────────────────────────────────────────────────────
  // Client-side paging over `filtered`. Resetting to page 1 whenever
  // the keyword / status filter changes keeps the user on the first
  // slice of the new result set (rather than a now-empty later page).
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // ── URL `?focus=` deep-link effect ──────────────────────────────────
  // CommandPalette routes to `/tasks?focus=<taskId>` so the row-level
  // drawer opens immediately when the user picks a search hit. The
  // effect strips the param back out of the URL after consuming it
  // so a hard-reload doesn't re-fire the open (`replace` history).
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId) return
    if (tasks.length === 0) return
    if (tasks.some((t) => t.task_id === focusId)) {
      const id = focusId
      requestAnimationFrame(() => setDrawerTaskId(id))
    }
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    setSearchParams(next, { replace: true })
  }, [searchParams, tasks, setSearchParams])

  // ── Derived read-model ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const kw = debouncedKeyword.trim().toLowerCase()
    return tasks
      .filter((item) => {
        if (status !== 'all' && (item.status ?? '') !== status) return false
        if (!kw) return true
        return (
          (item.task_id ?? '').toLowerCase().includes(kw) ||
          (item.platform ?? '').toLowerCase().includes(kw) ||
          (item.action ?? '').toLowerCase().includes(kw) ||
          (item.account ?? '').toLowerCase().includes(kw)
        )
      })
      .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
  }, [tasks, debouncedKeyword, status])

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: 0 }
    tasks.forEach((item) => {
      map.all += 1
      map[item.status ?? 'pending'] = (map[item.status ?? 'pending'] || 0) + 1
    })
    return map
  }, [tasks])

  // RESOLVE LABELS VIA t() BEFORE PASSING TO <StatusTabs> —
  // `chipOptions` exposes `labelKey + labelFallback` from the
  // module-level STATUS_CHIPS manifest (no React coupling). The
  // consumer (TasksPage) calls `.map(c => ({ ...c, label: t(c.labelKey,
  // c.labelFallback) }))` to resolve labels at render time. Do NOT
  // add `label: string` here — that would re-introduce a hardcoded
  // label and break the i18n contract (see docs/dev/adr-i18n-invariant
  // .md §2).
  const chipOptions = useMemo(
    () => STATUS_CHIPS.map((c) => ({ ...c, count: counts[c.value] ?? 0 })),
    [counts],
  )

  // ── paged read-model ──────────────────────────────────────────────
  // Slice `filtered` to the active page. `totalPages` is clamped to ≥1
  // so an empty result still renders a single (inactive) page.
  const totalFiltered = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pagedFiltered = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  )

  // ── Selection cleanup on filter change ────────────────────────────
  // Uses `filteredRef` so we read the latest `filtered` AT the rAF
  // commit frame, not at the moment the effect's deps last changed.
  // This handles ordering: when both `debouncedKeyword` and `status`
  // flip together, we want both reflected in the cleanup, not just
  // the most recent change.
  const filteredRef = useRef(filtered)
  useEffect(() => {
    filteredRef.current = filtered
  }, [filtered])

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setSelectedIds((prev) => {
        const visible = new Set(filteredRef.current.map((t) => t.task_id))
        let anyDropped = false
        const next = new Set<string>()
        prev.forEach((id) => {
          if (visible.has(id)) next.add(id)
          else anyDropped = true
        })
        return anyDropped ? next : prev
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [debouncedKeyword, status])

  // ── reset to first page when the result set changes ───────────────
  useEffect(() => {
    setPage(1)
  }, [debouncedKeyword, status])

  return {
    // raw state
    keyword,
    status,
    selectedIds,
    batchProgress,
    batchDetailOpen,
    drawerTaskId,
    retrying,
    manualRefreshing,
    addModalOpen,
    addForm,
    // setters (passed through to useTaskMutations)
    setKeyword,
    setStatus,
    setSelectedIds,
    setBatchProgress,
    setBatchDetailOpen,
    setDrawerTaskId,
    setRetrying,
    setManualRefreshing,
    setAddModalOpen,
    setAddForm,
    // refs
    searchInputRef,
    // derived read-model
    filtered,
    counts,
    chipOptions,
    // pagination
    pagedFiltered,
    totalFiltered,
    totalPages,
    page: safePage,
    pageSize,
    setPage,
    setPageSize,
  }
}
