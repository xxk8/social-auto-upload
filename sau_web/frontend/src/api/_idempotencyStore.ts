/**
 * Round-OPT-idem-keys frontend: Idempotency-Key store + interceptor.
 *
 * The 6 protected backend routes (`/api/upload/video`,
 * `/api/upload/note`, `/api/tasks/add`, `/api/tasks/retry`,
 * `/api/tasks/reschedule`, `/api/tasks/copy`) return 202 Accepted
 * and queue the work in the background. If the user's tab is
 * closed mid-upload and they reopen + retry, the BACKEND would
 * normally create a duplicate task row (and the upstream platform
 * would receive a duplicate publish). The backend's
 * `idempotency_keys` table dedups by Idempotency-Key + payload
 * hash; this module is the frontend half of that contract.
 *
 * ## Storage choice (localStorage, not sessionStorage)
 *
 * The primary failure mode this round solves is "tab close
 * mid-upload + reopen + retry". ``sessionStorage`` is per-tab
 * and dies on tab close, so a reopened tab would generate a
 * fresh UUID — defeating the dedup. ``localStorage`` persists
 * across tab close + browser restart, so the same UUID is
 * reused and the backend cache recognizes the retry.
 *
 * The orphan-key risk (a user navigates away + never returns,
 * leaving a stale localStorage entry) is bounded by the
 * ``_TTL_MS`` constant below. Entries older than 7 days
 * (matching the backend's PG row TTL) are evicted on read.
 * A successful 202 also clears the entry, so the typical
 * happy-path never leaks.
 *
 * ## How it integrates with the request interceptor
 *
 * `_appendIdempotencyKey` is the request-side hook: it reads
 * (or generates) a UUID for the current (user, route) and
 * sets the `Idempotency-Key` request header. A response
 * interceptor clears the entry on 2xx (so a subsequent
 * deliberate re-submission gets a fresh UUID) and on 422
 * (so a payload-mismatch retry can use a fresh UUID). 4xx
 * other than 422 keeps the entry (a transient 401/400 may
 * resolve on retry with the same UUID).
 */

import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../features/auth/authStore'

// Backend mirror — see `web_runner/idempotency.py`.
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed'

const _STORAGE_PREFIX = 'sau_idem_'
const _TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days, matches backend

// The 6 protected routes. Any URL that starts with one of these
// gets the Idempotency-Key header injected. The matcher is
// exact-prefix (NOT regex with wildcards) to avoid accidentally
// matching `/api/tasks/scheduled` (read-only, must NOT be
// idempotent) or `/api/tasks/copy/X` (no such route, but the
// safety margin is worth the string check).
const _PROTECTED_ROUTES: readonly string[] = [
  '/api/upload/video',
  '/api/upload/note',
  '/api/tasks/add',
  '/api/tasks/retry',
  '/api/tasks/reschedule',
  '/api/tasks/copy',
] as const

function isProtectedRoute(path: string): boolean {
  for (const r of _PROTECTED_ROUTES) {
    if (path === r || path.startsWith(`${r}/`)) return true
  }
  return false
}

function storageKey(route: string, userId: number | string): string {
  return `${_STORAGE_PREFIX}${userId}_${route}`
}

function generateUuid(): string {
  // crypto.randomUUID is widely supported (Node 19+, all modern
  // browsers, Safari 15.4+). Fall back to a less-cryptographically-
  // strong generator for old runtimes — UUID collision is
  // astronomically unlikely in either case.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // RFC 4122 v4 fallback (template from uuid package). The
  // per-route TTL + the 255-char backend cap make a collision
  // survive 7 days; that's acceptable for a fire-and-forget
  // surface where the worst case is a 422 (which the user can
  // resolve by reloading).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function readEntry(route: string, userId: number | string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(route, userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { uuid: string; created_at: number }
    if (!parsed?.uuid || typeof parsed.created_at !== 'number') {
      return null
    }
    if (Date.now() - parsed.created_at > _TTL_MS) {
      // Expired — drop and return null.
      localStorage.removeItem(storageKey(route, userId))
      return null
    }
    return parsed.uuid
  } catch {
    return null
  }
}

function writeEntry(route: string, userId: number | string, uuid: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      storageKey(route, userId),
      JSON.stringify({ uuid, created_at: Date.now() })
    )
  } catch {
    // localStorage may be full or disabled (private mode in
    // some browsers). Silent fallback — the request still goes
    // out without the header, which is the correct degraded
    // mode (no dedup, no errors).
  }
}

function clearEntry(route: string, userId: number | string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(storageKey(route, userId))
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Read the current user id from the auth store, falling back to
 * a stable hash of the user object (email or id). Lazy import
 * to avoid a circular dependency at module-load time
 * (authStore → authApi → request → this file).
 */
function currentUserKey(): number | string {
  try {
    // Direct ES import at the top of this file mirrors the
    // `_appendAuthPendingHeader.ts` pattern. Vite/esbuild
    // handle the circular dep (authStore → authApi → request
    // → this file → authStore) via hoisting, so the import
    // resolves cleanly. The try/catch wraps the .getState()
    // call (not the import) as a belt-and-suspenders guard for
    // SSR builds where the store module may not have
    // initialized yet.
    const user = useAuthStore.getState()?.user
    if (user?.id) return user.id
    if (user?.email) return user.email
  } catch {
    // Fall through.
  }
  return 0
}

/**
 * Request interceptor: set `Idempotency-Key` on the 6 protected
 * routes. Reuses a stored UUID for the (user, route) pair if
 * one exists (the dedup case), or generates + stores a new one
 * (the fresh case).
 *
 * Wired once on the single axios instance in `request.ts`
 * (client.ts re-exports that instance — do not double-register).
 */
export function appendIdempotencyKey(
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig {
  try {
    const path = config.url || ''
    if (!isProtectedRoute(path)) return config
    if (config.method?.toLowerCase() !== 'post') return config
    // Don't override a caller-supplied key (per-method override).
    if (config.headers.get?.(IDEMPOTENCY_KEY_HEADER)) return config
    const userKey = currentUserKey()
    let uuid = readEntry(path, userKey)
    if (!uuid) {
      uuid = generateUuid()
      writeEntry(path, userKey, uuid)
    }
    config.headers.set(IDEMPOTENCY_KEY_HEADER, uuid)
  } catch {
    // Degraded mode: request still goes out without the header.
  }
  return config
}

/**
 * Response interceptor: clear the localStorage entry on ALL
 * non-network final responses (2xx, 4xx, 5xx). The backend
 * mirrors this: 2xx→complete, 4xx+5xx→release. The frontend
 * clearing on every response keeps the two sides symmetric
 * — a 401 retry uses a fresh UUID (the backend released, so
 * the retry is a clean request), a 422 retry uses a fresh
 * UUID (the corrected payload shouldn't hit a stale 422), a
 * 5xx retry uses a fresh UUID (transient error, re-execute
 * allowed). The only path that DOESN'T clear is a network
 * error (no response received) — the entry stays so a
 * `location.reload()` + retry can dedup the still-in-flight
 * request.
 */
export function clearIdempotencyKeyOnResponse(response: AxiosResponse): AxiosResponse {
  try {
    const path = response.config?.url || ''
    if (!isProtectedRoute(path)) return response
    // Clear on any HTTP response — the backend's
    // finalize() already committed (2xx) or released (4xx/5xx)
    // the key, so the localStorage entry is stale regardless.
    clearEntry(path, currentUserKey())
  } catch {
    // Degraded mode: the response still propagates to the
    // caller; the localStorage entry is just left in place.
  }
  return response
}

/**
 * Test-only: clear ALL idempotency entries. Used by jest setup
 * to ensure no test leaks UUIDs across cases. Exported for
 * the test file's afterEach hook.
 */
export function _clearAllIdempotencyEntriesForTest(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(_STORAGE_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    // Best-effort.
  }
}

/**
 * Test-only: get the current entry for a (route, user) pair.
 * Returns the UUID string or null. Used by the contract test
 * to assert that the localStorage entry is cleared on 2xx /
 * 422.
 */
export function _getIdempotencyEntryForTest(
  route: string,
  userId: number | string
): string | null {
  return readEntry(route, userId)
}

// Re-export the route list for the test (so it doesn't have to
// re-declare the protected-route set, drift risk).
export const _PROTECTED_ROUTES_FOR_TEST = _PROTECTED_ROUTES
// AxiosRequestConfig re-export is intentional: the test imports
// the type-only contract for the helper signature.
export type { AxiosRequestConfig }
