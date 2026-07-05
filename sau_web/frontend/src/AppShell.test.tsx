import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { AppShell, SIDEBAR_STORAGE_KEY as APP_SHELL_SIDEBAR_KEY } from './AppShell'
import { mockUseAuth } from '@/test/auth-router-spies'
import { makeQueryClient } from '@/test/render-harness.helpers'

// ─────────────────────────────────────────────────────────────────────────
// AppShell · sidebar contract test (MemoryRouter wrap + layout invariants).
//
// WHY this file exists:
//
// 1. Pre-existing Page-spec breakage pattern. On `main`, all 3 Page-level
//    specs (`AccountsPage.test.tsx`, `PublishPage.test.tsx`,
//    `LoginPage.test.tsx`) failed because the test mount wrapped React
//    Router context the wrong way — either double-wrap ("Router inside
//    Router") or no wrap ("useLocation may be used only in the context
//    of a <Router>"). This file's first test (a) explicitly renders
//    AppShell inside <MemoryRouter> and asserts a stable render —
//    catching any future regression that drops or miswraps the Router
//    context for AppShell directly. The same file then pins three
//    layout invariants we've committed across the OPT-footer rounds:
//
// 2. Aside width `w-[260px]` (expanded) / `w-[60px]` (collapsed).
//    220 → 240 → 260 px progression across rounds; pinning stops this
//    drift. Collapsed-rail 60 px unchanged across all rounds.
//
// 3. Email font `text-[14px]` sans. Bumped from `text-[13px]` in
//    round-OPT-footer v3 (density-recalibration after v2 read as
//    cramped). Fits inside 260-px sidebar's ~110-px user-info
//    column for common dev emails (`local@sau.dev`,
//    `qa@example.com` measure ~95-px wide at 14-px sans). Long-
//    form real-world emails still hit `truncate` — same as v2.
//    Pinning stops regression below 14-px (under 14 reads as
//    caption, not body, per DESIGN.md typographic ladder).
//
// 4. Collapsed-mode footer compact treatment: avatar stays `h-8 w-8`,
//    logout button + <ThemeToggle size="compact"> both `h-7 w-7` /
//    icon `h-3.5 w-3.5`. The previous 28 vs 32 px mismatch inside
//    one container read as half-aligned; pinning stops the drift back
//    to non-uniform button sizes.
//
// WHAT this file does NOT cover:
//
// • The remaining <App /> provider chain — ThemeProvider /
//   ToastProvider / AccountsProvider / ErrorBoundary /
//   LazyOnboardingTour — those are orthogonal to AppShell's chrome
//   and live in App.test.tsx's routing layer.
//
// Test surface — 3 context providers + 8 vi.mock stubs replicate
// <App />'s chain at AppShell's mount point so the assertion layer
// stays narrowly scoped to the sidebar invariants (which don't need
// the full <App /> wrapping chain to render):
//
//   • 3 context providers (MemoryRouter / TooltipProvider /
//     QueryClientProvider) so AppShell + its first-order descendants
//     (ThemeToggle, CommandPalette) don't throw on missing context.
//     Per-provider rationale lives in `mountAppShell`'s inline
//     comment block.
//
//   • 8 vi.mock stubs at the framework boundary so the assertion
//     layer doesn't fire axios requests / dev-backend fetches / real
//     page chrome — useAuth (drives <AuthGuard>), @/api/client Proxy
//     (narrowed for `api.getTasks` so CommandPalette's useTasks()
//     resolves with a TaskItem[] shape, not the wide `{success,
//     data}` shape), and the 6 lazy route pages
//     (Account/Publish/Logs/Tasks/Analytics/Inbox).
//
// • Page-level chrome inside <main>. We stub all 6 lazy-loaded pages with
//   inline test-id divs so the inner <Suspense><Routes> doesn't block
//   render or pull in TanStack Query / editor chrome. Sidebar chrome is
//   rendered OUTSIDE <Suspense>, so we can assert on it synchronously
//   without `findByTestId` polling.
// ─────────────────────────────────────────────────────────────────────────

// ── framework-level mocks (must precede under-test imports) ─────────────

// useAuth is mocked so the real AuthGuard (which reads useAuth) can
// be driven by per-test state without booting authStore / TanStack
// Query / the /api/auth/me fetch. Mirrors App.test.tsx line ~50.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Round-OPT-prefs-dialog-v4 (slice extraction): UserMenu (rendered
// transitively inside AppShell's sidebar footer AND inside the
// mobile AppBar) calls usePreferencesDialog() to surface the 4 nav
// items. AppShell's mount tree has no <PreferencesDialogProvider>,
// so without this mock the hook throws "usePreferencesDialog must
// be used within a PreferencesDialogProvider" → all 5 AppShell
// tests fail. The stub keeps the dialog closed and exposes a
// no-op openPreferences spy so any future test asserting
// "UserMenu click triggers the dialog" can re-populate
// openPreferences.mock.calls without re-mounting the whole shell.
//
// Round-v4 CANONICAL: per the v4 reviewer verdict, the Provider
// component + its dispatch hook now live together in
// `PreferencesDialogProvider.tsx` (mirrors `<AccountsProvider />`
// + `useAccountsDispatch()` in one file). vi.mock targets that
// single path — the previous `PreferencesDialogProvider.helpers`
// target is invalid because the file no longer exports the hook.
vi.mock('@/features/preferences/PreferencesDialogProvider', () => ({
  usePreferencesDialog: () => ({
    open: false,
    activeTab: 'account',
    openPreferences: vi.fn(),
    closePreferences: vi.fn(),
    setActiveTab: vi.fn(),
  }),
}))

// Stub the api.client. <CommandPalette>'s useTasks() hook hits this
// when mounted — without the Proxy backstop, TanStack Query resolves
// useTasks' queryFn against the real axios/fetch call to
// localhost:3000 (dev backend), surfacing ECONNREFUSED.
//
// We NARROW the Proxy's `get` trap to return concrete shapes that
// match each known hook's queryFn contract. The previous wide-shape
// stub (`mockResolvedValue({ success: true, data: [] })` for every
// api.* call) was runtime-OK because no AppShell test asserts on
// tasks data — but a future CommandPalette fix that reads
// `tasks.map(t => t.task_id)` would silently throw on shape
// mismatch.
//
//   • `api.getTasks` → Promise<TaskItem[]> directly (matches
//     useTasks()' queryFn contract).
//   • Default: vi.fn() returning undefined — same fall-through as
//     InboxPage.test.tsx's Proxy. Callers see undefined and surface
//     the gap via a future explicit override here, rather than
//     masking with a wider-shape stub.
vi.mock('@/api/client', () => ({
  api: new Proxy(
    {},
    {
      get: (_target: object, prop: string) => {
        if (prop === 'getTasks') {
          return vi.fn().mockResolvedValue([])
        }
        return vi.fn()
      },
    },
  ),
}))

// Stub the 6 lazy-loaded route pages that AppShell's <Routes> refer to.
// Each stub renders a stable data-testid so future tests can assert on
// page-routing without re-thinking the lazy/Suspense plumbing.
vi.mock('@/features/accounts/AccountsPage', () => ({
  default: () => <div data-testid="stub-accounts-page">AccountsPage</div>,
}))

vi.mock('@/Pages/PublishPage', () => ({
  default: () => <div data-testid="stub-publish-page">PublishPage</div>,
}))

vi.mock('@/Pages/LogsPage', () => ({
  default: () => <div data-testid="stub-logs-page">LogsPage</div>,
}))

vi.mock('@/Pages/TasksPage', () => ({
  default: () => <div data-testid="stub-tasks-page">TasksPage</div>,
}))

vi.mock('@/Pages/AnalyticsPage', () => ({
  default: () => <div data-testid="stub-analytics-page">AnalyticsPage</div>,
}))

vi.mock('@/Pages/InboxPage', () => ({
  default: () => <div data-testid="stub-inbox-page">InboxPage</div>,
}))

// ── helpers ─────────────────────────────────────────────────────────────

// AppShell's `useState(() => ...)` initializer reads
// `localStorage['sau-sidebar-collapsed']` synchronously on the first
// render. Pre-seed localStorage in the helper so we get a deterministic
// initial state without having to fireEvent.click the toggle button
// and await state updates. We import the constant from App.tsx (where
// it lives) instead of string-duplicating it, so a future keyboard-
// key migration lands in lockstep between the two files.
const SIDEBAR_STORAGE_KEY = APP_SHELL_SIDEBAR_KEY

// AppShell's `useViewport()` calls `getIsMobile()` (reads
// window.innerWidth) AND `getShouldAutoCollapse()` (also reads
// window.innerWidth) during the *first* render. happy-dom+jest doesn't
// expose `window.innerWidth` as writable by default, so we set it via
// `Object.defineProperty` for the duration of each test.
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  })
}

function mountAppShell({
  initialPath = '/app',
  sidebarCollapsed = false,
  viewportWidth = 1280,
}: {
  initialPath?: string
  sidebarCollapsed?: boolean
  viewportWidth?: number
} = {}) {
  setViewportWidth(viewportWidth)
  localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  // Three context providers wrap <AppShell /> — mirrors the production
  // chain that <App /> provides around /app/* at the browser top level.
  // Catches the same layered provider-context failure pattern that was
  // uncovered in the pre-existing Page-spec failures on `main`:
  //
  //   • MemoryRouter        — AppShell's own useLocation / useNavigate
  //                            + the nested <Routes> need Router
  //                            context. This is the same <MemoryRouter>
  //                            pattern App.test.tsx uses. Removing the
  //                            wrap from this helper is what test
  //                            (a) protects against.
  //   • TooltipProvider     — <ThemeToggle> renders its compact-mode
  //                            <button> inside a Radix Tooltip wrapper
  //                            for accessible hover/focus labeling.
  //                            Without it, ThemeToggle's render throws
  //                            "Tooltip must be used within TooltipProvider".
  //   • QueryClientProvider — <CommandPalette> calls useTasks()
  //                            (TanStack Query hook) when scanning
  //                            its cmd-K index. Without it, that hook
  //                            throws "No QueryClient set, use
  //                            QueryClientProvider to set one".
  //
  // (No ToastProvider / AccountsProvider / ThemeProvider needed —
  // AppShell's render tree doesn't touch those.)
  return render(
    <TooltipProvider>
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  )
}

function setAuth({
  isAuthenticated = true,
  user = { id: 1, email: 'qa@example.com', role: 'admin' as const },
}: {
  isAuthenticated?: boolean
  user?: {
    id: number
    email: string
    role: 'admin' | 'user'
  } | null
} = {}) {
  mockUseAuth.mockReturnValue({
    user,
    isAuthenticated,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  })
}

// ── tests ───────────────────────────────────────────────────────────────

describe('AppShell · sidebar contract (MemoryRouter wrap + layout invariants)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    localStorage.removeItem(SIDEBAR_STORAGE_KEY)
  })

  // (a) MemoryRouter contract — AppShell must render under a <Router>
  // context. Without this wrap, every `useLocation`/`useNavigate` call
  // in AppShell throws "useLocation may be used only in the context of
  // a <Router>". This contract test is the regression shield for the
  // same `<MemoryRouter>`-miswrap pattern that caused 3 pre-existing
  // Page-spec failures on `main` (AccountsPage / PublishPage /
  // LoginPage). If a future PR deletes the `<MemoryRouter>` wrap from
  // `mountAppShell`, the assertion fails loudly — not via a confusing
  // react-router invariant mid-tree, but at the test-level.
  it('renders inside MemoryRouter without throwing (Router context required)', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ sidebarCollapsed: false })
    expect(screen.getByTestId('app-shell-sidebar')).toBeInTheDocument()
  })

  // (b.1) Aside width (expanded) — pinned at `w-[260px]` following the
  // round-OPT-footer progression (220 → 240 → 260 px). Catches a
  // future drift back to 220/240 px that would re-introduce the
  // email-truncation problem at 1024-px viewports.
  it('aside width is w-[260px] when sidebar expanded', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ sidebarCollapsed: false })
    const aside = screen.getByTestId('app-shell-sidebar')
    expect(aside.className).toMatch(/\bw-\[260px\]/)
  })

  // (b.2) Aside width (collapsed rail) — `w-[60px]` unchanged across
  // all OPT-footer rounds. The icon-only rail + collapse/expand
  // button pair are calibrated for this exact width.
  it('aside width is w-[60px] when sidebar collapsed', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ sidebarCollapsed: true })
    const aside = screen.getByTestId('app-shell-sidebar')
    expect(aside.className).toMatch(/\bw-\[60px\]/)
  })

  // (c) Email font — `text-[14px]` sans (post round-OPT-footer v3).
  // 13-px sans read as cramped on retina; bumped to 14-px so the
  // email sits in the body's "real identity text" band per
  // DESIGN.md's typographic ladder. 260-px sidebar's ~110-px
  // user-info column absorbs the wider 14-px glyph cleanly:
  // avatar(40) + gap-3.5(14) + gap-3.5(14) + buttons(58) = 126 px
  // non-text → text-col ≥ 110 px at 14-px sans. Common dev emails
  // (~95-px wide at 14-px) fit; long real-world emails still hit
  // `truncate` — explicit fallback (data-testid carries the same
  // `app-shell-sidebar-email` so the pin survives the v3 bump).
  it('email <span> uses text-[14px] font', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ sidebarCollapsed: false })
    const email = screen.getByTestId('app-shell-sidebar-email')
    expect(email.className).toMatch(/\btext-\[14px\]/)
  })

  // (d) Collapsed-mode footer contract — uniform `h-7 w-7` button
  // sizing for both logout AND <ThemeToggle size="compact">. The
  // previous round paired a 28-px logout button with the default
  // 32-px <ThemeToggle> inside one container, reading as half-aligned.
  // Pinning both to `h-7 w-7` cements the compact treatment.
  //
  // Avatar (h-8 w-8) is intentionally NOT pinned here — it's the
  // identity marker, deliberately taller than the icon buttons; the
  // hierarchy read is preserved by the avatar's separation, not by
  // mutual exclusion.
  //
  // Updated for the user-menu follow-up: the avatar is now a
  // <UserMenu mode="collapsed"> trigger button (h-8 w-8, aria-label
  // starts with `用户菜单`). The previous `:not([aria-label="登出"])`
  // selector would silently match that user-menu trigger as the
  // "first non-logout button" → failing the h-7 w-7 assertion. Tests
  // below use the ThemeToggle's mode-keyed aria-label prefix
  // (`切换到`) to disambiguate specifically from the user-menu trigger.
  it('collapsed-mode footer buttons are uniform h-7 w-7 (logout + ThemeToggle size="compact")', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ sidebarCollapsed: true })
    const footer = screen.getByTestId('app-shell-sidebar-footer-collapsed')

    // Logout button: aria-label="登出" uniquely disambiguates from
    // <ThemeToggle> (aria-label="切换到浅色模式"|"切换到深色模式")
    // AND from the user-menu avatar trigger (aria-label prefix
    // "用户菜单"). The "登出" anchor has been the unambiguous key
    // since round-OPT-footer v1.
    const logout = footer.querySelector('button[aria-label="登出"]')
    expect(logout).not.toBeNull()
    expect(logout!.className).toMatch(/\bh-7 w-7\b/)

    // ThemeToggle (compact size = h-7 w-7) — disambiguated from the
    // user-menu avatar trigger (h-8 w-8) by Radix's mode-keyed
    // aria-label prefix `切换到`. Both dark- and light-mode labels
    // share this prefix, so `^="切换到"` covers either branch.
    // The `:not([aria-label="登出"])` writeup from v1 still works in
    // principle, but only if the user-menu trigger isn't also a
    // `<button>` — once it is, the selector collides. Prefix match
    // is the smaller-footprint fix.
    const themeToggle = footer.querySelector(
      'button[aria-label^="切换到"]',
    )
    expect(themeToggle).not.toBeNull()
    expect(themeToggle!.className).toMatch(/\bh-7 w-7\b/)
  })
})
