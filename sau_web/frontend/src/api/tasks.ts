import { request } from './request'

export const tasksApi = {
  getTasks() {
    return request.get('/api/tasks').then((res) => res.data)
  },
  /**
   * Subscribe to task status updates via SSE.
   *
   * The backend emits:
   *   - event: initial — full task list on connection
   *   - event: update — full task list when it changes
   *   - event: done   — when all tasks reach a terminal state
   */
  streamTasks(signal?: AbortSignal) {
    const baseURL = request.defaults.baseURL || ''
    const url = `${baseURL}/api/tasks/stream`
    const eventSource = new EventSource(url, { withCredentials: true } as EventSourceInit)
    let abortListener: (() => void) | null = null

    if (signal) {
      abortListener = () => eventSource.close()
      signal.addEventListener('abort', abortListener)
    }

    const onMessage = (handler: (tasks: unknown[]) => void) => {
      const listener = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          if (Array.isArray(data)) {
            handler(data)
          }
        } catch {
          // ignore malformed messages
        }
      }
      eventSource.addEventListener('initial', listener)
      eventSource.addEventListener('update', listener)
      eventSource.addEventListener('done', () => {
        eventSource.close()
      })
    }

    return {
      eventSource,
      onMessage,
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
}