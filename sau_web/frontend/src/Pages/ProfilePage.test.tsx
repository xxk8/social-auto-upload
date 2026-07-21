import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mockUseAuth } from '@/test/auth-router-spies'
import ProfilePage from './ProfilePage'

// useAuth is mocked so ProfilePage reads directly from
// mockUseAuth.mockReturnValue({ user, ... }) without booting the
// real authStore + /api/auth/me fetch. Mirrors the AppShell.test.tsx
// + UserMenu.test.tsx pattern.
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

function mountProfile() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/app/account']}>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function setAuth({
  user = {
    id: 1,
    email: 'qa@sau.dev',
    role: 'admin' as const,
    name: null,
    avatar: null,
    tier: 'legacy',
    created_at: '2026-01-15T08:00:00+00:00',
    last_login: '2026-06-30T02:14:22+00:00',
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
}

describe('ProfilePage · round-7 profile contract', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  // (a) Basic read-only rendering — email + role + 显示名 rows
  // present when auth user is non-null. Pinning the data-testid is
  // overkill (the cells are styled, not stable anchors); we assert
  // on the label-as-text which is the contract surface.
  it('renders email + role + 显示名 rows when auth user is present', () => {
    setAuth()
    mountProfile()
    expect(screen.getByText('邮箱')).toBeInTheDocument()
    expect(screen.getByText('角色')).toBeInTheDocument()
    expect(screen.getByText('显示名')).toBeInTheDocument()
  })

  // (b) 显示名 row falls back to '—' when `name` is null. The
  // pre-round-7 contract showed a hardcoded '—'; post-round-7 the
  // fallback reads from the auth user.shape so a user who actually
  // set their name sees it instead.
  it('shows `—` placeholder when authUser.name is null', () => {
    setAuth({ user: { id: 1, email: 'qa@sau.dev', role: 'user', name: null, tier: 'legacy' } })
    mountProfile()
    const emailCells = screen.getAllByText('qa@sau.dev')
    expect(emailCells.length).toBeGreaterThanOrEqual(1)
    // The 显示名 cell is rendered as the literal '—' string.
    // Look for the placeholder via multi-occurrence-tolerant query.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  // (c) 显示名 row surfaces the real name when set. Pins the
  // round-7 contract: backend wired (PATCH /api/auth/me), types
  // extended (AuthUser.name), UI reads it.
  it('shows the real name when authUser.name is set', () => {
    setAuth({ user: { id: 1, email: 'qa@sau.dev', role: 'admin', name: '测试显示名', tier: 'pro' } })
    mountProfile()
    expect(screen.getByText('测试显示名')).toBeInTheDocument()
  })

  // (d) 注册时间 / 最近登录 rows are conditionally rendered — they
  // appear only when the auth user carries created_at / last_login.
  // Locks the conditional-rendering contract so a future profile
  // surface change doesn't accidentally drop them.
  it('renders metadata rows (最近登录 + 注册时间) when present', () => {
    setAuth()
    mountProfile()
    expect(screen.getByText('最近登录')).toBeInTheDocument()
    expect(screen.getByText('注册时间')).toBeInTheDocument()
  })

  it('hides metadata rows when created_at / last_login are absent', () => {
    setAuth({ user: { id: 1, email: 'qa@sau.dev', role: 'user', name: 'x', tier: 'free' } })
    mountProfile()
    expect(screen.queryByText('最近登录')).not.toBeInTheDocument()
    expect(screen.queryByText('注册时间')).not.toBeInTheDocument()
  })

  // (e) Empty / whitespace-only name maps to '—' — backend's PATCH
  // validation clears whitespace-only to NULL, and this page reads
  // `name ?? '—'`. When the auth store contains the empty string
  // (e.g. an upstream clear that re-fetched before the PATCH ran),
  // the UI should also render '—'.
  it('shows `—` when name is empty string', () => {
    setAuth({ user: { id: 1, email: 'qa@sau.dev', role: 'user', name: '', tier: 'legacy' } })
    mountProfile()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})
