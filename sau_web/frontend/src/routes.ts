/**
 * Single source of truth for all frontend route paths.
 *
 * Replaces 30+ hardcoded route string literals that previously lived
 * across `App.tsx`, `AppShell.tsx`, `MarketingFooter.tsx`,
 * `CommandPalette.tsx`, `LoginAuthPage.tsx`, `StudioPage.tsx`,
 * `StudioDetailPage.tsx`, and `_createAuth401ResponseInterceptor.ts`.
 *
 * Why this exists: the `/app/*` → `/dashboard/*` migration required
 * 241+ sed replacements because every route was hardcoded inline. A
 * future rename should be a 1-line change in this file.
 *
 * ## Design contract
 *
 * 1. **Nested object, `as const`** — `ROUTES.dashboard.publish` reads
 *    naturally; `as const` preserves literal types so TS narrows the
 *    `Route` union to the exact set of paths. Trade-off: no
 *    type-completion when calling parametric builders like
 *    `ROUTES.dashboard.studioDetail(...)` — see the "Parametric
 *    routes" section below.
 *
 * 2. **3 sections: `public` / `dashboard` / `legacy`** — public
 *    routes have no AuthGuard, dashboard routes are auth-gated
 *    (AppShell's inner `<Routes>`), legacy routes are the pre-rename
 *    shims that the new wildcard catches. Marked with a
 *    `@deprecated` JSDoc so a follow-up PR knows what to remove.
 *
 * 3. **Parametric routes are functions** — `/dashboard/studio/:id`
 *    is exposed as `ROUTES.dashboard.studioDetail(id: number |
 *    string)`. Function signature is the contract; forget to pass
 *    `id` and TS errors out. The alternative (a `:id` template
 *    string) lets callers forget to interpolate, which is the
 *    whole class of bug this module exists to prevent.
 *
 * 4. **`Route` union type** — every concrete path in the manifest
 *    is part of the `Route` union. Consumers can type their props
 *    as `{ to: Route }` to lock the call site to a valid route
 *    (autocomplete on `to={...}` in IDEs). NOT used in the
 *    call-site migration below — keeping the union for future
 *    strict-mode refactors.
 *
 * 5. **No query string templates here** — `?focus=`, `?plan=`,
 *    `?intent=` are caller concerns, not route shape. Callers
 *    compose with `new URLSearchParams(...)` or template literals
 *    at the use site. Putting query strings here would force
 *    every consumer to know about every optional param.
 *
 * ## Test strategy
 *
 * Tests (vitest + E2E + python) KEEP string literals like
 * `initialEntries={['/dashboard/publish']}`. Tests assert on wire
 * format, not the source-of-truth indirection — if `routes.ts` had
 * a typo, both the test and the production code would break
 * together, and the test would lose its ability to catch a
 * regression where someone writes a hardcoded `/dashboard/pubish`
 * (typo) directly into a component.
 */

// ── Public routes (no AuthGuard) ────────────────────────────────────────
export const ROUTES = {
  public: {
    landing: '/',
    login: '/login',
    loginAuth: '/login/auth',
    forgotPassword: '/login/forgot-password',
    resetPassword: '/login/reset-password',
    pricing: '/pricing',
    about: '/about',
    hotlist: '/hotlist',
    catalog: '/catalog',
  },

  // ── Dashboard routes (auth-gated via AppShell's inner <Routes>) ────
  dashboard: {
    root: '/dashboard',
    publish: '/dashboard/publish',
    tasks: '/dashboard/tasks',
    calendar: '/dashboard/calendar',
    analytics: '/dashboard/analytics',
    logs: '/dashboard/logs',
    inbox: '/dashboard/inbox',
    studio: '/dashboard/studio',
    /** Parametric: /dashboard/studio/:id (StudioDetailPage) */
    studioDetail: (id: number | string): string => `/dashboard/studio/${id}`,
    account: '/dashboard/account',
    settings: '/dashboard/settings',
    personalization: '/dashboard/personalization',
    // ── Admin sub-routes (admin role only) ────────────────────────────
    admin: {
      root: '/dashboard/admin',
      users: '/dashboard/admin/users',
      audit: '/dashboard/admin/audit',
    },
  },

  // ── Legacy shims (pre-rename prefix; temporary) ────────────────────
  //
  // These exist ONLY so that:
  //   (a) bookmarks + shared links to the old `/app/*` URLs
  //       continue to resolve via `<Route path="/app/*">` in App.tsx
  //       (which forwards to `/dashboard/<subpath>` preserving the
  //       descending splat + query + hash), and
  //   (b) bookmarks to the older `/publish` / `/tasks` / `/logs` /
  //       `/analytics` shim-paths continue to bounce to their
  //       `/dashboard/*` form.
  //
  // **Remove in 1-2 release cycles** once telemetry confirms zero
  // hits. See the migration todo in `docs/dev/INDEX.md` (TBF-018
  // cron-style runbook for the cleanup window).
  /** @deprecated Pre-rename prefix; use {@link ROUTES.dashboard.root} */
  legacy: {
    app: '/app',
    appWildcard: '/app/*',
    /** @deprecated Use {@link ROUTES.dashboard.publish} */
    publish: '/publish',
    /** @deprecated Use {@link ROUTES.dashboard.tasks} */
    tasks: '/tasks',
    /** @deprecated Use {@link ROUTES.dashboard.logs} */
    logs: '/logs',
    /** @deprecated Use {@link ROUTES.dashboard.analytics} */
    analytics: '/analytics',
  },
} as const

// ── Relative dashboard routes (AppShell's nested mobile <Routes> only) ──
//
// AppShell renders its own inner <Routes> for both desktop sidebar
// and mobile bottom-nav. The MOBILE variant uses RELATIVE paths
// because the parent <Route path="/dashboard/*"> in App.tsx
// provides the `/dashboard` prefix at runtime — the inner
// `/publish` resolves to `/dashboard/publish` only when nested
// under the dashboard wildcard parent.
//
// The DESKTOP nav uses ABSOLUTE paths (ROUTES.dashboard.publish)
// because it renders as a top-level nav-link list, not as a
// nested <Route>.
//
// Keeping these as a separate constant avoids two problems:
//   (a) Hardcoding `/publish` etc. in the mobile block — drift
//       risk if a route is renamed in ROUTES.dashboard.*
//   (b) Calling `.replace('/dashboard', '')` on the absolute
//       paths at the use site — ugly + fragile (the slash count
//       must be exact or the route silently fails to match)
//
// Sync requirement: every entry in RELATIVE_DASHBOARD_ROUTES must
// mirror the post-`/dashboard` suffix of the corresponding
// ROUTES.dashboard entry. The constants CANNOT be derived from
// each other (TypeScript can't assert "this constant is a prefix
// slice of that constant" at compile time), so a future refactor
// that renames a dashboard route must update BOTH places. The
// routes.ts unit test (when added) should pin the suffix equality
// to catch silent drift.
export const RELATIVE_DASHBOARD_ROUTES = {
  root: '/',
  publish: '/publish',
  tasks: '/tasks',
  calendar: '/calendar',
  analytics: '/analytics',
  logs: '/logs',
  inbox: '/inbox',
  account: '/account',
  settings: '/settings',
  personalization: '/personalization',
  studio: '/studio',
  /** React Router path pattern (NOT a template literal) — `:id` is extracted
   *  via `useParams()` in StudioDetailPage. Mirrors ROUTES.dashboard.studioDetail
   *  but as a pattern string since relative paths don't need interpolation. */
  studioDetail: '/studio/:id',
  // Admin sub-routes (relative — mobile renders these inside the
  // `/dashboard/*` parent).
  admin: {
    root: '/admin',
    users: '/admin/users',
    audit: '/admin/audit',
  },
} as const

// ── Public route allowlist for the 401 interceptor ────────────────────
//
// Mirrored here so the 401-response-interceptor has a single import
// surface for the canonical "this is a public auth-bearing page" set
// (vs. importing directly from `routes.ts` AND `authApi.ts`).
// Previously lived inline in `_createAuth401ResponseInterceptor.ts`
// as a `ReadonlySet<string>`. As a const array it's easier to read
// in tests + lint.
// Object.freeze makes the readonly contract true at BOTH compile time
// (the `ReadonlyArray<string>` type) AND runtime (so
// `PUBLIC_AUTH_PATHS.push(...)` throws TypeError, not silently
// succeeds). The routes.test.ts suite asserts both layers; a
// future refactor that drops the freeze (re-introducing a
// mutable string[] under a `readonly` type) fails the test
// at the .push() line, catching the contract violation.
export const PUBLIC_AUTH_PATHS: ReadonlyArray<string> = Object.freeze([
  ROUTES.public.login,
  ROUTES.public.loginAuth,
  ROUTES.public.forgotPassword,
  ROUTES.public.resetPassword,
])

// ── `Route` union type ─────────────────────────────────────────────────
//
// Exhaustive union of every concrete path literal in the manifest.
// Consumers can use this to lock prop types to known routes:
//
//   interface MyComponentProps { to: Route }
//   function MyComponent({ to }: MyComponentProps) { return <Link to={to} /> }
//
// Note: this union does NOT include:
//   - `ROUTES.legacy.appWildcard` (`/app/*`) — React Router path-pattern, not navigable
//   - `ROUTES.dashboard.studioDetail(...)` — parametric builder, returns `string` (not assignable to Route)
//   - The `*` 404 catch-all in App.tsx — same reason as appWildcard
export type PublicRoute = (typeof ROUTES)['public'][keyof (typeof ROUTES)['public']]
export type DashboardRoute = (typeof ROUTES)['dashboard'][Exclude<
  keyof (typeof ROUTES)['dashboard'],
  'studioDetail' | 'admin'
>]
export type AdminRoute = (typeof ROUTES)['dashboard']['admin'][keyof (typeof ROUTES)['dashboard']['admin']]
export type LegacyRoute = (typeof ROUTES)['legacy'][Exclude<keyof (typeof ROUTES)['legacy'], 'appWildcard'>]
export type Route = PublicRoute | DashboardRoute | AdminRoute | LegacyRoute

// ── Legacy shim redirects (single source of truth) ───────────────────────
//
// Type-safe map of legacy shim source path → canonical target. Drives
// the `<Route path={legacyPath} element={<Navigate to={target} />} />`
// shims in `App.tsx`. Exhaustive `Record<LegacyRoute, DashboardRoute>` (all 5 shim targets are dashboard routes, not legacy) — adding a
// new entry to `ROUTES.legacy` forces a corresponding target here.
// `appWildcard: \'/app/*\'` is intentionally NOT a key — it\'s a path
// PATTERN (React Router wildcard), not a navigable path, so the
// `LegacyRoute` union excludes it; that shim is handled by the separate
// `LegacyAppRedirect` component.
export const LEGACY_SHIM_REDIRECTS: Record<LegacyRoute, DashboardRoute> = {
  [ROUTES.legacy.app]: ROUTES.dashboard.root,
  [ROUTES.legacy.publish]: ROUTES.dashboard.publish,
  [ROUTES.legacy.tasks]: ROUTES.dashboard.tasks,
  [ROUTES.legacy.logs]: ROUTES.dashboard.logs,
  [ROUTES.legacy.analytics]: ROUTES.dashboard.analytics,
}

