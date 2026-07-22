// ──────────────────────────────────────────────────────────────────────────
// Components/AiRightPanel/TierBlockGate.tsx
//
// round-AI-paywall-v2 — neutral first-paint swap guard for the AI sidebar
// chat surface on /publish. Reads the `usage-quota/tier` query state and
// conditionally renders one of three branches:
//
//   1. `!query.isFetched`        → <AiChatSkeleton />    (initial loading)
//   2. fetched + required='pro' → <AiPaywallBanner full/> (free-tier gate)
//   3. otherwise                 → children               (chat composer)
//
// Lives INSIDE a <Suspense fallback={<AiChatSkeleton />}> boundary on the
// parent; the Suspense fallback is a defensive net (today inert since
// useQuery doesn't throw on pending), but it ensures the skeleton
// continues to render if a future code-split child opts into suspense.
//
// Sized by the parent layout so all three branches occupy the same
// rendered height (the skeleton is matched-height by design — see
// AiChatSkeleton.tsx for the matching layout invariants). This kills the
// ChatComposer → AiPaywallBanner swap flash for free-tier users on
// /publish without introducing layout shift.
// ──────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { AiPaywallBanner } from './AiPaywallBanner'
import { AiChatSkeleton } from './AiChatSkeleton'

/** Minimal slice of /api/usage/quota that TierBlockGate reads. */
export interface AiQuotaEntry {
  required_tier?: 'pro' | null | undefined
  can_upgrade?: boolean | undefined
  is_unlimited?: boolean | undefined
  limit?: number | undefined
  remaining?: number | undefined
}
export interface AiQuotaResponse {
  quotas?: { ai_generate?: AiQuotaEntry } | undefined
}

export interface TierBlockGateProps {
  query: UseQueryResult<AiQuotaResponse | null | undefined>
  children: ReactNode
}

export function TierBlockGate({ query, children }: TierBlockGateProps) {
  // Branch 1 — initial /api/usage/quota in-flight: hold neutral skeleton.
  if (!query.isFetched) return <AiChatSkeleton />

  // Branch 2 — free tier signal present: render Stripe-style paywall.
  const required = query.data?.quotas?.ai_generate?.required_tier
  if (required === 'pro') return <AiPaywallBanner variant="full" />

  // Branch 3 — pro / legacy / quota-disabled: render chat composer.
  return <>{children}</>
}
