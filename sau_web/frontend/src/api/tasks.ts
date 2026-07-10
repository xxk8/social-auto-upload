import { request } from './request'

export const tasksApi = {
  getTasks() {
    return request.get('/api/tasks').then((res) => res.data)
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