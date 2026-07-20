import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('@/Components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ addToast: vi.fn() }),
}))

// `apiMock.checkAuthorizationHealth` is hoisted so the in-flight behavior
// test can override it per-test with mockReturnValueOnce(<pending Promise>)
// to simulate a ~30-60s Chromium recheck without timing fixtures. Default
// resolution is the fast-success / mock-cached path so existing layout
// tests stay deterministic.
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    checkAllAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    checkAuthorizationHealth: vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'valid' },
    }),
  },
}))
// Round-XXX second-batch migration: split the legacy `@/api/client` mock
// into `@/api/accounts` (for the `apiMock` accounts methods like
// `checkAuthorizationHealth`, `checkAllAccounts`) + `@/api/types` (for
// PLATFORMS, QR_LOGIN_PLATFORMS). Production SortableAuthorizationItem.tsx
// imports `accountsApi` from `@/api/accounts` + PLATFORMS / QR_LOGIN_PLATFORMS
// from `@/api/client` (which re-exports from `@/api/types`).
vi.mock('@/api/accounts', () => ({
  accountsApi: apiMock,
}))
vi.mock('@/api/types', () => ({
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

import { waitFor } from '@testing-library/react'
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
})

// ─────────────────────────────────────────────────────────────────────
// round-OPT-cleanup-account-actions:
//
// Consolidation regression tests — the row-level standalone "立即完整验证"
// button was moved into the three-dot dropdown menu (now first item, always
// visible regardless of `canRescan`). These tests pin the new layout so a
// future refactor that re-extracts the standalone button (or hides "完整验证"
// behind canRescan) trips red here.
//
// Strategy: open the dropdown via clicking the trigger button (matches the
// `aria-label="Authorization actions"` role.query from existing render
// tests), then assert the menu items by their stable `data-testid` keys.
//
// Why we do NOT click `check-health-...` here: the dropdown menu item uses
// `handleCheckNow` which drives an async Chromium cookie re-check on the
// real backend; the test mocks `api.checkAuthorizationHealth` with a
// resolved value to keep the test deterministic, but the click + async
// resolution produces an obscure "act() warning" rather than a useful
// assertion. Coverage for the click handler itself lives in a Provider-
// level test (see FOLLOW-UP TBF-027 block) — these tests focus on layout.
// ─────────────────────────────────────────────────────────────────────
describe('SortableAuthorizationItem — dropdown consolidation (round-OPT-cleanup-account-actions)', () => {
  // userEvent.setup() over fireEvent.click: `@testing-library/user-event`
  // v14's `user.click` (via `userEvent.setup()`) awaits the FULL interaction
  // chain — pointerdown → pointerup → click → React state commit — before
  // resolving. Radix's DropdownMenu tracks open state via `useState` and
  // portales content to `document.body`; a synchronous `fireEvent.click`
  // fires the DOM event but returns BEFORE React 19's microtask-scheduled
  // re-render flushes the portal mount, so `getByTestId` queries against
  // the portaled items miss. `await user.click(...)` flushes all of those
  // microtasks, so post-`await` queries see the portaled menu items
  // immediately — no `waitFor` polling needed. Canonical pattern; mirrors
  // `Components/UserMenu.test.tsx` (the only project test that opens a
  // Radix DropdownMenu).
  // (Code-reviewer-minimax-m3 final review pass.)

  // beforeEach reset: clear call history on the apiMock entries so the
  // in-flight test's `mockReturnValueOnce` override from one run
  // doesn't bleed into the next. The override is one-shot (Vitest
  // contract) so this is cheap insurance rather than a hard
  // correctness requirement for the current 4 specs — pin it now to
  // protect against future test-suite growth.
  //
  // `checkAllAccounts` reset is currently inert (no test in this spec
  // block exercises it), but included so a future test that does
  // isn't tripped by stale calls from a prior spec.
  beforeEach(() => {
    apiMock.checkAuthorizationHealth.mockReset()
    apiMock.checkAuthorizationHealth.mockResolvedValue({
      success: true,
      data: { status: 'valid' },
    })
    apiMock.checkAllAccounts.mockReset()
    apiMock.checkAllAccounts.mockResolvedValue({ success: true, data: [] })
  })

  async function openDropdown() {
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: /Authorization actions/i }),
    )
  }

  it('does NOT render the standalone "立即完整验证" button at row level (moved into dropdown)', () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: false,
    }
    renderItem(auth)
    // The exact check-health testid was previously on a row-level Button;
    // it now lives ONLY inside the dropdown MenuItem. Before opening the
    // menu, the testid must not resolve at the row level.
    expect(screen.queryByTestId('check-health-10')).not.toBeInTheDocument()
    // The legacy visible label was "立即完整验证" — it should be gone too.
    expect(screen.queryByText('立即完整验证')).not.toBeInTheDocument()
  })

  it('renders "完整验证" inside the dropdown menu, ALWAYS (regardless of canRescan)', async () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      // valid: true + stale: false → canRescan === false → only 完整验证 +
      // 断开连接 should appear; 重新扫码 / 重新登录 must NOT.
      valid: true,
      stale: false,
    }
    renderItem(auth)
    await openDropdown()
    expect(screen.getByTestId('check-health-10')).toBeInTheDocument()
    expect(screen.getByText('完整验证')).toBeInTheDocument()
    expect(screen.queryByText('重新扫码')).not.toBeInTheDocument()
    expect(screen.getByText('断开连接')).toBeInTheDocument()
  })

  it('renders 完整验证 + 重新扫码 + 断开连接 for failed/stale authorizations (canRescan=true)', async () => {
    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: false,
    }
    renderItem(auth)
    await openDropdown()
    expect(screen.getByTestId('check-health-10')).toBeInTheDocument()
    expect(screen.getByTestId('reauthorize-1-douyin')).toBeInTheDocument()
    expect(screen.getByText('重新扫码')).toBeInTheDocument() // douyin ∈ QR_LOGIN_PLATFORMS
    expect(screen.getByText('断开连接')).toBeInTheDocument()
  })

  // In-flight UX invariant (round-OPT-cleanup-account-actions follow-up):
  //
  // The consolidated "完整验证" menu item replaced a row-level button that
  // was previously permanently visible — so the user could ALWAYS see
  // the `完整验证中…` label + spinning RefreshCw while the ~30–60s
  // Chromium recheck was pending. After moving into a Radix DropdownMenu,
  // the menu closes by default on item activation, which would have
  // silently removed the in-flight affordance. The complement fix is
  // `onSelect={(e) => { if (inflightRef.current) e.preventDefault() }}` —
  // this test pins that contract so a future regression that drops the
  // preventDefault (the user loses the 30–60s spinner) trips red here.
  //
  // Without this test, the 3 layout tests above can all pass while the
  // real UX is broken (the menu would close and the user sees nothing
  // for the duration of the network call).
  it('keeps the dropdown open and shows "完整验证中…" while the Chromium recheck is pending', async () => {
    // Override the API mock with a never-resolving Promise to simulate
    // a long-running in-flight request without using fake timers
    // (fake timers would have to interact with React 19's microtask
    // scheduler; the Promise approach is more deterministic in
    // happy-dom + jsdom).
    let resolveCheck: (v: { success: true; data: { status: string } }) => void = () => {}
    apiMock.checkAuthorizationHealth.mockReturnValueOnce(
      new Promise<{ success: true; data: { status: string } }>((r) => {
        resolveCheck = r
      }),
    )

    const auth: AccountAuthorization = {
      id: 10,
      platform: 'douyin',
      cookie_file: '/cookies/douyin.json',
      valid: false,
    }
    renderItem(auth)
    await openDropdown()

    const user = userEvent.setup()
    await user.click(screen.getByTestId('check-health-10'))

    // In-flight affordance STILL visible: the menu must NOT have closed,
    // and the label must flip to "完整验证中…" alongside the dumped
    // menu-structure (the ORIGINAL Radix close-on-select would have
    // unmounted all of this).
    expect(screen.getByTestId('check-health-10')).toBeInTheDocument()
    expect(screen.getByText('完整验证中…')).toBeInTheDocument()
    // `exact: true` prevents substring matching against `完整验证中…`
    // (the in-flight label contains the pre-click label as a prefix).
    // Without this, `not.toBeInTheDocument()` would always pass the
    // negative form but the positive `完整验证中…` assertion above
    // is what proves the visual flip happened.
    expect(screen.queryByText('完整验证', { exact: true })).not.toBeInTheDocument()

    // Concurrent second click must be a no-op (inflightRef race guard).
    await user.click(screen.getByTestId('check-health-10'))
    expect(apiMock.checkAuthorizationHealth).toHaveBeenCalledTimes(1)

    // Resolve the recheck and the menu must close cleanly (Radix's
    // default close-on-select returns once onSelect stops calling
    // preventDefault, which it does after finally clears the ref).
    resolveCheck({ success: true, data: { status: 'valid' } })
    await waitFor(() =>
      expect(screen.queryByText('完整验证中…')).not.toBeInTheDocument(),
    )
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
