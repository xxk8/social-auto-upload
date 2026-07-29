import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import type { AccountAuthorization } from '@/api/client'

// ── mocks ────────────────────────────────────────────────────────────

// Stub dnd-kit's useDraggable — the component only consumes `ref` (as a
// callback ref) + `isDragging`. Returning a no-op callback ref avoids
// the "useDraggable must be used inside DndContext" throw that would
// otherwise fire in a vitest jsdom render.
vi.mock('@dnd-kit/react', () => ({
  useDraggable: () => ({
    ref: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({
    ref: () => {},
    isDropTarget: false,
  }),
  useDragDropMonitor: () => {},
}))

vi.mock('@/hooks/useAccountGroups', async () => {
  // Spread the real module so hooks added after this test was
  // written (e.g. `useMoveAuthorization`) remain resolvable.
  const actual = await vi.importActual<typeof import('@/hooks/useAccountGroups')>('@/hooks/useAccountGroups')
  return {
    ...actual,
    useAccountGroups: () => ({
      data: [
        {
          id: 42,
          name: '测试组',
          created: '2024-01-01T00:00:00Z',
          authorizations: [
            { id: 10, platform: 'douyin', cookie_file: '/cookies/douyin.json', valid: false },
          ],
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    }),
    useCreateAccountGroup: () => ({
      mutateAsync: vi.fn().mockResolvedValue({ success: true, data: { id: 1, name: '新建分组' } }),
      isPending: false,
    }),
    useDeleteAccountGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }), isPending: false }),
    useRenameAccountGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true, data: { id: 1, name: '新名字' } }), isPending: false }),
    useRemoveAuthorization: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }), isPending: false }),
    useReorderAccountGroups: () => ({ mutate: vi.fn().mockResolvedValue({ success: true }), isPending: false }),
    useReorderAuthorizations: () => ({ mutate: vi.fn().mockResolvedValue({ success: true }), isPending: false }),
    useAuthorizeAccountGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true, data: { group_name: '测试组' } }), isPending: false }),
    useConfirmAuthorizeAccountGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }), isPending: false }),
  }
})

vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/api/client', () => ({
  api: {
    checkAllAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    checkAuthorizationHealth: vi.fn().mockResolvedValue({
      success: true,
      data: { valid: true, stale: false, health: 'valid' },
    }),
  },
  PLATFORMS: [
    { label: '抖音', value: 'douyin', color: 'magenta' },
    { label: 'TikTok', value: 'tiktok', color: 'cyan' },
  ] as const,
  QR_LOGIN_PLATFORMS: ['douyin', 'kuaishou', 'xiaohongshu', 'tencent', 'bilibili'],
}))

// Stub react-i18next — the component calls
// `t('accounts.actions.menu', 'Authorization actions')` for the
// trigger's aria-label. The mock returns the fallback string so the
// test is locale-independent (doesn't depend on the jsdom
// navigator.language or localStorage). Mirrors the LocalePicker
// fallback pattern — the fallback is the en-US canonical copy.
//
// `tSpy` is hoisted via `vi.hoisted` so the vi.fn is available
// before the vi.mock factory runs (vi.mock is hoisted to the top
// of the file). Tests then assert on `tSpy` to pin the i18n KEY
// PATH, not just the fallback string — a future refactor that
// renames `accounts.actions.menu` to e.g. `accounts.authorization_menu`
// would fail the spy assertion, catching the key drift.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tSpy,
  }),
}))

// ── imports (post-mock) ─────────────────────────────────────────────

import { SortableAuthorizationItem } from './SortableAuthorizationItem'
import { AccountsProvider } from './AccountsProvider'

// ── helpers ─────────────────────────────────────────────────────────

function renderItem(auth: AccountAuthorization, groupId = 1) {
  return render(
    <TestProviders client={makeQueryClient()}>
      <AccountsProvider>
        <SortableAuthorizationItem auth={auth} groupId={groupId} />
      </AccountsProvider>
    </TestProviders>,
  )
}

// ── test suite ──────────────────────────────────────────────────────

describe('SortableAuthorizationItem — component render', () => {
  it('renders the trigger button with the i18n aria-label for failed authorizations', () => {
    // aria-label resolves via t('accounts.actions.menu',
    // 'Authorization actions') — the mock stubs useTranslation
    // to return the fallback, so the accessible name is the
    // en-US canonical copy. zh-CN users get the bundle value
    // '授权操作' at runtime; the test only pins the contract
    // (t() is called with the right key) via the mock.
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: false,
    }
    tSpy.mockClear()
    renderItem(auth)
    expect(
      screen.getByRole('button', { name: /Authorization actions/i }),
    ).toBeInTheDocument()
    // Pin the i18n KEY PATH (not just the fallback string) so a
    // future refactor that renames `accounts.actions.menu` to e.g.
    // `accounts.authorization_menu` trips red here. Catches key
    // drift between the component and the locale bundles.
    expect(tSpy).toHaveBeenCalledWith('accounts.actions.menu', expect.any(String))
  })

  it('renders the 失效 status pill for failed (valid: false) authorizations', () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: false,
    }
    renderItem(auth)
    expect(screen.getByText('失效')).toBeInTheDocument()
  })

  it('renders the 过期 status pill for stale authorizations', () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: true,
      stale: true,
    }
    renderItem(auth)
    expect(screen.getByText('过期')).toBeInTheDocument()
  })

  it('renders the 有效 status pill for valid+!stale authorizations', () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: true,
      stale: false,
    }
    renderItem(auth)
    expect(screen.getByText('有效')).toBeInTheDocument()
  })

  it('renders the platform label (抖音) for the authorization', () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: false,
    }
    renderItem(auth)
    // The real getPlatformLabel resolves the platform string to the
    // Chinese display name via PLATFORMS[].label — "douyin" → "抖音".
    expect(screen.getByText('抖音')).toBeInTheDocument()
  })

  it('renders account_name under the platform label, not platform pinyin', () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      account_name: 'test66',
      cookie_file: '/cookies/douyin_test66.json',
      valid: true,
    }
    renderItem(auth)
    expect(screen.getByTestId('auth-account-id-10')).toHaveTextContent('test66')
    // Secondary line must not re-show platform pinyin ("douyin").
    expect(screen.getByTestId('auth-account-id-10')).not.toHaveTextContent('douyin')
  })

  it('falls back to cookie stem account when account_name is missing', () => {
    const auth: AccountAuthorization = {
      id: 11,
      platform: 'douyin',
      cookie_file: '/cookies/douyin_主号.json',
      valid: true,
    }
    renderItem(auth)
    expect(screen.getByTestId('auth-account-id-11')).toHaveTextContent('主号')
  })

  it('exposes a single status pill (no HealthBadge 未检查 / 立即检查 row clutter)', () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      account_name: 'test66',
      cookie_file: '/cookies/douyin_test66.json',
      valid: true,
      stale: false,
    }
    renderItem(auth)
    expect(screen.getByTestId('auth-status-pill')).toHaveTextContent('有效')
    expect(screen.queryByText('未检查')).not.toBeInTheDocument()
    expect(screen.queryByText('未检测')).not.toBeInTheDocument()
    expect(screen.queryByText('立即检查')).not.toBeInTheDocument()
    expect(screen.queryByText('立即检测')).not.toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────
// FOLLOW-UP (TBF-027): handler-logic test for `handleReauthorize`.
//
// The original test design drove the real handler via a `DispatchProbe`
// test consumer that captured the dispatch in `useEffect` + `onReady`.
// This pattern caused a JavaScript heap-out-of-memory crash in jsdom
// — the useEffect deps (`dispatch`, `onReady`) are new references on
// every render, so the effect fires on every render, which (combined
// with the React 19 strict-mode double-render) allocates closures
// faster than GC can reclaim them.
//
// Pragmatic fix for this PR: drop the handler-logic test from this
// file. The 5 render tests above verify the component renders the
// correct status pill + platform label + trigger button. The
// handler-logic invariant (selectedGroupId + selectedPlatform +
// loginModalOpen all land in the provider state) should be tested
// in `AccountsProvider.test.tsx` instead, where the test
// infrastructure is already set up for provider-level testing
// (the existing 27 tests there use the same mock stack but
// without the component wrapper that triggers the re-render loop).
//
// To add the test there:
//   1. Render `<AccountsProvider>` with a test consumer that reads
//      `useAccountsDispatch()`.
//   2. Call `dispatch.handleReauthorize(42, 'douyin')`.
//   3. Assert `state.selectedGroupId === 42`,
//      `state.selectedPlatform === 'douyin'`,
//      `state.loginModalOpen === true`.
// ─────────────────────────────────────────────────────────────────────
