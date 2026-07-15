// ──────────────────────────────────────────────────────────────────────────
// features/accounts/dialogs/AuthorizeDialog.test.tsx
//
// Round-OPT-authorize-grid (2026-q3): vitest spec for the visual-grid
// add-platform-authorization modal. 6 sync tests, all read-only OR
// dispatch-call-history validation:
//
//   1. grid renders radio cards per PLATFORMS entry (read-only)
//   2. <DialogTitle> header renders (read-only)
//   3. already-authorized platforms render dimmed + disabled (read-only)
//   4. click an available platform → dispatch.setSelectedPlatform(value)
//      (sync: vi.fn() identity is preserved via explicit dispatch map)
//   5. click Cancel → dispatch.setAuthorizeDialogOpen(false) + no other
//      dispatch fires (sync)
//   6. keyboard Enter on focused radio → same dispatch as click
//      (sync — relies on the explicit onKeyDown handler added in
//      AuthorizeDialog.tsx to make browsers AND jsdom dispatch Enter)
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'

// vi.hoisted wraps the bridge so the vi.mock factory closure (which
// vitest hoists above the body) can reach the same mutable references.
// IMPORTANT: explicit dispatch map (NOT a Proxy). Proxy-deep-refresh
// trick returns a fresh vi.fn() per property access — which silently
// breaks `expect(stubDispatch.x).toHaveBeenCalled()` because the fn
// invoked at component-call time != the fn inspected at assert time.
// Explicit map guarantees each key returns the SAME vi.fn() across
// reads. The dispatch is cast to AccountsDispatch at the hook edge.

const { stubState, stubDispatch } = vi.hoisted(() => {
  const state: {
    groups: Array<{
      id: number
      name: string
      authorizations: Array<{
        id: number
        platform: string
        valid: boolean
        cookie_file: string
      }>
    }>
    authorizeDialogOpen: boolean
    selectedGroupId: number | null
    selectedPlatform: string
  } = {
    groups: [],
    authorizeDialogOpen: true,
    selectedGroupId: null,
    selectedPlatform: '',
  }
  // AuthorizeDialog calls exactly these 3 dispatch methods. List every
  // vi.fn() the dialog touches here so the explicit-dispatch map is
  // complete before the component first reads it.
  const dispatch = {
    setAuthorizeDialogOpen: vi.fn(),
    setSelectedPlatform: vi.fn(),
    handleAuthorize: vi.fn(),
  }
  return { stubState: state, stubDispatch: dispatch }
})

// ── Module-level mocks (vitest hoists these) ──────────────────────────

vi.mock('@/features/accounts/AccountsProvider.helpers', async () => {
  const real =
    await vi.importActual<
      typeof import('@/features/accounts/AccountsProvider.helpers')
    >('@/features/accounts/AccountsProvider.helpers')
  return {
    ...real,
    useAccountsState: () => stubState,
    // Cast: explicit dispatch map declares the 3 methods the dialog
    // actually reads. The `AccountsDispatch` type has many more keys
    // but TS2344 (assignability) is suppressed because the consumer is
    // cast at the SAME edge the production type is widened — no
    // activity in the cast boundary differs from a hand-rolled mock.
    useAccountsDispatch: () => stubDispatch as never,
  }
})

vi.mock('@/Components/ui/platform-icon', () => ({
  PlatformIcon: ({
    platform,
    className,
  }: {
    platform: string
    className?: string
  }) => <span data-platform={platform} className={className} />,
}))

import { AuthorizeDialog } from './AuthorizeDialog'

// ── helpers ───────────────────────────────────────────────────────────

function seedAuthorizedGroup() {
  stubState.groups = [
    {
      id: 7,
      name: '测试分组',
      authorizations: [
        { id: 71, platform: 'douyin', valid: true, cookie_file: '' },
      ],
    },
  ]
  stubState.selectedGroupId = 7
}

beforeEach(() => {
  // Reset state slice WITHOUT replacing stubDispatch's vi.fn() identity
  // (mockClear resets call history; fn identity stays so component and
  // assertion see the same fn across the test).
  stubState.groups = []
  stubState.authorizeDialogOpen = true
  stubState.selectedGroupId = null
  stubState.selectedPlatform = ''
  seedAuthorizedGroup()
  stubDispatch.setAuthorizeDialogOpen.mockClear()
  stubDispatch.setSelectedPlatform.mockClear()
  stubDispatch.handleAuthorize.mockClear()
})

// ── tests ────────────────────────────────────────────────────────────

describe('AuthorizeDialog · visual platform grid', () => {
  it('renders a radiogroup card for every platform in PLATFORMS', () => {
    render(
      <TestProviders client={makeQueryClient()}>
        <AuthorizeDialog />
      </TestProviders>,
    )
    const grid = screen.getByRole('radiogroup', { name: '选择平台' })
    const radios = within(grid).getAllByRole('radio')
    // PLATFORMS has 7 entries (douyin + kuaishou + xiaohongshu +
    // tencent + bilibili + tiktok + baijiahao). ≥7 is a soft
    // assertion; changing PLATFORMS in api/types.ts will require
    // updating this test.
    expect(radios.length).toBeGreaterThanOrEqual(7)
    expect(screen.getByTestId('platform-card-douyin')).toBeInTheDocument()
    expect(screen.getByTestId('platform-card-bilibili')).toBeInTheDocument()
    expect(screen.getByTestId('platform-card-baijiahao')).toBeInTheDocument()
  })

  it('renders the <DialogTitle> header', () => {
    // Radix Dialog requires a DialogTitle for SR announcement; lock
    // the visible text so a future refactor doesn't silently drop
    // the title during optimization.
    render(
      <TestProviders client={makeQueryClient()}>
        <AuthorizeDialog />
      </TestProviders>,
    )
    expect(screen.getByText('添加平台授权')).toBeInTheDocument()
  })

  it('dims the already-authorized platform and disables its button', () => {
    render(
      <TestProviders client={makeQueryClient()}>
        <AuthorizeDialog />
      </TestProviders>,
    )
    const douyinCard = screen.getByTestId('platform-card-douyin')
    expect(douyinCard).toBeDisabled()
    expect(douyinCard).toHaveAttribute('aria-disabled', 'true')
    // "已授权" tag is rendered inline so users see WHY the card is
    // dim, not just "this is grey".
    expect(within(douyinCard).getByText('已授权')).toBeInTheDocument()
    // A non-authorized platform stays clickable.
    const bilibiliCard = screen.getByTestId('platform-card-bilibili')
    expect(bilibiliCard).not.toBeDisabled()
    expect(bilibiliCard).toHaveAttribute('aria-disabled', 'false')
  })

  it('clicking an available platform dispatches setSelectedPlatform(value)', () => {
    render(
      <TestProviders client={makeQueryClient()}>
        <AuthorizeDialog />
      </TestProviders>,
    )
    fireEvent.click(screen.getByTestId('platform-card-bilibili'))
    // Explicit dispatch map ⇒ SAME vi.fn() instance, so the fn
    // invoked by the component click handler is the fn we assert on.
    expect(stubDispatch.setSelectedPlatform).toHaveBeenCalledTimes(1)
    expect(stubDispatch.setSelectedPlatform).toHaveBeenCalledWith('bilibili')
    // Click must NOT also fire handleAuthorize — the submit lives on
    // the 开始授权 footer button.
    expect(stubDispatch.handleAuthorize).not.toHaveBeenCalled()
  })

  it('clicking Cancel routes to setAuthorizeDialogOpen(false) and no other dispatch fires', () => {
    render(
      <TestProviders client={makeQueryClient()}>
        <AuthorizeDialog />
      </TestProviders>,
    )
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(stubDispatch.setAuthorizeDialogOpen).toHaveBeenCalledTimes(1)
    expect(stubDispatch.setAuthorizeDialogOpen).toHaveBeenCalledWith(false)
    expect(stubDispatch.setSelectedPlatform).not.toHaveBeenCalled()
    expect(stubDispatch.handleAuthorize).not.toHaveBeenCalled()
  })

  it('keyboard Enter on a focused radio dispatches setSelectedPlatform', () => {
    // Real Chromium synthesizes a button-click on Enter natively —
    // however jsdom does NOT implement that synthesis, so we added
    // an explicit onKeyDown handler in AuthorizeDialog.tsx to make
    // this contract testable in jsdom AND make the keyboard intent
    // explicit in the production component (vs. relying on hidden
    // browser-synthesis timing).
    render(
      <TestProviders client={makeQueryClient()}>
        <AuthorizeDialog />
      </TestProviders>,
    )
    const bili = screen.getByTestId('platform-card-bilibili')
    bili.focus()
    fireEvent.keyDown(bili, { key: 'Enter' })
    expect(stubDispatch.setSelectedPlatform).toHaveBeenCalledWith('bilibili')
  })
})
