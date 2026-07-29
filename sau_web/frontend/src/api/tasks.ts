import { request, baseURL } from './request'
import type { LogEntry, TaskItem } from './types'

function parseTasksPayload(raw: string): TaskItem[] | null {
  try {
    const data = JSON.parse(raw) as unknown
    if (Array.isArray(data)) return data as TaskItem[]
    if (
      data &&
      typeof data === 'object' &&
      Array.isArray((data as { data?: unknown }).data)
    ) {
      return (data as { data: TaskItem[] }).data
    }
    return null
  } catch {
    return null
  }
}

export const tasksApi = {
  /** Default limit matches backend DEFAULT_TASK_LIST_LIMIT (100). */
  getTasks(params?: { limit?: number; offset?: number }) {
    return request
      .get('/api/tasks', {
        params: {
          limit: params?.limit ?? 100,
          offset: params?.offset ?? 0,
        },
      })
      .then((res) => res.data)
  },
  /**
   * Subscribe to task status updates via SSE.
   *
   * Backend emits named events:
   *   - event: initial — first snapshot
   *   - event: update  — snapshot when status signature changes
   *   - event: done    — all tasks terminal (connection may close)
   *
   * Also handles unnamed `message` events for older payloads.
   */
  streamTasks(signal?: AbortSignal) {
    const url = `${baseURL || ''}/api/tasks/stream`
    const eventSource = new EventSource(url, { withCredentials: true } as EventSourceInit)
    let abortListener: (() => void) | null = null
    let messageHandler: ((tasks: TaskItem[]) => void) | null = null

    if (signal) {
      abortListener = () => eventSource.close()
      if (signal.aborted) {
        eventSource.close()
      } else {
        signal.addEventListener('abort', abortListener)
      }
    }

    const dispatch = (event: MessageEvent) => {
      if (!messageHandler) return
      const tasks = parseTasksPayload(event.data)
      if (tasks) messageHandler(tasks)
    }

    eventSource.addEventListener('initial', dispatch as EventListener)
    eventSource.addEventListener('update', dispatch as EventListener)
    eventSource.onmessage = dispatch
    eventSource.addEventListener('done', () => {
      eventSource.close()
    })

    return {
      eventSource,
      onMessage: (handler: (tasks: TaskItem[]) => void) => {
        messageHandler = handler
      },
      onError: (handler: (error: Event) => void) => {
        eventSource.onerror = handler
      },
      close: () => {
        if (abortListener && signal) {
          signal.removeEventListener('abort', abortListener)
        }
        eventSource.close()
      },
    }
  },
  retryTask(taskId: string) {
    return request.post('/api/tasks/retry', { task_id: taskId }).then((res) => res.data)
  },
  deleteTask(taskId: string) {
    return request.post('/api/tasks/delete', { task_id: taskId }).then((res) => res.data)
  },
  clearTasks(status?: string[]) {
    return request.post('/api/tasks/clear', { status }).then((res) => res.data)
  },
  addTask(payload: {
    platform: string
    action: string
    account: string
    title?: string
    file?: string
    images?: string[]
    argv?: string[]
  }) {
    return request.post('/api/tasks/add', payload).then((res) => res.data)
  },
  reschedule(taskId: string, newScheduledAt: string) {
    return request.post('/api/tasks/reschedule', { task_id: taskId, new_scheduled_at: newScheduledAt }).then((res) => res.data)
  },
  copy(taskId: string, newScheduledAt: string) {
    return request.post('/api/tasks/copy', { task_id: taskId, new_scheduled_at: newScheduledAt }).then((res) => res.data)
  },
  scheduled(params?: { from?: string; to?: string }) {
    return request.get('/api/tasks/scheduled', { params }).then((res) => res.data)
  },
  /**
   * Live log SSE (`GET /api/logs/stream`).
   * Events: ready | log  (payload `{ts, message}`)
   */
  streamLogs(opts?: { taskId?: string; signal?: AbortSignal }) {
    const params = new URLSearchParams()
    if (opts?.taskId) params.set('task_id', opts.taskId)
    const qs = params.toString()
    const url = `${baseURL || ''}/api/logs/stream${qs ? `?${qs}` : ''}`
    const eventSource = new EventSource(url, { withCredentials: true } as EventSourceInit)
    let abortListener: (() => void) | null = null
    let logHandler: ((entry: LogEntry) => void) | null = null

    if (opts?.signal) {
      abortListener = () => eventSource.close()
      if (opts.signal.aborted) {
        eventSource.close()
      } else {
        opts.signal.addEventListener('abort', abortListener)
      }
    }

    const onLog = (event: MessageEvent) => {
      if (!logHandler) return
      try {
        const data = JSON.parse(event.data) as LogEntry
        if (data && typeof data.ts === 'string' && typeof data.message === 'string') {
          logHandler(data)
        }
      } catch {
        /* ignore malformed */
      }
    }
    eventSource.addEventListener('log', onLog as EventListener)

    return {
      eventSource,
      onLog: (handler: (entry: LogEntry) => void) => {
        logHandler = handler
      },
      onError: (handler: (error: Event) => void) => {
        eventSource.onerror = handler
      },
      close: () => {
        if (abortListener && opts?.signal) {
          opts.signal.removeEventListener('abort', abortListener)
        }
        eventSource.close()
      },
    }
  },
}
