/**
 * Shared request-interceptor helper: X-SAU-Auth-Pending header.
 *
 * Sets `X-SAU-Auth-Pending: 1` on every outgoing axios request
 * while the auth store is in its `isLoading: true` window — the
 * brief period after the dashboard mounts but before
 * `/api/auth/me` resolves. The backend Flask after-request hook
 * reads this header and, on 401 responses, echoes
 * `X-SAU-Race-Window: 1` so DevTools users can filter out the
 * race-window 401 noise with the network-panel filter
 * `has-response-header:X-SAU-Race-Window`.
 *
 * ## Why a shared factory
 *
 * The project carries TWO axios instances:
 *   * `sau_web/frontend/src/api/client.ts::request` — primary, used
 *     by `accounts.ts`, `publish.ts`, `tasks.ts`, `ai.ts`,
 *     `inbox.ts` (barrel re-exports).
 *   * `sau_web/frontend/src/api/request.ts::request` — defense-in-
 *     depth; `accounts.ts` specifically imports `request` from
 *     `./request`, not `./client`.
 *
 * Both instances already share the 401 response interceptor via
 * `_createAuth401ResponseInterceptor.ts` (extracted precisely to
 * prevent copy-paste drift). The request header set must follow
 * the same pattern: the logic lives here, both instances import
 * this file directly. A future refactor that drops or moves the
 * header set is a single-file diff — no axios-instance duplication.
 *
 * ## Why setting only on `isLoading: true`
 *
 * Outside the auth-loading window there is no race condition —
 * a 401 means the user is genuinely unauthenticated and the
 * existing redirect logic applies. Tagging those 401s as
 * "race window" too would mask real session-expired errors.
 * The auth store flips `isLoading` to false synchronously in
 * `setUser(...)` / `clearAuth(...)` — every request after the
 * first `/api/auth/me` resolution goes out without the header.
 *
 * ## CORS preflight cost
 *
 * Adding a custom request header makes the request "complex"
 * per the CORS spec — browsers fire an OPTIONS preflight
 * before the actual GET/POST. flask-cors echoes custom request
 * headers by default, so the preflight will succeed at 2xx;
 * the only cost is one extra round-trip per request during the
 * auth-loading window. The window is at most a few hundred ms
 * (the time for `/api/auth/me` to round-trip), so the cost is
 * bounded.
 *
 * ## Failure modes must NOT crash axios
 *
 * The function never throws — `useAuthStore.getState()` could
 * theoretically throw if the store module failed to load (an
 * SSR build without it, or a hot-reload that broke the import
 * graph). Catching silently + returning the config unchanged is
 * the correct fallback: the request still goes out without the
 * header, which is better than the request failing at all.
 */

import type { InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../features/auth/authStore'

/**
 * Header name. Exported so tests / monitoring tooling can
 * reference the canonical string without re-declaring it (drift
 * risk if a future refactor names the header differently but
 * forgets to update one of the references).
 */
export const SAU_AUTH_PENDING_HEADER = 'X-SAU-Auth-Pending'

export function appendAuthPendingHeader(
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig {
  try {
    if (useAuthStore.getState().isLoading) {
      // AxiosHeaders.set handles deduplication if the caller
      // already set the header (e.g. via a per-call override).
      config.headers.set(SAU_AUTH_PENDING_HEADER, '1')
    }
  } catch {
    // Store not available (extreme edge case — SSR, broken
    // import); skip silently. The request still goes out
    // without the header, which is the correct degraded mode.
  }
  return config
}
