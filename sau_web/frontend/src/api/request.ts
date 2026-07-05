import axios, { type AxiosInstance } from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'

const baseURL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? '' : 'http://localhost:6001')

export const request: AxiosInstance = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
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

const getRetryDelay = (retryCount: number): number =>
  Math.pow(2, retryCount) * RETRY_DELAY

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
  (error: import('axios').AxiosError) => {
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
  async (error: import('axios').AxiosError) => {
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