import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type LogEntry, type TaskItem } from '../api/client'

const TASKS_QUERY_KEY = ['tasks'] as const

/** Stream task status updates via SSE, falling back to a single fetch. */
export function useTasks() {
  const queryClient = useQueryClient()

  const query = useQuery<TaskItem[]>({
    queryKey: TASKS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.getTasks()
      return res.data ?? []
    },
    // SSE pushes updates into the cache; disable TanStack polling.
    refetchInterval: false,
  })

  useEffect(() => {
    let cancelled = false
    let retryDelay = 1_000
    const maxDelay = 30_000
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let currentController: AbortController | null = null
    let currentStream: ReturnType<typeof api.streamTasks> | null = null

    const connect = () => {
      const controller = new AbortController()
      currentController = controller
      const stream = api.streamTasks(controller.signal)
      currentStream = stream

      stream.onMessage((tasks) => {
        retryDelay = 1_000
        queryClient.setQueryData<TaskItem[]>(TASKS_QUERY_KEY, tasks as TaskItem[])
      })

      stream.onError((event) => {
        // eslint-disable-next-line no-console
        console.error('[tasks stream] error', event)
        stream.close()
        if (!cancelled) {
          timeoutId = setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, maxDelay)
        }
      })
    }

    connect()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      currentController?.abort()
      currentStream?.close()
    }
  }, [queryClient])

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
  })
}

/**
 * Fetch logs related to a specific task.
 *
 * Uses server-side filtering via the `task_id` query parameter.
 * Auto-polls every 2 s while the task is running, stops once terminal.
 */
export function useTaskLogs(taskId: string | null, taskStatus: string | undefined) {
  const isRunning = taskStatus === 'pending' || taskStatus === 'running'
  const enabled = !!taskId

  return useQuery<LogEntry[]>({
    queryKey: ['task-logs', taskId],
    queryFn: async () => {
      const res = await api.getLogs(taskId ? { task_id: taskId } : undefined)
      return res.data ?? []
    },
    enabled,
    refetchInterval: enabled && isRunning ? 2_000 : false,
    staleTime: 1_000,
  })
}
