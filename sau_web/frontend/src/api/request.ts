/**
 * Single axios instance for the Web Shell.
 *
 * All domain modules (`accounts`, `publish`, `tasks`, …) and the
 * `client.ts` barrel import THIS `request`. Do not create a second
 * `axios.create` — dual instances previously dropped Idempotency-Key
 * on the domain path (publish/upload went through here without it).
 *
 * Interceptors (in order):
 *   1. GET cache-bust `_t` + X-SAU-Auth-Pending + Idempotency-Key
 *   2. clear Idempotency-Key localStorage on any HTTP response
 *   3. 401 → hard redirect (see _createAuth401ResponseInterceptor)
 *   4. retry on network / 5xx for idempotent methods only (GET/HEAD/OPTIONS)
 */

import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createAuth401ResponseInterceptor } from './_createAuth401ResponseInterceptor'
import { appendAuthPendingHeader } from './_appendAuthPendingHeader'
import {
  appendIdempotencyKey,
  clearIdempotencyKeyOnResponse,
} from './_idempotencyStore'

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

export { baseURL }

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
    // Opt-in cache-bust only. Automatic `_t` on every GET defeated
    // browser/HTTP caching and forced full responses even when
    // React Query already owns freshness via staleTime.
    // Pass `headers: { 'X-SAU-Cache-Bust': '1' }` when a call site
    // truly needs a unique URL (rare).
    const bust = config.headers?.['X-SAU-Cache-Bust'] ?? config.headers?.['x-sau-cache-bust']
    if (config.method === 'get' && bust) {
      config.params = { ...config.params, _t: Date.now() }
      if (config.headers) {
        delete config.headers['X-SAU-Cache-Bust']
        delete config.headers['x-sau-cache-bust']
      }
    }
    // Tag race-window requests (X-SAU-Auth-Pending) + Idempotency-Key
    // for the 6 protected POST routes. See _appendAuthPendingHeader /
    // _idempotencyStore for contracts.
    return appendIdempotencyKey(appendAuthPendingHeader(config))
  },
  (error) => Promise.reject(error),
)

// ── Idempotency response cleanup (2xx / 4xx / 5xx; not network fail) ─
request.interceptors.response.use(
  (response) => clearIdempotencyKeyOnResponse(response),
  (error: AxiosError) => {
    if (error.response) {
      clearIdempotencyKeyOnResponse(error.response)
    }
    return Promise.reject(error)
  },
)

// ── 401 interceptor ──────────────────────────────────────────────────
request.interceptors.response.use(
  (response) => response,
  createAuth401ResponseInterceptor(),
)

// ── Retry interceptor ────────────────────────────────────────────────
// Only auto-retry **idempotent** methods. POST/PUT/PATCH/DELETE on 5xx
// previously re-fired create/episode inserts (studio lastrowid 500 →
// 1 click produced 4 ghost rows). Network blips on writes are surfaced
// to the caller instead of silently duplicating side effects.
const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options'])

request.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config
    if (!config || !config.headers) return Promise.reject(error)

    const method = (config.method || 'get').toLowerCase()
    if (!IDEMPOTENT_METHODS.has(method)) {
      return Promise.reject(error)
    }

    const retryCount = getRetryCount(config)
    if (retryCount >= MAX_RETRIES) return Promise.reject(error)

    if (
      error.code === 'ECONNABORTED' ||
      (error.response?.status && error.response.status >= 400 && error.response.status < 500)
    ) {
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
