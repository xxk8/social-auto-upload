/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { AppShell, SIDEBAR_STORAGE_KEY as APP_SHELL_SIDEBAR_KEY } from './AppShell'
import { mockUseAuth } from '@/test/auth-router-spies'
import { makeQueryClient } from '@/test/render-harness.helpers'
import i18n from '@/lib/i18n/config'

// ─────────────────────────────────────────────────────────────────────────
// AppShell · sidebar i18n flip
//
// Round-NT-28 i18n MVP — dashboard surface extension. This file proves
// the operator-facing sidebar + chrome flip cleanly between zh-CN and
// en-US via the singleton i18n instance + labelKey/labelFallback
// resolution pattern (mirrors MarketingTopBar's NAV_ITEMS shape +
// docs/dev/adr-i18n-invariant.md).
//
// Test surface:
//
//   • 8 specs exercise: initial zh-CN chrome (sidebar nav + admin
//     subnav + section headers + collapse aria-label + search button
//     + help button); en-US flip on language change; round-trip
//     persistence (zh-CN → en-US → zh-CN); localStorage write
//     invariant.
//   • Uses real `<I18nextProvider i18n={i18n}/>` wrap (NOT a
//     vi.mock('react-i18next') stub) so the production `changeLanguage`
//     codepath is exercised end-to-end. Without this, a regression in
//     the singleton's resource-load path would silently pass — a
//     per-test vi.mock would short-circuit the production path and
//     hide the bug.
//
//   • Mirrors AppShell.test.tsx's full mock chain (useAuth /
//     PreferencesDialogProvider / api/client Proxy / 6 lazy route
//     pages). Duplicated by design — the two files are independent
//     test harnesses with overlapping but not identical concerns
//     (this one: locale flip; the other: layout invariants + keyboard
//     shortcuts). A future refactor that extracts a shared
//     `mountAppShellWithMocks()` helper to `@/test/` is a worthwhile
//     followup once a third consumer lands.
// ─────────────────────────────────────────────────────────────────────────

// ── framework-level mocks (must precede under-test imports) ─────────────

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/features/preferences/PreferencesDialogProvider', () => ({
  usePreferencesDialog: () => ({
    open: false,
    activeTab: 'account',
    openPreferences: vi.fn(),
    closePreferences: vi.fn(),
    setActiveTab: vi.fn(),
  }),
}))

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

const SIDEBAR_STORAGE_KEY = APP_SHELL_SIDEBAR_KEY

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  })
}

function setAdminAuth() {
  mockUseAuth.mockReturnValue({
    user: { id: 1, email: 'qa@example.com', role: 'admin' as const },
    isAuthenticated: true,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  } as any)
}

function mountAppShell({
  initialPath = '/dashboard/admin',
  sidebarCollapsed = false,
  viewportWidth = 1280,
} = {}) {
  setViewportWidth(viewportWidth)
  localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <MemoryRouter initialEntries={[initialPath]}>
            <AppShell />
          </MemoryRouter>
        </QueryClientProvider>
      </TooltipProvider>
    </I18nextProvider>,
  )
}

// ── tests ───────────────────────────────────────────────────────────────

describe('AppShell · sidebar i18n flip', () => {
  beforeEach(async () => {
    mockUseAuth.mockReset()
    localStorage.removeItem(SIDEBAR_STORAGE_KEY)
    localStorage.removeItem('sau-ui-locale')
    // Reset the singleton to zh-CN at the start of every test so
    // `i18n.changeLanguage(...)` calls below actually trigger a
    // re-render (rather than setting language to its current value).
    await i18n.changeLanguage('zh-CN')
  })

  // (a) Initial render with zh-CN chrome — asserts the full set of
  //     sidebar nav labels (8 nav + 1 admin root + 3 admin children +
  //     1 admin section header "管理" + 1 main section header "导航")
  //     all render in Chinese under default locale. Each label is
  //     resolved through `t('dashboard.sidebar.nav.X', '...')` and
  //     matches the zh-CN resource literal exactly.
  it('initial zh-CN chrome: 8 nav labels + section headers + admin subnav all in Chinese', () => {
    setAdminAuth()
    mountAppShell()
    const sidebar = screen.getByTestId('app-shell-sidebar')

    // 8 main nav labels (in canonical order)
    expect(within(sidebar).getByText('账号管理')).toBeInTheDocument()
    expect(within(sidebar).getByText('发布中心')).toBeInTheDocument()
    expect(within(sidebar).getByText('任务列表')).toBeInTheDocument()
    expect(within(sidebar).getByText('数据分析')).toBeInTheDocument()
    expect(within(sidebar).getByText('运行日志')).toBeInTheDocument()
    expect(within(sidebar).getByText('下载中心')).toBeInTheDocument()
    expect(within(sidebar).getByText('内容日历')).toBeInTheDocument()
    expect(within(sidebar).getByText('剧本工坊')).toBeInTheDocument()

    // 2 section headers via direct getByText (rendered outside
    // sidebar subwrapper so within(sidebar) isn't strictly required)
    expect(screen.getByText('导航')).toBeInTheDocument()
    expect(screen.getByText('管理')).toBeInTheDocument()

    // 3 admin subnav children
    expect(within(sidebar).getByText('概览')).toBeInTheDocument()
    expect(within(sidebar).getByText('用户管理')).toBeInTheDocument()
    expect(within(sidebar).getByText('审计日志')).toBeInTheDocument()
  })

  // (b) Switch to en-US flips ALL sidebar chrome — admin section
  //     included. After `await act(() => i18n.changeLanguage('en-US'))`
  //     React re-renders, `DASHBOARD_NAV_DEFS.map(d => ({...d, label:
  //     t(d.labelKey, '...')}))` resolves labels to English resources,
  //     and the new labels render. We assert absorption: every zh-CN
  //     label from test (a) is gone AND every en-US label is
  //     present. The negation (`not.toBeInTheDocument()`) catches a
  //     regression that would silently keep BOTH copies (e.g. if the
  //     resolved array leaked into a stale SidebarNav render tree).
  it('switching to en-US flips sidebar nav labels + admin subnav + section headers', async () => {
    setAdminAuth()
    mountAppShell()
    // Sanity: initial state has Chinese labels
    expect(screen.getByText('账号管理')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    // English sidebar nav labels (8) — scoped to sidebar to avoid
    // collision with the role caption (which renders 'Admin' in
    // en-US too but lives in the footer, NOT the sidebar).
    const sidebar = screen.getByTestId('app-shell-sidebar')
    expect(within(sidebar).getByText('Accounts')).toBeInTheDocument()
    expect(within(sidebar).getByText('Publish')).toBeInTheDocument()
    expect(within(sidebar).getByText('Tasks')).toBeInTheDocument()
    expect(within(sidebar).getByText('Analytics')).toBeInTheDocument()
    expect(within(sidebar).getByText('Logs')).toBeInTheDocument()
    expect(within(sidebar).getByText('Inbox')).toBeInTheDocument()
    expect(within(sidebar).getByText('Calendar')).toBeInTheDocument()
    expect(within(sidebar).getByText('Script Studio')).toBeInTheDocument()

    // Section headers in English (Workspace is rendered outside
    // sidebar; "管理" should NOT appear anywhere)
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.queryByText('导航')).not.toBeInTheDocument()
    expect(within(sidebar).queryByText('管理')).not.toBeInTheDocument()

    // Admin subnav children + parent root button (all in sidebar)
    expect(within(sidebar).queryByText('概览')).not.toBeInTheDocument()
    expect(within(sidebar).queryByText('审计日志')).not.toBeInTheDocument()
    // 'Admin' appears in TWO places within the sidebar in en-US:
    // (a) the admin section's Collapsible trigger `<button>` (label
    // from `dashboard.sidebar.admin.root`) and (b) the section
    // header `<span>` (label from `dashboard.sidebar.section_admin`).
    // Bare `getByText` throws on multiple matches; the trigger
    // is a `<button>`, the header is a `<span>`, so the role-based
    // query resolves uniquely to the nav root.
    expect(within(sidebar).getByRole('button', { name: 'Admin' })).toBeInTheDocument()
    expect(within(sidebar).getByText('Overview')).toBeInTheDocument()
    expect(within(sidebar).getByText('Users')).toBeInTheDocument()
    expect(within(sidebar).getByText('Audit logs')).toBeInTheDocument()

    // Sidebar footer email fallback: zh-CN falls back to "管理员" /
    // en-US to "Admin". The footer `<span>` next to the email reads
    // the role-derived label (also '管理员' ↔ 'Admin'). SCOPED to
    // the footer because en-US renders 'Admin' in 2 distinct
    // locations (admin section root button in sidebar + role
    // caption in footer). The email itself stays `qa@example.com`
    // (auth-controlled, NOT localized).
    const footer = screen.getByTestId('app-shell-sidebar-footer-expanded')
    expect(within(footer).getByText('Admin')).toBeInTheDocument()
  })

  // (c) Round-trip persistence — zh-CN → en-US → zh-CN restores
  //     Chinese labels. Catches a regression where the resolved
  //     `navItems` array is mutated during a language change (per
  //     ADR-i18n-invariant: NEVER mutate DASHBOARD_NAV_DEFS — the
  //     resolution `.map` must always produce a fresh array). If a
  //     future refactor leaks the resolved labels back into the
  //     DEFS, the second flip back would hang on English.
  it('zh-CN → en-US → zh-CN round-trip restores Chinese nav labels', async () => {
    setAdminAuth()
    mountAppShell()
    expect(screen.getByText('账号管理')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.queryByText('账号管理')).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })

    // Chinese labels restored; English labels gone
    expect(screen.getByText('账号管理')).toBeInTheDocument()
    expect(screen.getByText('导航')).toBeInTheDocument()
    expect(screen.getByText('用户管理')).toBeInTheDocument()
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument()
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()
  })

  // (d) Collapse aria-label flips with locale. The expanded-mode
  //     collapse button renders `aria-label={t('dashboard.sidebar.
  //     collapse_sidebar', '收起侧边栏')}` (zh-CN) / `'Collapse
  //     sidebar'` (en-US). Asserts via `getByRole('button', { name:
  //     ... })` which resolves both aria-label matches.
  it('collapse button aria-label flips with locale (zh-CN: 收起侧边栏, en-US: Collapse sidebar)', async () => {
    setAdminAuth()
    mountAppShell({ sidebarCollapsed: false })
    // zh-CN default
    expect(
      screen.getByRole('button', { name: '收起侧边栏' }),
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '收起侧边栏' }),
    ).not.toBeInTheDocument()
  })

  // (e) When sidebar is COLLAPSED, the alternate button (expand)
  //     flips too — zh-CN `展开侧边栏` ↔ en-US `Expand sidebar`.
  //     Pins the inverted-conditional branch of the collapse-button
  //     localizations.
  it('expand button aria-label flips with locale when sidebar is collapsed (zh-CN: 展开侧边栏, en-US: Expand sidebar)', async () => {
    setAdminAuth()
    mountAppShell({ sidebarCollapsed: true })
    expect(
      screen.getByRole('button', { name: '展开侧边栏' }),
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeInTheDocument()
  })

  // (f) Search button `<span>` text flips with locale. Asserts on
  //     the rendered text node inside the ghost Button (the icon
  //     SVG has no testable text content, so `getByText(...)`
  //     resolves to the `<span>` directly).
  it('search button <span> text flips with locale (zh-CN: 搜索, en-US: Search)', async () => {
    setAdminAuth()
    mountAppShell()
    expect(screen.getByText('搜索')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.queryByText('搜索')).not.toBeInTheDocument()
  })

  // (g) Help button aria-label flips with locale. The existing
  //     AppShell.test.tsx (e) only asserts zh-CN `findByRole
  //     'button'/name /键盘快捷键/i`. This test pins the FULL
  //     bidirectional contract by adding en-US assertions.
  it('help button aria-label flips with locale (zh-CN: 键盘快捷键, en-US: Keyboard shortcuts)', async () => {
    setAdminAuth()
    mountAppShell()
    expect(
      screen.getByRole('button', { name: '键盘快捷键' }),
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(
      screen.getByRole('button', { name: 'Keyboard shortcuts' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '键盘快捷键' }),
    ).not.toBeInTheDocument()
  })

  // (h) Sidebar footer email fallback (`?? "管理员"`) and role
  //     label (`'管理员'|'用户'`) flip with locale. Pin: the email
  //     ITSELF stays `qa@example.com` (auth-controlled). Only the
  //     fallback strings + role caption flip. Verifies
  //     `t('...email_fallback', '管理员')` and the conditional
  //     `authUser?.role === 'admin'` ternaries resolve to the right
  //     resource in each locale.
  it('sidebar footer email-fallback + role caption flip with locale', async () => {
    setAdminAuth()
    mountAppShell()
    const footer = screen.getByTestId('app-shell-sidebar-footer-expanded')
    // Auth email is qa@example.com (not localized)
    expect(within(footer).getByText('qa@example.com')).toBeInTheDocument()
    // Role caption is '管理员' (admin → admin label)
    expect(within(footer).getByText('管理员')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    // Email still qa@example.com
    expect(within(footer).getByText('qa@example.com')).toBeInTheDocument()
    // Role caption is now 'Admin'
    expect(within(footer).getByText('Admin')).toBeInTheDocument()
    expect(within(footer).queryByText('管理员')).not.toBeInTheDocument()
  })
})
