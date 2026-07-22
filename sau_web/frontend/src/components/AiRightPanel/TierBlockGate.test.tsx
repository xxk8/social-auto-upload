// ──────────────────────────────────────────────────────────────────────────
// Components/AiRightPanel/TierBlockGate.test.tsx
//
// round-AI-paywall-v2 — focused vitest for <TierBlockGate> + <AiChatSkeleton>.
//
// Covers all three render branches of <TierBlockGate>:
//   • Loading  (`!query.isFetched`)               → <AiChatSkeleton />
//   • Free     (`query.isFetched` + required='pro') → <AiPaywallBanner variant="full" />
//   • Default  (otherwise)                         → children
//
// Plus a defensive layout-invariant check on <AiChatSkeleton> so the
// matched-height promise is pinned in CI (regression guard against
// future layout drift that would re-introduce the CLS flash).
//
// We render the gate in isolation (no QueryClient, no PublishAiSidebar,
// no AiAssistantPanel) and pass a hand-built `UseQueryResult`-shaped
// object via the `makeQuery(overrides)` helper. This means the test
// does NOT depend on TanStack Query timing or wrapper providers —
// branch behavior is asserted deterministically.
// ──────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from '@tanstack/react-router'

import { TierBlockGate } from './TierBlockGate'
import type { AiQuotaResponse } from './TierBlockGate'
import { AiChatSkeleton } from './AiChatSkeleton'

/**
 * Test wrapper: <AiPaywallBanner> renders a <Link to=…> from
 * react-router-dom, so the gate must be wrapped in <MemoryRouter>
 * (context provider) for branch (b) to render without throwing
 * `Cannot destructure property 'basename' of useContext(...) is null`.
 * TierBlockGate renders branches directly — but the (b) branch renders
 * AiPaywallBanner which transitively pulls in Link → RouterProvider.
 */
function renderGate(
  ui: ReactNode,
  overrides?: { initialEntries?: string[] },
) {
  return render(
    <MemoryRouter initialEntries={overrides?.initialEntries ?? ['/dashboard/publish']}>
      {ui}
    </MemoryRouter>,
  )
}

/**
 * Build a `UseQueryResult` shaped object with sensible defaults + overrides.
 * Default state mirrors TanStack Query v5's `pending` (initial fetch in
 * flight) — `isFetched: false`, `isPending: true`, `data: undefined`.
 */
function makeQuery(
  overrides: Partial<UseQueryResult<AiQuotaResponse | null>>,
): UseQueryResult<AiQuotaResponse | null> {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: 'idle',
    isEnabled: true,
    isError: false,
    isFetched: false,
    isFetchedAfterMount: false,
    isFetching: false,
    isLoading: false,
    isLoadingError: false,
    isPaused: false,
    isPending: true,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: true,
    isSuccess: false,
    refetch: () => Promise.resolve(undefined as never),
    remove: () => undefined,
    status: 'pending',
    promise: Promise.resolve(undefined as never),
    ...overrides,
  } as unknown as UseQueryResult<AiQuotaResponse | null>
}

describe('TierBlockGate (round-AI-paywall-v2)', () => {
  it('(a) while query.isFetched === false → renders AiChatSkeleton; NOT paywall or children', () => {
    const q = makeQuery({ isFetched: false, isPending: true, isFetching: true })
    renderGate(
      <TierBlockGate query={q}>
        <div data-testid="chat-composer-stub">chat composer</div>
      </TierBlockGate>,
    )
    // Loading branch.
    expect(screen.getByTestId('ai-chat-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-paywall-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-composer-stub')).not.toBeInTheDocument()
  })

  it('(b) fetched + required_tier="pro" → renders AiPaywallBanner variant=full; NOT skeleton or children', () => {
    const q = makeQuery({
      isFetched: true,
      isFetchedAfterMount: true,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: 'success',
      fetchStatus: 'idle',
      data: { quotas: { ai_generate: { required_tier: 'pro', can_upgrade: true } } },
    })
    renderGate(
      <TierBlockGate query={q}>
        <div data-testid="chat-composer-stub">chat composer</div>
      </TierBlockGate>,
    )
    // Free-tier branch — Stripe-style paywall, full variant.
    const banner = screen.getByTestId('ai-paywall-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.getAttribute('data-variant')).toBe('full')
    expect(screen.queryByTestId('ai-chat-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-composer-stub')).not.toBeInTheDocument()
  })

  it('(c) fetched + required_tier=null (pro tier, quota signal absent) → renders children; NOT skeleton or paywall', () => {
    const q = makeQuery({
      isFetched: true,
      isPending: false,
      isSuccess: true,
      status: 'success',
      // legacy / pro / auth-disabled: no `required_tier` key.
      data: { quotas: { ai_generate: { is_unlimited: true, limit: 200, remaining: 200, can_upgrade: false } } },
    })
    renderGate(
      <TierBlockGate query={q}>
        <div data-testid="chat-composer-stub">chat composer</div>
      </TierBlockGate>,
    )
    // Default branch — children (chat composer) renders.
    expect(screen.getByTestId('chat-composer-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-chat-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-paywall-banner')).not.toBeInTheDocument()
  })

  it('(d) fetched + legacy-shape (no ai_generate entry) → falls through to children', () => {
    // Pinned for the legacy / metering-disabled fallback: an empty
    // `quotas` envelope must NOT be misread as "free tier".
    const q = makeQuery({
      isFetched: true,
      isPending: false,
      isSuccess: true,
      status: 'success',
      data: { quotas: {} },
    })
    renderGate(
      <TierBlockGate query={q}>
        <div data-testid="chat-composer-stub">chat composer</div>
      </TierBlockGate>,
    )
    expect(screen.getByTestId('chat-composer-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-paywall-banner')).not.toBeInTheDocument()
    // Skeleton also not present.
    expect(screen.queryByTestId('ai-chat-skeleton')).not.toBeInTheDocument()
  })

  it('(e) fetched + error → falls through to children (defensive; quota-fetch failure is NOT an absence-of-pro)', () => {
    // On fetch error we render children rather than paywall: a 500
    // reading /api/usage/quota is a system fault, not a tier signal.
    // The chat-area XHR will surface its own toast if it really is
    // paywalled. This matches what PublishAiSidebar already does
    // pre-v2 (fall through to default branch when aiTierRequired=null).
    const q = makeQuery({
      isFetched: true,
      isPending: false,
      isError: true,
      isSuccess: false,
      status: 'error',
      error: new Error('mock 500'),
      data: undefined,
    })
    renderGate(
      <TierBlockGate query={q}>
        <div data-testid="chat-composer-stub">chat composer</div>
      </TierBlockGate>,
    )
    expect(screen.getByTestId('chat-composer-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-paywall-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-chat-skeleton')).not.toBeInTheDocument()
  })

  it('(f) AiChatSkeleton has matched-height layout (flex-1 min-h-0 flex flex-col px-4 py-4)', () => {
    // CLS regression guard. Loading→paywall swap must NOT cause a
    // visible vertical shift; both branches must share the same outer
    // padding + flex layout so the matched-height promise holds.
    const { container } = renderGate(<AiChatSkeleton />)
    const skeleton = screen.getByTestId('ai-chat-skeleton')
    expect(skeleton.className).toContain('flex-1')
    expect(skeleton.className).toContain('min-h-0')
    expect(skeleton.className).toContain('flex-col')
    expect(skeleton.className).toContain('px-4')
    expect(skeleton.className).toContain('py-4')
    // data-attribute invariant for cross-test anchoring.
    expect(skeleton.getAttribute('data-skeleton-kind')).toBe('ai-chat')
    // a11y regression guard: outer has aria-label so AT users get a
    // single coherent loading signal; inner placeholder bars are
    // aria-hidden so screen-reader output isn't a stream of
    // "image/image/image". No role="status" + aria-busy here —
    // that combo would leave a stale live-region on the swap.
    expect(skeleton.getAttribute('aria-label')).toBe('AI 助手加载中')
    expect(skeleton.getAttribute('role')).toBeNull()
    expect(skeleton.getAttribute('aria-busy')).toBeNull()
    void container
  })
})
