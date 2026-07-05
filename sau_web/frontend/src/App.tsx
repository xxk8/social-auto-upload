import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { AccountsProvider } from '@/features/accounts/AccountsProvider'
import { ThemeProvider } from './Components/ThemeProvider'
import { ToastProvider } from '@/Components/ui/toast'
import { ErrorBoundary } from './Components/ErrorBoundary'
import { NotFound } from './Components/NotFound'
import AppShellWithPrefs from './AppShell'

const LoginPage = lazy(() => import('./Pages/LoginPage'))
const LoginAuthPage = lazy(() => import('./Pages/LoginAuthPage'))
const LandingPage = lazy(() => import('./Pages/LandingPage'))
const CatalogPage = lazy(() => import('./Pages/CatalogPage'))
const PricingPage = lazy(() => import('./Pages/PricingPage'))
const AboutPage = lazy(() => import('./Pages/AboutPage'))

const LazyOnboardingTour = lazy(() =>
  import('./Components/OnboardingTour').then((m) => ({ default: m.OnboardingTour }))
)

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        <span className="text-sm text-muted-foreground">加载中...</span>
      </div>
    </div>
  )
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
   * Suspense fallback is <PageLoader /> instead of null so a slow
   * OnboardingTour chunk shows a visible centered spinner instead of a
   * momentary blank canvas. <PageLoader /> is reused for the inner
   * <Suspense> wrappers around LoginPage + CatalogPage. */
  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" storageKey="sau-ui-theme">
        <TooltipProvider>
          <ToastProvider>
            <AccountsProvider>
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
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
                      path="/"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <LandingPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/login"
                      element={
                        <Suspense fallback={<PageLoader />}>
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
                      path="/pricing"
                      element={
                        <Suspense fallback={<PageLoader />}>
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
                      path="/about"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <AboutPage />
                        </Suspense>
                      }
                    />
                    {/* Auth form (`/login/auth`) — round 12 sub-route.
                     *  PricingPage's deep-link CTAs land here directly,
                     *  bypassing the `/login` visitor pitch so mid-funnel
                     *  visitors go straight to the form with their
                     *  `?plan=<tier>` / `?intent=contact` preserved. */}
                    <Route
                      path="/login/auth"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <LoginAuthPage />
                        </Suspense>
                      }
                    />
                    {/* Legacy URL shims — catches the in-app `navigate()`
                     *  call sites that still target the old `/publish`,
                     *  `/tasks`, `/logs` paths. Each replaces the URL with
                     *  the new `/app/*` form so React Router resolves the
                     *  path on the next pass. Without these shims, hitting
                     *  those old paths would 404 (the inner Routes will
                     *  only resolve relative to /app/* once we get there). */}
                    <Route path="/publish" element={<Navigate to="/app/publish" replace />} />
                    <Route path="/tasks" element={<Navigate to="/app/tasks" replace />} />
                    <Route path="/logs" element={<Navigate to="/app/logs" replace />} />
                    <Route path="/analytics" element={<Navigate to="/app/analytics" replace />} />
                    {/* Dashboard (auth-protected via the AuthGuard inside
                     *  AppShell's child routes) — nested under `/app` so
                     *  the public `/` marketing route can share the same
                     *  SPA without AuthGuard interception. */}
                    <Route path="/app/*" element={<AppShellWithPrefs />} />
                    {/* Live component catalog (`pnpm dev` → /catalog). No
                     *  sidebar / header chrome — a standalone surface so
                     *  you can visually inspect the 9 components without
                     *  an authed context. */}
                    <Route
                      path="/catalog"
                      element={
                        <Suspense fallback={<PageLoader />}>
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
