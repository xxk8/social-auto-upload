import { useCallback, useLayoutEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type TaskItem } from '../api/client'
import type { AddTaskFormState } from '../features/tasks/AddTaskDialog'
import {
  type BatchProgress,
  type BatchResultItem,
  type StatusType,
} from '../features/tasks/shared'
import {
  BATCH_CONCURRENCY,
  runWithConcurrency,
  shortenId,
} from '../lib/features'
import { useToast } from '@/Components/ui/toast'

const TASKS_QUERY_KEY = ['tasks'] as const

/** Predicate: row is in a deletable terminal status. */
const canDelete = (s?: string) =>
  s === 'success' || s === 'failed' || s === 'error' || s === 'scheduled'
/** Predicate: row is in a retryable terminal status. */
const canRetry = (s?: string) => s === 'failed' || s === 'error'

export interface UseTaskMutationsInput {
  // ── table state (kept as live values for React reads; handlers read
  //   from ref mirrors so deps arrays stay minimal) ──
  filtered: TaskItem[]
  selectedIds: Set<string>
  drawerTaskId: string | null
  addForm: AddTaskFormState

  // ── setters ──
  setSelectedIds: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  setBatchProgress: (next: BatchProgress | ((prev: BatchProgress) => BatchProgress)) => void
  setBatchDetailOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  setDrawerTaskId: (next: string | null | ((prev: string | null) => string | null)) => void
  setRetrying: (next: string | null | ((prev: string | null) => string | null)) => void
  setManualRefreshing: (next: boolean | ((prev: boolean) => boolean)) => void
  setAddModalOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  setAddForm: (next: AddTaskFormState | ((prev: AddTaskFormState) => AddTaskFormState)) => void
  setStatus: (next: StatusType | ((prev: StatusType) => StatusType)) => void

  // ── server ──
  /** refetch() from useTasks() — wrapped into `refresh` below. */
  refetchTasks: () => Promise<unknown>
}

/**
 * useTaskMutations — action layer for TasksPage.
 *
 * Extracts every callback that talks to the backend or transitions
 * server-fed state out of the page. Uses the **useLatest ref-mirror
 * pattern**: each handler reads `filtered`, `selectedIds`,
 * `drawerTaskId`, and `addForm` from a useRef that's reassigned on
 * every render — this keeps handler identities stable so child
 * components don't see prop churn, AND the useCallback deps arrays
 * stay minimal (just `qc + addToast + refetchTasks` + the stable
 * setters themselves).
 */
export function useTaskMutations(input: UseTaskMutationsInput) {
  const qc = useQueryClient()
  const { addToast } = useToast()

  const {
    filtered,
    selectedIds,
    drawerTaskId,
    addForm,
    setSelectedIds,
    setBatchProgress,
    setBatchDetailOpen,
    setDrawerTaskId,
    setRetrying,
    setManualRefreshing,
    setAddModalOpen,
    setAddForm,
    setStatus,
    refetchTasks,
  } = input

  // ── useLatest mirrors ──
  // Each handler captures `X.current` rather than the closure's
  // `X` value, so deps arrays don't need to list every state slice
  // they read. `useLayoutEffect` syncs each ref post-render so:
  //   1. The `react-hooks/refs` ESLint rule accepts it (no
  //      render-phase mutation; React-19 strict-mode double-invoke
  //      and concurrent rendering see consistent mirrors).
  //   2. Event handlers fired after the commit are guaranteed to
  //      read the latest value (`useLayoutEffect` runs synchronously
  //      after DOM mutations, before browser paint).
  // The single combined effect keeps the commit cost O(1) instead
  // of running 4 separate effects.
  const filteredRef = useRef(filtered)
  const selectedIdsRef = useRef(selectedIds)
  const drawerTaskIdRef = useRef(drawerTaskId)
  const addFormRef = useRef(addForm)
  useLayoutEffect(() => {
    filteredRef.current = filtered
    selectedIdsRef.current = selectedIds
    drawerTaskIdRef.current = drawerTaskId
    addFormRef.current = addForm
  }, [filtered, selectedIds, drawerTaskId, addForm])

  // ── refresh ──
  const refresh = useCallback(async () => {
    setManualRefreshing(true)
    try {
      await refetchTasks()
    } finally {
      setManualRefreshing(false)
    }
  }, [refetchTasks, setManualRefreshing])

  // ── drawer ──
  const handleOpenDrawer = useCallback(
    (record: TaskItem) => {
      setDrawerTaskId(record.task_id)
    },
    [setDrawerTaskId],
  )
  const handleCloseDrawer = useCallback(() => setDrawerTaskId(null), [setDrawerTaskId])

  // ── single-row retry / delete ──
  // Both read `drawerTaskId` via the ref mirror so they don't take
  // it as a dep — keeping the handler identity stable reduces
  // wasteful re-renders of `<TaskDrawer>` and `<TaskTable>`.
  const handleRetry = useCallback(
    async (record: TaskItem) => {
      setRetrying(record.task_id)
      try {
        const res = await api.retryTask(record.task_id)
        if (res.success && res.data?.task_id) {
          addToast(`已创建重试任务：${shortenId(res.data.task_id)}`, 'success')
          qc.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
        } else {
          addToast(res.message ?? '重试失败', 'error')
        }
      } catch {
        addToast('重试请求失败，请检查后端连接', 'error')
      } finally {
        setRetrying(null)
        if (drawerTaskIdRef.current === record.task_id) setDrawerTaskId(null)
      }
    },
    [qc, addToast, setRetrying, setDrawerTaskId],
  )

  const handleDelete = useCallback(
    async (taskId: string) => {
      try {
        const res = await api.deleteTask(taskId)
        if (res.success) {
          addToast('任务已删除', 'success')
          qc.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
        } else {
          addToast(res.message ?? '删除失败', 'error')
        }
      } catch {
        addToast('删除请求失败', 'error')
      } finally {
        if (drawerTaskIdRef.current === taskId) setDrawerTaskId(null)
      }
    },
    [qc, addToast, setDrawerTaskId],
  )

  // ── bulk clear all completed/failed/error ──
  const handleClear = useCallback(async () => {
    try {
      const res = await api.clearTasks(['success', 'failed', 'error'])
      if (res.success && res.data) {
        addToast(`已清理 ${res.data.deleted} 个任务`, 'success')
        qc.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
      } else {
        addToast('清理失败', 'error')
      }
    } catch {
      addToast('清理请求失败', 'error')
    }
  }, [qc, addToast])

  // ── add modal ──
  const handleOpenAddModal = useCallback(() => {
    setAddForm({ platform: '', action: '', account: '', title: '' })
    setAddModalOpen(true)
  }, [setAddForm, setAddModalOpen])

  const handleCloseAddModal = useCallback(
    () => setAddModalOpen(false),
    [setAddModalOpen],
  )

  const handleAddTaskChange = useCallback(
    (next: AddTaskFormState) => setAddForm(next),
    [setAddForm],
  )

  const handleAddTaskConfirm = useCallback(async () => {
    if (!addFormRef.current.platform || !addFormRef.current.action || !addFormRef.current.account) {
      addToast('请填写必填字段', 'warning')
      return
    }
    try {
      const res = await api.addTask({
        platform: addFormRef.current.platform,
        action: addFormRef.current.action,
        account: addFormRef.current.account,
        title: addFormRef.current.title || undefined,
      })
      if (res.success && res.data) {
        addToast(`任务已创建：${shortenId(res.data.task_id)}`, 'success')
        handleCloseAddModal()
        qc.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
      } else {
        addToast(res.message || '创建失败', 'error')
      }
    } catch {
      addToast('创建请求失败', 'error')
    }
  }, [qc, addToast, handleCloseAddModal])

  // ── selection helpers ──
  const handleToggleSelect = useCallback(
    (taskId: string, checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (checked) next.add(taskId)
        else next.delete(taskId)
        return next
      })
    },
    [setSelectedIds],
  )

  const handleToggleAll = useCallback(
    (checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (checked) filteredRef.current.forEach((t) => next.add(t.task_id))
        else filteredRef.current.forEach((t) => next.delete(t.task_id))
        return next
      })
    },
    [setSelectedIds],
  )

  const handleClearSelection = useCallback(
    () => setSelectedIds(new Set()),
    [setSelectedIds],
  )

  // ── status chip toggle ──
  // Row-level status chips inside <TaskTable> use TOGGLE semantics
  // (clicking the same chip again resets to 'all'), which differs from
  // the header <ChipBar>'s straight-set semantics — that's why this
  // lives in the mutation layer rather than being a one-liner on
  // the page. `setStatus` is injected through `input` so the closure
  // resolves it (forgetting to pass it was the original 3-hook
  // refactor's `setStatus is not defined` runtime bug).
  const handleStatusBadgeClick = useCallback(
    (next: StatusType) => {
      setStatus((prev) => (prev === next ? 'all' : next))
    },
    [setStatus],
  )

  // ── batch helpers ────────────────────────────────────────────────
  // runBatch is the shared concurrency runner used by both batch
  // retry + batch delete. It owns the per-step result sink so the
  // UI stream (`batchProgress.results`) updates the same way
  // regardless of action type.
  const runBatch = useCallback(
    async (
      type: 'retry' | 'delete',
      targets: TaskItem[],
      callApi: (t: TaskItem) => Promise<{ success: boolean; message?: string }>,
      successToast: string,
    ) => {
      const results: BatchResultItem[] = []
      setBatchProgress({ type, total: targets.length, current: 0, results: [] })
      setBatchDetailOpen(false)
      await runWithConcurrency(
        targets,
        BATCH_CONCURRENCY,
        async (t) => {
          try {
            const res = await callApi(t)
            return {
              taskId: t.task_id,
              success: res.success,
              message: res.message,
              status: t.status,
            }
          } catch (err) {
            return {
              taskId: t.task_id,
              success: false,
              message: err instanceof Error ? err.message : '请求失败',
              status: t.status,
            }
          }
        },
        (_idx, result) => {
          setBatchProgress((prev) =>
            prev
              ? { ...prev, current: prev.current + 1, results: [...prev.results, result] }
              : prev,
          )
          results.push(result)
        },
      )
      setSelectedIds((prev) => {
        const next = new Set(prev)
        targets.forEach((t) => next.delete(t.task_id))
        return next
      })
      const succeeded = results.filter((r) => r.success).length
      addToast(
        `${successToast}：${succeeded} 成功，${results.length - succeeded} 失败`,
        succeeded > 0 ? 'success' : 'error',
      )
      qc.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    },
    [addToast, qc, setBatchProgress, setBatchDetailOpen, setSelectedIds],
  )

  const handleBatchRetry = useCallback(() => {
    const retryable = filteredRef.current.filter(
      (t) => selectedIdsRef.current.has(t.task_id) && canRetry(t.status),
    )
    if (retryable.length === 0) {
      addToast('选中的任务中没有可重试的任务', 'warning')
      return
    }
    void runBatch(
      'retry',
      retryable,
      (t) => api.retryTask(t.task_id).then((r) => ({ success: r.success, message: r.message })),
      '批量重试完成',
    )
  }, [addToast, runBatch])

  const handleBatchDelete = useCallback(() => {
    const deletable = filteredRef.current.filter(
      (t) => selectedIdsRef.current.has(t.task_id) && canDelete(t.status),
    )
    if (deletable.length === 0) {
      addToast('选中的任务中没有可删除的任务', 'warning')
      return
    }
    void runBatch(
      'delete',
      deletable,
      (t) => api.deleteTask(t.task_id).then((r) => ({ success: r.success, message: r.message })),
      '批量删除完成',
    )
  }, [addToast, runBatch])

  return {
    refresh,
    handleOpenDrawer,
    handleCloseDrawer,
    handleRetry,
    handleDelete,
    handleClear,
    handleOpenAddModal,
    handleCloseAddModal,
    handleAddTaskChange,
    handleAddTaskConfirm,
    handleToggleSelect,
    handleToggleAll,
    handleClearSelection,
    handleStatusBadgeClick,
    handleBatchRetry,
    handleBatchDelete,
  }
}
