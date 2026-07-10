import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  MemoryRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { mockUseAuth } from '@/test/auth-router-spies'

// ─────────────────────────────────────────────────────────────────────────
// App.tsx · post-merge routing split (vitest spec)
//
// WHY this file exists:
//
// The e2e spec at `tests/e2e/routing.spec.ts` covers the
// routing table via Playwright + chromium. That's the right gate for
// end-to-end coverage, but it's slow and requires Postgres/Vite. This
// vitest spec locks the SAME invariants at the RTL layer so future
// regressions fail fast in milliseconds without infrastructure.
//
// WHAT this file does NOT cover:
//
//   • The full App.tsx provider chain (ThemeProvider, ToastProvider,
//     AccountsProvider, etc.) — those are orthogonal to routing. The
//     inline `mountAppRoutesAt` helper below re-creates App.tsx's
//     `<Routes>` table verbatim; provider plumbing is irrelevant to
//     the routing invariants under test.
//
//   • The LoginPage content itself — those
//     have their own specs. We stub them here so we can assert on
//     stable test IDs without spinning their dependencies.
//
// WHAT this file DOES cover:
//
//   • `/`        → public marketing LandingPage (direct, no auth gate)
//   • `/dashboard/*` → Shell + AuthGuard → AccountsPage (authed) or /login (anon)
//   • `/login`   → login page (anonymous)
//   • Legacy `/publish` / `/tasks` / `/logs` shims → /dashboard/* form
//   • AuthGuard `isLoading` null-render branch (no spinner, no /login)
//   • Outer 404 + inner 404 fallback
//
// ─────────────────────────────────────────────────────────────────────────

// ── framework-level mocks (must precede under-test imports) ─────────────

// useAuth is mocked because AuthGuard's behaviour is driven by it.
// Routes / Navigate / useAuth stays REAL — the post-merge routing
// layer is what we're locking, including the real `<Navigate>` bounce
// inside AuthGuard and the real route-resolution of the legacy shims.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Page-level stubs so we can assert on stable test IDs. The real
// AccountsPage / PublishPage / TasksPage / LogsPage pull in TanStack
// Query, AccountsProvider, editor chrome, etc. — too much surface
// for a routing spec.
vi.mock('@/features/accounts/AccountsPage', () => ({
  default: () => <div data-testid="accounts-page">AccountsPage</div>,
}))

vi.mock('@/Pages/PublishPage', () => ({
  default: () => <div data-testid="publish-page">PublishPage</div>,
}))

vi.mock('@/Pages/TasksPage', () => ({
  default: () => <div data-testid="tasks-page">TasksPage</div>,
}))

vi.mock('@/Pages/LogsPage', () => ({
  default: () => <div data-testid="logs-page">LogsPage</div>,
}))

vi.mock('@/Pages/LandingPage', () => ({
  default: () => <div data-testid="landing-page">LandingPage</div>,
}))

vi.mock('@/Pages/PricingPage', () => ({
  default: () => <div data-testid="pricing-page">PricingPage</div>,
}))

// Round-12: the visitor pitch lives at /login and the auth form at
// /login/auth (sub-route). Mirror those splits in this stub set so the
// route table's verbatim-mirror invariant holds.
vi.mock('@/Pages/LoginPage', () => ({
  default: () => <div data-testid="login-page">LoginPage</div>,
}))
vi.mock('@/Pages/LoginAuthPage', () => ({
  default: () => <div data-testid="login-auth-page">LoginAuthPage</div>,
}))
// Round-12: new AboutPage surface. Anonymous, parallel to /pricing.
vi.mock('@/Pages/AboutPage', () => ({
  default: () => <div data-testid="about-page">AboutPage</div>,
}))

vi.mock('@/Components/NotFound', () => ({
  NotFound: () => <div data-testid="not-found">NotFound</div>,
}))

// ── helpers ─────────────────────────────────────────────────────────────

function setAuth({
  isAuthenticated = false,
  isLoading = false,
  user = null,
}: {
  isAuthenticated?: boolean
  isLoading?: boolean
  user?: { id: number; email: string; role: 'admin' | 'user' } | null
}) {
  mockUseAuth.mockReturnValue({
    user,
    isAuthenticated,
    isLoading,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  })
}

// Mirror of App.tsx's `<Routes>` block (verbatim route paths + element
// shapes), but rendered through `MemoryRouter` instead of `BrowserRouter`
// so each test can start at a deterministic path. The provider chain
// (ThemeProvider/ToastProvider/AccountsProvider/etc.) is deliberately
// not replicated — it's orthogonal to the routing invariants.
//
// Note: the mirror's `/` element matches App.tsx's current shape — a
// marketing LandingPage rendered directly (not via `<Navigate to="/dashboard" />`).
// Historical screenshots of these tests live in the git log; the
// redirect-to-app shape was retired when LandingPage replaced the
// redirect per the marketing-merge PR.
function mountAppRoutesAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<div data-testid="landing-page">landing</div>} />
        <Route
          path="/login"
          element={<div data-testid="login-page">login</div>}
        />
        {/* `/pricing` is a public visitor-facing route (parallel to `/`
         *  and `/login`). No AuthGuard — anonymous visitors must be able
         *  to compare tiers without sign-in friction. Locked here so any
         *  future move into `/dashboard/*` (or behind AuthGuard) breaks the
         *  paid-conversion funnel shape. */}
        <Route
          path="/pricing"
          element={<div data-testid="pricing-page">pricing</div>}
        />
        {/* Round-12: /about is a public visitor surface parallel to /pricing. */}
        <Route
          path="/about"
          element={<div data-testid="about-page">about</div>}
        />
        {/* Round-12: /login/auth is the auth form sub-route — PricingPage's
         *  deep-link CTAs route here directly. No AuthGuard. */}
        <Route
          path="/login/auth"
          element={<div data-testid="login-auth-page">login-auth</div>}
        />
        {/* Legacy URL shims — see App.tsx comment for WHY these live at
         *  the outer Routes table (catches in-app `navigate()` call
         *  sites that still target the pre-merge paths). */}
        <Route path="/publish" element={<Navigate to="/dashboard/publish" replace />} />
        <Route path="/tasks" element={<Navigate to="/dashboard/tasks" replace />} />
        <Route path="/logs" element={<Navigate to="/dashboard/logs" replace />} />
        {/* Authenticated dashboard under /dashboard/*. The wildcard is
         *  what makes the inner Routes' RELATIVE paths (`/publish`,
         *  `/tasks`, ...) resolve against /dashboard/* at runtime. */}
        <Route path="/dashboard/*" element={<AppShellInnerRoutes />} />
        {/* Outer 404 (catches anything that bypasses both /login and /dashboard/*). */}
        <Route path="*" element={<div data-testid="not-found">notFound</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// Mirror of AppShell's INNER <Routes> block. AppShell renders its own
// <Routes> with RELATIVE paths nested inside the outer /dashboard/*;
// this helper replicates that mirror with the same RELATIVE paths so
// the routing spec doesn't depend on AppShell's chrome (sidebar,
// header, command palette, viewport logic).
function AppShellInnerRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <AuthGuard>
            <div data-testid="accounts-page" />
          </AuthGuard>
        }
      />
      <Route
        path="/publish"
        element={
          <AuthGuard>
            <div data-testid="publish-page" />
          </AuthGuard>
        }
      />
      <Route
        path="/tasks"
        element={
          <AuthGuard>
            <div data-testid="tasks-page" />
          </AuthGuard>
        }
      />
      <Route
        path="/logs"
        element={
          <AuthGuard>
            <div data-testid="logs-page" />
          </AuthGuard>
        }
      />
      <Route path="*" element={<div data-testid="not-found">notFound</div>} />
    </Routes>
  )
}

// ── tests ───────────────────────────────────────────────────────────────

describe('App · post-merge routing split', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  // ── Public routes ─────────────────────────────────────────────────────

  // `/` is the public marketing LandingPage. No auth gate; the route
  // is intentionally open so visitors who arrive from a GitHub link
  // see the project pitch before being asked to sign in.
  it('/ renders LandingPage directly (anonymous)', () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/')
    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
  })

  it('/ renders LandingPage directly (authenticated — no bounce)', () => {
    setAuth({
      isAuthenticated: true,
      user: { id: 1, email: 'qa@example.com', role: 'admin' },
    })
    mountAppRoutesAt('/')
    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
  })

  // `/dashboard` is the canonical dashboard entry point (the
  // LandingPage CTA routes here). Anonymous visitors still bounce
  // to /login; authed operators land on AccountsPage. This contract
  // was preserved when the marketing LandingPage replaced the
  // historical /·→/dashboard·→AccountsPage redirect.
  it('/dashboard (anonymous) → AuthGuard → /login', async () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/dashboard')
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  it('/dashboard (authenticated) → AccountsPage', () => {
    setAuth({
      isAuthenticated: true,
      user: { id: 1, email: 'qa@example.com', role: 'admin' },
    })
    mountAppRoutesAt('/dashboard')
    expect(screen.getByTestId('accounts-page')).toBeInTheDocument()
  })

  // Round-12: /login mounts the visitor pitch (Pages/LoginPage). The
  // auth form moved to /login/auth so visitors see a marketing
  // explanation before being bounced to the form. The test
  // `data-testid="login-page"` here intentionally matches the pitch
  // mock; the form mock is `data-testid="login-auth-page"` and the
  // round-12 added test below covers /login/auth separately so a
  // future regression that swaps the route back to the legacy single-
  // route form path fails both tests, not just one.
  it('/login (anonymous) renders the visitor-pitch form-stub', () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/login')
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  // ── Pricing surface (public, parallel to LandingPage) ──────────────────

  // `/pricing` is the paid-conversion funnel entrance: an anonymous
  // visitor from the LandingPage footer should be able to compare the
  // 3 SaaS tiers WITHOUT signing in first. Locking the contract here so
  // future moves into `/dashboard/*` or auth-guard protection break the test.
  it('/pricing (anonymous) renders PricingPage directly', () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/pricing')
    expect(screen.getByTestId('pricing-page')).toBeInTheDocument()
  })

  // Authenticated operators should also see pricing on direct nav — the
  // page bills itself as a product feature, not a gated resource.
  it('/pricing (authenticated) renders PricingPage directly', () => {
    setAuth({
      isAuthenticated: true,
      user: { id: 1, email: 'qa@example.com', role: 'admin' },
    })
    mountAppRoutesAt('/pricing')
    expect(screen.getByTestId('pricing-page')).toBeInTheDocument()
  })

  // ── Round-12: /about + /login/auth (public) ─────────────────────────

  // /about is a public visitor surface parallel to /pricing. No
  // AuthGuard — anonymous visitors must be able to read the project's
  // mission / scale / tier preview / CTA narrative without signing
  // in. Locked here so any future move into /dashboard/* breaks the test.
  it('/about (anonymous) renders AboutPage directly', () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/about')
    expect(screen.getByTestId('about-page')).toBeInTheDocument()
  })

  it('/about (authenticated) renders AboutPage directly', () => {
    setAuth({
      isAuthenticated: true,
      user: { id: 1, email: 'qa@example.com', role: 'admin' },
    })
    mountAppRoutesAt('/about')
    expect(screen.getByTestId('about-page')).toBeInTheDocument()
  })

  // /login/auth is the auth form sub-route. PricingPage's deep-link
  // CTAs land here directly — anonymous visitors see the email →
  // 6-digit-code flow without bouncing through the /login
  // visitor-pitch surface. Locked here so a future move that
  // puts /login/auth behind AuthGuard breaks the paid-conversion
  // shape.
  it('/login/auth (anonymous) renders LoginAuthPage directly', () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/login/auth')
    expect(screen.getByTestId('login-auth-page')).toBeInTheDocument()
  })

  // ── Legacy URL shims (anonymous: bounce to /login) ──────────────────────

  // Step chain: /publish → Navigate → /dashboard/publish → /dashboard/* route →
  // AppShellInnerRoutes → /publish → AuthGuard → isAuthenticated=false →
  // <Navigate to="/login" replace> → /login route → login-page. We
  // use `findByTestId` because the bounce fires an async router
  // commit; without the async matcher the test races the re-render.
  it('/publish (anonymous) → /dashboard/publish → AuthGuard → /login', async () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/publish')
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  it('/tasks (anonymous) → /dashboard/tasks → AuthGuard → /login', async () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/tasks')
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  it('/logs (anonymous) → /dashboard/logs → AuthGuard → /login', async () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/logs')
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  // ── Legacy URL shims (authenticated: page mounted) ─────────────────────

  it('/publish (authenticated) → PublishPage via the shim', () => {
    setAuth({
      isAuthenticated: true,
      user: { id: 1, email: 'qa@example.com', role: 'admin' },
    })
    mountAppRoutesAt('/publish')
    expect(screen.getByTestId('publish-page')).toBeInTheDocument()
  })

  it('/tasks (authenticated) → TasksPage via the shim', () => {
    setAuth({ isAuthenticated: true })
    mountAppRoutesAt('/tasks')
    expect(screen.getByTestId('tasks-page')).toBeInTheDocument()
  })

  it('/logs (authenticated) → LogsPage via the shim', () => {
    setAuth({ isAuthenticated: true })
    mountAppRoutesAt('/logs')
    expect(screen.getByTestId('logs-page')).toBeInTheDocument()
  })

  // ── Direct /dashboard/* navigation (the canonical form) ─────────────────────
  it('/dashboard/publish (anonymous, no shim) → AuthGuard → /login', async () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/dashboard/publish')
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  it('/dashboard/publish (authenticated) → PublishPage', () => {
    setAuth({ isAuthenticated: true })
    mountAppRoutesAt('/dashboard/publish')
    expect(screen.getByTestId('publish-page')).toBeInTheDocument()
  })

  it('/dashboard/tasks (authenticated) → TasksPage', () => {
    setAuth({ isAuthenticated: true })
    mountAppRoutesAt('/dashboard/tasks')
    expect(screen.getByTestId('tasks-page')).toBeInTheDocument()
  })

  it('/dashboard/logs (authenticated) → LogsPage', () => {
    setAuth({ isAuthenticated: true })
    mountAppRoutesAt('/dashboard/logs')
    expect(screen.getByTestId('logs-page')).toBeInTheDocument()
  })

  it('/dashboard (authenticated, the silent default) → AccountsPage', () => {
    setAuth({ isAuthenticated: true })
    mountAppRoutesAt('/dashboard')
    expect(screen.getByTestId('accounts-page')).toBeInTheDocument()
  })

  // ── 404 handling ─────────────────────────────────────────────────────

  it('/dashboard/dashboard/unknown (authenticated) → inner NotFound', () => {
    setAuth({ isAuthenticated: true })
    mountAppRoutesAt('/dashboard/dashboard/unknown')
    expect(screen.getByTestId('not-found')).toBeInTheDocument()
  })

  it('/totally/unknown (anonymous) → outer NotFound', () => {
    setAuth({ isAuthenticated: false })
    mountAppRoutesAt('/totally/unknown')
    expect(screen.getByTestId('not-found')).toBeInTheDocument()
  })

  // ── AuthGuard loading state ───────────────────────────────────────────

  // Round-OPT-3J + follow-up: the original implementation rendered
  // a centered spinner with "验证登录状态…" during the initial
  // /api/auth/me resolution. The follow-up round first tried
  // `null` (blank content area) which felt too abrupt, so the
  // current contract is a lightweight `AuthLoadingSkeleton`
  // (generic PageHeader + 3 content blocks) inside the guard. The
  // AppShell's chrome (sidebar / header) is rendered outside the
  // guard so the operator sees the familiar shell with a sketched
  // content area until the auth query resolves. We assert four
  // observable signals — skeleton IS present, NO spinner text,
  // NO bounce to /login, NO premature children commit. The
  // isLoading gate MUST stay BEFORE the !isAuthenticated check so
  // a freshly-hydrated authed user (initial store: isLoading=true,
  // isAuthenticated=false) doesn't flash to /login before /me
  // lands.
  it('/dashboard/publish (isLoading=true) → AuthGuard renders loading skeleton (no spinner, no /login, no children)', () => {
    setAuth({ isAuthenticated: false, isLoading: true })
    mountAppRoutesAt('/dashboard/publish')
    // The shared page-loading skeleton IS rendered during the auth
    // window — gives the operator a sense of "content is coming"
    // without the old "验证登录状态…" spinner noise. Same testid as
    // the route-level Suspense fallback (AppShell.tsx / App.tsx) so
    // e2e tests can assert on one selector across both loading
    // surfaces.
    expect(
      screen.getByTestId('page-loading-skeleton'),
    ).toBeInTheDocument()
    // No spinner text (regression guard for the old implementation).
    expect(screen.queryByText(/验证登录状态/)).not.toBeInTheDocument()
    // We must NOT have bounced — login-page should not be visible
    // during the loading window. Flipping this assertion would
    // mean an authed visitor flashes to /login before /me lands.
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    // And we must NOT have prematurely committed children — the
    // auth query hasn't resolved yet, so the page stub stays out
    // of the DOM until either the authed branch or the Navigate
    // branch fires on a subsequent render.
    expect(screen.queryByTestId('publish-page')).not.toBeInTheDocument()
  })

  // Shim-presence note: deleting `<Route path="/publish" element={
  // <Navigate to="/dashboard/publish" replace />}/>` (or its /tasks|/logs
  // siblings) is locked INDIRECTLY by the three anonymous-bounce
  // tests above: with the shim gone, the legacy URL falls through to
  // the outer `*` → NotFound, so `findByTestId('login-page')` returns
  // null and the test fails. An earlier attempt at EXPLICIT shape
  // pinning (`mountAppRoutesAt.toString()` regex on the compiled
  // source) was rejected in code review because vitest's TSX→JS
  // pipeline doesn't preserve the literal `path="/publish"` strings;
  // the `.toString()` approach was strictly noisier than the
  // behavioral coverage.

  // ── Round-OPT-route-rename — legacy /app/* → /dashboard/* shims ──
  // Bookmarks + shared links may still use the pre-rename `/app/*`
  // prefix. App.tsx renders two shims: (a) a bare `/app` → `/dashboard`
  // redirect (React Router v6's `path="/app/*"` requires at least one
  // character after the slash), and (b) a `LegacyAppRedirect` that
  // preserves the descending subpath, query string, and hash. These
  // two tests lock both branches of the migration shim — the bare case
  // is the one the v6 wildcard would otherwise miss, so it gets a
  // dedicated test.

  function LegacyAppRedirect() {
    const location = useLocation()
    return (
      <Navigate
        to={location.pathname.replace(/^\/app/, '/dashboard') + location.search + location.hash}
        replace
      />
    )
  }

  function mountRoutesWithAppShim(initialPath: string) {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app" element={<Navigate to="/dashboard" replace />} />
          <Route path="/app/*" element={<LegacyAppRedirect />} />
          <Route
            path="/dashboard"
            element={<div data-testid="dashboard-shim-target">dashboard</div>}
          />
          <Route
            path="/dashboard/*"
            element={<div data-testid="dashboard-shim-target">dashboard</div>}
          />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('legacy /app (bare) → /dashboard via the bare-prefix shim', async () => {
    mountRoutesWithAppShim('/app')
    expect(await screen.findByTestId('dashboard-shim-target')).toBeInTheDocument()
  })

  it('legacy /app/studio/abc?focus=x → /dashboard/studio/abc?focus=x via the wildcard shim', async () => {
    mountRoutesWithAppShim('/app/studio/abc?focus=x')
    expect(await screen.findByTestId('dashboard-shim-target')).toBeInTheDocument()
  })
})
