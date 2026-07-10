/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/Components/ui/tooltip'
import PricingPage from './PricingPage'

/**
 * round-AI-paywall-v1 — pin the visitor-facing pricing free-tier
 * copy so the AI bullet removal is not silently reverted.
 *
 * `PricingTier.tsx` (`<Components/ui/pricing-tier.tsx>`) renders
 * `data-tier-card={id}` on the outer wrapper; that's the anchor we
 * use to scope queries to the free tier card only (so a future PR
 * can add AI copy back to Pro/Team/Enterprise tiers without tripping
 * this test).
 *
 * Cross-tier invariants (4 cards, exactly 1 highlight, "推荐"
 * badge visible) live in
 * `tests/e2e/landing-pricing-attribution.spec.ts` — we don't
 * duplicate them here.
 *
 * Why a hand-rolled wrapper instead of `@/test/render-harness`'s
 * <TestProviders>: TestProviders covers QueryClient / Router /
 * ThemeProvider / ToastProvider but does NOT include Radix's
 * TooltipProvider. PricingPage renders `<PricingComparison>` and
 * the HIGHLIGHT_ROWS mockups (TeamDashboardMockup /
 * EnterpriseScaleMockup) which use Radix Tooltip internally for
 * hover-previews. Without wrapping here, the test mount blows up
 * with "Tooltip must be used within TooltipProvider".
 *
 * If a future refactor adds TooltipProvider to TestProviders, this
 * file can collapse to the canonical wrapper. Until then, this
 * hand-rolled wrapper is intentional and documented.
 */

function mountPricing() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pricing']}>
        <TooltipProvider>
          <PricingPage />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function queryByAttr(attr: string, value: string): HTMLElement {
  // testing-library doesn't export a direct "find by data-attribute"
  // shorthand, so use the container's querySelector for the rare
  // anchor we need. The result has `.children` + `.textContent`
  // available for `within(...)` to scope against.
  const el = document.querySelector(`[${attr}="${value}"]`)
  if (!el) throw new Error(`No element with [${attr}="${value}"]`)
  return el as HTMLElement
}

describe('PricingPage · round-AI-paywall-v1 free-tier copy', () => {
  it('free tier card no longer lists "AI 文案生成 (基础模型)"', () => {
    mountPricing()
    const freeCard = queryByAttr('data-tier-card', 'free')
    // The misleading "基础模型" framing is gone for free tier
    // (Pro tiers keep their own AI-copy lines; this scopes the
    // assertion to the free card only via data-tier-card=free).
    expect(
      within(freeCard).queryByText(/AI 文案生成 \(基础模型\)/),
    ).not.toBeInTheDocument()
  })

  it('free tier card mentions the AI upgrade nudge', () => {
    mountPricing()
    const freeCard = queryByAttr('data-tier-card', 'free')
    // After the paywall move, the free card points users at the
    // upgrade path instead of claiming an AI feature it no longer
    // provides.
    expect(
      within(freeCard).getByText(/升级专业版解锁 AI 内容生成/),
    ).toBeInTheDocument()
  })
})
