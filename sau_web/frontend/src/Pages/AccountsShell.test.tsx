import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { mockUseAuth } from '@/test/auth-router-spies'
import { AuthGuard } from '@/features/auth/AuthGuard'
import AccountsPage from './AccountsPage'

// ── framework-level mocks ──────────────────────────────────────────────

// useAuth is mocked so the real AuthGuard (which reads useAuth) can be
// driven by per-test state without booting authStore / TanStack Query.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Full 24-field AccountsState stub so the real subtree (DialogHost →
// BatchDeleteGroupConfirm / CreateGroupDialog / AuthorizeDialog /
// GroupRenameDialog / LoginProgressModal) renders without throwing
// when it accesses `selectedGroupId` / `loginModalOpen` / `refetch` etc.
// Earlier 7-field stubs caused BatchDeleteGroupConfirm's useMemo to
// crash (undefined selectedIds iteration). Safe zero defaults keep
// every branch in a "no-data" render path; `refetch` is the only field
// that needs a stable fn reference (DialogHost wraps it in a useCallback).
const stubState = {
  groups: [],
  isLoading: false,
  refetch: vi.fn(),
  isCreatePending: false,
  isRenamePending: false,
  isReorderInFlight: false,
  localGroups: [],
  filteredGroups: [],
  searchQuery: '',
  validityFilter: 'all' as const,
  viewMode: 'grid' as const,
  selectedIds: new Set<number>(),
  newGroupName: '',
  createDialogOpen: false,
  batchDeleteOpen: false,
  authorizeDialogOpen: false,
  renameDialogOpen: false,
  renameDialogGroupId: null,
  renameDialogCurrentName: '',
  selectedGroupId: null,
  selectedPlatform: '',
  loginModalOpen: false,
  isCheckingStatus: false,
}
const stubDispatch = new Proxy({}, { get: () => vi.fn() })
vi.mock('@/features/accounts/AccountsProvider', async () => {
  const real =
    await vi.importActual<typeof import('@/features/accounts/AccountsProvider')>(
      '@/features/accounts/AccountsProvider',
    )
  return {
    ...real,
    AccountsProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useAccountsState: () => stubState,
    useAccountsDispatch: () => stubDispatch,
  }
})

// Helpers module: spread `real` so the new `AccountsBodyCtx` +
// `useAccountsBody` exports (added in round N+1) stay real — the
// shell mounts `<AccountsBodyCtx.Provider>` in JSX and that React
// context symbol must be the real createContext instance, not a
// mocked null. The 2 throwing hooks are stubbed here AND in the
// barrel mock above; the dupe is intentional belt-and-braces so
// either import path's resolve-is-synonymous-with-real-pass-through.
vi.mock('@/features/accounts/AccountsProvider.helpers', async () => {
  const real =
    await vi.importActual<typeof import('@/features/accounts/AccountsProvider.helpers')>(
      '@/features/accounts/AccountsProvider.helpers',
    )
  return {
    ...real,
    useAccountsState: () => stubState,
    useAccountsDispatch: () => stubDispatch,
  }
})

// HomepageOverview uses `useAccountGroups` + `useTasks` react-query
// hooks. Stub it because the test tree has no QueryClient populated
// with account/task fixtures. The PageHeader / DialogHost /
// GroupToolbar / GroupGridArea / GroupListArea are NOT stubbed — the
// barrel mock above keeps their `useAccountsState` hooks resolving,
// and they render as cheap data-testids themselves.
vi.mock('@/features/accounts/HomepageOverview', () => ({
  HomepageOverview: () => null,
}))

// ── helpers ────────────────────────────────────────────────────────────

function setAuth({
  isAuthenticated = false,
  isLoading = false,
  user = null,
}: {
  isAuthenticated?: boolean
  isLoading?: boolean
  user?: { id: number; email: string; role: 'admin' | 'user' } | null
} = {}) {
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

function mountAccountsPage() {
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={['/dashboard']}>
      <AuthGuard>
        <AccountsPage />
      </AuthGuard>
    </TestProviders>,
  )
}

// ── tests ──────────────────────────────────────────────────────────────
//
// Facade invariants for the SHELL only (the 7 layout branches live in
// AccountsBody.test.tsx). Two tests:
//   1. authenticated → real PageHeader "账号管理" heading renders +
//      AccountsBody reachable through AccountsShell → ctx → body chain.
//   2. anonymous → AuthGuard fires <Navigate to="/login" replace />,
//      no PageHeader, no body subtree (anonymous-bounce invariant).

describe('AccountsShell · facade invariants (AuthGuard + ctx wiring)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  it('renders PageHeader through shell → ctx → body when authenticated', () => {
    setAuth({ isAuthenticated: true })
    mountAccountsPage()
    // Real PageHeader "账号管理" heading proves the shell mounted AND
    // the ctxProvider populated the body AND the body kept rendering
    // past PageHeader. Asserting on user-visible text (not a stub
    // testid) keeps the test honest about implementation drift.
    expect(
      screen.getByRole('heading', { name: '账号管理' }),
    ).toBeInTheDocument()
  })

  it('does NOT render page content when anonymous (AuthGuard bounce)', () => {
    setAuth({ isAuthenticated: false })
    mountAccountsPage()
    // AuthGuard fires <Navigate to="/login" replace />, so AccountsPage
    // never mounts. Asserting absence of the user-visible PageHeader
    // heading is the strongest signal the bounce happened.
    expect(
      screen.queryByRole('heading', { name: '账号管理' }),
    ).not.toBeInTheDocument()
  })
})
