import { request } from '@/api/client'

export type AdminUser = {
  id: number
  email: string
  role: 'admin' | 'user'
  tier: string
  created_at: string
  last_login: string | null
  // Founder status — surfaced so the Admin Users page can render
  // a Founder badge and gate the "transfer Founder" affordance on
  // it. Optional on the wire because /api/admin/users predates
  // this column; backend `SELECT` statement rows have it at all
  // times. Default `false` keeps legacy callers forward-safe.
  is_founder?: boolean
}

export type AuditLogItem = {
  id: number
  admin_user_id: number
  target_user_id: number | null
  action: string
  detail: string | null
  created_at: string
  admin_email: string | null
  target_email: string | null
}

export type AdminOverviewData = {
  total_users: number
  active_today: number
  total_tasks: number
  task_success_rate: number
  recent_actions: Array<{
    id: number
    user_id: number
    action: string
    created_at: string
    user_email: string | null
  }>
}

export type SystemStatusData = {
  tasks_by_status: Record<string, number>
  tasks_by_platform: Record<string, number>
  errors_by_type: Record<string, number>
}

/** Trend series for the Admin Overview 4 stat cards.
 *  `points` is OLDEST FIRST, length always exactly `days` (the
 *  backend 0-fills days with no source rows). */
export type TrendData = {
  metric: 'total_users' | 'active_today' | 'total_tasks' | 'task_success_rate'
  days: number
  points: number[]
}

function _auditDateRange(range: 'today' | 'week' | 'month'): { start: string; end: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`

  const startOfDay = (d: Date) => {
    const x = new Date(d)
    x.setUTCHours(0, 0, 0, 0)
    return x
  }
  const endOfDay = (d: Date) => {
    const x = new Date(d)
    x.setUTCHours(23, 59, 59, 0)
    return x
  }

  if (range === 'today') {
    return { start: fmt(startOfDay(now)), end: fmt(endOfDay(now)) }
  }

  if (range === 'week') {
    const day = now.getUTCDay()
    const diffToMonday = day === 0 ? 6 : day - 1
    const monday = new Date(now)
    monday.setUTCDate(now.getUTCDate() - diffToMonday)
    const sunday = new Date(monday)
    sunday.setUTCDate(monday.getUTCDate() + 6)
    return { start: fmt(startOfDay(monday)), end: fmt(endOfDay(sunday)) }
  }

  // month
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  return { start: fmt(startOfDay(first)), end: fmt(endOfDay(last)) }
}

export const adminApi = {
  getUsers(): Promise<{ success: boolean; data?: AdminUser[]; message?: string }> {
    return request.get('/api/admin/users').then((r) => r.data)
  },

  updateUserRole(userId: number, role: string): Promise<{ success: boolean; data?: AdminUser; message?: string }> {
    return request.put(`/api/admin/users/${userId}/role`, { role }).then((r) => r.data)
  },

  getAuditLogs(
    page = 1,
    perPage = 50,
    timeRange?: 'all' | 'today' | 'week' | 'month' | 'custom',
    customStart?: string,
    customEnd?: string,
  ): Promise<{
    success: boolean
    data?: { logs: AuditLogItem[]; total: number; page: number; per_page: number }
    message?: string
  }> {
    const params: Record<string, string | number> = { page, per_page: perPage }
    if (timeRange && timeRange !== 'all') {
      if (timeRange === 'custom' && customStart && customEnd) {
        params.start_date = `${customStart}T00:00:00`
        params.end_date = `${customEnd}T23:59:59`
      } else if (timeRange !== 'custom') {
        const { start, end } = _auditDateRange(timeRange)
        params.start_date = start
        params.end_date = end
      }
    }
    return request.get('/api/admin/audit', { params }).then((r) => r.data)
  },

  getOverview(
    timeRange?: 'all' | 'today' | 'week' | 'month' | 'custom',
    customStart?: string,
    customEnd?: string,
  ): Promise<{ success: boolean; data?: AdminOverviewData; message?: string }> {
    const params: Record<string, string> = {}
    if (timeRange && timeRange !== 'all') {
      if (timeRange === 'custom' && customStart && customEnd) {
        params.start_date = `${customStart}T00:00:00`
        params.end_date = `${customEnd}T23:59:59`
      } else if (timeRange !== 'custom') {
        const { start, end } = _auditDateRange(timeRange)
        params.start_date = start
        params.end_date = end
      }
    }
    return request.get('/api/admin/overview', { params }).then((r) => r.data)
  },

  getSystem(): Promise<{ success: boolean; data?: SystemStatusData; message?: string }> {
    return request.get('/api/admin/system').then((r) => r.data)
  },

  /** Fetch a single metric's N-day value series for the sparkline row
   *  on the Overview 4-stat cards. Server returns 0-filled series of
   *  length `days` even on empty DB so consumers can index safely.
   *  `days` defaults to 14 (matching the v3-mini sparkline width). */
  getTrends(
    metric: TrendData['metric'],
    days: number = 14,
  ): Promise<{ success: boolean; data?: TrendData; message?: string }> {
    return request.get('/api/admin/trends', { params: { metric, days } }).then((r) => r.data)
  },

  /** Stream a CSV export of the trends series. Returns a `Blob` ready
   *  for `URL.createObjectURL` + anchor-click download. When `metric`
   *  is omitted, the server returns a 5-column CSV (date + all 4
   *  metrics). When provided, the server returns a 2-column CSV
   *  (date, value). Both files come with a UTF-8 BOM so Excel-CN
   *  imports them without the "Data → From Text/CSV" wizard.
   *  The server emits `Content-Disposition: attachment; filename=...`
   *  but browsers don't auto-trigger a download for XHR blobs, so
   *  callers must build their own `<a download="...">` element. */
  exportTrendsCsv(
    days: number = 14,
    metric?: TrendData['metric'],
  ): Promise<Blob> {
    const params: Record<string, string | number> = { days }
    if (metric) params.metric = metric
    return request
      .get('/api/admin/trends/export', { params, responseType: 'blob' })
      .then((r) => r.data)
  },

  getUnacknowledgedAuditCount(): Promise<{ success: boolean; data?: { count: number }; message?: string }> {
    return request.get('/api/admin/audit/unacknowledged-count').then((r) => r.data)
  },

  acknowledgeAuditLogs(): Promise<{ success: boolean; data?: { updated: number }; message?: string }> {
    return request.post('/api/admin/audit/acknowledge').then((r) => r.data)
  },

  /** Founder identity transfer (ai-api-keys-founder feature):
      POST /api/admin/founder/transfer with `{ target_user_id }`.
      Caller MUST be the current founder; the backend atomically
      swaps `users.is_founder` from caller → target and writes an
      `action='founder_transfer'` audit row. The response shape
      surfaces the prior + new founder pair so the UI can render
      "✓ 已将 Founder 身份从 {prior.email} 转移给 {new.email}"
      without a second round-trip. */
  transferFounder(
    targetUserId: number,
  ): Promise<{
    success: boolean
    data?: {
      prior_founder: { id: number | null; email: string | null }
      new_founder: { id: number; email: string }
      transferred_at: string
    }
    message?: string
  }> {
    return request
      .post('/api/admin/founder/transfer', { target_user_id: targetUserId })
      .then((r) => r.data)
  },
}
