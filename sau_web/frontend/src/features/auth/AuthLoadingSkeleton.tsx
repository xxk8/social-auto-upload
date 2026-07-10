import { Skeleton } from '@/Components/ui/skeleton'

/**
 * Generic page-loading skeleton — generic PageHeader + 3 content blocks.
 *
 * Used by:
 *   1. `AuthGuard` (features/auth/AuthGuard.tsx) — paints during the
 *      initial /api/auth/me resolution window.
 *   2. Route-level `<Suspense>` fallbacks in App.tsx + AppShell.tsx —
 *      paints during the lazy-loaded route-chunk download window.
 *
 * The two surfaces share this component so the "chrome + sketched
 * content area" contract is consistent across both loading windows.
 * Per-call-site padding tuning via the `padding` prop — both windows
 * use the default `p-4` by default; callers that need to match a
 * page with `p-6` inner padding (e.g. TasksPage) can opt in via
 * `padding="p-6"`. The structural contract is the same regardless.
 * Mirrors the generic PageHeader + content-block layout that every
 * `/dashboard/*` route renders (AccountsPage / PublishPage / TasksPage /
 * etc. all start with a `<PageHeader title=... description=...>`
 * and a content area below it). Reused from the existing
 * shadcn/ui `Skeleton` primitive so the auth window stays in
 * lockstep with the per-page skeletons already rendered by
 * AccountActivityTable / VolumeTrendChart / AdminUsersPage /
 * AdminAuditPage / MaterialImageGrid during their own loading
 * phases.
 *
 * Color note: the `Skeleton` primitive defaults to `bg-primary/10`
 * (sodium-amber tint). We override to `bg-muted/40` so the loading
 * window reads as a neutral placeholder rather than a warning-tinted
 * overlay — matches the convention in HomepageOverview.tsx (~L290),
 * PlatformDistribution.tsx (~L113), and MaterialImageGrid.tsx (~L178).
 * `aria-hidden` so screen readers don't read the placeholder
 * structure to operators.
 *
 * `padding` prop lets callers tune the inner gap-to-edge ratio to
 * match their host page. `p-4` is the safer default (the previous
 * code-reviewer noted p-6 was a guess at per-page padding and could
 * cause layout shift on routes with different inner padding). Callers
 * that know their page uses p-6 (e.g. TasksPage) can opt in via
 * `padding="p-6"` to match the eventual layout exactly.
 */
export type AuthLoadingSkeletonProps = {
  padding?: 'p-4' | 'p-6'
}

export function AuthLoadingSkeleton({
  padding = 'p-4',
}: AuthLoadingSkeletonProps = {}) {
  return (
    <div
      className={`flex flex-col gap-6 ${padding}`}
      data-testid="page-loading-skeleton"
      aria-hidden="true"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-48 bg-muted/40" />
        <Skeleton className="h-4 w-72 bg-muted/40" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg bg-muted/40" />
        <Skeleton className="h-24 w-full rounded-lg bg-muted/40" />
        <Skeleton className="h-24 w-full rounded-lg bg-muted/40" />
      </div>
    </div>
  )
}
