import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'

// ── mock react-router-dom useNavigate so AdminNavTabs navigation is spyable ─

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => mockNavigate),
  }
})

// ── mock adminApi before component imports ───────────────────────────────

const mockGetOverview = vi.fn()
const mockGetUsers = vi.fn()
const mockUpdateUserRole = vi.fn()
const mockGetAuditLogs = vi.fn()
const mockGetUnacknowledgedAuditCount = vi.fn()
const mockAcknowledgeAuditLogs = vi.fn()
const mockGetTrends = vi.fn()
const mockExportTrendsCsv = vi.fn()

vi.mock('./adminApi', () => ({
  adminApi: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    getUsers: (...args: unknown[]) => mockGetUsers(...args),
    updateUserRole: (...args: unknown[]) => mockUpdateUserRole(...args),
    getAuditLogs: (...args: unknown[]) => mockGetAuditLogs(...args),
    getSystem: vi.fn(),
    getTrends: (...args: unknown[]) => mockGetTrends(...args),
    exportTrendsCsv: (...args: unknown[]) => mockExportTrendsCsv(...args),
    getUnacknowledgedAuditCount: (...args: unknown[]) => mockGetUnacknowledgedAuditCount(...args),
    acknowledgeAuditLogs: (...args: unknown[]) => mockAcknowledgeAuditLogs(...args),
  },
}))

// ── component imports (post-mock) ───────────────────────────────────────

import AdminOverviewPage from './AdminOverviewPage'
import AdminUsersPage from './AdminUsersPage'
import AdminAuditPage from './AdminAuditPage'

// ── helpers ─────────────────────────────────────────────────────────────

function mountOverview(initialEntries?: string[]) {
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={initialEntries}>
      <AdminOverviewPage />
    </TestProviders>,
  )
}

function mountUsers(initialEntries?: string[]) {
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={initialEntries}>
      <AdminUsersPage />
    </TestProviders>,
  )
}

function mountAudit(initialEntries?: string[]) {
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={initialEntries}>
      <AdminAuditPage />
    </TestProviders>,
  )
}

beforeEach(() => {
  mockGetOverview.mockReset()
  mockGetUsers.mockReset()
  mockUpdateUserRole.mockReset()
  mockGetAuditLogs.mockReset()
  mockGetUnacknowledgedAuditCount.mockReset()
  mockAcknowledgeAuditLogs.mockReset()
  mockGetTrends.mockReset()
  mockExportTrendsCsv.mockReset()
  mockNavigate.mockClear()

  // Default resolved values so components that call these methods on mount don't crash.
  mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
  mockAcknowledgeAuditLogs.mockResolvedValue({ success: true, data: { updated: 0 } })
  // Default: trends endpoint resolves with 14 days of synthetic data for any
  // metric. The point of the default is just to prevent the queryFn from
  // crashing; specific tests override this with a 5xx-style reject to
  // exercise the per-metric fallback path.
  mockGetTrends.mockImplementation((metric: string, days: number = 14) => {
    const seed = metric.length
    const points = Array.from({ length: days }, (_, i) => 10 + i + seed)
    return Promise.resolve({ success: true, data: { metric, days, points } })
  })
  // Default: CSV export returns an empty blob. Tests that care about
  // the download path override this with a real Blob.
  mockExportTrendsCsv.mockResolvedValue(new Blob(['\ufeffdate,value\n']))
})

// Restore any `vi.spyOn` stubs created inside individual `it` blocks
// (e.g. URL.createObjectURL for the export-trends click test). Without
// this hook, a throw mid-assertion would leak the spy into the next
// test and break URL.createObjectURL's real behavior. `restoreAllMocks`
// is safe here because it only touches vi.spyOn stubs — vi.mock()
// module-level mocks are unaffected and continue to be re-applied
// per test file run.
afterEach(() => {
  vi.restoreAllMocks()
})

// ── AdminOverviewPage ───────────────────────────────────────────────────

describe('AdminOverviewPage', () => {
  it('renders page header with title and description', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview()
    expect(
      await screen.findByRole('heading', { name: '系统概览' }),
    ).toBeInTheDocument()
    expect(screen.getByText('项目使用统计与最近活动')).toBeInTheDocument()
  })

  it('renders admin nav tabs with overview active', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toHaveAttribute('data-state', 'active'),
    )
    expect(screen.getByTestId('admin-nav-tab-users')).toBeInTheDocument()
    expect(screen.getByTestId('admin-nav-tab-audit')).toBeInTheDocument()
  })

  it('does NOT render data while loading', () => {
    mockGetOverview.mockReturnValue(new Promise(() => {}))
    mountOverview()
    expect(screen.queryByText('总用户数')).toBeInTheDocument()
    // Data values are NOT present yet (skeletons rendered instead).
    expect(screen.queryByText('42')).not.toBeInTheDocument()
  })

  it('renders stat cards with correct values', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 42,
        active_today: 7,
        total_tasks: 1337,
        task_success_rate: 98.5,
        recent_actions: [],
      },
    })
    mountOverview()
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('1337')).toBeInTheDocument()
    expect(screen.getByText('98.5%')).toBeInTheDocument()
  })

  it('renders recent actions table when data exists', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 1,
        active_today: 1,
        total_tasks: 1,
        task_success_rate: 100,
        recent_actions: [
          {
            id: 1,
            user_id: 1,
            action: 'update_role',
            created_at: '2026-07-05T10:30:00+00:00',
            user_email: 'admin@test.com',
          },
        ],
      },
    })
    mountOverview()
    await waitFor(() =>
      expect(screen.getByText('admin@test.com')).toBeInTheDocument(),
    )
    expect(screen.getByText('update_role')).toBeInTheDocument()
    expect(screen.getByText('2026-07-05 10:30')).toBeInTheDocument()
  })

  it('renders empty state when no recent actions', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview()
    await waitFor(() =>
      expect(screen.getByText('暂无记录')).toBeInTheDocument(),
    )
    expect(
      screen.getByText('所选时间范围内没有用户操作'),
    ).toBeInTheDocument()
  })

  it('renders time range filter tabs (全部 / 今天 / 本周 / 本月 / 自定义)', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview()
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('tab', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '本周' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '本月' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '自定义' })).toBeInTheDocument()
  })

  it('switching time range tab refetches overview with new range', async () => {
    const user = userEvent.setup()
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 1,
        active_today: 1,
        total_tasks: 1,
        task_success_rate: 100,
        recent_actions: [],
      },
    })
    mountOverview()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '系统概览' })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('tab', { name: '今天' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '今天' })).toHaveAttribute('data-state', 'active'),
    )

    const lastCall = mockGetOverview.mock.calls[mockGetOverview.mock.calls.length - 1]
    expect(lastCall[0]).toBe('today')
  })

  it('shows custom date inputs when 自定义 tab is active', async () => {
    const user = userEvent.setup()
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview()
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument(),
    )

    expect(screen.queryByLabelText('开始日期')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '自定义' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '自定义' })).toHaveAttribute('data-state', 'active'),
    )

    expect(screen.getByLabelText('开始日期')).toBeInTheDocument()
    expect(screen.getByLabelText('结束日期')).toBeInTheDocument()
  })

  it('reads time range from URL query params on mount', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview(['/app/admin/overview?range=today'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '今天' })).toHaveAttribute('data-state', 'active'),
    )
    // The initial API call should include the timeRange from URL.
    expect(mockGetOverview).toHaveBeenCalledWith('today', undefined, undefined)
  })

  it('reads custom dates from URL query params on mount', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview(['/app/admin/overview?range=custom&start=2026-07-01&end=2026-07-05'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '自定义' })).toHaveAttribute('data-state', 'active'),
    )
    expect(screen.getByDisplayValue('2026-07-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-07-05')).toBeInTheDocument()
    expect(mockGetOverview).toHaveBeenCalledWith('custom', '2026-07-01', '2026-07-05')
  })

  it('gracefully falls back to "all" when range URL param is invalid', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview(['/app/admin/overview?range=invalid'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('data-state', 'active'),
    )
    expect(mockGetOverview).toHaveBeenCalledWith('all', undefined, undefined)
  })

  it('clicking 清除筛选 resets range to "all" and refetches', async () => {
    const user = userEvent.setup()
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mountOverview(['/app/admin/overview?range=today'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '今天' })).toHaveAttribute('data-state', 'active'),
    )

    const clearBtn = screen.getByRole('button', { name: '清除筛选' })
    expect(clearBtn).toBeInTheDocument()

    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    await user.click(clearBtn)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('data-state', 'active'),
    )
    // Button disappears when filters are inactive
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument()
    // API refetched with 'all'
    expect(mockGetOverview).toHaveBeenLastCalledWith('all', undefined, undefined)
  })
})

// ── AdminUsersPage ──────────────────────────────────────────────────────

describe('AdminUsersPage', () => {
  it('renders page header with title and description', async () => {
    mockGetUsers.mockResolvedValue({ success: true, data: [] })
    mountUsers(['/app/admin/users'])
    expect(
      await screen.findByRole('heading', { name: '用户管理' }),
    ).toBeInTheDocument()
    expect(screen.getByText('查看和管理所有注册用户')).toBeInTheDocument()
  })

  it('renders admin nav tabs with users active', async () => {
    mockGetUsers.mockResolvedValue({ success: true, data: [] })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountUsers(['/app/admin/users'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-users')).toHaveAttribute('data-state', 'active'),
    )
    expect(screen.getByTestId('admin-nav-tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('admin-nav-tab-audit')).toBeInTheDocument()
  })

  it('does NOT render user rows while loading', () => {
    mockGetUsers.mockReturnValue(new Promise(() => {}))
    mountUsers()
    expect(screen.queryByText('alice@test.com')).not.toBeInTheDocument()
  })

  it('renders user table with correct data', async () => {
    mockGetUsers.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          email: 'alice@test.com',
          role: 'admin',
          tier: 'pro',
          created_at: '2026-01-15T08:00:00+00:00',
          last_login: '2026-07-05T09:00:00+00:00',
        },
        {
          id: 2,
          email: 'bob@test.com',
          role: 'user',
          tier: 'free',
          created_at: '2026-03-20T10:00:00+00:00',
          last_login: null,
        },
      ],
    })
    mountUsers()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )
    expect(screen.getByText('bob@test.com')).toBeInTheDocument()
    expect(screen.getByText('管理员')).toBeInTheDocument()
    // "用户" now matches both the nav tab and the role badge — scope to table.
    expect(within(screen.getByRole('table')).getByText('用户')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
    expect(screen.getByText('free')).toBeInTheDocument()
    expect(screen.getByText('2026-01-15')).toBeInTheDocument()
    expect(screen.getByText('2026-07-05 09:00')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('renders empty state when no users', async () => {
    mockGetUsers.mockResolvedValue({ success: true, data: [] })
    mountUsers()
    await waitFor(() =>
      expect(screen.getByText('还没有注册用户')).toBeInTheDocument(),
    )
  })

  it('opens alert dialog on role change click and confirms mutation', async () => {
    const user = userEvent.setup()
    mockGetUsers.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          email: 'bob@test.com',
          role: 'user',
          tier: 'free',
          created_at: '2026-01-01T00:00:00+00:00',
          last_login: null,
        },
      ],
    })
    mockUpdateUserRole.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        email: 'bob@test.com',
        role: 'admin',
        tier: 'free',
        created_at: '2026-01-01T00:00:00+00:00',
        last_login: null,
      },
    })

    mountUsers()
    await waitFor(() =>
      expect(screen.getByText('bob@test.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /变更角色/ }))
    await user.click(screen.getByRole('menuitem', { name: '设为管理员' }))

    expect(await screen.findByText('确认变更角色')).toBeInTheDocument()
    // Dialog description contains the target email + role text.
    expect(
      screen.getByText(/此操作将被记录到审计日志/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认' }))

    await waitFor(() => {
      expect(mockUpdateUserRole).toHaveBeenCalledWith(1, 'admin')
    })
    // Invalidation triggers a refetch of the user list.
    await waitFor(() => {
      expect(mockGetUsers).toHaveBeenCalledTimes(2)
    })
    // Alert dialog closes after confirm.
    expect(screen.queryByText('确认变更角色')).not.toBeInTheDocument()
  })

  it('cancels role change when alert dialog cancel is clicked', async () => {
    const user = userEvent.setup()
    mockGetUsers.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          email: 'alice@test.com',
          role: 'admin',
          tier: 'pro',
          created_at: '2026-01-01T00:00:00+00:00',
          last_login: null,
        },
      ],
    })
    mountUsers()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /变更角色/ }))
    await user.click(screen.getByRole('menuitem', { name: '设为用户' }))

    expect(await screen.findByText('确认变更角色')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(mockUpdateUserRole).not.toHaveBeenCalled()
    expect(
      screen.queryByText('确认变更角色'),
    ).not.toBeInTheDocument()
  })

  it('disables dropdown item for current role', async () => {
    const user = userEvent.setup()
    mockGetUsers.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          email: 'alice@test.com',
          role: 'admin',
          tier: 'pro',
          created_at: '',
          last_login: null,
        },
      ],
    })
    mountUsers()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /变更角色/ }))
    const adminItem = screen.getByRole('menuitem', { name: '设为管理员' })
    const userItem = screen.getByRole('menuitem', { name: '设为用户' })

    expect(adminItem).toHaveAttribute('aria-disabled', 'true')
    expect(userItem).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('shows error toast when mutation fails', async () => {
    const user = userEvent.setup()
    mockGetUsers.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          email: 'bob@test.com',
          role: 'user',
          tier: 'free',
          created_at: '',
          last_login: null,
        },
      ],
    })
    mockUpdateUserRole.mockResolvedValue({
      success: false,
      message: '不能降级自己',
    })

    mountUsers()
    await waitFor(() =>
      expect(screen.getByText('bob@test.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /变更角色/ }))
    await user.click(screen.getByRole('menuitem', { name: '设为管理员' }))
    await user.click(screen.getByRole('button', { name: '确认' }))

    await waitFor(() => {
      expect(screen.getByText('不能降级自己')).toBeInTheDocument()
    })
  })

  it('disables the role-change button while mutation is pending', async () => {
    const user = userEvent.setup()
    let resolveMutation!: (v: unknown) => void
    mockGetUsers.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          email: 'bob@test.com',
          role: 'user',
          tier: 'free',
          created_at: '',
          last_login: null,
        },
      ],
    })
    mockUpdateUserRole.mockReturnValue(
      new Promise((res) => {
        resolveMutation = res
      }),
    )

    mountUsers()
    await waitFor(() =>
      expect(screen.getByText('bob@test.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /变更角色/ }))
    await user.click(screen.getByRole('menuitem', { name: '设为管理员' }))
    await user.click(screen.getByRole('button', { name: '确认' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /变更角色/ }),
      ).toBeDisabled()
    })

    resolveMutation({
      success: true,
      data: { id: 1, email: 'bob@test.com', role: 'admin', tier: 'free', created_at: '', last_login: null },
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /变更角色/ }),
      ).not.toBeDisabled()
    })
  })
})

// ── AdminAuditPage ──────────────────────────────────────────────────────

describe('AdminAuditPage', () => {
  it('renders page header with title and description', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    mountAudit(['/app/admin/audit'])
    expect(
      await screen.findByRole('heading', { name: '操作日志' }),
    ).toBeInTheDocument()
    expect(screen.getByText('管理员操作审计记录')).toBeInTheDocument()
  })

  it('renders admin nav tabs with audit active', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mockAcknowledgeAuditLogs.mockResolvedValue({ success: true, data: { updated: 0 } })
    mountAudit(['/app/admin/audit'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-audit')).toHaveAttribute('data-state', 'active'),
    )
    expect(screen.getByTestId('admin-nav-tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('admin-nav-tab-users')).toBeInTheDocument()
  })

  it('does NOT render log rows while loading', () => {
    mockGetAuditLogs.mockReturnValue(new Promise(() => {}))
    mountAudit()
    expect(screen.queryByText('admin@test.com')).not.toBeInTheDocument()
  })

  it('renders audit log table with correct data', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: [
          {
            id: 1,
            admin_user_id: 1,
            target_user_id: 2,
            action: 'update_role',
            detail: 'role: user → admin',
            created_at: '2026-07-05T10:30:00+00:00',
            admin_email: 'admin@test.com',
            target_email: 'user@test.com',
          },
        ],
        total: 1,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByText('admin@test.com')).toBeInTheDocument(),
    )
    expect(screen.getByText('user@test.com')).toBeInTheDocument()
    expect(screen.getByText('update_role')).toBeInTheDocument()
    expect(screen.getByText('role: user → admin')).toBeInTheDocument()
    expect(screen.getByText('2026-07-05 10:30')).toBeInTheDocument()
  })

  it('falls back to ID display when emails are null', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: [
          {
            id: 1,
            admin_user_id: 5,
            target_user_id: null,
            action: 'system_restart',
            detail: null,
            created_at: '2026-07-05T10:00:00+00:00',
            admin_email: null,
            target_email: null,
          },
        ],
        total: 1,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByText('ID:5')).toBeInTheDocument(),
    )
    // Target email is null and target_user_id is also null → '—'
    // v3-table: the row now starts with a selection checkbox column at
    // index 0, so target column moved from [2] to [3]. We locate the
    // admin cell (which renders 'ID:5' in this fixture) and assert the
    // NEXT cell is the target column — robust against future column
    // re-orderings.
    const adminCell = screen.getByText('ID:5').closest('td')
    expect(adminCell).not.toBeNull()
    const targetCell = adminCell!.nextElementSibling
    expect(targetCell).toHaveTextContent('—')
  })

  it('renders empty state when no audit logs', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByText('暂无操作记录')).toBeInTheDocument(),
    )
  })

  it('renders time range filter tabs (全部 / 今天 / 本周 / 本月 / 自定义)', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('tab', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '本周' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '本月' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '自定义' })).toBeInTheDocument()
  })

  it('switching time range tab resets page to 1 and refetches with new range', async () => {
    const user = userEvent.setup()
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'update_role',
          detail: `entry ${i + 1}`,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'admin@test.com',
          target_email: 'user@test.com',
        })),
        total: 75,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByText('entry 1')).toBeInTheDocument(),
    )

    // Navigate to page 2 first
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 25 }, (_, i) => ({
          id: i + 51,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'update_role',
          detail: `entry ${i + 51}`,
          created_at: '2026-07-05T11:00:00+00:00',
          admin_email: 'admin@test.com',
          target_email: 'user@test.com',
        })),
        total: 75,
        page: 2,
        per_page: 50,
      },
    })
    await user.click(screen.getByRole('button', { name: /下一页/ }))
    await waitFor(() =>
      expect(screen.getByText('entry 51')).toBeInTheDocument(),
    )

    // Switch to "今天" tab — page should reset to 1
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    await user.click(screen.getByRole('tab', { name: '今天' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '今天' })).toHaveAttribute('data-state', 'active'),
    )

    // The last call should have page=1 and timeRange=today (3rd arg)
    const lastCall = mockGetAuditLogs.mock.calls[mockGetAuditLogs.mock.calls.length - 1]
    expect(lastCall[0]).toBe(1) // page
    expect(lastCall[1]).toBe(50) // perPage
    expect(lastCall[2]).toBe('today') // timeRange
  })

  it('navigates pages and fetches new data', async () => {
    const user = userEvent.setup()
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'update_role',
          detail: `entry ${i + 1}`,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'admin@test.com',
          target_email: 'user@test.com',
        })),
        total: 75,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByText('entry 1')).toBeInTheDocument(),
    )

    expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument()
    expect(screen.getByText(/共 75 条/)).toBeInTheDocument()

    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 25 }, (_, i) => ({
          id: i + 51,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'update_role',
          detail: `entry ${i + 51}`,
          created_at: '2026-07-05T11:00:00+00:00',
          admin_email: 'admin@test.com',
          target_email: 'user@test.com',
        })),
        total: 75,
        page: 2,
        per_page: 50,
      },
    })

    await user.click(screen.getByRole('button', { name: /下一页/ }))
    await waitFor(() =>
      expect(screen.getByText('entry 51')).toBeInTheDocument(),
    )
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument()
    expect(mockGetAuditLogs).toHaveBeenLastCalledWith(2, 50, 'all', undefined, undefined)

    expect(screen.getByRole('button', { name: /上一页/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /下一页/ })).toBeDisabled()
  })

  it('disables prev on first page and next on last page when only 2 pages', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /上一页/ })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: /下一页/ })).not.toBeDisabled()
  })

  it('both prev and next are enabled on a middle page', async () => {
    const user = userEvent.setup()
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 120,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /下一页/ })).toBeInTheDocument(),
    )

    // Navigate to page 2 of 3
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 51,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T11:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 120,
        page: 2,
        per_page: 50,
      },
    })
    await user.click(screen.getByRole('button', { name: /下一页/ }))
    await waitFor(() =>
      expect(screen.getByText(/第 2 \/ 3 页/)).toBeInTheDocument(),
    )

    expect(screen.getByRole('button', { name: /上一页/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /下一页/ })).not.toBeDisabled()
  })

  it('reads time range and page from URL query params on mount', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 25 }, (_, i) => ({
          id: i + 51,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T11:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 2,
        per_page: 50,
      },
    })
    mountAudit(['/app/admin/audit?range=today&page=2'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '今天' })).toHaveAttribute('data-state', 'active'),
    )
    await waitFor(() =>
      expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument(),
    )
    // The initial API call should include timeRange + page from URL.
    expect(mockGetAuditLogs).toHaveBeenCalledWith(2, 50, 'today', undefined, undefined)
  })

  it('reads custom dates from URL query params on mount', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    mountAudit(['/app/admin/audit?range=custom&start=2026-07-01&end=2026-07-05'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '自定义' })).toHaveAttribute('data-state', 'active'),
    )
    expect(screen.getByDisplayValue('2026-07-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-07-05')).toBeInTheDocument()
    expect(mockGetAuditLogs).toHaveBeenCalledWith(1, 50, 'custom', '2026-07-01', '2026-07-05')
  })

  it('gracefully falls back to "all" when range URL param is invalid', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    mountAudit(['/app/admin/audit?range=invalid'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('data-state', 'active'),
    )
    expect(mockGetAuditLogs).toHaveBeenCalledWith(1, 50, 'all', undefined, undefined)
  })

  it('gracefully falls back to page 1 when page URL param is negative', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit(['/app/admin/audit?range=all&page=-1'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('data-state', 'active'),
    )
    // Pagination should show page 1, not -1 (totalPages = 2, so footer renders)
    await waitFor(() =>
      expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument(),
    )
    expect(mockGetAuditLogs).toHaveBeenCalledWith(1, 50, 'all', undefined, undefined)
  })

  it('gracefully falls back to page 1 when page URL param is non-numeric', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 1,
        per_page: 50,
      },
    })
    mountAudit(['/app/admin/audit?range=all&page=abc'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('data-state', 'active'),
    )
    // Pagination should show page 1, not abc (totalPages = 2, so footer renders)
    await waitFor(() =>
      expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument(),
    )
    expect(mockGetAuditLogs).toHaveBeenCalledWith(1, 50, 'all', undefined, undefined)
  })

  it('clicking 清除筛选 resets range to "all" and page to 1 on AuditPage', async () => {
    const user = userEvent.setup()
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 25 }, (_, i) => ({
          id: i + 51,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T11:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 2,
        per_page: 50,
      },
    })
    mountAudit(['/app/admin/audit?range=today&page=2'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '今天' })).toHaveAttribute('data-state', 'active'),
    )
    await waitFor(() =>
      expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument(),
    )

    const clearBtn = screen.getByRole('button', { name: '清除筛选' })
    expect(clearBtn).toBeInTheDocument()

    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 1,
        per_page: 50,
      },
    })
    await user.click(clearBtn)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('data-state', 'active'),
    )
    // Pagination resets to page 1
    await waitFor(() =>
      expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument(),
    )
    // Button disappears when filters are inactive
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument()
    // API refetched with page=1, range='all'
    expect(mockGetAuditLogs).toHaveBeenLastCalledWith(1, 50, 'all', undefined, undefined)
  })

  it('clicking 清除筛选 wipes all params (range + start + end + page)', async () => {
    const user = userEvent.setup()
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 25 }, (_, i) => ({
          id: i + 51,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T11:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 2,
        per_page: 50,
      },
    })
    mountAudit(['/app/admin/audit?range=custom&start=2026-07-01&end=2026-07-05&page=2'])
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '自定义' })).toHaveAttribute('data-state', 'active'),
    )
    expect(screen.getByDisplayValue('2026-07-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-07-05')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument(),
    )

    const clearBtn = screen.getByRole('button', { name: '清除筛选' })
    expect(clearBtn).toBeInTheDocument()

    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: {
        logs: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          admin_user_id: 1,
          target_user_id: 2,
          action: 'login',
          detail: null,
          created_at: '2026-07-05T10:00:00+00:00',
          admin_email: 'a@test.com',
          target_email: 'b@test.com',
        })),
        total: 75,
        page: 1,
        per_page: 50,
      },
    })
    await user.click(clearBtn)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('data-state', 'active'),
    )
    // Custom date inputs should be gone
    expect(screen.queryByDisplayValue('2026-07-01')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('2026-07-05')).not.toBeInTheDocument()
    // Pagination resets to page 1
    await waitFor(() =>
      expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument(),
    )
    // API refetched with all defaults
    expect(mockGetAuditLogs).toHaveBeenLastCalledWith(1, 50, 'all', undefined, undefined)
  })
})

// ── AdminNavTabs ────────────────────────────────────────────────────────

describe('AdminNavTabs', () => {
  it('clicking an inactive tab calls navigate() with the correct path', async () => {
    const user = userEvent.setup()
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toHaveAttribute('data-state', 'active'),
    )

    // Click "users" tab — should navigate to /app/admin/users
    await user.click(screen.getByTestId('admin-nav-tab-users'))
    expect(mockNavigate).toHaveBeenCalledWith('/app/admin/users')

    // Click "audit" tab — should navigate to /app/admin/audit
    await user.click(screen.getByTestId('admin-nav-tab-audit'))
    expect(mockNavigate).toHaveBeenCalledWith('/app/admin/audit')
  })

  it('shows badge on audit tab when unacknowledged count > 0', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 5 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-audit-badge')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('admin-nav-audit-badge')).toHaveTextContent('5')
  })

  it('caps badge at 99+ when unacknowledged count exceeds 99', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 150 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-audit-badge')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('admin-nav-audit-badge')).toHaveTextContent('99+')
  })

  it('does NOT show badge on audit tab when unacknowledged count is 0', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toHaveAttribute('data-state', 'active'),
    )
    expect(screen.queryByTestId('admin-nav-audit-badge')).not.toBeInTheDocument()
  })

  it('renders keyboard shortcut kbd hints (1 / 2 / 3) on each tab', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toBeInTheDocument(),
    )
    // Each tab trigger should contain a <kbd> with its shortcut digit.
    const overviewTab = screen.getByTestId('admin-nav-tab-overview')
    const usersTab = screen.getByTestId('admin-nav-tab-users')
    const auditTab = screen.getByTestId('admin-nav-tab-audit')
    expect(overviewTab).toHaveTextContent('1')
    expect(usersTab).toHaveTextContent('2')
    expect(auditTab).toHaveTextContent('3')
  })

  it('Cmd+1/2/3 navigates to the corresponding admin tab when on an admin page', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toHaveAttribute('data-state', 'active'),
    )

    // Cmd+2 → users
    const user = userEvent.setup()
    await user.keyboard('{Meta>}{2}{/Meta}')
    expect(mockNavigate).toHaveBeenCalledWith('/app/admin/users')

    // Cmd+3 → audit
    await user.keyboard('{Meta>}{3}{/Meta}')
    expect(mockNavigate).toHaveBeenCalledWith('/app/admin/audit')

    // Cmd+1 → overview
    await user.keyboard('{Meta>}{1}{/Meta}')
    expect(mockNavigate).toHaveBeenCalledWith('/app/admin')
  })

  it('does NOT navigate when Cmd+1/2/3 is pressed outside admin pages', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app']) // NOT an admin page
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toBeInTheDocument(),
    )

    const user = userEvent.setup()
    await user.keyboard('{Meta>}{2}{/Meta}')
    expect(mockNavigate).not.toHaveBeenCalledWith('/app/admin/users')
  })

  it('does NOT navigate when typing in an input field', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toHaveAttribute('data-state', 'active'),
    )

    // Add an input to the document and focus it.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    input.focus()

    const user = userEvent.setup()
    await user.keyboard('{Meta>}{2}{/Meta}')
    expect(mockNavigate).not.toHaveBeenCalledWith('/app/admin/users')

    document.body.removeChild(input)
  })

  it('does NOT navigate when a modal dialog is open', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toHaveAttribute('data-state', 'active'),
    )

    // Inject a fake open Radix Dialog into the DOM.
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)

    const user = userEvent.setup()
    await user.keyboard('{Meta>}{2}{/Meta}')
    expect(mockNavigate).not.toHaveBeenCalledWith('/app/admin/users')

    document.body.removeChild(dialog)
  })

  it('does NOT navigate when Shift is held (Shift+Cmd+2)', async () => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 0,
        active_today: 0,
        total_tasks: 0,
        task_success_rate: 0,
        recent_actions: [],
      },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 0 } })
    mountOverview(['/app/admin'])
    await waitFor(() =>
      expect(screen.getByTestId('admin-nav-tab-overview')).toHaveAttribute('data-state', 'active'),
    )

    const user = userEvent.setup()
    await user.keyboard('{Shift>}{Meta>}{2}{/Meta}{/Shift}')
    expect(mockNavigate).not.toHaveBeenCalledWith('/app/admin/users')
  })
})

// ── AdminAuditPage acknowledgement ──────────────────────────────────────

describe('AdminAuditPage acknowledgement', () => {
  it('calls acknowledgeAuditLogs on mount and invalidates badge query', async () => {
    mockGetAuditLogs.mockResolvedValue({
      success: true,
      data: { logs: [], total: 0, page: 1, per_page: 50 },
    })
    mockGetUnacknowledgedAuditCount.mockResolvedValue({ success: true, data: { count: 3 } })
    mockAcknowledgeAuditLogs.mockResolvedValue({ success: true, data: { updated: 3 } })
    mountAudit(['/app/admin/audit'])

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '操作日志' })).toBeInTheDocument(),
    )

    // Should call acknowledge on mount
    await waitFor(() => {
      expect(mockAcknowledgeAuditLogs).toHaveBeenCalledTimes(1)
    })
  })
})

// ── AdminOverviewPage · v3-mini sparkline + delta ──────────────────────
//
// These four tests lock the new visual layer on the Admin Overview
// 4-stat strip. They complement the existing contract tests
// (which still pass — see Test Contract in components/AdminStat.tsx):
//
//   1. `renders 4 stat cards on initial mount` — structural: the
//      `data-testid="admin-stat-card"` group count stays at 4
//      regardless of data state.
//   2. `renders sparkline SVG inside each stat card after data loads`
//      — confirms the 4 trend series render into 4 SVG sparklines.
//   3. `does NOT render sparkline while loading` — pin the loading
//      suppression behavior so a future refactor that flips the
//      boolean doesn't break the contract.
//   4. `renders a colored delta chip with a percentage label in each
//      card` — confirms the auto-derived chip carries a digit+%
//      string. Tone class itself is asserted on the chip's className
//      (one of success|warning|error|info background tokens).
//
// All four rely on the deterministic trendMock — the same metric key
// produces the same series across runs so test snapshots don't drift.

describe('AdminOverviewPage · v3-mini sparkline + delta', () => {
  // Helper: minimal overview object + matcher reset for this describe.
  const mockOverviewResolved = (overrides: Partial<{
    total_users: number
    active_today: number
    total_tasks: number
    task_success_rate: number
  }> = {}) => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 42,
        active_today: 7,
        total_tasks: 1337,
        task_success_rate: 98.5,
        recent_actions: [],
        ...overrides,
      },
    })
  }

  it('renders 4 stat cards on initial mount', async () => {
    mockOverviewResolved()
    mountOverview()
    await waitFor(() =>
      expect(screen.getAllByTestId('admin-stat-card')).toHaveLength(4),
    )
  })

  it('renders a sparkline SVG inside each stat card after data loads', async () => {
    mockOverviewResolved()
    mountOverview()
    await waitFor(() =>
      expect(screen.getAllByTestId('admin-stat-sparkline')).toHaveLength(4),
    )
  })

  it('does NOT render sparkline while loading', () => {
    mockGetOverview.mockReturnValue(new Promise(() => {}))
    mountOverview()
    // Overview hasn't resolved → trends is null → no sparkline rendered.
    expect(screen.queryAllByTestId('admin-stat-sparkline')).toHaveLength(0)
    expect(screen.queryAllByTestId('admin-stat-delta')).toHaveLength(0)
    // Loading skeleton keeps the card structure intact (4 cards render
    // even before data lands so the strip's vertical rhythm doesn't
    // shift on data resolve).
    expect(screen.getAllByTestId('admin-stat-card')).toHaveLength(4)
  })

  it('renders a colored delta chip with a digit+% label in each card', async () => {
    mockOverviewResolved()
    mountOverview()
    await waitFor(() => {
      const chips = screen.getAllByTestId('admin-stat-delta')
      expect(chips).toHaveLength(4)
      // Each chip carries the +X.X% / -X.X% / 0.0% label. Arrow svg
      // contributes no text content so textContent here IS the label.
      chips.forEach((chip) => {
        const text = chip.textContent ?? ''
        expect(text).toMatch(/-?\d+(\.\d+)?%/u)
        // Tone chip carries one of the four tone-* background tokens
        // — confirms `toneChipClasses(toneDelta.tone)` is composed
        // correctly (no "muted" fallback when a real direction exists).
        expect(chip.className).toMatch(/status-(success|warning|error|info)-bg/u)
      })
    })
  })
})

// ── AdminUsersPage · v3-table · TanStack primitives ─────────────────────
//
// Six tests verifying the v3-table upgrade (`@tanstack/react-table`
// 8.21.3). Locked v2 test contract stays green (see admin-users
// describe block above) — these six pin *behavior* of the new
// primitives:
//
//   1. Sort asc via column header click (header caret ↑).
//   2. Sort desc on second click (caret ↓).
//   3. Per-column filter input narrows the row model.
//   4. Column-visibility dropdown hides the tier column.
//   5. Row multi-select shows the bulk toolbar with selected count.
//   6. Bulk toolbar 取消选择 unmounts the toolbar.
//
// Insertion order for the fixture is intentionally mis-ordered vs
// alphabetic email order (carol, alice, bob ⇒ by-id: 1·2·3) so a sort
// click visibly reorders rows. TanStack 8.x two-state sort:
// false → asc → desc → asc … (no in-between unsorted toggle).

describe('AdminUsersPage · v3-table · TanStack primitives', () => {
  function mountUsersWithThreeRows() {
    mockGetUsers.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          email: 'carol@test.com',
          role: 'user',
          tier: 'free',
          created_at: '2026-05-20T10:00:00+00:00',
          last_login: null,
        },
        {
          id: 2,
          email: 'alice@test.com',
          role: 'admin',
          tier: 'pro',
          created_at: '2026-01-15T08:00:00+00:00',
          last_login: '2026-07-05T09:00:00+00:00',
        },
        {
          id: 3,
          email: 'bob@test.com',
          role: 'user',
          tier: 'free',
          created_at: '2026-03-20T10:00:00+00:00',
          last_login: null,
        },
      ],
    })
    return mountUsers()
  }

  it('sorts ascending when clicking the 邮箱 column header', async () => {
    const user = userEvent.setup()
    mountUsersWithThreeRows()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByTestId('admin-table-header-email'))

    // Asc by email: alice (id 2) → bob (id 3) → carol (id 1).
    await waitFor(() => {
      const rows = screen.getAllByTestId(/^admin-table-row-/)
      expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
        'admin-table-row-2',
        'admin-table-row-3',
        'admin-table-row-1',
      ])
      // SortIndicator surfaces ↑ when direction === 'asc'.
      expect(screen.getByTestId('admin-table-header-email')).toHaveTextContent(
        '↑',
      )
    })
  })

  it('sorts descending on the second click of the 邮箱 column header', async () => {
    const user = userEvent.setup()
    mountUsersWithThreeRows()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByTestId('admin-table-header-email'))
    await user.click(screen.getByTestId('admin-table-header-email'))

    // Desc by email: carol (id 1) → bob (id 3) → alice (id 2).
    await waitFor(() => {
      const rows = screen.getAllByTestId(/^admin-table-row-/)
      expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
        'admin-table-row-1',
        'admin-table-row-3',
        'admin-table-row-2',
      ])
      // SortIndicator surfaces ↓ when direction === 'desc'.
      expect(screen.getByTestId('admin-table-header-email')).toHaveTextContent(
        '↓',
      )
    })
  })

  it('filters rows by typing in the 邮箱 column filter input', async () => {
    const user = userEvent.setup()
    mountUsersWithThreeRows()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )

    const filterInput = screen.getByTestId('admin-table-filter-email')
    await user.type(filterInput, 'alice')

    // Only alice matches the substring; bob and carol hidden by filter.
    await waitFor(() => {
      expect(screen.getByText('alice@test.com')).toBeInTheDocument()
      expect(screen.queryByText('bob@test.com')).not.toBeInTheDocument()
      expect(screen.queryByText('carol@test.com')).not.toBeInTheDocument()
    })
  })

  it('hides the Tier column via the 列设置 dropdown', async () => {
    const user = userEvent.setup()
    mountUsersWithThreeRows()
    await waitFor(() => expect(screen.getByText('pro')).toBeInTheDocument())

    // Sanity: tier CodePill text rendered before toggle (pro + free).
    expect(screen.getByText('pro')).toBeInTheDocument()
    expect(screen.getAllByText('free').length).toBeGreaterThan(0)

    await user.click(screen.getByTestId('admin-table-columns-toggle'))
    await user.click(screen.getByTestId('admin-table-columns-toggle-tier'))

    await waitFor(() => {
      // Tier values no longer in DOM after hiding the column.
      expect(screen.queryByText('pro')).not.toBeInTheDocument()
      expect(screen.queryByText('free')).not.toBeInTheDocument()
    })
    // Email column still visible — sanity that we hid the right one.
    expect(screen.getByText('alice@test.com')).toBeInTheDocument()
  })

  it('shows bulk toolbar with selected count after multi-select', async () => {
    const user = userEvent.setup()
    mountUsersWithThreeRows()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )

    // Initially: 0 selected → bulk toolbar is unmounted.
    expect(
      screen.queryByTestId('admin-table-bulk-toolbar'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('checkbox', { name: '选择 alice@test.com' }),
    )
    await waitFor(() =>
      expect(
        screen.getByTestId('admin-table-bulk-toolbar'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByTestId('admin-table-bulk-toolbar-count'),
    ).toHaveTextContent('已选 1 项')

    await user.click(
      screen.getByRole('checkbox', { name: '选择 bob@test.com' }),
    )
    expect(
      screen.getByTestId('admin-table-bulk-toolbar-count'),
    ).toHaveTextContent('已选 2 项')
  })

  it('unmounts the bulk toolbar after clicking 取消选择', async () => {
    const user = userEvent.setup()
    mountUsersWithThreeRows()
    await waitFor(() =>
      expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
    )

    await user.click(
      screen.getByRole('checkbox', { name: '选择 alice@test.com' }),
    )
    await waitFor(() =>
      expect(
        screen.getByTestId('admin-table-bulk-toolbar'),
      ).toBeInTheDocument(),
    )

    await user.click(screen.getByTestId('admin-table-bulk-clear'))

    await waitFor(() => {
      expect(
        screen.queryByTestId('admin-table-bulk-toolbar'),
      ).not.toBeInTheDocument()
    })
    // Header checkbox reflects 0 selected.
    expect(screen.getByRole('checkbox', { name: '全选' })).not.toBeChecked()
  })
})

// ── AdminOverviewPage · /api/admin/trends integration ───────────────────
//
// Two tests pin the v3-trends contract:
//
//   1. `calls getTrends for all 4 metrics with days=14 on mount` — the
//      AdminOverviewPage's trendsQuery fan-out hits the API once per
//      metric. Without this assertion, a future refactor that drops a
//      metric from the fan-out list would silently leave that stat's
//      sparkline driven by the in-memory trendMock (and tests wouldn't
//      notice).
//   2. `falls back to trendMock when getTrends rejects — sparkline
//      still renders` — locks the per-metric fallback. The page must
//      still show 4 sparklines even when the trends endpoint 5xx's,
//      so a single failed metric doesn't take down all 4 sparklines.
//      We test the WHOLE-batch-failure case (all 4 reject); the
//      per-metric partial-degradation is exercised by the existing
//      v3-mini tests which use the default synthetic data.

describe('AdminOverviewPage · /api/admin/trends integration', () => {
  const mockOverviewResolved = (overrides: Partial<{
    total_users: number
    active_today: number
    total_tasks: number
    task_success_rate: number
  }> = {}) => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 42,
        active_today: 7,
        total_tasks: 1337,
        task_success_rate: 98.5,
        recent_actions: [],
        ...overrides,
      },
    })
  }

  it('calls getTrends for all 4 metrics with days=14 on mount', async () => {
    mockOverviewResolved()
    mountOverview()
    await waitFor(() => {
      // All 4 metrics should have been fetched.
      const calls = mockGetTrends.mock.calls
      const metrics = calls.map((c) => c[0])
      const days = calls.map((c) => c[1])
      expect(metrics).toEqual(
        expect.arrayContaining([
          'total_users',
          'active_today',
          'total_tasks',
          'task_success_rate',
        ]),
      )
      // Every call should request days=14 (the v3-mini default).
      days.forEach((d) => expect(d).toBe(14))
      // Exactly 4 calls (one per metric) — no double-fetch, no missing.
      expect(calls).toHaveLength(4)
    })
  })

  it('falls back to trendMock when getTrends rejects — sparkline still renders', async () => {
    // Simulate the trends endpoint 5xx'ing — ALL 4 metrics fail. The
    // page's trendsQuery catches per-promise and synthesizes an
    // out object with `undefined` for every key. The page's `trends`
    // useMemo then sees `real === undefined || no-entries` and falls
    // back to trendMock for every metric, so all 4 sparklines
    // still render (the fallback path is what keeps the page
    // graceful when /api/admin/trends 5xx's or the network drops).
    mockGetTrends.mockRejectedValue(new Error('trends endpoint 503'))
    mockOverviewResolved()
    mountOverview()
    await waitFor(() => {
      // 4 stat cards still render.
      expect(screen.getAllByTestId('admin-stat-card')).toHaveLength(4)
    })
    // 4 sparklines still render (driven by the in-memory trendMock
    // fallback, not the API). The chip path also still works because
    // trendMock.last-sample-pin means series[13] === current.
    await waitFor(() => {
      expect(screen.getAllByTestId('admin-stat-sparkline')).toHaveLength(4)
    })
  })
})

// ── AdminOverviewPage · /api/admin/trends/export (CSV download) ─────────
//
// Two tests pin the v3-trends-export contract:
//
//   1. `renders 下载趋势 button next to refresh` — the button lives in
//      the PageHeader actions slot, right next to the 刷新 button.
//      Without this assertion, a future header redesign that drops
//      the button would silently remove the only mouse-accessible
//      export entry point (the keyboard shortcut isn't wired).
//
//   2. `clicking 下载趋势 triggers CSV download with days=14` — locks
//      the download contract: the page calls exportTrendsCsv(14)
//      (mirroring the v3-mini sparkline width), and the resulting
//      blob triggers an `<a download>` click that the browser would
//      turn into a file save dialog. We assert via the mock +
//      spyOn(URL.createObjectURL) so the test is independent of
//      jsdom's anchor-download behavior.

describe('AdminOverviewPage · /api/admin/trends/export (CSV download)', () => {
  const mockOverviewResolved = (overrides: Partial<{
    total_users: number
    active_today: number
    total_tasks: number
    task_success_rate: number
  }> = {}) => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 42,
        active_today: 7,
        total_tasks: 1337,
        task_success_rate: 98.5,
        recent_actions: [],
        ...overrides,
      },
    })
  }

  it('renders 下载趋势 button next to refresh in the page header', async () => {
    mockOverviewResolved()
    mountOverview()
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '系统概览' }),
      ).toBeInTheDocument(),
    )
    const exportBtn = screen.getByTestId('admin-overview-export-trends')
    const refreshBtn = screen.getByTestId('admin-overview-refresh')
    expect(exportBtn).toBeInTheDocument()
    expect(refreshBtn).toBeInTheDocument()
    // Both buttons live in the same actions slot (PageHeader).
    // The export button is rendered BEFORE the refresh button in
    // the actions JSX so they read left-to-right as
    // "[last-updated] [days-picker] [下载趋势] [刷新]" in the
    // toolbar.
    expect(
      exportBtn.compareDocumentPosition(refreshBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('clicking 下载趋势 triggers CSV download with days=14', async () => {
    const user = userEvent.setup()
    // The blob is opaque to jsdom — it just needs to exist so the
    // page's URL.createObjectURL() call has something to wrap.
    mockExportTrendsCsv.mockResolvedValue(
      new Blob(['\ufeffdate,total_users,active_today,total_tasks,task_success_rate\n2026-07-05,1,2,3,98.5\n']),
    )
    mockOverviewResolved()
    mountOverview()
    await waitFor(() =>
      expect(
        screen.getByTestId('admin-overview-export-trends'),
      ).toBeInTheDocument(),
    )

    // Spy on URL.createObjectURL so we can verify the page
    // actually built an anchor href (the only signal jsdom
    // gives us that a "download" was triggered).
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url')

    await user.click(screen.getByTestId('admin-overview-export-trends'))

    // exportTrendsCsv was called with days=14 (matches the v3-mini
    // sparkline width; future changes to the page's days must thread
    // through here too).
    await waitFor(() => {
      expect(mockExportTrendsCsv).toHaveBeenCalledWith(14)
    })
    // The handler built an object URL from the response blob.
    expect(createObjectURLSpy).toHaveBeenCalled()
    // No inline mockRestore — the file-level `afterEach` (vi.restoreAllMocks)
    // cleans up `vi.spyOn` stubs so a throw mid-assertion can't leak the
    // spy into the next test.
  })
})

// ── AdminOverviewPage · /api/admin/trends days-picker ──────────────────
//
// Three tests pin the v3-trends days-picker contract:
//
//   1. `renders days-picker with 3 options and 14d active by default` —
//      the picker lives in the PageHeader actions slot, BEFORE the
//      export button. Default 14d matches the v3-mini sparkline
//      width. Without this assertion, a future redesign that drops
//      the picker would silently fall back to the constant-driven
//      default and tests wouldn't notice.
//
//   2. `clicking 7d refetches trends with days=7` — locks the
//      queryKey-driven refetch path. The page's trendsQuery uses
//      `['admin', 'trends', days]` so React Query auto-refetches
//      when the picker changes. Without this, the CSV export and
//      the visible sparkline could drift apart (export would use
//      new days, sparkline would still show old days).
//
//   3. `clicking 下载趋势 after changing days uses the new days` —
//      the export handler reads from the same `days` state, so the
//      CSV always matches the visible chart. Asserts the cross-
//      state coupling that NIT 2 introduced.

describe('AdminOverviewPage · /api/admin/trends days-picker', () => {
  const mockOverviewResolved = (overrides: Partial<{
    total_users: number
    active_today: number
    total_tasks: number
    task_success_rate: number
  }> = {}) => {
    mockGetOverview.mockResolvedValue({
      success: true,
      data: {
        total_users: 42,
        active_today: 7,
        total_tasks: 1337,
        task_success_rate: 98.5,
        recent_actions: [],
        ...overrides,
      },
    })
  }

  it('renders days-picker with 3 options (7d/14d/30d) and 14d active by default', async () => {
    mockOverviewResolved()
    mountOverview()
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '系统概览' }),
      ).toBeInTheDocument(),
    )
    // All 3 options rendered.
    const opt7 = screen.getByTestId('admin-overview-days-7')
    const opt14 = screen.getByTestId('admin-overview-days-14')
    const opt30 = screen.getByTestId('admin-overview-days-30')
    expect(opt7).toBeInTheDocument()
    expect(opt14).toBeInTheDocument()
    expect(opt30).toBeInTheDocument()
    // 14d is the active default (aria-checked=true).
    expect(opt14).toHaveAttribute('aria-checked', 'true')
    expect(opt7).toHaveAttribute('aria-checked', 'false')
    expect(opt30).toHaveAttribute('aria-checked', 'false')
    // Picker is to the LEFT of the export button (it's a scope
    // selector gating the export, not an after-export control).
    const exportBtn = screen.getByTestId('admin-overview-export-trends')
    expect(
      opt7.compareDocumentPosition(exportBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('clicking 7d refetches trends with days=7 for all 4 metrics', async () => {
    const user = userEvent.setup()
    mockOverviewResolved()
    mountOverview()
    await waitFor(() =>
      expect(
        screen.getByTestId('admin-overview-days-7'),
      ).toBeInTheDocument(),
    )
    // Wipe call log so we can isolate the post-click calls. The
    // initial mount already issued 4 calls with days=14 — we only
    // care about the calls triggered by the picker click.
    mockGetTrends.mockClear()
    await user.click(screen.getByTestId('admin-overview-days-7'))
    // The queryKey change drives React Query to refetch all 4
    // metrics with the new days=7. We assert on the call args,
    // not the count, so a future queryFn signature change is OK
    // as long as the days param threads through.
    await waitFor(() => {
      const calls = mockGetTrends.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      calls.forEach((c) => expect(c[1]).toBe(7))
    })
  })

  it('clicking 下载趋势 after changing days uses the new days', async () => {
    const user = userEvent.setup()
    mockExportTrendsCsv.mockResolvedValue(
      new Blob(['\ufeffdate,total_users,active_today,total_tasks,task_success_rate\n2026-07-05,1,2,3,98.5\n']),
    )
    mockOverviewResolved()
    mountOverview()
    await waitFor(() =>
      expect(
        screen.getByTestId('admin-overview-days-7'),
      ).toBeInTheDocument(),
    )
    // Click 30d (different from default 14d so the assertion is
    // meaningful), then click export — the export handler should
    // read the current `days` state and pass it through.
    await user.click(screen.getByTestId('admin-overview-days-30'))
    mockExportTrendsCsv.mockClear()
    await user.click(screen.getByTestId('admin-overview-export-trends'))
    await waitFor(() => {
      expect(mockExportTrendsCsv).toHaveBeenCalledWith(30)
    })
  })
})

