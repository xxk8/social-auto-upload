import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { mockUseAuth } from '@/test/auth-router-spies'
import { AuthGuard } from '@/features/auth/AuthGuard'

// ── framework-level mocks (must precede under-test imports) ─────────────

// useAuth is mocked so the real AuthGuard (which reads useAuth) can
// be driven by per-test state without booting authStore / TanStack
// Query / the /api/auth/me fetch.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Data hooks: PublishPage hooks into useAccounts/useTasks/useAccountGroups
// at the top of the component, before any conditional render. Without
// these mocks the QueryClient inside TestProviders would fire real
// axios calls during render → fetch-fail noise (and on CI, real
// retry storms). Stub them with empty `data` so the hooks return
// stable references and the page's render loop completes synchronously.
vi.mock('@/hooks/useTasks', () => ({
  useAccounts: () => ({
    data: [],
    refetch: vi.fn(),
    isLoading: false,
    isError: false,
  }),
  useTasks: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/hooks/useAccountGroups', () => ({
  useAccountGroups: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}))

// usePublishStore is a Zustand store. PublishPage calls
// `usePublishStore(selector)` four times. We preserve the selector
// semantics with a passthrough strategy: any selector the page passes
// is invoked against a default state shape.
const defaultPublishState = {
  lastTaskIds: [] as string[],
  submitSuccess: null as null | { count: number; mode: string; taskIds: string[] },
  setLastTaskIds: vi.fn(),
  setSubmitSuccess: vi.fn(),
}

vi.mock('@/stores/publishStore', () => ({
  usePublishStore: (selector: (s: typeof defaultPublishState) => unknown) =>
    selector(defaultPublishState),
}))

// `usePublishWizardStore` is intentionally NOT mocked. The default
// Zustand initial state (`mode='video'`, `groupSelection=null`,
// `content={title:'',desc:'',note:'',tags:'',schedule:'',advanced:{}}`)
// is exactly what these chrome tests want to assert against. Letting
// the real store run also exercises the FormHandle bridge's
// `getState()` path — a mock would have to mirror Zustand's static
// `.getState` API verbatim to avoid regressions.
// `usePublishWizardStore.getState()` in PublishPage's bridge reaches
// the same singleton these selectors read from.

// Stub the heavy wizard + form / sidebar components. The render-time
// tests assert on data-testids; deeper behavior is locked by their
// own individual vitest specs (PublishWizard.test.tsx, etc.).
vi.mock('@/features/publish/wizard/PublishWizard', () => ({
  PublishWizard: () => <div data-testid="publish-wizard">PublishWizard</div>,
}))

vi.mock('@/features/publish/PublishSuccessBanner', () => ({
  PublishSuccessBanner: () => null,
}))

vi.mock('@/features/publish/PublishStatsBar', () => ({
  PublishStatsBar: () => (
    <div data-testid="publish-stats-bar">PublishStatsBar</div>
  ),
}))

// PublishAiSidebar mounts in two places in PublishPage (desktop column
// + mobile drawer). PublishPage imports the two components via DIRECT
// sub-path (`../Components/AiRightPanel/PublishAiSidebar` and
// `.../MobileAiDrawer`), so Vitest treats each as its own module ID.
// Mocking the index `@/Components/AiRightPanel` here does NOT
// intercept the sub-path imports. We mock each leaf module directly
// to match the imports the page actually uses. Mock MobileAiDrawer as
// open-conditional: null when closed, render-children when open — this
// mirrors the real Drawer's hide/show semantics so a future regression
// in the open-state machine surfaces here.
vi.mock('@/Components/AiRightPanel/PublishAiSidebar', () => ({
  PublishAiSidebar: () => (
    <div data-testid="publish-ai-sidebar">PublishAiSidebar</div>
  ),
}))
vi.mock('@/Components/AiRightPanel/MobileAiDrawer', () => ({
  MobileAiDrawer: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div data-testid="mobile-ai-drawer">{children}</div> : null),
}))

// useMobileDrawer drives whether the floating AI FAB + drawer open
// state surfaces. Module-scope with per-test override before render.
let mobileDrawerState: { isMobile: boolean; isOpen: boolean } = {
  isMobile: false,
  isOpen: false,
}

vi.mock('@/hooks/useMobileDrawer', () => ({
  useMobileDrawer: () => ({
    isMobile: mobileDrawerState.isMobile,
    isOpen: mobileDrawerState.isOpen,
    open: vi.fn(),
    close: vi.fn(),
  }),
}))

// ── imports (post-mock) ────────────────────────────────────────────────

import PublishPage from './PublishPage'

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

function mountPublishPage() {
  // TestProviders already wraps in <MemoryRouter>; nesting another
  // MemoryRouter triggers react-router v6's "Router inside Router" runtime
  // error. Pass initialEntries via TestProviders instead.
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={['/app/publish']}>
      <AuthGuard>
        <PublishPage />
      </AuthGuard>
    </TestProviders>,
  )
}

// ── tests ───────────────────────────────────────────────────────────────

describe('PublishPage · AuthGuard + chrome (post-merge routing)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    // The wizard store (Zustand singleton) is intentionally NOT reset
    // here: none of these chrome tests mutate it, so the default state
    // (`mode='video'`, `groupSelection=null`) is exactly what every
    // render expects. A future test that flips the mode would call
    // `usePublishWizardStore.setState(...)` against the live singleton
    // (see opt-3F bridge internals for the same pattern).
    mobileDrawerState = { isMobile: false, isOpen: false }
    // Defensive: any future spec in this file could write
    // `sau-publish-ai-collapsed='true'` and forget to clean up,
    // which would flip `aiCollapsed` initial render → the
    // 60/40 ratio-invariant spec below would silently break.
    // Vitest-localStorage is per-file, not per-spec; scrub the
    // one key PublishPage reads on mount.
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem('sau-publish-ai-collapsed') } catch {}
    }
  })

  // ── Authenticated branch — PageHeader ───────────────────────────────

  it('renders the PageHeader with title "发布中心" when authenticated', () => {
    setAuth({ isAuthenticated: true })
    mountPublishPage()
    expect(
      screen.getByRole('heading', { name: '发布中心' }),
    ).toBeInTheDocument()
  })

  it('renders the PageHeader description "发布视频或图文到多个平台"', () => {
    setAuth({ isAuthenticated: true })
    mountPublishPage()
    expect(
      screen.getByText('发布视频或图文到多个平台'),
    ).toBeInTheDocument()
  })

  // ── Body chrome (post-rewire: wizard + variants panel + AI sidebar) ─

  it('mounts the wizard column + desktop PublishAiSidebar', () => {
    setAuth({ isAuthenticated: true })
    mountPublishPage()
    expect(screen.getByTestId('publish-wizard')).toBeInTheDocument()
    expect(screen.getByTestId('publish-stats-bar')).toBeInTheDocument()
    // MobileAiDrawer is mocked with `open`-conditional rendering.
    // Desktop default (isMobile=false → isOpen=false → open=false)
    // renders the drawer as null, so only the desktop column's
    // PublishAiSidebar mounts → exactly one element with that id.
    expect(screen.getByTestId('publish-ai-sidebar')).toBeInTheDocument()
  })

  // ── Layout invariant — default collapsed grid ratio ─────────────

  it('defaults to collapsed AI-sidebar grid (lg:grid-cols-[1fr_60px]) for first-time visitors', () => {
    setAuth({ isAuthenticated: true })
    // Default: vitest-localStorage has no `sau-publish-ai-collapsed`
    // → `aiCollapsed` initialises to true (collapsed) → the cn(...)
    // expression resolves to the collapsed branch with a 60px rail.
    mountPublishPage()
    const grid = screen.getByTestId('publish-grid-container')
    expect(grid.className).toContain('lg:grid-cols-[1fr_60px]')
    // The expanded-state branch MUST NOT leak into the default render.
    expect(grid.className).not.toContain('lg:grid-cols-[2fr_3fr]')
  })

  it('switches to expanded AI-sidebar grid (lg:grid-cols-[2fr_3fr]) when localStorage says false', () => {
    // Simulate a returning visitor who previously expanded the sidebar.
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('sau-publish-ai-collapsed', 'false') } catch {}
    }
    setAuth({ isAuthenticated: true })
    mountPublishPage()
    const grid = screen.getByTestId('publish-grid-container')
    expect(grid.className).toContain('lg:grid-cols-[2fr_3fr]')
    expect(grid.className).not.toContain('lg:grid-cols-[1fr_60px]')
  })

  // ── Mobile-mode branches ────────────────────────────────────────────

  it('does NOT render the mobile AI trigger when not mobile', () => {
    setAuth({ isAuthenticated: true })
    // mobileDrawerState defaults to isMobile: false in beforeEach.
    mountPublishPage()
    expect(
      screen.queryByTestId('mobile-ai-trigger'),
    ).not.toBeInTheDocument()
  })

  it('renders the mobile AI trigger when on mobile', () => {
    setAuth({ isAuthenticated: true })
    mobileDrawerState = { isMobile: true, isOpen: false }
    mountPublishPage()
    expect(
      screen.getByTestId('mobile-ai-trigger'),
    ).toBeInTheDocument()
  })

  it('does NOT render the mobile-ai-drawer DOM when mobile + drawer closed', () => {
    setAuth({ isAuthenticated: true })
    mobileDrawerState = { isMobile: true, isOpen: false }
    mountPublishPage()
    // The real invariant we lock is the DRAWER MECHANISM: when the
    // drawer is closed, MobileAiDrawer returns null and its DOM shell
    // never appears. (The desktop-column PublishAiSidebar is CSS-hidden
    // via `hidden lg:block` but stays in the DOM.)
    expect(
      screen.queryByTestId('mobile-ai-drawer'),
    ).not.toBeInTheDocument()
  })

  it('renders PublishAiSidebar inside the mobile drawer when opened (in addition to desktop column)', () => {
    setAuth({ isAuthenticated: true })
    mobileDrawerState = { isMobile: true, isOpen: true }
    mountPublishPage()
    // When the drawer opens, MobileAiDrawer renders its children
    // (PublishAiSidebar). The desktop column PublishAiSidebar is
    // ALSO still in the tree (CSS-hidden on mobile but never removed
    // from the DOM). Scoping via `within(mobile-ai-drawer)` proves the
    // DRAWER PATH mounted a PublishAiSidebar, not just "a sidebar
    // existed somewhere in the tree".
    expect(
      screen.getByTestId('mobile-ai-drawer'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('mobile-ai-drawer')).getByTestId(
        'publish-ai-sidebar',
      ),
    ).toBeInTheDocument()
  })

  // ── Anonymous bounce ────────────────────────────────────────────────

  it('does NOT render page content when anonymous (AuthGuard bounce)', () => {
    setAuth({ isAuthenticated: false })
    mountPublishPage()
    expect(
      screen.queryByRole('heading', { name: '发布中心' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('publish-wizard'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('publish-ai-sidebar'),
    ).not.toBeInTheDocument()
  })
})
