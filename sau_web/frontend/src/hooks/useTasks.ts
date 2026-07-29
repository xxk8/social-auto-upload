import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type LogEntry, type TaskItem } from '../api/client'
import { isTasksStreamSupported, subscribeTasksStream } from './tasksStream'

export const TASKS_QUERY_KEY = ['tasks'] as const

function isActiveStatus(status?: string | null) {
  return status === 'pending' || status === 'running'
}

function hasActiveTasks(tasks: TaskItem[] | undefined) {
  return !!tasks?.some((t) => isActiveStatus(t.status))
}

export type UseTasksOptions = {
  /**
   * When false, skip fetch/SSE entirely (e.g. CommandPalette closed).
   * Cached data is still returned if present.
   */
  enabled?: boolean
  /**
   * When false, only use the REST cache — never open SSE.
   * Useful for opportunistic consumers that just want search hits.
   */
  live?: boolean
}

/**
 * Task list with a **shared** SSE live channel while any task is active.
 *
 * Flow:
 *  1. Initial REST fetch (`GET /api/tasks?limit=100`) when `enabled`
 *  2. With `live` + active tasks + visible tab → shared EventSource
 *  3. On stream error → 3s REST poll fallback
 *  4. Terminal / hidden tab → drop this subscriber (stream closes at 0 refs)
 */
export function useTasks(options: UseTasksOptions = {}) {
  const { enabled = true, live = true } = options
  const queryClient = useQueryClient()
  const [tabVisible, setTabVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  )
  const [pollFallback, setPollFallback] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const query = useQuery<TaskItem[]>({
    queryKey: TASKS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.getTasks()
      return res.data ?? []
    },
    enabled,
    staleTime: 5_000,
    refetchInterval: (q) => {
      if (!enabled || !live || !pollFallback) return false
      return hasActiveTasks(q.state.data) ? 3_000 : false
    },
  })

  const active = hasActiveTasks(query.data)

  useEffect(() => {
    if (!enabled || !live || !active || !tabVisible) return
    if (!isTasksStreamSupported()) {
      setPollFallback(true)
      return
    }

    return subscribeTasksStream(
      (tasks) => {
        setPollFallback(false)
        queryClient.setQueryData<TaskItem[]>(TASKS_QUERY_KEY, tasks)
      },
      () => {
        const current = queryClient.getQueryData<TaskItem[]>(TASKS_QUERY_KEY)
        if (!hasActiveTasks(current)) return
        setPollFallback(true)
        void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
      },
    )
  }, [enabled, live, active, tabVisible, queryClient])

  return query
}

/**
 * Fetch accounts, optionally filtered by platform.
 */
export function useAccounts(platform?: string) {
  return useQuery({
    queryKey: ['accounts', platform ?? 'all'] as const,
    queryFn: async () => {
      const res = await api.getAccounts(platform)
      return res.data ?? []
    },
    staleTime: 60_000,
  })
}

/**
 * Fetch logs related to a specific task.
 * Polls while running; pauses when the document is hidden.
 */
export function useTaskLogs(taskId: string | null, taskStatus: string | undefined) {
  const isRunning = taskStatus === 'pending' || taskStatus === 'running'
  const enabled = !!taskId
  const queryClient = useQueryClient()
  const [tabVisible, setTabVisible] = useState(
    () => (typeof document === 'undefined' ? true : !document.hidden),
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const query = useQuery<LogEntry[]>({
    queryKey: ['task-logs', taskId],
    queryFn: async () => {
      const res = await api.getLogs(taskId ? { task_id: taskId, limit: 200 } : { limit: 200 })
      return res.data ?? []
    },
    enabled,
    // SSE below is primary while running; rare poll only if stream unsupported.
    refetchInterval:
      enabled && isRunning && tabVisible && typeof EventSource === 'undefined' ? 3_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 1_500,
  })

  useEffect(() => {
    if (!enabled || !isRunning || !tabVisible || !taskId) return
    if (typeof EventSource === 'undefined') return
    // Dedicated stream filtered by task_id (not the global shared one).
    const ac = new AbortController()
    const stream = api.streamLogs({ taskId, signal: ac.signal })
    stream.onLog((entry) => {
      queryClient.setQueryData<LogEntry[]>(['task-logs', taskId], (prev) => {
        const list = prev ?? []
        if (list.some((x) => x.ts === entry.ts && x.message === entry.message)) {
          return list
        }
        return [...list, entry].slice(-500)
      })
    })
    return () => {
      ac.abort()
      stream.close()
    }
  }, [enabled, isRunning, tabVisible, taskId, queryClient])

  return query
}
