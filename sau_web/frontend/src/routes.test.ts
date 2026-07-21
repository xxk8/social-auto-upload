import { describe, it, expect } from 'vitest'
import { ROUTES, RELATIVE_DASHBOARD_ROUTES, PUBLIC_AUTH_PATHS } from './routes'

/**
 * routes.test.ts — pins the routes.ts single-source-of-truth manifest
 * so a typo (e.g. `/dashbord/admin/users`) or a silent rename drift
 * (e.g. updating `ROUTES.dashboard.publish` without mirroring
 * `RELATIVE_DASHBOARD_ROUTES.publish`) gets caught at test time.
 *
 * Three core behaviors are locked (per the user's request):
 *   1. Anti-typo — concrete path strings match exactly.
 *   2. Anti-drift on 401 interceptor allowlist — `PUBLIC_AUTH_PATHS`
 *      must stay `['/login', '/login/auth']` so the 401-response
 *      interceptor keeps the public-auth-pages bypass intact.
 *   3. Parametric builder — `ROUTES.dashboard.studioDetail(id)`
 *      interpolates the id correctly for both string and number.
 *
 * Plus one bonus invariant:
 *   4. Sync between `ROUTES.dashboard.*` and
 *      `RELATIVE_DASHBOARD_ROUTES.*` (the documented sync
 *      requirement in routes.ts JSDoc).
 */

// ── 1. Anti-typo: concrete path strings must match exactly ─────────
//
// The literal-string assertions below are brittle to intentional
// renames BY DESIGN — that's the point. A future PR that renames
// `/dashboard/admin/users` to e.g. `/dashboard/admin/members` must
// update both the constant AND the test, which forces a deliberate
// audit of all consumers (sidebar navItem, mobile Route, tests,
// etc.). An accidental typo in the constant (e.g. `/dashbord/admin/
// users`) fails the test immediately, not at runtime in production.
describe('ROUTES — concrete path strings (anti-typo)', () => {
  it('public routes match exactly', () => {
    expect(ROUTES.public.landing).toBe('/')
    expect(ROUTES.public.login).toBe('/login')
    expect(ROUTES.public.loginAuth).toBe('/login/auth')
    expect(ROUTES.public.pricing).toBe('/pricing')
    expect(ROUTES.public.about).toBe('/about')
    expect(ROUTES.public.hotlist).toBe('/hotlist')
    expect(ROUTES.public.catalog).toBe('/catalog')
  })

  it('dashboard routes match exactly', () => {
    expect(ROUTES.dashboard.root).toBe('/dashboard')
    expect(ROUTES.dashboard.publish).toBe('/dashboard/publish')
    expect(ROUTES.dashboard.tasks).toBe('/dashboard/tasks')
    expect(ROUTES.dashboard.analytics).toBe('/dashboard/analytics')
    expect(ROUTES.dashboard.logs).toBe('/dashboard/logs')
    expect(ROUTES.dashboard.inbox).toBe('/dashboard/inbox')
    expect(ROUTES.dashboard.studio).toBe('/dashboard/studio')
    expect(ROUTES.dashboard.account).toBe('/dashboard/account')
    expect(ROUTES.dashboard.settings).toBe('/dashboard/settings')
    expect(ROUTES.dashboard.personalization).toBe('/dashboard/personalization')
  })

  it('admin sub-routes match exactly', () => {
    expect(ROUTES.dashboard.admin.root).toBe('/dashboard/admin')
    expect(ROUTES.dashboard.admin.users).toBe('/dashboard/admin/users')
    expect(ROUTES.dashboard.admin.audit).toBe('/dashboard/admin/audit')
  })

  it('legacy shim paths match exactly (pre-rename, temporary)', () => {
    expect(ROUTES.legacy.app).toBe('/app')
    expect(ROUTES.legacy.appWildcard).toBe('/app/*')
    expect(ROUTES.legacy.publish).toBe('/publish')
    expect(ROUTES.legacy.tasks).toBe('/tasks')
    expect(ROUTES.legacy.logs).toBe('/logs')
    expect(ROUTES.legacy.analytics).toBe('/analytics')
  })

  it('RELATIVE_DASHBOARD_ROUTES.studioDetail pattern uses :id (locks the param name)', () => {
    // The relative path is consumed by React Router at runtime AND
    // coupled to `StudioDetailPage.tsx`'s `useParams<{ id: string }>()`
    // — a rename to `:projectId` in the manifest silently breaks the
    // page (useParams returns `{}` because React Router no longer
    // matches the URL). Pin the literal string here so the param-name
    // coupling gets caught at test time, not in production.
    expect(RELATIVE_DASHBOARD_ROUTES.studioDetail).toBe('/studio/:id')
  })
})

// ── 2. Anti-drift: PUBLIC_AUTH_PATHS stays `['/login', '/login/auth']` ─
//
// The 401-response-interceptor (`api/_createAuth401ResponseInterceptor.ts`)
// reads `PUBLIC_AUTH_PATHS` and short-circuits any 401 that lands on
// one of those pages. If a future PR adds e.g. `/signup` to
// `PUBLIC_AUTH_PATHS` without also teaching the interceptor to
// recognize the new page, an auth flow that legitimately returns 401
// from a public page would trigger an infinite `/login → /login`
// loop — the regression that originally motivated this allowlist
// (Round-OPT-3F followup comment in the interceptor source).
//
// Pinning both membership AND order here is intentional: the
// existing `new Set(PUBLIC_AUTH_PATHS)` in the interceptor preserves
// order, so a refactor that accidentally sorts the array would
// still pass the membership check but might surface as a test
// ordering diff (defensive, not a contract violation).
describe('PUBLIC_AUTH_PATHS — 401 interceptor allowlist (anti-drift)', () => {
  it('membership is exactly ["/login", "/login/auth"]', () => {
    expect(PUBLIC_AUTH_PATHS).toEqual(['/login', '/login/auth'])
  })

  it('is a readonly array (no in-place mutation allowed)', () => {
    // The `as const` on the routes.ts source should make this
    // a `readonly` tuple. A future refactor that drops `as const`
    // (re-introducing a mutable string[]) would fail this test.
    // @ts-expect-error — push() on a readonly tuple is a TS error
    expect(() => PUBLIC_AUTH_PATHS.push('/signup')).toThrow(TypeError)
  })

  it('does not contain any non-public dashboard route by accident', () => {
    // Cross-check: a refactor that adds a dashboard route to
    // PUBLIC_AUTH_PATHS would expose auth-bypass on every
    // authenticated page. This is the canonical "nope, that
    // would be a security regression" guard.
    for (const path of PUBLIC_AUTH_PATHS) {
      expect(path.startsWith('/dashboard')).toBe(false)
      expect(path.startsWith('/app/')).toBe(false)
    }
  })
})

// ── 3. Parametric builder: studioDetail(id) interpolates correctly ─
//
// `ROUTES.dashboard.studioDetail` is the only function in the
// manifest. Its return type is `string` (not the `Route` union)
// because TypeScript can't statically verify that any interpolated
// id is a known route. Pinning the format here means a refactor
// that breaks the interpolation (e.g. drops the `/studio/` prefix,
// swaps to a different parent, accidentally URL-encodes the id)
// fails the test before it can reach production.
describe('ROUTES.dashboard.studioDetail — parametric builder', () => {
  it('interpolates a number id', () => {
    expect(ROUTES.dashboard.studioDetail(123)).toBe('/dashboard/studio/123')
  })

  it('interpolates a string id (slug form)', () => {
    expect(ROUTES.dashboard.studioDetail('my-project-slug')).toBe(
      '/dashboard/studio/my-project-slug',
    )
  })

  it('handles id=0 without dropping the prefix', () => {
    // A naive template literal like `/${id || 'default'}` would
    // collapse id=0 to 'default'. Pin the literal interpolation.
    expect(ROUTES.dashboard.studioDetail(0)).toBe('/dashboard/studio/0')
  })

  it('handles empty-string id without dropping the prefix', () => {
    // Same as above — empty string is falsy in some templating
    // patterns but should remain literal here.
    expect(ROUTES.dashboard.studioDetail('')).toBe('/dashboard/studio/')
  })
})

// ── 4. Sync: RELATIVE_DASHBOARD_ROUTES mirrors ROUTES.dashboard suffix ─
//
// Documented in routes.ts JSDoc: "every entry in
// RELATIVE_DASHBOARD_ROUTES must mirror the post-`/dashboard`
// suffix of the corresponding ROUTES.dashboard entry". This test
// is the enforcement — a future PR that renames a dashboard route
// in only one of the two constants fails here, forcing the
// reviewer to either rename both or explicitly justify the
// divergence in the PR description.
describe('RELATIVE_DASHBOARD_ROUTES — sync with ROUTES.dashboard', () => {
  const DASHBOARD_PREFIX = '/dashboard'

  // Helper: strip the `/dashboard` prefix from an absolute path
  // to derive the expected relative form. Pure function (no
  // dependency on routes.ts) so a bug in routes.ts can't make
  // this test pass by accident.
  const stripPrefix = (absolute: string): string => {
    if (!absolute.startsWith(DASHBOARD_PREFIX)) {
      throw new Error(`expected ${absolute} to start with ${DASHBOARD_PREFIX}`)
    }
    return absolute.slice(DASHBOARD_PREFIX.length) || '/'
  }

  it('non-admin dashboard routes mirror their absolute counterparts', () => {
    expect(RELATIVE_DASHBOARD_ROUTES.root).toBe(stripPrefix(ROUTES.dashboard.root))
    expect(RELATIVE_DASHBOARD_ROUTES.publish).toBe(stripPrefix(ROUTES.dashboard.publish))
    expect(RELATIVE_DASHBOARD_ROUTES.tasks).toBe(stripPrefix(ROUTES.dashboard.tasks))
    expect(RELATIVE_DASHBOARD_ROUTES.analytics).toBe(stripPrefix(ROUTES.dashboard.analytics))
    expect(RELATIVE_DASHBOARD_ROUTES.logs).toBe(stripPrefix(ROUTES.dashboard.logs))
    expect(RELATIVE_DASHBOARD_ROUTES.inbox).toBe(stripPrefix(ROUTES.dashboard.inbox))
    expect(RELATIVE_DASHBOARD_ROUTES.studio).toBe(stripPrefix(ROUTES.dashboard.studio))
    expect(RELATIVE_DASHBOARD_ROUTES.account).toBe(stripPrefix(ROUTES.dashboard.account))
    expect(RELATIVE_DASHBOARD_ROUTES.settings).toBe(stripPrefix(ROUTES.dashboard.settings))
    expect(RELATIVE_DASHBOARD_ROUTES.personalization).toBe(
      stripPrefix(ROUTES.dashboard.personalization),
    )
  })

  it('admin sub-routes mirror their absolute counterparts', () => {
    expect(RELATIVE_DASHBOARD_ROUTES.admin.root).toBe(
      stripPrefix(ROUTES.dashboard.admin.root),
    )
    expect(RELATIVE_DASHBOARD_ROUTES.admin.users).toBe(
      stripPrefix(ROUTES.dashboard.admin.users),
    )
    expect(RELATIVE_DASHBOARD_ROUTES.admin.audit).toBe(
      stripPrefix(ROUTES.dashboard.admin.audit),
    )
  })

  it('studioDetail pattern matches studio absolute path (with :id)', () => {
    // The absolute `studioDetail` is a function `(/studio/${id})`,
    // the relative one is a string pattern `(/studio/:id)`. The
    // test asserts the path prefix matches, ignoring the
    // interpolation/param-syntax difference at the end.
    const absolutePrefix = stripPrefix(ROUTES.dashboard.studio).replace(/\/$/, '')
    const relativePrefix = RELATIVE_DASHBOARD_ROUTES.studioDetail.replace(/:id$/, '')
    expect(relativePrefix).toBe(`${absolutePrefix}/`)
  })

  it('top-level key set is identical between the two manifests', () => {
    // Catches a one-sided addition: someone adds `ROUTES.dashboard.foo`
    // but forgets to mirror it in `RELATIVE_DASHBOARD_ROUTES` (or vice
    // versa). The pair of suffix checks above iterates over a HARDCODED
    // key list and would silently pass when a new entry lands in only
    // one manifest. The Set comparison (ignoring insertion order —
    // the two manifests intentionally have different orderings for
    // the studio/account block) is the canonical anti-drift lock.
    const absoluteKeys = new Set(Object.keys(ROUTES.dashboard))
    const relativeKeys = new Set(Object.keys(RELATIVE_DASHBOARD_ROUTES))
    expect(relativeKeys).toEqual(absoluteKeys)
  })

  it('admin sub-route key set is identical between the two manifests', () => {
    // Same one-sided-addition guard, but for the nested admin sub-table.
    const absoluteAdminKeys = new Set(Object.keys(ROUTES.dashboard.admin))
    const relativeAdminKeys = new Set(Object.keys(RELATIVE_DASHBOARD_ROUTES.admin))
    expect(relativeAdminKeys).toEqual(absoluteAdminKeys)
  })

  it('entry counts match the documented route inventory', () => {
    // Pin the exact entry counts so a PR that adds a route in one
    // manifest but not the other fails the count check FIRST, before
    // a reviewer has to diff the suffixes by eye. The numbers here
    // are the canonical inventory: 10 top-level dashboard routes
    // (root + 9 named sub-routes, NOT counting the parametric
    // `studioDetail` builder which IS in Object.keys but handled by
    // the suite above), 1 admin sub-table (treated as one key at the
    // top level), and 1 `studioDetail` parametric builder entry.
    // Note: `Object.keys(ROUTES.dashboard)` includes the nested
    // `admin` object as one key + the `studioDetail` function as one
    // key, so the expected count is 12 (10 named + admin + studioDetail).
    expect(Object.keys(ROUTES.dashboard).length).toBe(12)
    expect(Object.keys(RELATIVE_DASHBOARD_ROUTES).length).toBe(12)
    expect(Object.keys(ROUTES.dashboard.admin).length).toBe(3)
    expect(Object.keys(RELATIVE_DASHBOARD_ROUTES.admin).length).toBe(3)
  })
})

// ── 5. Exhaustive leaf coverage (anti «mobile=<Route> · desktop=<* />» drift) ──
//
// Walks every leaf of ROUTES.dashboard (calendar, the parametric
// studioDetail, the admin sub-tree) and asserts a matching
// RELATIVE_DASHBOARD_ROUTES counterpart. The "mobile × desktop
// drift" bug that this test guards against exposed itself when
// calendar was wired into AppShell.tsx's mobile <Routes> block
// but not the desktop/tablet block — both React-Router branches
// read RELATIVE_DASHBOARD_ROUTES directly, so a one-sided omission
// here propagates 1:1 into React-Router-registration drift. This
// test prevents that propagation: when ROUTES.dashboard.calendar
// (or any other leaf) goes missing from RELATIVE_DASHBOARD_ROUTES,
// CI fails with an enumerated list of every drift point.
describe('ROUTES.dashboard × RELATIVE_DASHBOARD_ROUTES — exhaustive leaf coverage', () => {
  const stripDashboardPrefix = (absolute: string): string =>
    absolute === '/dashboard' ? '/' : absolute.slice('/dashboard'.length)

  it('every non-admin leaf mirrors prefix-stripped absolute counterpart', () => {
    // Walk every leaf whose value is a string starting with
    // `/dashboard`. For each, derive the expected relative form
    // (= post-`/dashboard` suffix, `/` for the root itself) and
    // assert the matching RELATIVE_DASHBOARD_ROUTES key holds it.
    // Collect ALL mismatches into a single array and assert array
    // equality — this surfaces every drift point in one failure
    // message instead of stopping at the first mismatch the way
    // successive `expect(...).toBe()` calls would (a regression
    // author's dream for first-pass diagnosis).
    const skip = new Set(['studioDetail', 'admin'])
    const ROUTES_DASHBOARD = ROUTES.dashboard as Record<string, unknown>
    const RELATIVE = RELATIVE_DASHBOARD_ROUTES as Record<string, unknown>
    const mismatches: string[] = []
    for (const key of Object.keys(ROUTES_DASHBOARD)) {
      if (skip.has(key)) continue
      const absolute = ROUTES_DASHBOARD[key]
      if (typeof absolute !== 'string' || !absolute.startsWith('/dashboard')) continue
      const expected = stripDashboardPrefix(absolute)
      const actual = RELATIVE[key]
      if (actual !== expected) {
        mismatches.push(
          `${key}: expected RELATIVE_DASHBOARD_ROUTES.${key} ` +
          `=== ${JSON.stringify(expected)} ` +
          `(suffix of ${absolute}), got ${JSON.stringify(actual)}`,
        )
      }
    }
    expect(mismatches).toEqual([])
  })

  it('studioDetail — parametric absolute (function) + relative pattern (string) both wired', () => {
    // The function form encodes the interpolation contract; the
    // string-pattern form encodes the runtime param syntax that
    // React Router picks up via RELATIVE_DASHBOARD_ROUTES. Both
    // MUST be present — one without the other means
    // navigate("…/studio") works but <Route path="/studio/:id">
    // matches nothing (or vice versa).
    expect(typeof ROUTES.dashboard.studioDetail).toBe('function')
    expect(ROUTES.dashboard.studioDetail(42)).toBe('/dashboard/studio/42')
    expect(RELATIVE_DASHBOARD_ROUTES.studioDetail).toBe('/studio/:id')
  })

  it('every admin sub-tree leaf mirrors prefix-stripped absolute counterpart', () => {
    // Walk every `ROUTES.dashboard.admin.<key>` and assert the
    // matching RELATIVE_DASHBOARD_ROUTES.admin leaf holds the
    // post-`/dashboard` suffix. Admin keys live under a nested
    // object, so the inline walk in the top-level test above
    // can't reach them — handled here.
    const mismatches: string[] = []
    for (const key of Object.keys(ROUTES.dashboard.admin)) {
      const absolute = (ROUTES.dashboard.admin as Record<string, unknown>)[key]
      const relative = (RELATIVE_DASHBOARD_ROUTES.admin as Record<string, unknown>)[key]
      const absoluteStr = typeof absolute === 'string' ? absolute : null
      if (!absoluteStr || !absoluteStr.startsWith('/dashboard')) {
        mismatches.push(
          `admin.${key}: absolute is not a /dashboard-prefixed string: ` +
          `${JSON.stringify(absolute)}`,
        )
        continue
      }
      const expected = stripDashboardPrefix(absoluteStr)
      if (relative !== expected) {
        mismatches.push(
          `admin.${key}: expected RELATIVE_DASHBOARD_ROUTES.admin.${key} ` +
          `=== ${JSON.stringify(expected)} ` +
          `(suffix of ${absoluteStr}), got ${JSON.stringify(relative)}`,
        )
      }
    }
    expect(mismatches).toEqual([])
  })
})
