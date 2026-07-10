/**
 * Locks the 401 interceptor behavior so a future refactor that
 * accidentally drops the `isLoading` guard, the `/login` short-
 * circuit, or the `clearAuth` call gets caught by CI rather than
 * discovered in a real browser when the AuthLoadingSkeleton
 * disappears.
 *
 * Background: the 401 race condition between
 * AccountsProvider's `/api/account-groups` (fires before
 * AuthGuard mounts) and `/api/auth/me` was making the
 * AuthLoadingSkeleton dead code. The fix is this guard. This
 * test makes the fix unforkable.
 *
 * ## Why DI for both `redirect` and `getPathname`
 *
 * The interceptor reads two things from `window.location`:
 *   1. `pathname` (to short-circuit when the 401 happens on /login)
 *   2. `href` (to do the hard redirect on session-expired)
 *
 * Both are non-configurable accessors in jsdom (different
 * reasons, same outcome: hard to mock). Across v1-v5 we
 * tried `Object.defineProperty`, `vi.spyOn`, prototype
 * patching, and direct `window.location` replacement — each
 * hit a different jsdom quirk. v6 sidesteps the entire
 * problem: the helper takes both `redirect` and `getPathname`
 * as optional DI parameters, and tests inject `vi.fn()` and
 * a path string. No `window.location` mocking at all. The
 * only remaining mock is `useAuthStore.getState`, which is
 * straightforward (the real store is a module-level singleton).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AxiosError } from 'axios'
import {
  createAuth401ResponseInterceptor,
  PUBLIC_AUTH_PAGES,
} from './_createAuth401ResponseInterceptor'
import { useAuthStore } from '../features/auth/authStore'

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal AxiosError-shaped 401 response. */
function make401(url = '/api/account-groups'): AxiosError {
  const err = new Error('Request failed with status code 401') as AxiosError
  err.isAxiosError = true
  err.name = 'AxiosError'
  err.config = { url } as AxiosError['config']
  err.response = {
    status: 401,
    statusText: 'Unauthorized',
    data: null,
    headers: {},
    config: err.config!,
  }
  return err
}

/** Build a non-401 error (e.g. 500). */
function make500(): AxiosError {
  const err = new Error('Request failed with status code 500') as AxiosError
  err.isAxiosError = true
  err.name = 'AxiosError'
  err.config = { url: '/api/account-groups' } as AxiosError['config']
  err.response = {
    status: 500,
    statusText: 'Server Error',
    data: null,
    headers: {},
    config: err.config!,
  }
  return err
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createAuth401ResponseInterceptor', () => {
  // We only override `getState` (the tests don't touch `setState`),
  // so we don't need to snapshot `setState` in beforeEach.
  let realGetState: typeof useAuthStore.getState

  beforeEach(() => {
    realGetState = useAuthStore.getState
  })

  afterEach(() => {
    useAuthStore.getState = realGetState
    // Reset the underlying store state to the initial
    // isLoading=true so a leaked getState override (in a test
    // that throws) can't leave the store in a bad state for
    // the next test.
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    })
    vi.restoreAllMocks()
  })

  // (1) THE bug fix. Without this guard, the AuthLoadingSkeleton
  // is dead code in real browsers. If a future refactor drops
  // the `isLoading` check, this test must turn red.
  it('does NOT hard-redirect during the initial /api/auth/me window (isLoading=true)', async () => {
    const clearAuth = vi.fn()
    useAuthStore.getState = () =>
      ({ isLoading: true, clearAuth } as unknown as ReturnType<typeof useAuthStore.getState>)

    const redirect = vi.fn()
    const interceptor = createAuth401ResponseInterceptor(redirect, () => '/dashboard')

    await expect(interceptor(make401())).rejects.toBeTruthy()

    expect(clearAuth).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  // (2) Session-expired case: isLoading has been false since the
  // initial check completed, so we DO hard-redirect AND clear
  // the local auth state.
  it('hard-redirects to /login with return URL when isLoading=false (session expired mid-session)', async () => {
    const clearAuth = vi.fn()
    useAuthStore.getState = () =>
      ({ isLoading: false, clearAuth } as unknown as ReturnType<typeof useAuthStore.getState>)

    const redirect = vi.fn()
    const interceptor = createAuth401ResponseInterceptor(redirect, () => '/dashboard/publish')

    await expect(interceptor(make401())).rejects.toBeTruthy()

    expect(clearAuth).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/login?redirect=%2Fdashboard%2Fpublish&reason=session_expired')
  })

  // (3) The /login short-circuit prevents an infinite redirect
  // loop when credential validation fails. Note: this test
  // passes /login as the pathname AND isLoading=false to
  // verify the /login check fires BEFORE the isLoading check.
  it('does NOT redirect when the 401 happens on the /login page itself', async () => {
    const clearAuth = vi.fn()
    useAuthStore.getState = () =>
      ({ isLoading: false, clearAuth } as unknown as ReturnType<typeof useAuthStore.getState>)

    const redirect = vi.fn()
    const interceptor = createAuth401ResponseInterceptor(redirect, () => '/login')

    await expect(interceptor(make401())).rejects.toBeTruthy()

    expect(clearAuth).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  // (3b) Round-OPT-3F followup: /login/auth is the actual email+code
  // form (moved off /login in round 12). Its `useAuth().getMe()` call
  // on mount returns 401 for any anonymous visitor — without the
  // explicit allowlist entry, the user would be hard-redirected to
  // /login?redirect=/login/auth&reason=session_expired BEFORE the
  // form ever paints. This test pins the fix.
  it('does NOT redirect when the 401 happens on the /login/auth page (email-code form)', async () => {
    const clearAuth = vi.fn()
    useAuthStore.getState = () =>
      ({ isLoading: false, clearAuth } as unknown as ReturnType<typeof useAuthStore.getState>)

    const redirect = vi.fn()
    const interceptor = createAuth401ResponseInterceptor(redirect, () => '/login/auth')

    await expect(interceptor(make401())).rejects.toBeTruthy()

    expect(clearAuth).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  // (4) Non-401 errors (4xx other than 401, 5xx) must not trigger
  // any auth-state side effect. They're call-site concerns, not
  // auth concerns.
  it('does NOT redirect or clear auth on non-401 errors (e.g. 500)', async () => {
    const clearAuth = vi.fn()
    useAuthStore.getState = () =>
      ({ isLoading: false, clearAuth } as unknown as ReturnType<typeof useAuthStore.getState>)

    const redirect = vi.fn()
    const interceptor = createAuth401ResponseInterceptor(redirect, () => '/dashboard')

    await expect(interceptor(make500())).rejects.toBeTruthy()

    expect(clearAuth).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  // (5) Promise rejection contract: the interceptor must always
  // reject so React Query / error boundaries can react. Otherwise
  // a call site that does `.then((res) => res.data)` on a 401
  // would see a "successful" 401 and crash on undefined access.
  // Also asserts no auth-state side effects (clearAuth) so a
  // future refactor that adds a side effect to this branch gets
  // caught here rather than discovered in production.
  //
  // Round-OPT-3G: the no-DI call path now goes through
  // navigateInApp() (which falls back to window.location.href =
  // path when the registry is empty — the case here since this
  // test isLoading=true and therefore the SHOULD-redirect branch
  // shouldn't fire anyway). We stub window.location.href setter
  // to assert no real navigation happens; the assertion that
  // matters is that the promise is rejected and clearAuth is NOT
  // called during the isLoading window.
  it('rejects the promise in all cases (so React Query can surface the 401)', async () => {
    const clearAuth = vi.fn()
    useAuthStore.getState = () =>
      ({ isLoading: true, clearAuth } as unknown as ReturnType<typeof useAuthStore.getState>)

    const hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        set href(_v: string) {
          hrefSetter(_v)
        },
      },
    })

    const interceptor = createAuth401ResponseInterceptor() // no DI — uses defaults
    await expect(interceptor(make401())).rejects.toBeInstanceOf(Error)
    expect(clearAuth).not.toHaveBeenCalled()
  })

  // (6) SSR safety: when `window` is undefined (e.g. a future
  // SSR build), the interceptor must just reject rather than
  // throw `ReferenceError: window is not defined`. This branch
  // was added defensively in the helper; this test makes it
  // load-bearing rather than aspirational. The injected
  // `redirect` confirms the helper doesn't call the redirect
  // either, since there's nothing to navigate to.
  it('rejects without throwing when window is undefined (SSR safety)', async () => {
    const clearAuth = vi.fn()
    useAuthStore.getState = () =>
      ({ isLoading: false, clearAuth } as unknown as ReturnType<typeof useAuthStore.getState>)

    vi.stubGlobal('window', undefined)

    try {
      const redirect = vi.fn()
      const interceptor = createAuth401ResponseInterceptor(redirect, () => '/dashboard')
      await expect(interceptor(make401())).rejects.toBeTruthy()
      expect(clearAuth).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // (7) Membership snapshot. Pins the current `PUBLIC_AUTH_PAGES`
  // entries so a future refactor that drops `/login` or
  // `/login/auth` from the Set (silently disabling its
  // short-circuit and re-introducing the login redirect loop)
  // gets caught by CI rather than discovered in a real browser.
  //
  // Sorted compare: reordering the Set's literal is a cosmetic
  // edit and shouldn't break CI (Set iteration order is
  // insertion-order, but ordering doesn't affect `.has()`
  // semantics). Sorting also catches "extra entries" — a future
  // `Set.add('/signup')` that forgets to update this snapshot
  // fails the toEqual because the array is longer than expected.
  //
  // When adding a public auth page (e.g. `/signup`): add the
  // entry to `PUBLIC_AUTH_PAGES` AND update this expected array
  // in the SAME PR. The matching test cases (3) and (3b) above
  // already pin the per-pathname redirect behavior; this test
  // pins the Set shape itself.
  it('PUBLIC_AUTH_PAGES membership is locked (snapshot)', () => {
    expect([...PUBLIC_AUTH_PAGES].sort()).toEqual([
      '/login',
      '/login/auth',
    ])
  })
})
