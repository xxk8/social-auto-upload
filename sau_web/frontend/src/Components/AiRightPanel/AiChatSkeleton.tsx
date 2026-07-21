// ──────────────────────────────────────────────────────────────────────────
// Components/AiRightPanel/AiChatSkeleton.tsx
//
// round-AI-paywall-v2 — neutral first-paint skeleton for the AI sidebar
// chat surface on /publish. Eliminates the ChatComposer → AiPaywallBanner
// swap flash that free-tier users see when /api/usage/quota is in flight.
//
// Layout invariants (matched to BOTH branches so the swap is CLS-free):
//   • Outer wrapper: `flex-1 min-h-0 flex flex-col px-4 py-4` — same as
//     the paywall wrapper (`PublishAiSidebar.tsx` §paywall branch) and
//     structurally compatible with `AiAssistantPanel` which is itself
//     flex-1 min-h-0 flex-col.
//   • Inner heights: brand row (~24px) + headline (3 lines ≈ 56px) + 3
//     bullet bars (~36px) + CTA (36px) + flex spacer. Total ≈ 200px
//     before the spacer — both branches settle into the available
//     `flex-1` space the same way the skeleton claims it.
//
// Renders from two call sites:
//   1. TierBlockGate — `!query.isFetched` (initial /api/usage/quota
//      in-flight). Primary mechanism.
//   2. <Suspense fallback> wrapper around TierBlockGate — defensive net
//      that only fires if a child throws a Promise (e.g. future code-
//      split child opts into suspense, or a deliberately-thrown promise
//      in error paths). Today this rarely fires since useQuery defaults
//      to throwOnError=false.
//
// data-testid invariant: `ai-chat-skeleton` + `data-skeleton-kind` on
// the outer wrapper, so unit tests can anchor on a single selector and
// distinguish the TierBlockGate branch from a hypothetical Suspense-only
// rendering if we later want to test the two paths separately.
// ──────────────────────────────────────────────────────────────────────────

export function AiChatSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-testid="ai-chat-skeleton"
      data-skeleton-kind="ai-chat"
      aria-label="AI 助手加载中"
      className={`flex-1 min-h-0 flex flex-col px-4 py-4 ${className ?? ''}`.trim()}
    >
      {/* inner placeholder bars are aria-hidden — they are visual-only
          shimmer bars and would otherwise be announced by screen
          readers as a stream of graphics. Outer `aria-label` gives
          AT users a single coherent "loading" announcement that
          naturally clears when the swap to paywall / composer
          happens. (Avoiding `role="status" + aria-busy` here —
          those would create a stale live-region on swap, which is
          worse than the simple readable label approach.) */}
      <div aria-hidden="true" className="mb-3 flex items-center gap-2">
        <div className="h-5 w-5 rounded-md bg-muted/60 animate-pulse" />
        <div className="h-3 w-24 rounded bg-muted/60 animate-pulse" />
      </div>

      <div aria-hidden="true" className="mb-3 flex items-start gap-2.5">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-muted/60 animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-2/3 rounded bg-muted/60 animate-pulse" />
          <div className="h-3 w-full rounded bg-muted/60 animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-muted/60 animate-pulse" />
        </div>
      </div>

      <div aria-hidden="true" className="mb-4 space-y-1.5 pl-2">
        <div className="h-3 w-3/4 rounded bg-muted/60 animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-muted/60 animate-pulse" />
        <div className="h-3 w-4/5 rounded bg-muted/60 animate-pulse" />
      </div>

      <div className="flex-1" />

      <div
        aria-hidden="true"
        className="ml-auto h-9 w-28 rounded bg-muted/60 animate-pulse"
      />
    </div>
  )
}
