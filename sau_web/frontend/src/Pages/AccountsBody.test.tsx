import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  AccountsBodyCtx,
  type AccountsBodyContextValue,
  type AccountsDispatch,
  type AccountsState,
} from '@/features/accounts/AccountsProvider.helpers'
import { AccountsBody } from './AccountsPage'

// ── Stub child components ──────────────────────────────────────────────
// Each stub exposes a stable data-testid the tests assert on. Mirrors
// the prior test pattern; mocking these keeps layout tests focused on
// the parent JSX (PageHeader / HeaderActions / BodyArea / DialogHost)
// without booting the heavyweight real children.
//
// IMPORTANT: AccountsBody is the under-test component. It must NOT be
// stubbed — that's what we're rendering.
vi.mock('@/features/accounts/HomepageOverview', () => ({
  HomepageOverview: () => (
    <div data-testid="homepage-overview">HomepageOverview</div>
  ),
}))

vi.mock('@/features/accounts/GroupToolbar', () => ({
  GroupToolbar: () => <div data-testid="group-toolbar">GroupToolbar</div>,
}))

vi.mock('@/features/accounts/GroupGridArea', () => ({
  GroupGridArea: () => <div data-testid="group-grid-area">GroupGridArea</div>,
}))

vi.mock('@/features/accounts/GroupListArea', () => ({
  GroupListArea: () => (
    <div data-testid="group-list-area">GroupListArea</div>
  ),
}))

vi.mock('@/features/accounts/dialogs', () => ({
  DialogHost: () => <div data-testid="dialog-host">DialogHost</div>,
}))

// ── helpers ────────────────────────────────────────────────────────────
//
// State slice the body actually reads. Kept narrow with `Partial` so
// tests only specify the fields their branch cares about; the rest fall
// through to defaults that produce the "no-data → empty state" branch.
type BodyRelevantState = Partial<
  Pick<
    AccountsState,
    | 'groups'
    | 'localGroups'
    | 'filteredGroups'
    | 'isLoading'
    | 'isCheckingStatus'
    | 'viewMode'
    | 'searchQuery'
  >
>

const _DEFAULTS: BodyRelevantState = {
  groups: [],
  localGroups: [],
  filteredGroups: [],
  isLoading: false,
  isCheckingStatus: false,
  viewMode: 'grid',
  searchQuery: '',
}

function makeStubDispatch(): AccountsDispatch {
  // Proxy dispatch: any property access returns vi.fn() so the body's
  // dispatch.handleCheckAllStatus / setCreateDialogOpen / handleClearSearch
  // / etc. all resolve without each test enumerating them. Mirrors the
  // pre-split AccountsPage.test.tsx proxy pattern.
  return new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        // Some handlers return Promise<void> (`void dispatch.foo()` in JSX).
        if (prop === 'handleCheckAllStatus') {
          return vi.fn().mockResolvedValue(undefined)
        }
        return vi.fn()
      },
    },
  ) as unknown as AccountsDispatch
}

const stubNavigation: AccountsBodyContextValue['navigation'] = {
  onOpenTasks: vi.fn(),
  onOpenPublish: vi.fn(),
}

function mountAccountsBody(over: BodyRelevantState = {}) {
  const state = { ..._DEFAULTS, ...over } as AccountsState
  const dispatch = makeStubDispatch()
  return {
    state,
    dispatch,
    render: render(
      <AccountsBodyCtx.Provider
        value={{ state, dispatch, navigation: stubNavigation }}
      >
        <AccountsBody />
      </AccountsBodyCtx.Provider>,
    ),
  }
}

// ── tests ──────────────────────────────────────────────────────────────
//
// 7 tests originally failing under AccountsPage.test.tsx due to the
// `useAccountsState must be used inside <AccountsProvider>` throw from
// the helpers-path hooks (which the test's barrel-path vi.mock did
// not intercept). With the AccountsBody split, layout tests stub the
// AccountsBodyContext directly — no hook mocking required.

describe('AccountsBody · layout branches (round N+1 regression)', () => {
  it('renders PageHeader with title "账号管理"', () => {
    mountAccountsBody()
    expect(screen.getByRole('heading', { name: '账号管理' })).toBeInTheDocument()
  })

  it('renders PageHeader description "管理账号分组和平台授权"', () => {
    mountAccountsBody()
    expect(screen.getByText('管理账号分组和平台授权')).toBeInTheDocument()
  })

  it('renders both header actions (一键检测 + 新建分组)', () => {
    mountAccountsBody()
    // PageHeader exposes its action slot at [data-testid="page-header-actions"]
    // (added in page-header.tsx spec-fix scope). The GroupToolbar stub
    // ALSO renders a 新建分组 button — scoping via within(...) proves
    // "the HEADER renders 新建分组", not "a 新建分组 exists somewhere".
    const headerActions = within(screen.getByTestId('page-header-actions'))
    expect(
      headerActions.getByRole('button', { name: /一键检测/ }),
    ).toBeInTheDocument()
    expect(
      headerActions.getByRole('button', { name: /新建分组/ }),
    ).toBeInTheDocument()
  })

  it('renders the loading spinner when state.isLoading is true', () => {
    mountAccountsBody({ isLoading: true })
    // Loading branch fires BEFORE group-empty check, so spinner renders.
    expect(screen.getByText('加载中…')).toBeInTheDocument()
    // Empty-state branch must NOT fire.
    expect(screen.queryByText('暂无账号分组')).not.toBeInTheDocument()
  })

  it('renders the empty-state placeholder when groups are empty', () => {
    // mockedState defaults already give us groups: []; this is the
    // dominant state for first-time operators.
    mountAccountsBody()
    expect(screen.getByText('暂无账号分组')).toBeInTheDocument()
    // Loading branch must NOT fire.
    expect(screen.queryByText('加载中…')).not.toBeInTheDocument()
  })

  it('renders the search-filtered empty state when searchQuery has no matches', () => {
    mountAccountsBody({
      groups: [{ id: 1, name: 'bilibili-test' }] as AccountsState['groups'],
      filteredGroups: [] as AccountsState['filteredGroups'],
      searchQuery: 'nope',
    })
    // BodyArea reads: not loading, groups non-empty, filteredGroups
    // empty → search-empty branch fires.
    expect(screen.getByText('未找到匹配的分组')).toBeInTheDocument()
    // The other empty paths must NOT fire.
    expect(screen.queryByText('暂无账号分组')).not.toBeInTheDocument()
    expect(screen.queryByText('加载中…')).not.toBeInTheDocument()
  })

  it('mounts HomepageOverview + DialogHost stubs at the body level', () => {
    mountAccountsBody()
    expect(screen.getByTestId('homepage-overview')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-host')).toBeInTheDocument()
  })
})
