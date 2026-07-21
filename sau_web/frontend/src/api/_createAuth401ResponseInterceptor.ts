/**
 * Shared 401 response-interceptor factory.
 *
 * Used by BOTH axios instances (client.ts + request.ts) so the
 * 401 handling logic lives in exactly one place. Previously
 * duplicated; the code-reviewer flagged it as a real drift risk
 * — the next person to change the redirect target would have to
 * remember to update both.
 *
 * ## Behavior contract
 *
 * **Initial-auth-check window** (authStore.isLoading === true):
 *   The user just landed on a `/dashboard/*` page. `useAuth` is still
 *   resolving `/api/auth/me`. Other parallel API calls (most
 *   notably `AccountsProvider`'s `/api/account-groups`, which is
 *   hoisted ABOVE `<Routes>` in `App.tsx and so fires before
 *   `AuthGuard` even mounts) can return 401 in this window. If
 *   we hard-redirect to `/login` here, we destroy the React
 *   tree before `AuthGuard`'s `isLoading=true` branch can paint
 *   the `AuthLoadingSkeleton` — making the skeleton effectively
 *   dead code in real browsers. So: just reject the promise and
 *   let the React Query / component error boundary surface the
 *   401, and let `useAuth`'s `useEffect` determine the final
 *   redirect once `/api/auth/me` lands.
 *
 * **Post-auth-check window** (authStore.isLoading === false):
 *   This is the session-expired mid-session case (e.g. JWT TTL
 *   ran out). Clear the local auth state and hard-redirect to
 *   `/login`. The hard redirect is a known UX wart (it loses
 *   form input, scroll position, open modals, in-flight
 *   `useMutation` state) — preserving the pre-fix behavior
 *   here is intentional for this PR. See followup to migrate
 *   to `navigate('/login', { replace: true })` via React Router.
 *
 * **`/login` itself**: never trigger a redirect. The login page
 * legitimately issues auth calls that return 401, and we'd
 * otherwise create a redirect loop.
 *
 * ## Cycle safety
 *
 * Importing `useAuthStore` here creates the cycle:
 *   this file → authStore → authApi → request.ts (via `request`)
 *   or this file → authStore → authApi → client.ts (via `request`)
 *
 * The cycle is safe because `authApi.ts` only references
 * `request` inside function bodies (`authApi.login` etc.), not
 * at module top level. By the time those functions run, this
 * file has finished evaluating and `request` is bound.
 */

import type { AxiosError } from 'axios'
import { useAuthStore } from '../features/auth/authStore'
import { ROUTES, PUBLIC_AUTH_PATHS } from '@/routes'
import { navigateInApp } from '@/lib/navigation'

/**
 * Optional redirect injection point. Tests pass a `vi.fn()` to
 * verify the redirect without mocking `window.location` (which
 * is a host object in jsdom and notoriously hard to mock —
 * `pathname` is non-configurable on the instance in some
 * jsdom builds, and `href` is an accessor that triggers
 * navigation on assignment). Production callers omit this
 * arg and get the default `window.location.href = ...`
 * behavior. The default uses `globalThis` so SSR builds that
 * have no window still type-check (the function is never
 * actually called from SSR because axios doesn't fire there,
 * but we keep the type safe).
 */
export type RedirectFn = (path: string) => void

/**
 * Optional pathname injection point. Same rationale as
 * `RedirectFn` — tests pass `() => '/login'` or `() => '/dashboard'`
 * to control which branch the interceptor takes without
 * trying to mock jsdom's non-configurable `Location.pathname`
 * accessor. Production callers omit this arg and get the
 * default `window.location.pathname` read.
 */
export type GetPathnameFn = () => string

// Round-OPT-3G followup: default redirect now delegates to
// React Router via the imperative registry in lib/navigation.ts.
// This preserves the React tree across session-expired bounces
// (form input, scroll, in-flight useMutations). `replace: true`
// keeps the browser Back button from yanking the user back to
// the dead-state dashboard the 401 fired from. Falls back to
// `window.location.href` (see navigateInApp's fallback branch)
// when the registry is empty (rare race between module load
// and <RegisterNavigate /> first commit, or SSR builds).
const defaultRedirect: RedirectFn = (path) => {
  navigateInApp(path, { replace: true })
}

const defaultGetPathname: GetPathnameFn = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).window.location.pathname
}

/**
 * Set of public auth-bearing pages that legitimately issue auth
 * calls returning 401. A 401 on one of these MUST NOT trigger a
 * hard redirect — that would either create an infinite
 * `/login → /login` loop, or strand the user before the form
 * paints (`/login/auth → /login`).
 *
 * ## Members
 *
 * - `/login` — password/social login submit. The form's submit
 *   handler reads the 401 from the rejected promise and renders
 *   the error inline.
 *
 * - `/login/auth` — the email+code form (moved off `/login` in
 *   round 12). On initial mount it fires `useAuth().getMe()`,
 *   which returns 401 for any anonymous visitor.
 *
 *   Round-OPT-3F followup: without the explicit allowlist entry
 *   here, that 401 triggered a hard redirect to
 *   `/login?redirect=/login/auth&reason=session_expired` BEFORE
 *   the form ever painted — making the form unreachable in the
 *   browser. The allowlist is the canonical fix for the
 *   `(isAuthenticated=false, getMe()→401)` race on initial mount.
 *
 * ## Why a Set
 *
 * `.has()` is O(1) and future-proof: adding the next public
 * auth page (e.g. /forgot-password, /signup) is a one-line
 * `.add('/signup')` here, with no need to touch the
 * if-condition or its branches. Module-level so the Set is
 * allocated once at module load, not per interceptor invocation.
 *
 * ## Test-only export
 *
 * `PUBLIC_AUTH_PAGES` is exported EXCLUSIVELY so the
 * membership-snapshot test in `_createAuth401ResponseInterceptor.test.ts`
 * can pin current entries — a future refactor that drops
 * `/login` or `/login/auth` from the Set without updating the
 * corresponding test gets caught by CI rather than discovered
 * in production as a re-introduced login redirect loop.
 *
 * Production code should call
 * `createAuth401ResponseInterceptor()` and never reference the
 * Set directly. When adding a new public auth page: append the
 * entry here AND update the snapshot test in the same PR.
 */
// Re-exported from routes.ts (single source of truth for route paths).
// The interceptor allowlist is now the `PUBLIC_AUTH_PATHS` array
// (defined alongside ROUTES). Kept as a `Set` for the O(1) `.has()`
// lookup, but the source data lives in routes.ts.
export const PUBLIC_AUTH_PAGES: ReadonlySet<string> = new Set(PUBLIC_AUTH_PATHS)

/**
 * Returns a `(error) => Promise<never>` suitable for use as the
 * error handler of `axiosInstance.interceptors.response.use(...)`.
 *
 * The function is intentionally a factory (not a singleton) so
 * each call site gets its own reference but the LOGIC is shared.
 * `redirect` and `getPathname` are injection seams: tests pass
 * `vi.fn()` / `() => '/some/path'`, production callers omit
 * both for the default `window.location`-based behavior.
 */
export function createAuth401ResponseInterceptor(
  redirect: RedirectFn = defaultRedirect,
  getPathname: GetPathnameFn = defaultGetPathname
) {
  return (error: AxiosError): Promise<never> => {
    // Non-401 errors: just propagate. Only 401 has auth-state
    // implications; 4xx/5xx without auth consequences belong to
    // the call site to handle.
    if (error.response?.status !== 401) {
      return Promise.reject(error)
    }

    // SSR safety: tests + the rare server-rendered path can hit
    // this without a window. In that case there's no auth UI to
    // navigate to, so just reject and let the caller decide.
    if (typeof window === 'undefined') {
      return Promise.reject(error)
    }

    // Public-route short-circuit. Membership + the "why these
    // pages" rationale (including the Round-OPT-3F `getMe()`-on-
    // initial-mount history) live in the module-level
    // PUBLIC_AUTH_PAGES Set above as single source of truth.
    //
    // Order matters: this check fires BEFORE the `isLoading`
    // check so that a 401 on a login page never triggers a
    // redirect regardless of the auth state. Reshuffling these
    // two would break the login error flow.
    const here = getPathname()
    if (PUBLIC_AUTH_PAGES.has(here)) {
      return Promise.reject(error)
    }

    // Initial-auth-check window: skip the hard redirect so the
    // AuthLoadingSkeleton can paint and AuthGuard can navigate
    // via React Router once /api/auth/me resolves.
    if (useAuthStore.getState().isLoading) {
      return Promise.reject(error)
    }

    // Post-auth-check 401: session expired. Clear local state
    // and hard-redirect, preserving the original destination so
    // LoginPage can bounce back after re-authentication.
    //
    // Round-OPT-3F: append `reason=session_expired` so LoginPage /
    // LoginAuthPage can distinguish a 401-triggered redirect from
    // a voluntary visit. When this flag is present the auto-redirect
    // goes to /dashboard/publish instead of the original target — breaks
    // the redirect loop when an API returns 401 for an otherwise
    // authenticated user (e.g. studio API with SAU_AUTH_ENABLED=false).
    useAuthStore.getState().clearAuth()
    redirect(`${ROUTES.public.login}?redirect=${encodeURIComponent(here)}&reason=session_expired`)
    return Promise.reject(error)
  }
}
