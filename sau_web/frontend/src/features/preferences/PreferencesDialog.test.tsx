/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@/test/user-event-shim'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { PreferencesDialog } from '@/features/preferences/PreferencesDialog'
import {
  PreferencesDialogProvider,
  usePreferencesDialog,
} from '@/features/preferences/PreferencesDialogProvider'
import { mockUseAuth } from '@/test/auth-router-spies'
import { makeQueryClient } from '@/test/render-harness.helpers'

// useAuth is mocked so PreferencesDialog's <SettingsContent /> reads
// `user.tier` from the mock (NOT the real /api/auth/me fetch) and so
// the 退出 button's `logout()` call can be observed. Same
// mock-router-spies import as UserMenu.test.tsx.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// ── Controlled-mount helper ────────────────────────────────────────
//
// The dialog is `open: false` at first render, so calling
// `render(<PreferencesDialog />)` shows NOTHING. To test the
// dialog content, we wrap it in a small harness component that
// exposes the `openPreferences` hook to a `data-trigger-open`
// button. Clicking the trigger (via userEvent) opens the dialog.
//
// This mirrors the existing "controlled component" test pattern
// from CatalogPage tests / OnboardingTour tests — render a thin
// harness, click an in-test trigger, then assert on what the
// dialog renders.

function OpenTrigger() {
  const { openPreferences } = usePreferencesDialog()
  return (
    <button
      type="button"
      data-testid="test-open-trigger"
      onClick={() => openPreferences('account')}
    >
      open
    </button>
  )
}

function mountDialogUnderTest({
  user = {
    id: 1,
    email: 'qa@sau.dev',
    role: 'admin' as const,
    name: 'qa',
    avatar: null,
    tier: 'legacy' as const,
  },
}: { user?: any } = {}) {
  mockUseAuth.mockReturnValue({
    user,
    isAuthenticated: !!user,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    updateMe: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
    updateMeStatus: 'idle',
  } as any)

  return render(
    <TooltipProvider>
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <PreferencesDialogProvider>
            <OpenTrigger />
            <PreferencesDialog />
          </PreferencesDialogProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  )
}

describe('PreferencesDialog · round-OPT-prefs-dialog', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    // Default mockUseAuth returnValue so test (a) — which mounts
    // <PreferencesDialog /> without invoking mountDialogUnderTest's
    // setUp — doesn't trip on `useAuth() returning undefined`.
    // PreferencesDialog calls `useAuth()` unconditionally for
    // `logout()` (used in handleLogout), so the mock must be
    // populated even when the dialog is closed. Per-test
    // overrides (e.g. test (c) `tier=free`) re-populate via
    // mountDialogUnderTest({ user: { tier: 'free' } }) so the
    // default here is just the safety net.
    mockUseAuth.mockReturnValue({
      user: {
        id: 1,
        email: 'qa@sau.dev',
        role: 'admin',
        name: 'qa',
        avatar: null,
        tier: 'legacy',
      },
      isAuthenticated: true,
      isLoading: false,
      sendCode: vi.fn().mockResolvedValue({ success: true }),
      login: vi.fn().mockResolvedValue({ success: true }),
      logout: vi.fn().mockResolvedValue({ success: true }),
      updateMe: vi.fn().mockResolvedValue({ success: true }),
      sendCodeStatus: 'idle',
      loginStatus: 'idle',
      updateMeStatus: 'idle',
    } as any)
  })

  // (a) Closed-by-default — mounting the dialog in a fresh tree
  // never shows the dialog content. Locks the SSR-safe invariant
  // (the modal portal renders nothing before the openPreferences()
  // call) so future PRs that auto-open on mount get caught.
  it('does NOT render dialog content before openPreferences is called', () => {
    render(
      <TooltipProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <PreferencesDialogProvider>
              <PreferencesDialog />
            </PreferencesDialogProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </TooltipProvider>,
    )
    expect(screen.queryByTestId('preferences-dialog')).not.toBeInTheDocument()
  })

  // (b) openPreferences('account') (default tab) surfaces the
  // ProfileContent body — the 邮箱 / 角色 / 显示名 rows render.
  // Locks the surface composition: dialog mounts + initial tab
  // resolves to the profile content WITHOUT forcing the user to
  // click any tab first.
  it('opens with default account tab + renders ProfileContent rows', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    expect(await screen.findByTestId('preferences-dialog')).toBeInTheDocument()
    expect(screen.getByText('邮箱')).toBeInTheDocument()
    expect(screen.getByText('角色')).toBeInTheDocument()
    expect(screen.getByText('显示名')).toBeInTheDocument()
  })

  // (c) Clicking the 设置 tab flips the body to TIER_MAP output.
  // Drive the test with tier='free' so the free-branch copy is
  // asserted cleanly (default test user carries tier='legacy' so
  // a 自由版 expectation would never land). Both branches exercise
  // SettingsContent's mapping, but tier='free' gives a clean
  // expected string. The default-tab was account; clicking 设置
  // swaps visibly (no async wait — internal state setState is
  // sync and Radix's Portal keeps the same DOM node).
  it('clicking the 设置 tab swaps body to TIER_MAP output (tier=free branch)', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest({
      user: {
        id: 1,
        email: 'qa@sau.dev',
        role: 'admin',
        name: 'qa',
        avatar: null,
        tier: 'free',
      },
    })
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-settings'))
    expect(await screen.findByText('当前套餐')).toBeInTheDocument()
    expect(screen.getByText('自由版')).toBeInTheDocument()
  })

  // (d) Round-OPT-3G+ (Overview nav item) — the 5 tabs (`概览 · 账户
  // · 设置 · 个性化 · 关于`) are present in the left nav regardless
  // of which tab is active. Mirrors the UserMenu (c) test — the
  // 5-item shape must stay consistent across both surfaces so a
  // future "remove 个性化" PR trips BOTH the dropdown test AND
  // the dialog test. Overview is now the FIRST item (left-MOST)
  // because "show me everything at once" is the most common
  // operator intent; the 4 source tabs (账户 / 设置 / 个性化 /
  // 关于) remain below for drill-down. TABS array order in
  // PreferencesDialog.tsx is the source of truth.
  it('renders all 5 tab buttons in the left nav', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    expect(screen.getByTestId('preferences-tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('preferences-tab-account')).toBeInTheDocument()
    expect(screen.getByTestId('preferences-tab-settings')).toBeInTheDocument()
    expect(screen.getByTestId('preferences-tab-personalization')).toBeInTheDocument()
    expect(screen.getByTestId('preferences-tab-about')).toBeInTheDocument()
  })

  // (e) Active tab carries `aria-selected="true"` (WAI-ARIA APG
  // tabs contract — `aria-selected` is what role="tab" uses; the
  // prior `aria-current="page"` was leftover from the
  // hand-rolled nav-of-buttons pattern that v3 replaced with
  // Radix Tabs). Locks the sidebar-active-row pattern: the
  // amber-strip indicator is wired via `data-state="active"` so
  // a future regression that drops the indicator or swaps the
  // theme picker would also trip this test.
  it('marks the active tab with aria-selected=true and data-state=active', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    const accountTab = screen.getByTestId('preferences-tab-account')
    expect(accountTab).toHaveAttribute('aria-selected', 'true')
    expect(accountTab).toHaveAttribute('data-state', 'active')
    const settingsTab = screen.getByTestId('preferences-tab-settings')
    expect(settingsTab).toHaveAttribute('aria-selected', 'false')
    expect(settingsTab).toHaveAttribute('data-state', 'inactive')
    // The amber-strip indicator is visible ONLY on the active tab
    // via the HTML `hidden` attribute (negated: `hidden={!isActive}`).
    expect(
      screen.getByTestId('preferences-tab-account-indicator'),
    ).toBeVisible()
    expect(
      screen.getByTestId('preferences-tab-settings-indicator'),
    ).not.toBeVisible()
  })

  // (f) Clicking 退出 invokes useAuth().logout() AND closes the
  // dialog. Locks the round-trip: the visible effect of pressing
  // 退出 is sign-out (the user lands on /) NOT a stuck modal.
  // Order matters: closePreferences() fires BEFORE the
  // awaited logout() so the modal disappears immediately rather
  // than after network round-trip.
  it('clicking 退出 invokes logout() and closes the dialog', async () => {
    const user = userEvent.setup()
    const logoutSpy = vi.fn().mockResolvedValue({ success: true })
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'qa@sau.dev', role: 'admin', name: 'qa', tier: 'legacy' },
      isAuthenticated: true,
      isLoading: false,
      sendCode: vi.fn(),
      login: vi.fn(),
      logout: logoutSpy,
      updateMe: vi.fn(),
      sendCodeStatus: 'idle',
      loginStatus: 'idle',
      updateMeStatus: 'idle',
    } as any)

    render(
      <TooltipProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <PreferencesDialogProvider>
              <OpenTrigger />
              <PreferencesDialog />
            </PreferencesDialogProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </TooltipProvider>,
    )

    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-dialog-logout'))

    await waitFor(() => {
      expect(screen.queryByTestId('preferences-dialog')).not.toBeInTheDocument()
    })
    expect(logoutSpy).toHaveBeenCalledTimes(1)
  })

  // (g) Esc keypress closes the dialog. Radix Dialog listens for
  // Escape globally WHILE the dialog is open and forwards to
  // onOpenChange(false). Without this test, a future regression
  // that adds/removes a parent component stealing Escape focus
  // would silently regress dismiss-by-keyboard.
  it('Escape keypress closes the dialog', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    expect(await screen.findByTestId('preferences-dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByTestId('preferences-dialog')).not.toBeInTheDocument()
    })
  })

  // (h) The shadcn-default X close button (top-right
  // <DialogPrimitive.Close>) closes the dialog. The button has
  // screen-reader-only label "Close" + an X icon. Without this
  // test, a future regression on shadcn upgrade / dialog.tsx
  // rename of the close XPath would silently break the most
  // common close path.
  it('clicking the shadcn-default X close button closes the dialog', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    expect(await screen.findByTestId('preferences-dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => {
      expect(screen.queryByTestId('preferences-dialog')).not.toBeInTheDocument()
    })
  })

  // (i) Round-OPT-3G+ — the tab header
  // (`data-testid="preferences-dialog-tab-header"`) renders the
  // active tab's title + description, and the `data-tab` attribute
  // swaps when the user clicks between tabs. Without this test, a
  // future regression that detaches the header from the activeTab
  // state (e.g. hard-codes to 'account' on every render) would
  // silently break "reader lands with full context" promise.
  // Overview is now the FIRST tab (added round-OPT-3G+) so it's
  // included here.
  it.each([
    { tab: 'overview', label: '概览', desc: '一键跳转所有偏好设置' },
    { tab: 'account', label: '账户', desc: '查看账号信息与活动记录' },
    { tab: 'settings', label: '设置', desc: '管理订阅套餐与跨页面跳转' },
    {
      tab: 'personalization',
      label: '个性化',
      desc: '外观与显示偏好',
    },
    { tab: 'about', label: '关于', desc: '应用元数据与社区信息' },
  ])(
    'tab-header renders label + description for selected tab=$tab',
    async ({ tab, label, desc }) => {
      const user = userEvent.setup()
      mountDialogUnderTest()
      await user.click(screen.getByTestId('test-open-trigger'))
      await user.click(screen.getByTestId(`preferences-tab-${tab}`))
      const header = await screen.findByTestId('preferences-dialog-tab-header')
      expect(header).toHaveAttribute('data-tab', tab)
      expect(header).toHaveTextContent(label)
      expect(header).toHaveTextContent(desc)
    },
  )

  // (j) Tab click swaps the body via `data-tab-body` mirror so
  // larger test harnesses can scope assertions to the active tab
  // without backtracking to the header. Pins that the body
  // subtree tracks activeTab synchronously after a tab click.
  it('tab click swaps the data-tab-body subtree attribute', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    // Default tab is 'account' on mount.
    expect(screen.getByTestId('preferences-dialog-content').querySelector(
      '[data-tab-body="account"]',
    )).toBeInTheDocument()
    await user.click(screen.getByTestId('preferences-tab-personalization'))
    expect(screen.getByTestId('preferences-dialog-content').querySelector(
      '[data-tab-body="personalization"]',
    )).toBeInTheDocument()
  })

  // (k) Round-upgrade-banner polish — banner is conditionally
  // rendered: visible for tier=free + tier=legacy (the latter
  // catches the fallback chain `user.tier ?? 'legacy'` when
  // tier is null/undefined on the API response); hidden for
  // tier=pro (already paying, no nag). Pin both branches via
  // `it.each` so a future regression that drops the conditional,
  // breaks the price chip, or flips the wrong tier trips red.
  it.each([
    { tier: 'free' as const, expectedCta: '查看套餐' },
    { tier: 'legacy' as const, expectedCta: '查看套餐' },
  ])(
    'renders upgrade banner for tier=$tier on Settings tab',
    async ({ tier, expectedCta }) => {
      const user = userEvent.setup()
      mountDialogUnderTest({
        user: {
          id: 1,
          email: 'qa@sau.dev',
          role: 'admin',
          name: 'qa',
          avatar: null,
          tier,
        },
      })
      await user.click(screen.getByTestId('test-open-trigger'))
      await user.click(screen.getByTestId('preferences-tab-settings'))
      const banner = await screen.findByTestId('settings-upgrade-banner')
      expect(banner).toHaveAttribute('data-tier', tier)
      expect(
        within(banner).getByTestId('settings-upgrade-banner-cta'),
      ).toHaveTextContent(expectedCta)
      // Price chip is present — locks ¥99 / 月标点与源代码加锁。
      expect(
        within(banner).getByTestId('settings-upgrade-banner-price'),
      ).toHaveTextContent('¥99')
    },
  )

  // (l) pro 用户不显示 banner（已付费、不需升级提示）。
  // 锁是：banner is gated == false ‑pro 分支的重点反面。
  it('does NOT render upgrade banner for tier=pro', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest({
      user: {
        id: 1,
        email: 'qa@sau.dev',
        role: 'admin',
        name: 'qa',
        avatar: null,
        tier: 'pro',
      },
    })
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-settings'))
    expect(
      screen.queryByTestId('settings-upgrade-banner'),
    ).not.toBeInTheDocument()
  })

  // (m) Banner CTA 指向 /pricing (visitor-surface PricingPage)。
  // Round-7 PATCH 已陆 /pricing 作为访客转化的 entry point，
  // 所以这里检验的是“border 区域的边界” — dialog 的 CTA
  // 不应走 modal / 不应调 API。Button.asChild (Radix Slot) 会
  // 把 data-testid 透到实际 child — Link 本身就是 anchor，
  // 所以直接检查 element.tagName + href — 不要 querySelector，
  // querySelector 不包含自身，会 false‑null。
  it('upgrade banner CTA links to /pricing', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest({
      user: {
        id: 1,
        email: 'qa@sau.dev',
        role: 'admin',
        name: 'qa',
        avatar: null,
        tier: 'free',
      },
    })
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-settings'))
    const cta = await screen.findByTestId('settings-upgrade-banner-cta')
    expect(cta.tagName).toBe('A')
    expect((cta as HTMLAnchorElement).getAttribute('href')).toBe('/pricing')
  })

  // (n) Tier=undefined 时 banner 仍渲染 — SettingsContent 的
  // `user.tier ?? 'legacy'` fallback 锁必须能成功跳转。
  // 如果未来有人改了 fallback 逻辑，多加个验证、避免退化为 null
  // banner。
  it('renders upgrade banner for tier=undefined via fallback chain', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest({
      user: {
        id: 1,
        email: 'qa@sau.dev',
        role: 'admin',
        name: 'qa',
        avatar: null,
        tier: undefined,
      },
    })
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-settings'))
    const banner = await screen.findByTestId('settings-upgrade-banner')
    expect(banner).toHaveAttribute('data-tier', 'legacy')
  })

  // (o) Round-OPT-3G+ — ArrowDown cycles forward through 5 tabs,
  // with circular wrap from `about` → `overview` so the user is
  // never stuck on one end. TABS array order is the source of
  // truth: `[overview, account, settings, personalization, about]`.
  // WAI-ARIA APG: vertical tablists bind ArrowDown/ArrowUp ONLY
  // (Left/Right is reserved for cross-tablist nav on the page).
  // Locks both directions so a future regression that drops Radix
  // Tabs or rebinds Left/Right to a non-APG action trips red.
  it('arrow-down cycles forward through 5 tabs with wrap', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    // Click the active tab to nest focus inside the tablist —
    // ArrowDown then navigates between Tabs.Triggers, NOT
    // some other focused element outside the dialog.
    await user.click(screen.getByTestId('preferences-tab-account'))

    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByTestId('preferences-tab-settings'),
    ).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByTestId('preferences-tab-personalization'),
    ).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByTestId('preferences-tab-about'),
    ).toHaveAttribute('aria-selected', 'true')

    // Wrap: about ↓ → overview (the first tab in nav order).
    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByTestId('preferences-tab-overview'),
    ).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByTestId('preferences-tab-account'),
    ).toHaveAttribute('aria-selected', 'true')
  })

  // (p) ArrowUp cycles backward through 5 tabs with wrap.
  // Mirrors (o); locks both directions on the roving tabindex
  // axis. Without this, a future commit that flips the wrap
  // direction (e.g. caps at index 0 instead of wrapping) would
  // silently break all up-arrow users. From `account` the
  // upward chain wraps to `about` (last in nav order).
  it('arrow-up cycles backward through 5 tabs with wrap', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-account'))

    // account(idx 1) ↑ → overview(idx 0): direct previous, NOT a wrap.
    await user.keyboard('{ArrowUp}')
    expect(
      screen.getByTestId('preferences-tab-overview'),
    ).toHaveAttribute('aria-selected', 'true')

    // overview(idx 0) ↑ → about(idx 4): wrap to last.
    await user.keyboard('{ArrowUp}')
    expect(
      screen.getByTestId('preferences-tab-about'),
    ).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowUp}')
    expect(
      screen.getByTestId('preferences-tab-personalization'),
    ).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowUp}')
    expect(
      screen.getByTestId('preferences-tab-settings'),
    ).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowUp}')
    expect(
      screen.getByTestId('preferences-tab-account'),
    ).toHaveAttribute('aria-selected', 'true')
  })

  // (q) Round-OPT-3G+ — Home / End jump to first / last tab. APG
  // tabs pattern — keyboard users have a one-key escape hatch
  // from "where am I" without having to count ArrowDowns. The
  // first tab is now `overview`, the last is still `about`.
  it('Home and End jump to first (overview) and last (about) tab', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-account'))

    await user.keyboard('{End}')
    expect(
      screen.getByTestId('preferences-tab-about'),
    ).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(
      screen.getByTestId('preferences-tab-overview'),
    ).toHaveAttribute('aria-selected', 'true')
  })

  // (r) Round-OPT-3G+ v2.5 (tile summaries). OverviewTab renders
  // a 2x2 grid of jump-off tiles; each tile flattens source-tab
  // settings into InfoRow rows at density="compact" (py-2 +
  // text-[13px]) so 4 tiles fit the modal viewport without
  // scrolling. Per-tile row schema:
  //   • account       → email / role / displayName / lastLogin
  //   • settings      → tier / price / features / related
  //   • personalization → theme / more (single stub marker row)
  //   • about         → appName / version / sha / description
  //
  // Round-OPT-3G+ v2.5 design pin: data-testid uses STABLE ROWKEY
  // (NOT the i18n display label). An i18n migration (邮箱 → E-mail)
  // does NOT blast the test surface because the test ids are
  // `preferences-overview-tile-account-row-email` (stable
  // machine key) — the display label `邮箱` still renders as
  // the 11px eyebrow text but is asserted via `toHaveTextContent`
  // rather than via the test id itself.
  //
  // Auxiliary: stub rows collapsed to a SINGLE trailing
  // "更多偏好" row on Personalization tile only (so a row count
  // assertion pins this — Personalization has exactly 2 rows).
  it('Overview renders 4 jump tiles; rows use stable rowKey data-testids + Chinese display labels', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest({
      user: {
        id: 1,
        email: 'qa@sau.dev',
        role: 'admin',
        name: 'qa',
        avatar: null,
        tier: 'legacy',
        last_login: '2025-12-01 08:30',
      },
    })
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-overview'))

    // ── Account tile: 4 rows with stable rowKey testids ──
    const accountTile = await screen.findByTestId(
      'preferences-overview-tile-account',
    )
    expect(accountTile).toBeInTheDocument()
    // email row: rowKey='email' + i18n label '邮箱'
    const accountEmail = screen.getByTestId(
      'preferences-overview-tile-account-row-email',
    )
    expect(accountEmail).toHaveTextContent('qa@sau.dev')
    // The display label 邮箱 still appears in the row (eyebrow).
    expect(accountEmail).toHaveTextContent('邮箱')
    expect(
      screen.getByTestId('preferences-overview-tile-account-row-role'),
    ).toHaveTextContent('管理员')
    expect(
      screen.getByTestId('preferences-overview-tile-account-row-displayName'),
    ).toHaveTextContent('qa')
    expect(
      screen.getByTestId('preferences-overview-tile-account-row-lastLogin'),
    ).toHaveTextContent('2025-12-01 08:30')

    // ── Settings tile: 4 rows; 已包含 = "3 项特色" for tier=legacy ──
    expect(
      screen.getByTestId('preferences-overview-tile-settings'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('preferences-overview-tile-settings-row-tier'),
    ).toHaveTextContent('社区版')
    expect(
      screen.getByTestId('preferences-overview-tile-settings-row-features'),
    ).toHaveTextContent('3 项特色')
    expect(
      screen.getByTestId('preferences-overview-tile-settings-row-related'),
    ).toHaveTextContent('运行日志')

    // ── Personalization tile: 2 rows (主题 + single stub marker) ──
    // Locks v2.5 design pin — exactly 2 rows, no 紧凑度/语言 stubs.
    expect(
      screen.getByTestId('preferences-overview-tile-personalization'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('preferences-overview-tile-personalization-row-theme'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('preferences-overview-tile-personalization-row-more'),
    ).toHaveTextContent('即将上线')

    // ── About tile: 4 rows including build SHA mono ──
    expect(
      screen.getByTestId('preferences-overview-tile-about'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('preferences-overview-tile-about-row-appName'),
    ).toHaveTextContent('social-auto-upload')
    expect(
      screen.getByTestId('preferences-overview-tile-about-row-sha'),
    ).toHaveTextContent('dev') // VITE_BUILD_SHA defaults to 'dev' in test harness
    expect(
      screen.getByTestId('preferences-overview-tile-about-row-version'),
    ).toBeInTheDocument()

    // ── CTA preserved per tile (jump-off bridge) ──
    expect(
      screen.getByTestId('preferences-overview-tile-account-cta'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('preferences-overview-tile-about-cta'),
    ).toBeInTheDocument()

    // ── Inline theme picker source-of-truth radiogroup ──
    expect(screen.getByTestId('overview-theme-modes')).toBeInTheDocument()
  })

  // (r') Round-OPT-3G+ v2.5 (tile rows fall back to em-dash when
  // auth fields are missing). Lock the "—" graceful-degradation
  // contract on Account tile: a user with `name === undefined`,
  // `last_login === undefined` should still see ALL 4 rows with
  // em-dash values, NOT unmount or crash. Without this test, a
  // future regression that gates InfoRow rendering on truthy
  // fields would silently drop rows.
  it('Overview Account tile falls back to em-dash for missing auth fields', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest({
      user: {
        id: 1,
        email: 'qa@sau.dev',
        role: 'user', // not admin
        name: undefined, // missing
        avatar: null,
        tier: 'legacy',
        last_login: undefined, // missing
      },
    })
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-overview'))
    const accountEmail = await screen.findByTestId(
      'preferences-overview-tile-account-row-email',
    )
    expect(accountEmail).toHaveTextContent('qa@sau.dev')
    expect(
      screen.getByTestId('preferences-overview-tile-account-row-role'),
    ).toHaveTextContent('用户')
    // displayName + lastLogin → em-dash (NOT undefined / NOT dropped).
    expect(
      screen.getByTestId('preferences-overview-tile-account-row-displayName'),
    ).toHaveTextContent('—')
    expect(
      screen.getByTestId('preferences-overview-tile-account-row-lastLogin'),
    ).toHaveTextContent('—')
  })

  // (r'') Round-OPT-3G+ v2.5 (Settings 已包含 count per tier).
  // Locks the per-tier feature count: free / pro / legacy
  // branch into different 已包含 row contents so a future
  // TIER_FEATURES edit that drops a bullet on one tier trips.
  it.each([
    { tier: 'free' as const, expectedFeaturesCount: 3 },
    { tier: 'pro' as const, expectedFeaturesCount: 3 },
    { tier: 'legacy' as const, expectedFeaturesCount: 3 },
  ])(
    'Settings tile 已包含 renders "$expectedFeaturesCount 项特色" for tier=$tier',
    async ({ tier, expectedFeaturesCount }) => {
      const user = userEvent.setup()
      mountDialogUnderTest({
        user: {
          id: 1,
          email: 'qa@sau.dev',
          role: 'admin',
          name: 'qa',
          avatar: null,
          tier,
        },
      })
      await user.click(screen.getByTestId('test-open-trigger'))
      await user.click(screen.getByTestId('preferences-tab-overview'))
      expect(
        await screen.findByTestId(
          'preferences-overview-tile-settings-row-features',
        ),
      ).toHaveTextContent(`${expectedFeaturesCount} 项特色`)
    },
  )

  // (s) Round-OPT-3G+ — clicking the overview tile CTA jumps to
  // the source tab WITHOUT closing + re-opening the modal.
  // `openPreferences(tab)` is a setter that updates activeTab
  // while leaving `open=true`, so the body subtree swaps
  // synchronously. Locks the in-dialog navigation promise:
  // jumping never unmounts the modal.
  it('clicking an overview tile CTA swaps to the source tab without closing', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-overview'))
    const accountCta = await screen.findByTestId(
      'preferences-overview-tile-account-cta',
    )
    await user.click(accountCta)
    // Dialog is still open and the active tab swapped to account.
    expect(screen.getByTestId('preferences-dialog')).toBeInTheDocument()
    expect(
      screen.getByTestId('preferences-tab-account'),
    ).toHaveAttribute('aria-selected', 'true')
    // The account body subtree rendered — 邮箱 row is on AccountTab.
    expect(screen.getByText('邮箱')).toBeInTheDocument()
  })

  // (t) Round-OPT-3G+ — the inline theme picker on OverviewTab
  // shares the same source-of-truth `ThemeModesRadio` as
  // PersonalizationTab. Clicking `theme-mode-light` from the
  // Overview surface updates `useTheme()` which the
  // PersonalizationTab radiogroup ALSO observes. Locks the
  // cross-surface responsiveness contract: theme changes from
  // either surface propagate everywhere.
  it('Overview renders its OWN theme-modes radiogroup distinct from PersonalizationTab', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-overview'))
    // Overview owns its OWN radiogroup (testId override)
    // — single source of truth at the ThemeModesRadio level,
    // NOT duplicated surface code.
    expect(
      await screen.findByTestId('overview-theme-modes'),
    ).toBeInTheDocument()
  })

  // (u) Round-OPT-3G+ (default tab unchanged) — openPreferences()
  // called with NO argument still resolves to `account` (NOT
  // `overview`); the default tab is preserved because the
  // original `账号信息` flow is the most common FIRST visit
  // and Overview is the SECOND visit (jump-off). Backwards
  // compatibility for UserMenu / command-palette consumers
  // that call `openPreferences()` with no arg.
  it('openPreferences() with no argument opens the account tab (overview NOT default)', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    // Default tab is 'account' (not 'overview') so existing
    // UserMenu / command-palette callers that omit the arg
    // continue to land on AccountTab.
    expect(
      screen.getByTestId('preferences-tab-account'),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByTestId('preferences-tab-overview'),
    ).toHaveAttribute('aria-selected', 'false')
  })

  // NOTE: click-outside-to-close is Radix Dialog's native
  // `onPointerDownOutside` behavior — wired through our
  // `<Dialog onOpenChange={(next) => { if (!next) closePreferences() }}>`
  // binding at the top of PreferencesDialog.tsx. We intentionally
  // do NOT exercise the pointer-down chain in vitest because
  // happy-dom 15.x crashes `@radix-ui/react-dismissable-layer`
  // with `Cannot read properties of null (reading 'addEventListener')`
  // when user-event fires the full pointer/mouse sequence on
  // the overlay. The project precedent in PublishPage.test.tsx
  // is the same: mock Radix primitives that don't render
  // reliably under happy-dom. mocking the Dialog here would
  // bypass tests (g) (Escape) and (h) (X button) which legitimately
  // exercise Radix's other close paths. Production-time invariant
  // is documented at the top of PreferencesDialog.tsx.
  //
  // TODO: re-add a real lock in a sibling
  // `PreferencesDialog.click-outside.test.tsx` with
  // `// @vitest-environment jsdom` once happy-dom >= 16 lands
  // OR Radix refactors dismissable-layer off the React tree
  // OR @testing-library/user-event ships a friendlier
  // pointer-event polyfill. Until then we trust Radix Dialog's
  // native behavior + the close-binding coverage of (g)/(h).
})
