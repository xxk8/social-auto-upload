/**
 * API 客户端 barrel 入口。
 *
 * 保持所有现有 import 路径不变（`@/api/client` 或 `../api/client`），
 * 实现按领域拆分到独立文件：
 *
 *   request.ts   — **唯一** axios 实例 + 拦截器（幂等 / 401 / retry）
 *   accounts.ts  — 账号管理
 *   publish.ts   — 上传/发布
 *   tasks.ts     — 任务管理
 *   ai.ts        — AI 生成
 *   inbox.ts     — 下载中心
 *   types.ts     — 共享类型与常量
 *   sse.ts       — SSE 流式读取
 *
 * client.ts 只做 re-export + `api.*` 聚合。不要在本文件 `axios.create`。
 */

import type { PublishHistoryItem } from './types'
import { request, baseURL } from './request'

// Re-export the single instance so `@/api/client` and `./request`
// callers share interceptors (Idempotency-Key, 401, retry).
export { request, baseURL }

// ── Barrel re-exports — preserves all existing import paths ──────────
export { getNoteImageLimit } from './types'
export type {
  ApiResponse, PlatformOption, AccountItem, AccountGroup,
  AccountAuthorization, TaskItem, LogEntry, PublishHistoryItem,
  CalendarTaskItem, CalendarSummary,
} from './types'
export {
  PLATFORMS, PLATFORMS_WITH_ICONS, LOGIN_PLATFORMS,
  NOTE_PLATFORMS, NOTE_PLATFORM_IMAGE_LIMITS, QR_LOGIN_PLATFORMS,
} from './types'

import { accountsApi } from './accounts'
import { publishApi } from './publish'
import { tasksApi } from './tasks'
import { aiApi } from './ai'
import { inboxApi } from './inbox'
import { calendarApi } from './calendar'
import { crawlApi } from './crawl'

/**
 * 统一 API 对象 — 所有领域方法聚合在这里。
 *
 * 保持与旧 `api.*` 调用签名完全兼容：
 *   api.getAccounts()       → 映射到 accountsApi.getAccounts()
 *   api.uploadVideo()       → 映射到 publishApi.uploadVideo()
 *   api.getTasks()          → 映射到 tasksApi.getTasks()
 *   api.generateAiContent() → 映射到 aiApi.generateAiContent()
 *   api.inboxDownload()     → 映射到 inboxApi.inboxDownload()
 *   api.analytics.*         → 内联（仅此一处）
 *   api.license.*           → 内联
 *   api.templates.*         → 内联
 *   api.tasks.reschedule()  → 映射到 tasksApi.reschedule()
 *   api.usage.*             → 内联
 *   api.searchWeb()         → 映射到 aiApi.searchWeb()
 */
const analyticsApi = {
  summary(params: { from?: string; to?: string }) {
    return request.get('/api/analytics/summary', { params }).then((res) => res.data)
  },
  accounts(params: { from?: string; to?: string }) {
    return request.get('/api/analytics/accounts', { params }).then((res) => res.data)
  },
  exportCsv(params: { from?: string; to?: string }) {
    return request.get('/api/analytics/export', { params, responseType: 'blob' }).then((res) => res.data)
  },
}

const licenseApi = {
  activate(key: string) {
    return request.post('/api/license/activate', { key }).then((res) => res.data)
  },
  status() {
    return request.get('/api/license/status').then((res) => res.data)
  },
  deactivate() {
    return request.post('/api/license/deactivate').then((res) => res.data)
  },
  generate(tier: string, count: number) {
    return request.post('/api/license/generate', { tier, count }).then((res) => res.data)
  },
}

const templatesApi = {
  list() {
    return request.get('/api/templates').then((res) => res.data)
  },
  create(payload: {
    name: string
    mode?: string
    snapshot?: Record<string, unknown>
    platform?: string
    template?: Record<string, unknown>
  }) {
    const body = {
      name: payload.name,
      mode: payload.mode || 'video',
      snapshot: payload.snapshot || payload.template || {},
      platform: payload.platform,
    }
    return request.post('/api/templates', body).then((res) => res.data)
  },
  update(id: number, payload: { name?: string; snapshot?: Record<string, unknown> }) {
    return request.put(`/api/templates/${id}`, payload).then((res) => res.data)
  },
  delete(id: number) {
    return request.delete(`/api/templates/${id}`).then((res) => res.data)
  },
  remove(id: number) {
    return request.delete(`/api/templates/${id}`).then((res) => res.data)
  },
  apply(id: number, payload?: { variables?: Record<string, unknown>; platform?: string }) {
    return request
      .post(`/api/templates/${id}/apply`, payload || {})
      .then((res) => res.data)
  },
  import(templates: Array<{ name: string; mode: string; snapshot: Record<string, unknown> }>) {
    return request.post('/api/templates/import', templates).then((res) => res.data)
  },
  export() {
    return request.get('/api/templates/export', { responseType: 'blob' }).then((res) => res.data)
  },
}


const usageApi = {
  quota() {
    return request.get('/api/usage/quota').then((res) => res.data)
  },
}

export const api = {
  getBaseUrl() { return baseURL },

  // ── Accounts ──
  getAccounts: accountsApi.getAccounts,
  deleteAccount: accountsApi.deleteAccount,
  checkAccount: accountsApi.checkAccount,
  checkAllAccounts: accountsApi.checkAllAccounts,
  loginAccount: accountsApi.loginAccount,
  getAccountGroups: accountsApi.getAccountGroups,
  createAccountGroup: accountsApi.createAccountGroup,
  deleteAccountGroup: accountsApi.deleteAccountGroup,
  renameAccountGroup: accountsApi.renameAccountGroup,
  authorizeAccountGroup: accountsApi.authorizeAccountGroup,
  confirmAuthorizeAccountGroup: accountsApi.confirmAuthorizeAccountGroup,
  removeAuthorization: accountsApi.removeAuthorization,
  moveAuthorization: accountsApi.moveAuthorization,
  checkAuthorizationHealth: accountsApi.checkAuthorizationHealth,
  sendTestNotification: accountsApi.sendTestNotification,
  reorderAccountGroups: accountsApi.reorderAccountGroups,
  reorderAuthorizations: accountsApi.reorderAuthorizations,

  // ── Publish ──
  uploadVideo: publishApi.uploadVideo,
  uploadNoteMultipart: publishApi.uploadNoteMultipart,

  // ── Tasks ──
  getTasks: tasksApi.getTasks,
  streamTasks: tasksApi.streamTasks,
  retryTask: tasksApi.retryTask,
  deleteTask: tasksApi.deleteTask,
  clearTasks: tasksApi.clearTasks,
  addTask: tasksApi.addTask,
  tasks: {
    reschedule: tasksApi.reschedule,
    copy: tasksApi.copy,
    scheduled: tasksApi.scheduled,
  },

  // ── Publish history (operator AboutTab Timeline) ──
  getPublishHistory(limit = 20): Promise<PublishHistoryItem[]> {
    return request
      .get('/api/publish/history', { params: { limit } })
      .then((res) => res.data?.data ?? [])
  },

  // ── Calendar (content-calendar dashboard view) ──
  // Delegates to the dedicated calendarApi; the response eagerly
  // unwraps the inner `data` envelope so a CalendarPage consumer
  // reads `res.tasks` directly, NOT `res.data.tasks`. The fetch
  // also coalesces envelope-missing into a stub `{tasks:[], summary}`
  // so a malformed server response renders an empty calendar (no
  // crash on render).
  getCalendarTasks: calendarApi.list,

  // ── AI ──
  generateAiContent: aiApi.generateAiContent,
  fetchAiModels: aiApi.fetchAiModels,
  getAiConfig: aiApi.getAiConfig,
  listAiKeys: aiApi.listAiKeys,
  setAiConfig: aiApi.setAiConfig,
  deleteAiConfig: aiApi.deleteAiConfig,
  batchAddKeys: aiApi.batchAddKeys,
  validateAiKey: aiApi.validateAiKey,
  generateMultiPlatformStream: aiApi.generateMultiPlatformStream,
  generatePlatformVariantsStream: aiApi.generatePlatformVariantsStream,
  generateVariantsStream: aiApi.generateVariantsStream,
  searchWeb: aiApi.searchWeb,
  enhancePrompt: aiApi.enhancePrompt,
  generateAiContentStream: aiApi.generateAiContentStream,
  generateMessagesStream: aiApi.generateMessagesStream,

  // ── Logs ──
  getLogs(params?: { after?: string; task_id?: string; limit?: number; offset?: number }) {
    return request
      .get('/api/logs', {
        params: {
          ...params,
          // Backend defaults to 200; explicit cap keeps FloatingLogs payloads small.
          limit: params?.limit ?? 200,
        },
      })
      .then((res) => res.data)
  },
  streamLogs: tasksApi.streamLogs,

  // ── Inbox ──
  inboxDownload: inboxApi.inboxDownload,
  inboxList: inboxApi.inboxList,
  inboxReveal: inboxApi.inboxReveal,
  inboxDelete: inboxApi.inboxDelete,
  inboxClear: inboxApi.inboxClear,
  inboxStorage: inboxApi.inboxStorage,
  inboxCleanup: inboxApi.inboxCleanup,
  inboxThumbUrl: inboxApi.inboxThumbUrl,
  inboxTranscribeStream: inboxApi.inboxTranscribeStream,
  inboxFetchFile: inboxApi.inboxFetchFile,
  inboxSubtitle: inboxApi.inboxSubtitle,
  inboxSubtitleStream: inboxApi.inboxSubtitleStream,
  inboxSubtitleSave: inboxApi.inboxSubtitleSave,
  inboxOrganize: inboxApi.inboxOrganize,

  // ── Crawler (openspec/changes/mediacrawler-integration) ────────
  // Read-only data-collection surface; 7 MediaCrawler-style
  // platforms (xhs/dy/ks/bili/wb/tieba/zhihu) + AI sentiment + AI
  // reply-suggestion. Action POSTs return 202 + Location →
  // ``api.crawl.status(task_id)`` for polling.
  crawl: crawlApi,

  // ── Analytics, License, Templates, Usage ──
  analytics: analyticsApi,
  license: licenseApi,
  templates: templatesApi,
  usage: usageApi,

  // ── Content templates (alias) ──
  contentTemplates: templatesApi,

  // ── Smart scheduling ──
  scheduling: {
    insights: (payload?: { platform?: string; account?: string }) =>
      request
        .get('/api/scheduling/insights', { params: payload })
        .then((res) => res.data),
    autoAssign: (
      payload?:
        | { platform?: string; account?: string }
        | Array<{ platform?: string; account?: string }>,
    ) =>
      request
        .post('/api/scheduling/auto-assign', payload || {})
        .then((res) => res.data),
    setSchedule: async (scheduled_at: string) =>
      request
        .post('/api/tasks/reschedule', { task_id: '', new_scheduled_at: scheduled_at })
        .then((res) => res.data),
  },

  batchImport: async (..._a: any[]) => ({
    success: false as const,
    data: null as any,
    message: 'batch import not implemented in local shell',
  }),
  downloadBatchTemplate: async () => new Blob(['platform,account,title\n'], { type: 'text/csv' }),
}
