// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/AboutTab.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): AboutTab is the
// 'about' tab body for the PreferencesDialog. Compact modal-only
// version of the /about route (which has 4 sections × visitor chrome
// + GSAP scroll-triggered choreography — those can't fit in any
// modal). Shows app metadata + version + GitHub link only, sized
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
// ──────────────────────────────────────────────────────────────────────────
//

import { Link } from 'react-router-dom'
import { ArrowRight, GitBranch, Heart, Terminal, History } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/Components/ui/card'
import { Button } from '@/Components/ui/button'
import { Timeline } from '@/Components/ui/timeline'
import type { TimelineItemData } from '@/Components/ui/timeline'

// ── Mock publish history (replace with real API data) ────────────────────
const MOCK_PUBLISH_HISTORY: TimelineItemData[] = [
  {
    id: '1',
    date: '2026-07-04 14:30',
    title: '【Vlog】周末探店：藏在巷子里的咖啡馆',
    platform: 'douyin',
    status: 'success',
    url: 'https://www.douyin.com/video/xxx',
    description: '同步分发至 6 个平台 · 播放量 12.3k',
  },
  {
    id: '2',
    date: '2026-07-03 10:15',
    title: 'React 19 新特性深度解析',
    platform: 'bilibili',
    status: 'success',
    url: 'https://www.bilibili.com/video/xxx',
    description: '同步分发至 4 个平台 · 播放量 8.7k',
  },
  {
    id: '3',
    date: '2026-07-02 18:00',
    title: 'Mac 效率工具推荐',
    platform: 'xiaohongshu',
    status: 'failed',
    description: '小红书图文发布失败 · 图片尺寸不符合要求',
  },
  {
    id: '4',
    date: '2026-07-01 09:00',
    title: '2026 年中总结：我的创作之路',
    platform: 'tencent',
    status: 'pending',
    description: '定时发布 · 等待队列中',
  },
  {
    id: '5',
    date: '2026-06-28 20:00',
    title: '如何搭建个人博客',
    platform: 'kuaishou',
    status: 'success',
    url: 'https://www.kuaishou.com/xxx',
    description: '同步分发至 5 个平台 · 播放量 5.2k',
  },
]

export function AboutTab() {
  const appName =
    (import.meta.env?.VITE_APP_NAME as string | undefined) ?? 'social-auto-upload'
  const appVersion =
    (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? 'unknown'
  const buildSha =
    (import.meta.env?.VITE_BUILD_SHA as string | undefined) ?? 'dev'

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">关于此应用</CardTitle>
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
              为视频创作者 / 矩阵运营 / MCN 设计的开源多平台自动发布工具。
            </p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              本地优先 · 数据归属您 · MIT 协议
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/about">
                <Heart className="h-3.5 w-3.5" aria-hidden />
                了解更多
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <a
                href="https://github.com/dyhBUPT/social-auto-upload"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitBranch className="h-3.5 w-3.5" aria-hidden />
                GitHub 仓库
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Publish history timeline ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px] flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            发布历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          {MOCK_PUBLISH_HISTORY.length > 0 ? (
            <Timeline>
              {MOCK_PUBLISH_HISTORY.map((item) => (
                <Timeline.Item key={item.id} data={item} />
              ))}
            </Timeline>
          ) : (
            <Timeline.Empty message="暂无发布记录，快去发布你的第一个视频吧" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
