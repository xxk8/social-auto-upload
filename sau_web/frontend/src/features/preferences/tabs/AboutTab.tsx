// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/AboutTab.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): AboutTab is the
// 'about' tab body for the PreferencesDialog. Compact modal-only
// version of the /about route (which has 4 sections × visitor chrome
// + GSAP scroll-triggered choreography — those can't fit in any
// modal). Shows app metadata + version + publish history, sized
// for one-screen-in-the-modal reading at v2's wider ~1024-px
// canvas.
//
// env reads (import.meta.env.VITE_APP_NAME / _VITE_APP_VERSION /
// _VITE_BUILD_SHA) at component scope so HMR doesn't re-read
// every render. Missing vars fall back to literal defaults so the
// dialog renders cleanly in dev (Vite injects these only via the
// build plugin).
//
// ── Reciprocal cross-ref to <Pages/AboutPage.tsx> ───────────────────────
//
// NOT the same About as the visitor-facing `/about` marketing
// surface at `Pages/AboutPage.tsx`. They look coincidentally related
// (both render brand + version metadata) but they are intentionally
// disjoint, and this reciprocal anchor mirrors the equivalent
// cross-ref block at the top of `AboutPage.tsx` so a future PR finds
// the explicit boundary from EITHER side:
//   • `features/preferences/tabs/AboutTab.tsx` (THIS FILE) — modal
//     tab body inside the operator PreferencesDialog. Triggered
//     from the AppShell footer <UserMenu /> ←
//     <PreferencesDialogProvider />, routed through
//     `usePreferencesDialog().openPreferences('about')`. Composed
//     from operator primitives (Card + Button + Link) sized for
//     the modal canvas; no SectionHeading / Stat / PricingTier.
//   • `Pages/AboutPage.tsx` — public visitor marketing surface at
//     `/about`. Auth-gated-free, no dialog state. Composed from
//     visitor primitives (SectionHeading + Stat + PricingTier).
// Anchoring both surfaces with the SYMMETRIC cross-ref prevents
// future PRs from unifying them by accident — e.g. "just import
// `AboutTab` from `features/preferences/` into `/about`" would
// silently re-introduce the dialog dependency into the public
// visitor surface. The '了解更多 →' button below is the legitimate
// hand-off from operator→visitor (Link to /about, not a slice
// import).
//
// ── Publish history: replaced MOCK_PUBLISH_HISTORY (round-OPT-3G) ───────
// Previously this tab rendered a hardcoded 5-row `MOCK_PUBLISH_HISTORY`
// literal with the comment "replace with real API data". That literal
// is now sourced from `GET /api/publish/history` — see
// web_runner/routes/tasks.py :: list_publish_history for the server-side
// mapping + lifecycle→Timeline status reducer.
//
// Direct `useEffect + useCallback` is intentional: the modal is opened
// occasionally + doesn't need cross-page query invalidation, so
// TanStack Query is overkill here. The refresh button on the Card
// header lets the operator re-fetch without closing the dialog.
// ──────────────────────────────────────────────────────────────────────────
//

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Heart,
  Info,
  Terminal,
  History,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/Components/ui/card'
import { Button } from '@/Components/ui/button'
import { Timeline } from '@/Components/ui/timeline'
import { api } from '@/api/client'
import type { PublishHistoryItem } from '@/api/types'

import { ROUTES } from '@/routes'
// Module-level history cap, mirrored from the server-side default in
// `web_runner/routes/tasks.py::list_publish_history`. The frontend
// sends `limit` as a query param so the modal never accidentally
// fans out into the operator's complete task archive. Server clamps
// to max(1, min(limit, 100)) so a stray `?limit=999999` can't OOM
// the worker.
const HISTORY_LIMIT = 20

export function AboutTab() {
  const appName =
    (import.meta.env?.VITE_APP_NAME as string | undefined) ?? 'social-auto-upload'
  const appVersion =
    (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? 'unknown'
  const buildSha =
    (import.meta.env?.VITE_BUILD_SHA as string | undefined) ?? 'dev'

  // ── Publish history state ───────────────────────────────────────────
  // `loading` starts true so the FIRST render shows a Skeleton. Radix
  // `<Tabs.Content forceMount={false}>` auto-unmounts inactive panes,
  // so re-opening the dialog naturally re-runs the mount-time effect
  // + re-enters the loading state.
  //
  // `error` is a copy-able string for the issue tracker. We do NOT
  // bubble to a toast: tab opens inside a modal where a global toast
  // would race the dialog's slide-in animation, and the inline
  // <Timeline.Empty message=... /> below is already user-visible.
  const [history, setHistory] = useState<PublishHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Mount-cancellation flag: Radix `<Tabs.Content forceMount={false}>`
  // auto-unmounts inactive panes, so closing the PreferencesDialog
  // mid-fetch would otherwise trigger React's "setState on unmounted
  // component" warning. The ref persists across renders (unlike a
  // useState flag, which would itself trigger a re-render and need
  // its own cleanup). A future AbortController upgrade is the
  // forward-compatible path for cancelling the in-flight HTTP req
  // itself; today the network call still completes, but its result
  // is silently dropped.
  const cancelledRef = useRef(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await api.getPublishHistory(HISTORY_LIMIT)
      if (cancelledRef.current) return
      // Mirror server-side defensive `?? []` so a future schema drift
      // (missing `data` envelope) renders the empty state instead of
      // crashing the Timeline above.
      setHistory(Array.isArray(items) ? items : [])
    } catch (err: unknown) {
      if (cancelledRef.current) return
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : '加载失败'
      setError(message || '加载失败')
      setHistory([])
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  // Mount-once fetch. `refresh` is itself memoized with empty deps,
  // so this effect runs exactly once per mount.
  useEffect(() => {
    cancelledRef.current = false
    void refresh()
    return () => {
      cancelledRef.current = true
    }
  }, [refresh])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px] flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Info className="h-4 w-4" />
            </span>
            关于此应用
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* App identity — enlarged brand mark (h-12 w-12) + bigger
              name (text-base font-semibold) so the brand reads as
              an establishment, not a footer-coda. Hairline
              divider below separates brand from body. */}
          <div className="flex items-center gap-4 pb-5 border-b border-border/30">
            <div className="flex h-12 w-12 items-center justify-center rounded-[4px] bg-foreground text-background flex-shrink-0">
              <Terminal className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-base font-semibold tracking-tight text-foreground">
                {appName}
              </span>
              <span className="mt-1 text-[12px] font-mono tabular-nums text-muted-foreground/80">
                v{appVersion} · build {buildSha}
              </span>
            </div>
          </div>

          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70">
              项目简介
            </span>
            <p className="mt-2 text-sm text-foreground leading-relaxed">
              为视频创作者 / 矩阵运营 / MCN 设计的多平台自动发布工具。
            </p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              本地优先 · 数据归属您 · 持续维护
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to={ROUTES.public.about}>
                <Heart className="h-3.5 w-3.5" aria-hidden />
                了解更多
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>

          </div>
        </CardContent>
      </Card>

      {/* ── Publish history timeline (API-driven) ───────────────────
          Header gains a refresh icon button so the operator can
          re-fetch without closing the dialog. While a refresh is
          in flight, the icon rotates to mirror the existing Loader2
          pattern used in publish wizard. */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-[15px] flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              发布历史
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="刷新发布历史"
              className="gap-1.5"
            >
              <RefreshCw
                className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
                aria-hidden
              />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <Timeline.Empty message={`加载失败：${error}`} />
          ) : loading && history.length === 0 ? (
            <Timeline.Empty message="加载中…" />
          ) : history.length === 0 ? (
            <Timeline.Empty message="暂无发布记录，快去发布你的第一个视频吧" />
          ) : (
            <Timeline>
              {history.map((item) => (
                <Timeline.Item key={item.id} data={item} />
              ))}
            </Timeline>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
