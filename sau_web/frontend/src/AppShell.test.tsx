import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@/test/user-event-shim'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { AppShell, SIDEBAR_STORAGE_KEY as APP_SHELL_SIDEBAR_KEY } from './AppShell'
import { mockUseAuth } from '@/test/auth-router-spies'
import { makeQueryClient } from '@/test/render-harness.helpers'
import i18n from '@/lib/i18n/config'

// Local jsdom 25 sometimes lazy-mounts window.localStorage AFTER
// module evaluation but BEFORE beforeEach runs. AppShell.tsx reads
// `localStorage.getItem(SIDEBAR_STORAGE_KEY)` in its `useState(() =>\n// …)` initializer at first render — and this test's `beforeEach`\n// `localStorage.removeItem(...)` could throw \"Cannot read\n// properties of undefined (reading 'removeItem')\". Pattern from\n// earlier rounds (LocalePicker.test.tsx, LandingPage.test.tsx);\n// documented in docs/vitest-suite.md §4.5 jsdom-lazy-mount\n// workaround. Idempotent guard — no-op when real localStorage\n// exists.\nif (typeof window !== 'undefined' && !window.localStorage) {\n  const store = new Map<string, string>()\n  Object.defineProperty(window, 'localStorage', {\n    value: {\n      getItem: (k: string) => store.get(k) ?? null,\n      setItem: (k: string, v: string) => { store.set(k, v) },\n      removeItem: (k: string) => { store.delete(k) },\n      clear: () => { store.clear() },\n      key: (i: number) => Array.from(store.keys())[i] ?? null,\n      get length() { return store.size },\n    },\n    configurable: true,\n    writable: true,\n  })\n}

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
  initialPath = '/dashboard',
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
  // chain that <App /> provides around /dashboard/* at the browser top level.
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

// ── helpers: keyboard events ───────────────────────────────────────────

function fireKey(key: string, opts: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; repeat?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  // Dispatch on the focused element so typing-suppression tests
  // are meaningful (e.target must be the input/textarea, not
  // document). Falls back to document for global shortcuts fired
  // when nothing is focused.
  const target = document.activeElement || document
  target.dispatchEvent(event)
  return event
}

// ── tests ───────────────────────────────────────────────────────────────

describe('AppShell · sidebar contract (MemoryRouter wrap + layout invariants)', () => {
  beforeEach(async () => {
    mockUseAuth.mockReset()
    localStorage.removeItem(SIDEBAR_STORAGE_KEY)
    // Insurance vs prior-test locale leakage — if a sibling test
    // file (currently src/AppShell.i18n.test.tsx) ran the i18n
    // singleton to en-US in its own beforeEach, the singleton
    // retains 'en-US' for subsequent test files in the same VM.
    // Forcing re-init to 'zh-CN' here guarantees the existing
    // zh-CN string assertions (e.g. `findByText('键盘快捷键')`,
    // `getByRole('button', { name: /键盘快捷键/i })`) still match
    // the post-retranslate DOM.
    await i18n.changeLanguage('zh-CN')
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

  // (d) Collapsed-mode footer contract — <ThemeToggle size="compact">
  // is the only icon button left after round-OPT-marketing-chrome v5
  // removed the standalone logout button. The `aria-label="登出"`
  // regression shield is the more important pin in this round:
  // previously a `<button aria-label="登出">` lived in the collapsed
  // footer (h-7 w-7, hover-destructive) as a parallel logout
  // affordance — that button is GONE in v5 because logout is now the
  // 5th dropdown item inside <UserMenu> (data-testid="user-menu-
  // logout"). The "no element with aria-label='登出' exists in the
  // collapsed footer" assertion catches a future regression that
  // silently re-introduces a parallel logout button — the exact
  // duplication the v5 round was scoped to eliminate.
  //
  // Avatar (h-8 w-8) is intentionally NOT pinned here — it's the
  // identity marker, deliberately taller than the icon buttons; the
  // hierarchy read is preserved by the avatar's separation, not by
  // mutual exclusion.
  //
  // The ThemeToggle disambiguation (`aria-label^="切换到"`) is the
  // smaller-footprint fix for the user-menu trigger collision
  // documented in v4: UserMenu mode="collapsed" trigger is a
  // <button> with aria-label "用户菜单 · <email>" — a `:not([
  // aria-label="登出"])` selector would silently match it. Prefix
  // match is the safer disambiguator.
  it('collapsed-mode footer (UserMenu + ThemeToggle compact) — no standalone logout button (v5 consolidation)', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ sidebarCollapsed: true })
    const footer = screen.getByTestId('app-shell-sidebar-footer-collapsed')

    // Regression shield: the v5 standalone logout button is gone.
    // Re-introducing it would re-create the exact chrome duplication
    // the v5 round was scoped to eliminate (UserMenu's 5th dropdown
    // item is now the SOLE logout affordance across AppShell
    // sidebar footer + AppShell mobile AppBar + MarketingTopBar
    // authed branch).
    expect(footer.querySelector('button[aria-label="登出"]')).toBeNull()

    // ThemeToggle (compact size = h-7 w-7) — the only icon button
    // left in the collapsed footer. Same disambiguation as v1:
    // Radix's mode-keyed aria-label prefix `切换到` covers both
    // dark- and light-mode labels.
    const themeToggle = footer.querySelector(
      'button[aria-label^="切换到"]',
    )
    expect(themeToggle).not.toBeNull()
    expect(themeToggle!.className).toMatch(/\bh-7 w-7\b/)
  })
})

// ── KeyboardShortcutsCheatSheet tests ──────────────────────────────────
//
// These tests live in AppShell.test.tsx (not a separate file) because
// the cheat-sheet is rendered INSIDE AppShell's render tree — its
// open/close state is owned by AppShell. A separate test file would
// have to re-create the same provider chain and shortcut handler,
// duplicating the mount harness.

describe('AppShell · KeyboardShortcutsCheatSheet', () => {
  beforeEach(async () => {
    mockUseAuth.mockReset()
    localStorage.removeItem(SIDEBAR_STORAGE_KEY)
    // Insurance vs prior-test locale leakage — if a sibling test
    // file (currently src/AppShell.i18n.test.tsx) ran the i18n
    // singleton to en-US in its own beforeEach, the singleton
    // retains 'en-US' for subsequent test files in the same VM.
    // Forcing re-init to 'zh-CN' here guarantees the existing
    // zh-CN string assertions (e.g. `findByText('键盘快捷键')`,
    // `getByRole('button', { name: /键盘快捷键/i })`) still match
    // the post-retranslate DOM.
    await i18n.changeLanguage('zh-CN')
  })

  // (e) The help button renders in the header with correct aria-label.
  // Without this, a future header redesign that drops the icon button
  // would silently remove the only mouse-accessible entry point.
  it('renders the help button in the header', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell()
    const helpBtn = screen.getByRole('button', { name: /键盘快捷键/i })
    expect(helpBtn).toBeInTheDocument()
  })

  // (f) Clicking the help button opens the cheat-sheet modal.
  // Mirrors the Cmd+? keyboard path — both entry points must work.
  it('clicking the help button opens the cheat-sheet', async () => {
    const user = userEvent.setup()
    setAuth({ isAuthenticated: true })
    mountAppShell()
    await user.click(screen.getByRole('button', { name: /键盘快捷键/i }))
    expect(await screen.findByText('键盘快捷键')).toBeInTheDocument()
  })

  // (g) Cmd+Shift+? (macOS) opens the cheat-sheet. The `?` key
  // requires Shift on most layouts. We suppress while typing (handled
  // inside the global handler's `isTyping` gate). Uses findByText
  // because Radix Dialog portals render asynchronously.
  it('Cmd+Shift+? opens the cheat-sheet on macOS', async () => {
    setAuth({ isAuthenticated: true })
    mountAppShell()
    fireKey('?', { metaKey: true, shiftKey: true })
    expect(await screen.findByText('键盘快捷键')).toBeInTheDocument()
  })

  // (h) Ctrl+Shift+? (Win/Linux) opens the cheat-sheet. Mirrors (g)
  // for the non-macOS modifier path.
  it('Ctrl+Shift+? opens the cheat-sheet on Windows/Linux', async () => {
    setAuth({ isAuthenticated: true })
    mountAppShell()
    fireKey('?', { ctrlKey: true, shiftKey: true })
    expect(await screen.findByText('键盘快捷键')).toBeInTheDocument()
  })

  // (i) The cheat-sheet renders all shortcut groups. This is a
  // coarse-grained content test — it asserts the group headings
  // render so a future regression that drops a group trips red.
  // We scope queries to <h3> elements specifically because some
  // group titles (e.g. "任务列表") also appear as shortcut
  // descriptions inside other groups, causing getByText ambiguity.
  it('renders all shortcut groups (全局 · 侧边栏导航 · 任务列表 · 管理后台 · 弹窗与对话框)', async () => {
    const user = userEvent.setup()
    setAuth({ isAuthenticated: true })
    mountAppShell()
    await user.click(screen.getByRole('button', { name: /键盘快捷键/i }))
    const modal = await screen.findByRole('dialog')
    const headings = within(modal).getAllByRole('heading', { level: 3 })
    const titles = headings.map((h) => h.textContent)
    expect(titles).toContain('全局')
    expect(titles).toContain('侧边栏导航')
    expect(titles).toContain('任务列表')
    expect(titles).toContain('管理后台')
    expect(titles).toContain('弹窗与对话框')
  })

  // (j) Esc closes the cheat-sheet. Radix Dialog handles Escape
  // natively — this test locks the close path.
  it('Escape closes the cheat-sheet', async () => {
    const user = userEvent.setup()
    setAuth({ isAuthenticated: true })
    mountAppShell()
    await user.click(screen.getByRole('button', { name: /键盘快捷键/i }))
    expect(await screen.findByText('键盘快捷键')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByText('键盘快捷键')).not.toBeInTheDocument()
    })
  })

  // (k) Typing in an input while the cheat-sheet is closed does NOT
  // open it. The `?` key without a modifier is "just typing"; only
  // Cmd+? / Ctrl+? triggers the modal.
  it('does NOT open when typing ? in an input', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireKey('?', { metaKey: true, shiftKey: true })
    // The shortcut handler checks isTyping and returns early.
    expect(screen.queryByText('键盘快捷键')).not.toBeInTheDocument()
    document.body.removeChild(input)
  })
})

// ── Main nav keyboard shortcut tests ───────────────────────────────────

describe('AppShell · main nav keyboard shortcuts', () => {
  beforeEach(async () => {
    mockUseAuth.mockReset()
    localStorage.removeItem(SIDEBAR_STORAGE_KEY)
    // Insurance vs prior-test locale leakage — if a sibling test
    // file (currently src/AppShell.i18n.test.tsx) ran the i18n
    // singleton to en-US in its own beforeEach, the singleton
    // retains 'en-US' for subsequent test files in the same VM.
    // Forcing re-init to 'zh-CN' here guarantees the existing
    // zh-CN string assertions (e.g. `findByText('键盘快捷键')`,
    // `getByRole('button', { name: /键盘快捷键/i })`) still match
    // the post-retranslate DOM.
    await i18n.changeLanguage('zh-CN')
  })

  // (l) Sidebar nav items render kbd hints (⌘1 / Ctrl+1 etc.) when
  // the sidebar is expanded. The hints are hidden on collapsed rail.
  // We assert via regex because the modifier label depends on the
  // test environment's navigator.platform (macOS → ⌘, otherwise Ctrl+).
  // All 6 navItems have shortcuts, so exactly 6 kbd hints should render.
  it('renders kbd hints on expanded sidebar nav items', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ sidebarCollapsed: false })
    const sidebar = screen.getByTestId('app-shell-sidebar')
    const kbds = within(sidebar).getAllByText(/^(⌘|Ctrl\+)[1-6]$/)
    expect(kbds.length).toBe(6)
  })

  // (m) Cmd+1/2/3/4/5/6 fires the shortcut handler on non-admin pages.
  // We assert via event.defaultPrevented because the MemoryRouter test
  // harness uses absolute route paths that don't align with the app's
  // nested /dashboard/* routing — checking rendered page stubs is unreliable.
  it.each([
    { key: '1' },
    { key: '2' },
    { key: '3' },
    { key: '4' },
    { key: '5' },
    { key: '6' },
  ])(
    'Cmd+$key shortcut handler fires on non-admin pages (defaultPrevented)',
    ({ key }) => {
      setAuth({ isAuthenticated: true })
      mountAppShell({ initialPath: '/dashboard' })
      const event = fireKey(key, { metaKey: true })
      expect(event.defaultPrevented).toBe(true)
    },
  )

  // (n) Main nav shortcuts are IGNORED on admin pages so they don't
  // collide with sidebar nav shortcuts. Without this guard, pressing
  // Cmd+1 on /dashboard/admin would navigate to 账号管理 instead of admin
  // Overview — a major UX regression. We assert via defaultPrevented
  // because route-based assertions are unreliable in the test harness.
  it('ignores main nav shortcuts on admin pages', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ initialPath: '/dashboard/admin' })
    const event = fireKey('1', { metaKey: true })
    expect(event.defaultPrevented).toBe(false)
  })

  // (o) Typing suppression: pressing Cmd+1 while focused in an input
  // does NOT navigate. The isTyping gate must block the shortcut.
  // Assert via defaultPrevented — when suppression works the handler
  // returns early without calling preventDefault.
  it('does NOT fire when typing in an input', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ initialPath: '/dashboard' })
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const event = fireKey('1', { metaKey: true })
    expect(event.defaultPrevented).toBe(false)
    document.body.removeChild(input)
  })

  // (p) Modal suppression: when a dialog is open, main nav shortcuts
  // are blocked so the user doesn't accidentally navigate away while
  // interacting with a modal. Assert via defaultPrevented.
  it('does NOT fire when a modal dialog is open', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ initialPath: '/dashboard' })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    const event = fireKey('2', { metaKey: true })
    expect(event.defaultPrevented).toBe(false)
    document.body.removeChild(dialog)
  })

  // (q) Shift+Cmd+1 is blocked. The handler checks `e.shiftKey` and
  // returns early — without this test, a future refactor that drops
  // the shift guard would silently break. Mirrors the admin tab
  // Shift+Cmd blocker test in AdminDashboard.test.tsx.
  it('does NOT fire on Shift+Cmd+1', () => {
    setAuth({ isAuthenticated: true })
    mountAppShell({ initialPath: '/dashboard' })
    const event = fireKey('1', { metaKey: true, shiftKey: true })
    expect(event.defaultPrevented).toBe(false)
  })
})
