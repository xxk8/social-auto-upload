/**
 * Imperative-navigation registry.
 *
 * Round-OPT-3G followup: axios-level response interceptors cannot
 * call `useNavigate()` directly — hooks require a React component.
 * The previous contract used `window.location.href = path` which:
 *   1. Loses React state mid-bounce (form input, scroll, in-flight
 *      useMutation queries)
 *   2. Forces a full document reload (cold reload of the whole
 *      Vite app, slow on dev builds)
 *
 * The registry pattern sidesteps both: a single
 * `<RegisterNavigate />` component at the top of the React tree
 * captures `useNavigate()` once and exposes it as a non-hook
 * function. The axios interceptor then calls `navigateInApp(...)`
 * which delegates to React Router (preserving state) when the
 * registry is populated and falls back to `window.location.href`
 * during the (very short) window between module load and the
 * `<RegisterNavigate />` effect's first run.
 *
 * ## Race condition between module load and effect run
 *
 * `_navigate` is null until `<RegisterNavigate />` mounts and its
 * `useEffect` fires. **For the `clearAuth + hard-redirect` path
 * (session expired mid-session), this is OK:** by the time a 401
 * can drive a hard-redirect, the auth store's `isLoading` gate
 * has already fired and `_navigate` is registered. The fallback
 * path (`window.location.href = path`) only triggers for the
 * genuinely-rare case of a 401 firing during the very first
 * tick — at which point the redirect target is `?reason=
 * session_expired` login, which the user would have to manually
 * navigate to anyway.
 *
 * The race-window fallback is therefore a **safety net**, not a
 * primary path. The 401 interceptor's `isLoading` short-circuit
 * ensures we never hit `navigateInApp` during the truly-crucial
 * race window.
 *
 * ## SSR safety
 *
 * `navigateInApp` is a no-op when both `_navigate === null` and
 * `typeof window === 'undefined'`. The `isLoading` short-circuit
 * in `_createAuth401ResponseInterceptor` already protects against
 * SSR-fired 401s by rejecting early (`if (typeof window ===
 * 'undefined') return Promise.reject(error)`), so this branch is
 * defense-in-depth.
 */

import type { NavigateFunction } from 'react-router-dom'

let _navigate: NavigateFunction | null = null

/**
 * Register the active `<Navigate />` instance. Idempotent: a
 * second registration replaces the first (rare — only happens if
 * two `<RegisterNavigate />` components mount simultaneously,
 * which today's tree does not do).
 *
 * Returns an unregister function for symmetry with `useEffect`'s
 * cleanup contract. Currently unused but exported for future
 * testability — tests calling `registerNavigate` can call the
 * returned function to reset between cases.
 */
export function registerNavigate(fn: NavigateFunction): () => void {
  _navigate = fn
  return () => {
    if (_navigate === fn) _navigate = null
  }
}

/**
 * Imperative navigate. Falls back to a full-page redirect when
 * the registry is empty (router not yet mounted) or when SSR
 * (no window) is in play.
 *
 * `opts.replace` defaults to `false` (push new entry → Back works).
 * Session-expired redirects SHOULD pass `replace: true` so Back
 * doesn't yank the user back to the dead-state dashboard the
 * 401 fired from. The 401 interceptor passes `{ replace: true }`
 * for that reason.
 */
export function navigateInApp(
  path: string,
  opts: { replace?: boolean } = {}
): void {
  if (_navigate) {
    _navigate(path, opts)
    return
  }
  // Fallback: registry not populated yet OR SSR.
  if (typeof window !== 'undefined') {
    window.location.href = path
  }
}

