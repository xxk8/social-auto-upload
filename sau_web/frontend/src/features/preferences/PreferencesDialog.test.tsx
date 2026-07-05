/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
        <MemoryRouter initialEntries={['/app']}>
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
          <MemoryRouter initialEntries={['/app']}>
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

  // (d) The 4 tabs (`账户 · 设置 · 个性化 · 关于`) are present in
  // the left nav regardless of which tab is active. Mirrors the
  // UserMenu (c) test — the 4-item shape must stay consistent
  // across both surfaces so a future "remove 个性化" PR trips
  // BOTH the dropdown test AND the dialog test.
  it('renders all 4 tab buttons in the left nav', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
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
          <MemoryRouter initialEntries={['/app']}>
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

  // (i) Round-OPT-prefs-dialog v2 — the tab header
  // (`data-testid="preferences-dialog-tab-header"`) renders the
  // active tab's title + description, and the `data-tab` attribute
  // swaps when the user clicks between tabs. Without this test, a
  // future regression that detaches the header from the activeTab
  // state (e.g. hard-codes to 'account' on every render) would
  // silently break "reader lands with full context" promise.
  it.each([
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

  // (o) ArrowDown cycles forward through 4 tabs, with circular
  // wrap from `about` → `account` so the user is never stuck on
  // one end. WAI-ARIA APG: vertical tablists bind
  // ArrowDown/ArrowUp ONLY (Left/Right is reserved for
  // cross-tablist nav on the page). Locks both directions so a
  // future regression that drops Radix Tabs or rebinds
  // Left/Right to a non-APG action trips red.
  it('arrow-down cycles forward through 4 tabs with wrap', async () => {
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

    // Wrap: about ↓ → account (the first tab).
    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByTestId('preferences-tab-account'),
    ).toHaveAttribute('aria-selected', 'true')
  })

  // (p) ArrowUp cycles backward through 4 tabs with wrap.
  // Mirrors (o); locks both directions on the roving tabindex
  // axis. Without this, a future commit that flips the wrap
  // direction (e.g. caps at index 0 instead of wrapping) would
  // silently break all up-arrow users.
  it('arrow-up cycles backward through 4 tabs with wrap', async () => {
    const user = userEvent.setup()
    mountDialogUnderTest()
    await user.click(screen.getByTestId('test-open-trigger'))
    await user.click(screen.getByTestId('preferences-tab-account'))

    // Wrap: account ↑ → about (last tab).
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

  // (q) Home / End jump to first / last tab. APG tabs pattern
  // — keyboard users have a one-key escape hatch from
  // "where am I" without having to count ArrowDowns.
  it('Home and End jump to first and last tab', async () => {
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
      screen.getByTestId('preferences-tab-account'),
    ).toHaveAttribute('aria-selected', 'true')
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
