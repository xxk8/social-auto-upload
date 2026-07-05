/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mockUseAuth } from '@/test/auth-router-spies'
import SettingsPage from './SettingsPage'

// useAuth is mocked so SettingsPage reads `user.tier` directly
// from the mock return without booting authStore / TanStack Query.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
}

function mountSettings() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/app/settings']}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function setAuth({
  tier,
}: { tier?: 'free' | 'pro' | 'legacy' | undefined } = {}) {
  // No destructuring default — explicit `setAuth({ tier: undefined })`
  // must preserve `tier = undefined` so the page's `?? 'legacy'`
  // fallback is exercised in test (d). (ES2015 destructuring
  // defaults fire on undefined values, which would silently mask
  // the round-7 contract test.)
  mockUseAuth.mockReturnValue({
    user: { id: 1, email: 'qa@sau.dev', role: 'admin', name: 'qa', tier },
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
}

describe('SettingsPage · round-7 TIER_MAP translation', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  // (a) tier='free' → '自由版' plan card visible. Pins the
  // round-7 TIER_MAP mapping for the canonical default tier.
  it('renders `自由版` plan when tier=free', () => {
    setAuth({ tier: 'free' })
    mountSettings()
    expect(screen.getByText('自由版')).toBeInTheDocument()
    expect(screen.getByText(/¥0 \/ 永久免费/)).toBeInTheDocument()
  })

  // (b) tier='pro' → '专业版' plan card visible. Confirms the
  // sparkles prop + the price string differ from free.
  it('renders `专业版` plan when tier=pro', () => {
    setAuth({ tier: 'pro' })
    mountSettings()
    expect(screen.getByText('专业版')).toBeInTheDocument()
    expect(screen.getByText(/¥99 \/ 月/)).toBeInTheDocument()
  })

  // (c) tier='legacy' → '社区版' plan card visible. Confirms the
  // pre-tier-gating fallback reads as a real plan, not a degraded
  // state.
  it('renders `社区版` plan when tier=legacy', () => {
    setAuth({ tier: 'legacy' })
    mountSettings()
    expect(screen.getByText('社区版')).toBeInTheDocument()
    expect(screen.getByText(/感谢您的早期支持/)).toBeInTheDocument()
  })

  // (d) Default fallback — when tier is undefined (legacy test
  // setup or pre-round-7 mock), SettingsPage renders the 'legacy'
  // plan (defense-in-depth: `?? 'legacy'` keeps the page never
  // blank).
  it('falls back to `社区版` when tier is undefined', () => {
    setAuth({ tier: undefined })
    mountSettings()
    expect(screen.getByText('社区版')).toBeInTheDocument()
  })

  // (e) 升级套餐 CTA always points to /pricing. Pins the conversion
  // funnel so a future route rename doesn't silently break paid-
  // conversion entry.
  it('CTA links to /pricing for free / legacy tiers', () => {
    setAuth({ tier: 'free' })
    mountSettings()
    const cta = screen.getByRole('link', { name: /升级套餐/ })
    expect(cta.getAttribute('href')).toBe('/pricing')
  })

  // (f) pro tier CTA label shifts to `管理订阅` (per the
  // conditional render). Pro users don't see "upgrade" — they're
  // already subscribed; the affordance changes to subscription
  // management. Locks the tier-status-aware copy.
  it('pro tier CTA is `管理订阅`, not `升级套餐`', () => {
    setAuth({ tier: 'pro' })
    mountSettings()
    expect(screen.queryByRole('link', { name: /升级套餐/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /管理订阅/ })).toBeInTheDocument()
  })

  // (g) The 查看运行日志 shortcut remains visible regardless of
  // tier. It's a cross-page navigation aid, not a tier-dependent
  // CTA.
  it('always renders 查看运行日志 shortcut', () => {
    setAuth({ tier: 'free' })
    mountSettings()
    const logsLink = screen.getByRole('link', { name: /查看运行日志/ })
    expect(logsLink.getAttribute('href')).toBe('/app/logs')
  })
})
