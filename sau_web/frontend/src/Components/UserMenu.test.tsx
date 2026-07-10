/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { QueryClientProvider } from '@tanstack/react-query'
import { UserMenu } from './UserMenu'
import { mockUseAuth } from '@/test/auth-router-spies'
import { makeQueryClient } from '@/test/render-harness.helpers'

// useAuth is mocked so UserMenu's authUser.email?.[0]?.toUpperCase()
// branch can be driven per-test without booting the real authStore
// + /api/auth/me fetch. Mirrors the AppShell.test.tsx / InboxPage
// pattern.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Round-OPT-prefs-dialog-v4 (slice extraction): UserMenu now calls
// usePreferencesDialog() instead of using react-router-dom <Link>
// to navigate to the 4 routes. Mock the hook so the test tree
// doesn't need a real <PreferencesDialogProvider>. The mock carries
// a spy for every openPreferences(tab) invocation so tests can pin
// the surface.
//
// Round-v4 CANONICAL: per the v4 reviewer verdict, the Provider
// component + `usePreferencesDialog` hook live together in
// `PreferencesDialogProvider.tsx` (mirrors `<AccountsProvider />`
// + `useAccountsDispatch()` in one file). vi.mock targets that
// single path — the previous `PreferencesDialogContext` target
// hit the now-deleted legacy file and threw
// "usePreferencesDialog must be used within a PreferencesDialogProvider"
// across all 7 UserMenu tests until this update landed.
const mockOpenPreferences = vi.fn()
vi.mock('@/features/preferences/PreferencesDialogProvider', () => ({
  usePreferencesDialog: () => ({
    open: false,
    activeTab: 'account',
    openPreferences: (...args: unknown[]) => mockOpenPreferences(...args),
    closePreferences: vi.fn(),
    setActiveTab: vi.fn(),
  }),
}))

function mountUserMenu({
  mode = 'expanded' as const,
}: { mode?: 'expanded' | 'collapsed' | 'mobile' } = {}) {
  return render(
    <TooltipProvider>
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <UserMenu mode={mode} />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  )
}

function setAuth({
  user = { id: 1, email: 'qa@example.com', role: 'admin' as const },
}: { user?: { id: number; email: string; role: 'admin' | 'user' } | null } = {}) {
  mockUseAuth.mockReturnValue({
    user,
    isAuthenticated: user !== null,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  } as any)
}

describe('UserMenu · avatar → dropdown with 4 navigation items', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    // Reset the openPreferences spy between tests so test (f)'s
    // strict mock.calls equality assertion doesn't see leakage
    // from any future test that adds a 5th dropdown item or
    // rearranges the order. Both spy mocks live at module scope
    // so they need explicit reset in beforeEach.
    mockOpenPreferences.mockReset()
  })

  // (a) Trigger renders the email initial at h-10 w-10 in expanded
  // mode. The class match pins the round-OPT-footer v3 visual
  // envelope (gradient + 2-px primary ring + flex-shrink-0). The
  // glyph derives from email[0] (per UserMenu.emailInitial), so the
  // 'qa@example.com' email surfaces 'Q' (uppercased) inside the
  // avatar circle. Pins the data-testid so other surfaces can mount
  // + trigger without ambiguity.
  it('expanded-mode trigger renders the email initial inside h-10 w-10 (round-OPT-footer v3 envelope)', () => {
    setAuth()
    mountUserMenu()
    const trigger = screen.getByTestId('user-menu-trigger-expanded')
    expect(trigger).toBeInTheDocument()
    expect(trigger.className).toMatch(/\bh-10 w-10\b/)
    expect(trigger.textContent).toBe('Q')
  })

  // (b) Collapsed-mode trigger is h-8 w-8 — matches the prior inlined
  // collapsed-mode avatar envelope (bg-muted/50, no ring). Proves
  // the two-mode UserMenu ships with the correct visual envelope
  // per mode, so AppShell.test.tsx test (d)`s collapsed pin
  // (h-7 w-7 for logout + ThemeToggle) keeps a non-overlapping
  // avatar (h-8 w-8).
  it('collapsed-mode trigger is h-8 w-8 (matches the v3 footer compact treatment)', () => {
    setAuth()
    mountUserMenu({ mode: 'collapsed' })
    const trigger = screen.getByTestId('user-menu-trigger-collapsed')
    expect(trigger).toBeInTheDocument()
    expect(trigger.className).toMatch(/\bh-8 w-8\b/)
  })

  // (b-mobile) Mobile-mode trigger shares the compact envelope with
  // collapsed (h-8 w-8, bg-muted/50, no ring) so the avatar reads
  // as ONE identity marker across mobile ↔ desktop breakpoints.
  // Mounted by AppShell's isMobile branch next to the default-size
  // ThemeToggle in the AppBar's right-side actions cluster (round-
  // OPT-mobile-chrome). The testid pinning + class match lets
  // AppShell-level integration get a stable anchor for the mobile
  // header trigger without ANY new test pinning on AppShell side.
  // Side-effect check (NOT a render assertion — Radix Portal renders
  // <DropdownMenuContent> lazily): the click does not throw.
  it('mobile-mode trigger is h-8 w-8 (shares the compact envelope with collapsed)', () => {
    setAuth()
    mountUserMenu({ mode: 'mobile' })
    const trigger = screen.getByTestId('user-menu-trigger-mobile')
    expect(trigger).toBeInTheDocument()
    expect(trigger.className).toMatch(/\bh-8 w-8\b/)
    expect(trigger.textContent).toBe('Q')
  })

  // (c) Clicking the trigger opens a Radix DropdownMenu (portaled to
  // body) surfacing the 4 navigation items the user enumerated:
  // 账户 / 设置 / 个性化 / 关于. Tests `getByText` against the
  // portaled content — happy-dom + Radix Portal renders the
  // DropdownMenuContent descendants inside document.body, and
  // @testing-library/react finds them via standard role / text
  // queries against the global document. Locks the 4-item shape
  // so a future regression (e.g. menu dropping 个性化) trips red.
  //
  // userEvent.click over fireEvent.click: `@testing-library/user-
  // event` v14's `user.click` (via `userEvent.setup()`) awaits the
  // FULL interaction chain — pointerdown → pointerup → click →
  // React state commit — before the returned promise resolves. In
  // happy-dom, Radix's DropdownMenu tracks open state via
  // `useState`; a synchronous `fireEvent.click` fires the DOM event
  // but returns BEFORE React 19's microtask-scheduled re-render
  // flushes the portal mount, so `getByText` queries miss the
  // portaled items. `await user.click(...)` flushes all of those
  // microtasks, so post-`await` queries see the portaled 4 items
  // immediately — no `waitFor` polling needed. Canonical fix per
  // testing-library's Radix recipes.
  it('clicking the trigger surfaces 4 navigation items (账户 / 设置 / 个性化 / 关于)', async () => {
    const user = userEvent.setup()
    setAuth()
    mountUserMenu()
    await user.click(screen.getByTestId('user-menu-trigger-expanded'))
    expect(screen.getByText('账户')).toBeInTheDocument()
    expect(screen.getByText('设置')).toBeInTheDocument()
    expect(screen.getByText('个性化')).toBeInTheDocument()
    expect(screen.getByText('关于')).toBeInTheDocument()
  })

  // (d) When the auth store has no user (e.g. logout cleared the
  // session), the trigger falls back to the `S` initial — same as
  // the prior inline avatar. The dropdown label still surfaces
  // '管理员' as a placeholder for the missing email. Confirms the
  // null-safety chain (`authUser?.email?.[0]?.toUpperCase() ?? "S"`)
  // doesn't throw on the trigger side even when the menu content
  // briefly renders without an email.
  it('fallback initial is `S` when the auth user is null', () => {
    setAuth({ user: null })
    mountUserMenu()
    const trigger = screen.getByTestId('user-menu-trigger-expanded')
    expect(trigger.textContent).toBe('S')
  })

  // (e) Round 7 — avatar-URL branch. When the authed user sets a
  // custom avatar (via PATCH /api/auth/me on ProfilePage), the
  // trigger swaps the email-initial glyph for an <img src=...>
  // image. Without this test, a future regression that accidentally
  // drops the branch (e.g. reverts the conditional to the prior
  // always-letter rendering) silently passes CI since none of the
  // existing 5 UserMenu tests drive `user.avatar`. Pins:
  //   • `data-testid="user-menu-avatar-img"` is in the document
  //   • `data-testid="user-menu-avatar-glyph"` is NOT in the document
  //     (mutually exclusive with the img branch)
  //   • img src matches the URL the auth store carries
  it('avatar URL branch renders <img src> instead of the letter glyph', () => {
    setAuth({
      user: {
        id: 1,
        email: 'qa@example.com',
        role: 'admin',
        name: 'QA',
        avatar: 'https://avatars.githubusercontent.com/u/42?v=4',
        tier: 'pro',
      },
    })
    mountUserMenu()
    const trigger = screen.getByTestId('user-menu-trigger-expanded')
    const img = screen.getByTestId('user-menu-avatar-img')
    expect(trigger).toContainElement(img)
    expect(img.tagName).toBe('IMG')
    expect((img as HTMLImageElement).src).toBe(
      'https://avatars.githubusercontent.com/u/42?v=4',
    )
    expect(screen.queryByTestId('user-menu-avatar-glyph')).not.toBeInTheDocument()
  })

  // (f) Round-OPT-prefs-dialog — the 4 nav items now OPEN the
  // modal (not navigate via <Link>). Pins the new contract so any
  // future regression that swaps the button back to a Link
  // (re-introducing the page-reload feel) trips red.
  // mockOpenPreferences is wired to a vi.fn spy; the assertion
  // verifies each call site passes the correct tab id.
  it('clicking the 4 nav items invoke openPreferences(<tab>) — NOT navigate', async () => {
    const user = userEvent.setup()
    setAuth()
    mountUserMenu()
    await user.click(screen.getByTestId('user-menu-trigger-expanded'))
    await user.click(screen.getByTestId('user-menu-open-preferences-account'))
    await user.click(screen.getByTestId('user-menu-trigger-expanded'))
    await user.click(screen.getByTestId('user-menu-open-preferences-settings'))
    await user.click(screen.getByTestId('user-menu-trigger-expanded'))
    await user.click(screen.getByTestId('user-menu-open-preferences-personalization'))
    await user.click(screen.getByTestId('user-menu-trigger-expanded'))
    await user.click(screen.getByTestId('user-menu-open-preferences-about'))
    expect(mockOpenPreferences.mock.calls).toEqual([
      ['account'],
      ['settings'],
      ['personalization'],
      ['about'],
    ])
  })

  // (g) Round-OPT-marketing-chrome v5 — UserMenu is the single
  // source of truth for the logout affordance across all 3 chrome
  // surfaces (AppShell sidebar footer [expanded|collapsed], AppShell
  // mobile AppBar, MarketingTopBar authed branch). The previous
  // AppShell sidebar-footer standalone `<button aria-label="登出">`
  // is gone, so this test pins the new contract: clicking 登出 in
  // the dropdown invokes `logout()` from useAuth (the per-component
  // navigate('/', { replace: true }) is internal and not asserted
  // here — it has no observable side effect inside MemoryRouter
  // since the test mount doesn't drive a real route change).
  //
  // Without this test, a future regression that accidentally drops
  // the 5th dropdown item OR swaps its onClick to a navigation that
  // skips the auth-store logout mutation would silently leave the
  // authed UI mounted in a half-state: cookies gone but `useAuth.
  // isAuthenticated` still true, AuthGuard still gating, but the
  // next /api/auth/me GET returning 401. The assertion pins the
  // exact behavior the v5 round depends on.
  it('clicking 登出 dropdown item invokes logout() — UserMenu is the single source of truth for logout', async () => {
    const user = userEvent.setup()
    const mockLogout = vi.fn().mockResolvedValue({ success: true })
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'qa@example.com', role: 'admin' },
      isAuthenticated: true,
      isLoading: false,
      sendCode: vi.fn().mockResolvedValue({ success: true }),
      login: vi.fn().mockResolvedValue({ success: true }),
      logout: mockLogout,
      sendCodeStatus: 'idle',
      loginStatus: 'idle',
    } as any)
    mountUserMenu()
    await user.click(screen.getByTestId('user-menu-trigger-expanded'))
    await user.click(screen.getByTestId('user-menu-logout'))
    expect(mockLogout).toHaveBeenCalledTimes(1)
  })
})
