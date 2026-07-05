/**
 * API 客户端 barrel 入口。
 *
 * 保持所有现有 import 路径不变（`@/api/client` 或 `../api/client`），
 * 但实现已按领域拆分到独立文件：
 *
 *   accounts.ts  — 账号管理
 *   publish.ts   — 上传/发布
 *   tasks.ts     — 任务管理
 *   ai.ts        — AI 生成
 *   inbox.ts     — 素材收件箱
 *   types.ts     — 共享类型与常量
 *   sse.ts       — SSE 流式读取
 *
 * client.ts 只保留 axios 实例 + 拦截器 + barrel re-export 职责。
 */

import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'

const baseURL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? '' : 'http://localhost:6001')

export const request: AxiosInstance = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
  withCredentials: true,
})

// ── Retry configuration (WeakMap — no request header pollution) ──────
const MAX_RETRIES = 3
const RETRY_DELAY = 1000
const retryCountMap = new WeakMap<InternalAxiosRequestConfig, number>()

const getRetryCount = (config: InternalAxiosRequestConfig): number =>
  retryCountMap.get(config) ?? 0

const incrementRetryCount = (config: InternalAxiosRequestConfig): void => {
  retryCountMap.set(config, getRetryCount(config) + 1)
}

const getRetryDelay = (retryCount: number): number => {
  return Math.pow(2, retryCount) * RETRY_DELAY
}

// ── Request interceptor ──────────────────────────────────────────────
request.interceptors.request.use(
  (config) => {
    if (config.method === 'get') {
      config.params = { ...config.params, _t: Date.now() }
    }
    return config
  },
  (error) => Promise.reject(error),
)

// ── 401 interceptor ──────────────────────────────────────────────────
request.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      import('../features/auth/authStore').then(({ useAuthStore }) => {
        useAuthStore.getState().clearAuth()
        window.location.href = '/login'
      })
    }
    return Promise.reject(error)
  },
)

// ── Retry interceptor ────────────────────────────────────────────────
request.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config
    if (!config || !config.headers) return Promise.reject(error)

    const retryCount = getRetryCount(config)
    if (retryCount >= MAX_RETRIES) return Promise.reject(error)

    if (error.code === 'ECONNABORTED' ||
        (error.response?.status && error.response.status >= 400 && error.response.status < 500)) {
      return Promise.reject(error)
    }

    if (!error.response || (error.response.status && error.response.status >= 500)) {
      incrementRetryCount(config)
      await new Promise((resolve) => setTimeout(resolve, getRetryDelay(retryCount)))
      return request(config)
    }

    return Promise.reject(error)
  },
)

// ── Barrel re-exports — preserves all existing import paths ──────────
export { getNoteImageLimit } from './types'
export type {
  ApiResponse, PlatformOption, AccountItem, AccountGroup,
  AccountAuthorization, TaskItem, LogEntry,
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
// 这几个 namespace 太小，不值得单独拆文件，内联在 barrel 里
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
  create(payload: { name: string; mode: string; snapshot: Record<string, unknown> }) {
    return request.post('/api/templates', payload).then((res) => res.data)
  },
  update(id: number, payload: { name?: string; snapshot?: Record<string, unknown> }) {
    return request.put(`/api/templates/${id}`, payload).then((res) => res.data)
  },
  delete(id: number) {
    return request.delete(`/api/templates/${id}`).then((res) => res.data)
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
  reorderAccountGroups: accountsApi.reorderAccountGroups,
  reorderAuthorizations: accountsApi.reorderAuthorizations,

  // ── Publish ──
  uploadVideo: publishApi.uploadVideo,
  uploadNoteMultipart: publishApi.uploadNoteMultipart,

  // ── Tasks ──
  getTasks: tasksApi.getTasks,
  retryTask: tasksApi.retryTask,
  deleteTask: tasksApi.deleteTask,
  clearTasks: tasksApi.clearTasks,
  addTask: tasksApi.addTask,
  tasks: {
    reschedule: tasksApi.reschedule,
    scheduled: tasksApi.scheduled,
  },

  // ── AI ──
  generateAiContent: aiApi.generateAiContent,
  fetchAiModels: aiApi.fetchAiModels,
  getAiConfig: aiApi.getAiConfig,
  listAiKeys: aiApi.listAiKeys,
  setAiConfig: aiApi.setAiConfig,
  deleteAiConfig: aiApi.deleteAiConfig,
  batchAddKeys: aiApi.batchAddKeys,
  generateMultiPlatformStream: aiApi.generateMultiPlatformStream,
  generateVariantsStream: aiApi.generateVariantsStream,
  searchWeb: aiApi.searchWeb,
  enhancePrompt: aiApi.enhancePrompt,
  generateAiContentStream: aiApi.generateAiContentStream,
  generateMessagesStream: aiApi.generateMessagesStream,

  // ── Logs ──
  getLogs(params?: { after?: string; task_id?: string }) {
    return request.get('/api/logs', { params }).then((res) => res.data)
  },

  // ── Inbox ──
  inboxDownload: inboxApi.inboxDownload,
  inboxReveal: inboxApi.inboxReveal,
  inboxTranscribeStream: inboxApi.inboxTranscribeStream,
  inboxFetchFile: inboxApi.inboxFetchFile,

  // ── Analytics, License, Templates, Usage (内联 namespace) ──
  analytics: analyticsApi,
  license: licenseApi,
  templates: templatesApi,
  usage: usageApi,
}