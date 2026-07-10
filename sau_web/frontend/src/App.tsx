import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ROUTES, LEGACY_SHIM_REDIRECTS, type LegacyRoute } from '@/routes'
import { registerNavigate } from '@/lib/navigation'

// Derived: hoist the `as LegacyRoute` cast out of the map callback
// so `LEGACY_SHIM_REDIRECTS[legacyPath]` is fully type-safe.
const LEGACY_PATHS = Object.keys(LEGACY_SHIM_REDIRECTS) as LegacyRoute[]
import { TooltipProvider } from '@/Components/ui/tooltip'
import { AccountsProvider } from '@/features/accounts/AccountsProvider'
import { ThemeProvider } from './Components/ThemeProvider'
import { ToastProvider } from '@/Components/ui/toast'
import { ErrorBoundary } from './Components/ErrorBoundary'
import { NotFound } from './Components/NotFound'
import { AuthLoadingSkeleton } from './features/auth/AuthLoadingSkeleton'
import AppShellWithPrefs from './AppShell'

const LoginPage = lazy(() => import('./Pages/LoginPage'))
const LoginAuthPage = lazy(() => import('./Pages/LoginAuthPage'))
const ForgotPasswordPage = lazy(() => import('./Pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./Pages/ResetPasswordPage'))
const LandingPage = lazy(() => import('./Pages/LandingPage'))
const CatalogPage = lazy(() => import('./Pages/CatalogPage'))
const PricingPage = lazy(() => import('./Pages/PricingPage'))
const AboutPage = lazy(() => import('./Pages/AboutPage'))
const HotListPage = lazy(() => import('./Pages/HotListPage'))

const LazyOnboardingTour = lazy(() =>
  import('./Components/OnboardingTour').then((m) => ({ default: m.OnboardingTour }))
)

// LegacyAppRedirect — Round-OPT-route-rename: catches any URL
// that still uses the pre-rename `/app/*` prefix and forwards it
// to the new `/dashboard/*` form, preserving the descending splat
// (e.g. `/dashboard/studio/abc` → `/dashboard/studio/abc`),
// the query string, and the hash fragment. `replace` keeps the
// history stack clean so Back doesn't yank the visitor to a URL
// that just bounces again. Without this shim, anyone holding
// bookmarks, team-shared links, or stale OAuth confirmation
// emails would 404 on the old prefix.
function LegacyAppRedirect() {
  const { pathname, search, hash } = useLocation()
  return (
    <Navigate
      to={pathname.replace(/^\/app/, '/dashboard') + search + hash}
      replace
    />
  )
}

/**
 * Round-OPT-3G followup: register the imperative `navigateInApp()`
 * once at the top of the <BrowserRouter> tree so axios-level
 * response interceptors can navigate without a hard reload.
 *
 * Lives as a SIBLING of <Routes> (NOT a child) so it never gets
 * unmounted by an error boundary or by a route change. Uses
 * useEffect (NOT useMemo) — registration is a side-effect and
 * MUST run after first commit; useMemo would register
 * synchronously on first render which is technically safe but
 * not idiomatic for hooks that capture React Router context.
 *
 * The `<></>` rendering is intentional — Null-rendering keeps
 * React's reconciliation pass without adding a wrapper DOM
 * node. Without this, an empty `<></>` block would still be a
 * fragment in the tree.
 */
function RegisterNavigate() {
  const navigate = useNavigate()
  useEffect(() => registerNavigate(navigate), [navigate])
  return null
}

function App() {
  /* AccountsProvider is hoisted ABOVE LazyOnboardingTour so the tour can
   * read `useAccountGroups()` and adapt step 3 (build-first or add-auth)
   * to whether the user already has groups. Without this hoisting the
   * AutoStartTour child of TourProvider would render outside the
   * accounts context and the selector fallback could not react.
   *
   * ErrorBoundary is hoisted ABOVE Suspense so the boundary catches
   * BOTH lazy-load rejections (LazyOnboardingTour + nested lazy Route
   * components) AND runtime errors from deeper descendants. With the
   * boundary INSIDE Suspense, a rejected chunk would bubble past Suspense
   * (which only handles pending→fallback, not throws) to the React root
   * — producing a white page with no error UI. The hoisted boundary
   * turns the rejection into ErrorBoundary's inline "页面出错了" card.
   *
   * Round-OPT-3J follow-up: Suspense fallbacks now render the shared
   * `AuthLoadingSkeleton` (see features/auth/AuthLoadingSkeleton.tsx)
   * instead of the React-default `null`. Same chrome + sketched
   * content-area contract as the AuthGuard auth window, so a slow
   * lazy chunk paints identically to a slow /api/auth/me — no
   * visible "加载中…" overlay, no layout jank. The error path
   * (rejected chunk / runtime throw) still surfaces via the hoisted
   * ErrorBoundary card. */
  return (
    <BrowserRouter>
      {/* Imperative-navigate registry — first child of
          BrowserRouter so registration happens before any
          route child can fire an axios 401-driven redirect. */}
      <RegisterNavigate />
      <ThemeProvider defaultTheme="system" storageKey="sau-ui-theme">
        <TooltipProvider>
          <ToastProvider>
            <AccountsProvider>
              <ErrorBoundary>
                <Suspense fallback={<AuthLoadingSkeleton />}>
                  <LazyOnboardingTour>
                    {/* Login route renders standalone — no sidebar, header, or floating logs */}
                    <Routes>
                    {/* Root `/` is the public marketing landing page. No
                     *  AuthGuard — the surface is intentionally open so
                     *  unauthenticated visitors from the GitHub README
                     *  see the project pitch before being asked to log
                     *  in. The "go to Web Shell" CTA in the CTA section
                     *  is the path that bounces through AppShell →
                     *  AuthGuard → /login (anonymous) or the
                     *  dashboard (authenticated). */}
                    <Route
                      path={ROUTES.public.landing}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <LandingPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path={ROUTES.public.login}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <LoginPage />
                        </Suspense>
                      }
                    />
                    {/* Visitor-facing pricing (`/pricing`) — public route,
                     *  parallel to `/` and `/login`. Drives the paying-
                     *  customer conversion funnel: anonymous visitors see
                     *  the 3-tier table, click → /login?plan=<tier> which
                     *  is also public (no AuthGuard). See DESIGN.md round 4
                     *  for the visitor-surface composition rule. */}
                    <Route
                      path={ROUTES.public.pricing}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <PricingPage />
                        </Suspense>
                      }
                    />
                    {/* Visitor-facing about (`/about`) — round 12. New
                     *  public surface composed of SectionHeading + Stat
                     *  + PricingTier with the `data-section` +
                     *  `data-section-cell` test-id scaffold. No inline
                     *  alternatives. Parallel to `/` and `/pricing`
                     *  (no AuthGuard). */}
                    <Route
                      path={ROUTES.public.about}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <AboutPage />
                        </Suspense>
                      }
                    />
                    {/* Public hot list page — aggregates trending data from
                     *  12+ Chinese social platforms via DailyHotApi.
                     *  No AuthGuard — intentionally open for visitors. */}
                    <Route
                      path={ROUTES.public.hotlist}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <HotListPage />
                        </Suspense>
                      }
                    />
                    {/* Auth form (`/login/auth`) — round 12 sub-route.
                     *  PricingPage's deep-link CTAs land here directly,
                     *  bypassing the `/login` visitor pitch so mid-funnel
                     *  visitors go straight to the form with their
                     *  `?plan=<tier>` / `?intent=contact` preserved. */}
                    <Route
                      path={ROUTES.public.loginAuth}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <LoginAuthPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path={ROUTES.public.forgotPassword}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <ForgotPasswordPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path={ROUTES.public.resetPassword}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <ResetPasswordPage />
                        </Suspense>
                      }
                    />
                    {/* Legacy URL shims — catches the in-app `navigate()`
                     *  call sites that still target the pre-rename
                     *  `/publish`, `/tasks`, `/logs`, `/analytics` paths.
                     *  Each replaces the URL with the new `/dashboard/*`
                     *  form so React Router resolves the path on the next
                     *  pass. The `/app/*` LegacyAppRedirect catches
                     *  bookmarks + shared links that still use the old
                     *  prefix. */}
                    {LEGACY_PATHS.map((legacyPath) => (
                      <Route
                        key={legacyPath}
                        path={legacyPath}
                        element={
                          <Navigate
                            to={LEGACY_SHIM_REDIRECTS[legacyPath]}
                            replace
                          />
                        }
                      />
                    ))}
                    {/* Round-OPT-route-rename — bare `/app` shim. React
                     *  Router v6's `<Route path="/app/*">` requires at
                     *  least one character after the slash, so a
                     *  bookmark to `…/app` (no trailing path) would
                     *  fall through to the 404 handler. This sibling
                     *  Route covers the bare-prefix case and forwards
                     *  to `/dashboard` (with no trailing slash so the
                     *  sidebar's active-state exact match still works). */}
                    <Route path={ROUTES.legacy.appWildcard} element={<LegacyAppRedirect />} />
                    {/* Dashboard (auth-protected via the AuthGuard inside
                     * AppShell's child routes) — nested under `/dashboard`
                     *  so the public `/` marketing route can share the
                     *  same SPA without AuthGuard interception. */}
                    <Route path={`${ROUTES.dashboard.root}/*`} element={<AppShellWithPrefs />} />
                    {/* Live component catalog (`pnpm dev` → /catalog). No
                     *  sidebar / header chrome — a standalone surface so
                     *  you can visually inspect the 9 components without
                     *  an authed context. */}
                    <Route
                      path={ROUTES.public.catalog}
                      element={
                        <Suspense fallback={<AuthLoadingSkeleton />}>
                          <CatalogPage />
                        </Suspense>
                      }
                    />
                    {/* Standalone 404 — no shell chrome. */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </LazyOnboardingTour>
                </Suspense>
              </ErrorBoundary>
            </AccountsProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
