import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/Components/ui/button'
import { Badge } from '@/Components/ui/badge'
import { BrandMark } from '@/Components/ui/brand-glyph'
import MarketingFooter from '@/Components/MarketingFooter'
import MarketingTopBar from '@/Components/MarketingTopBar'
import { Stat } from '@/Components/ui/stat'
import { PlatformIcon } from '@/Components/ui/platform-icon'
import { useRevealStagger } from '@/lib/use-reveal-stagger'
import { useVisitorMotion } from '@/lib/use-visitor-motion'
import { MeshGradient } from '@/Components/motion/MeshGradient'
import { SplitText } from '@/Components/motion/SplitText'
import { GlowOrb, DotGridBg, CtaSpotlightGlow } from '@/Components/motion/visitor-decor'
import { ROUTES } from '@/routes'
import {
  Send,
  CalendarClock,
  Sparkles,
  CheckCircle2,
  Upload,
  MousePointerClick,
  Rocket,
  Video,
  Type,
  Hash,
  Users,
  Zap,
  Clock,
  Globe,
  Lock,
} from 'lucide-react'

// ── Marketing landing page (`/`) — Premium Linear/Vercel redesign ────────
//
// Round-NT-28-i18n: all visitor-facing chrome is resolved via `t(...)` so
// the page mirrors the same string-set the document-set already docs in
// src/locales/{zh-CN,en-US}.json. Static Chinese labels inside
// `ProductMockup` + `MiniAccountMockup` + `MiniScheduleMockup` +
// `MiniAiMockup` stay as demo-data because they represent what the
// actual product UI looks like (which is zh-CN-only for now).
//
// E2E invariants (MUST preserve):
//   • Exactly 3 [data-hero-cell] elements
//   • section#features visible
//   • section id="platforms" reachable as anchor
//   • Footer contains "social-auto-upload" (wordmark, brand-literal)
//   • Primary CTA link href="/dashboard"

// ── Visitor decor (shared with /pricing + /about) ────────────────────────
//
// `GlowOrb`, `DotGridBg`, and `CtaSpotlightGlow` were extracted to
// `Components/motion/visitor-decor.tsx` in the round-unify-grammar
// pass so all 3 visitor surfaces can compose the same background
// stack without duplicating the JSX or losing the `data-*`
// attribute contract that `useVisitorMotion` targets. See the
// docstring at the top of `visitor-decor.tsx` for the per-element
// rationale (color-mix blending, mask layering, mix-blend-mode).

// ── Product Mockup ────────────────────────────────────────────────────────
// The mockup represents the actual product UI, which is zh-CN-only.
// Mockup strings stay static as product-representative visual evidence.

const MOCKUP_PLATFORMS = [
  { platform: 'douyin',      cn: '抖音',   selected: true },
  { platform: 'bilibili',    cn: 'B站',    selected: true },
  { platform: 'xiaohongshu', cn: '小红书', selected: true },
  { platform: 'kuaishou',    cn: '快手',   selected: true },
] as const

function ProductMockup() {
  return (
    <div
      data-hero-mockup
      className="relative max-w-4xl"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 rounded-3xl"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 50%, color-mix(in oklab, var(--primary) 12%, transparent), transparent)',
          filter: 'blur(40px)',
        }}
      />
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl shadow-foreground/[0.06] ring-1 ring-foreground/5">
        <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-5 py-3">
          <BrandMark size="sm" />
          <span className="text-[13px] font-medium tracking-tight text-foreground">
            social-auto-upload
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" aria-hidden />
          </span>
        </div>

        <div className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              发布中心
            </span>
            <Badge variant="secondary" className="text-[10px]">
              4 个平台已选
            </Badge>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {MOCKUP_PLATFORMS.map((p) => (
              <div
                key={p.platform}
                className="flex items-center gap-2 rounded-xl border border-border/40 bg-background/60 px-3.5 py-2.5 transition-colors hover:border-primary/30"
              >
                <PlatformIcon platform={p.platform} className="h-4 w-4 shrink-0" />
                <span className="text-[12px] font-medium text-foreground">{p.cn}</span>
                <CheckCircle2
                  className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]"
                  aria-hidden
                />
              </div>
            ))}
          </div>

          <div className="mb-5 space-y-2.5">
            <div className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-background/60 px-3.5 py-2.5">
              <Video className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[12px] text-muted-foreground">夏季新品发布视频.mp4</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                2:34
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-background/60 px-3.5 py-2.5">
              <Type className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[12px] text-muted-foreground">夏季新品发布 · 限时优惠</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-background/60 px-3.5 py-2.5">
              <Hash className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[12px] text-muted-foreground">夏季新品 · 限时优惠 · 穿搭</span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3.5">
            <span className="text-[13px] font-medium text-foreground">
              一键发布到 4 个平台
            </span>
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
              发布
              <Send className="h-3.5 w-3.5" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section 1 — Hero ─────────────────────────────────────────────────────

function HeroSection() {
  const { t } = useTranslation()
  return (
    <section
      data-hero-section
      className="relative overflow-hidden border-b border-border/30"
    >
      {/* Background stack: MeshGradient (depth) + GlowOrb
          (centered radial pulse) + DotGridBg (subtle texture).
          Three layers stays under the threshold where
          backdrop-blur starts to feel busy — the mesh blobs
          carry opacity-50 and the dot grid is opacity-4, so
          the canvas reads as "alive" without being loud. */}
      <MeshGradient intensity="normal" />
      <GlowOrb />
      <DotGridBg />

      <div className="relative mx-auto max-w-5xl px-6 pt-20 pb-24 text-center sm:pt-28 sm:pb-32">
        <div className="mb-8 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/30 px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground backdrop-blur-sm">
            <span
              className="badge-dot-pulse h-1.5 w-1.5 rounded-full bg-primary"
              aria-hidden
            />
            {t('marketing.landing.hero.badge', '多平台分发 · 本地优先 · 私有部署')}
          </div>
        </div>

        {/* Headline — 3-piece H1. Each piece carries
            `data-text-segment` so useLandingMotion can stagger
            the entrance (y + autoAlpha). The middle fragment
            still carries the gradient class. `{' '}` whitespace
            tokens are explicit between pieces so translators
            can drop leading-space separators from the JSON
            without breaking layout. */}
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          <span data-text-segment className="inline-block">
            {t('marketing.landing.hero.headline_1', '一条视频')}
          </span>
          {' '}
          <span
            data-text-segment
            className="inline-block bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"
          >
            {t('marketing.landing.hero.headline_2', '一键分发')}
          </span>
          {' '}
          <span data-text-segment className="inline-block">
            {t('marketing.landing.hero.headline_3', '到全网平台')}
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground sm:text-xl">
          {t('marketing.landing.hero.subhead', '上传视频,选中账号组,定时发布到抖音、B站、小红书、快手、视频号、百家号。\n不再每天切换多个 App、复制多次文案、盯每个平台发布状态。')}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Button
            asChild
            size="lg"
            className="shimmer h-12 px-7 text-sm font-semibold shadow-lg shadow-primary/20"
          >
            <Link to={ROUTES.dashboard.root}>
              {t('marketing.landing.hero.cta_primary', '立即开始 →')}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-12 px-7 text-sm font-medium">
            <a href="#features">
              {t('marketing.landing.hero.cta_secondary', '了解能力')}
            </a>
          </Button>
        </div>

        {/* 3 stat cells — E2E invariant: exactly 3 [data-hero-cell] */}
        <div className="mx-auto mt-16 grid w-full max-w-3xl grid-cols-3 gap-6 border-t border-border/30 pt-10 sm:gap-10">
          <div data-hero-cell>
            <Stat
              value={t('marketing.landing.hero.stat_platforms', '多平台')}
              caption={t('marketing.landing.hero.stat_platforms_caption', '国内主流 · 全网覆盖')}
            />
          </div>
          <div data-hero-cell>
            <Stat
              value={t('marketing.landing.hero.stat_time', '3h+/day')}
              caption={t('marketing.landing.hero.stat_time_caption', '典型多账号 · 每天省下')}
            />
          </div>
          <div data-hero-cell>
            <Stat
              value={t('marketing.landing.hero.stat_privacy', '不上云')}
              caption={t('marketing.landing.hero.stat_privacy_caption', '数据归属您 · 私有部署')}
            />
          </div>
        </div>

        {/* Three-layer DOM for the mockup:
            • data-mockup-parallax (outermost): mouse-driven
              x,y offset — the parallax hook writes here
            • data-mockup-float (middle): continuous yoyo
              y oscillation — the float hook writes here
            • data-hero-mockup (innermost, on ProductMockup's
              own root): entrance fade-up from useRevealStagger
            Each layer writes to a DIFFERENT node, so GSAP
            never has to merge two live tweens on the same
            DOM element (which would cause the float's
            `y: '+=12'` to fight the parallax's `y: y * 16`
            on every mousemove). `mx-auto` + `mt-16` live on
            the outermost wrapper to keep the previous
            centering and the top spacing between the stat
            row and the mockup. */}
        <div
          data-mockup-parallax
          className="mx-auto mt-16 max-w-4xl"
        >
          <div data-mockup-float>
            <ProductMockup />
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Section 2 — Platform strip ───────────────────────────────────────────

// PLATFORM_STRIP — `cn` (Chinese display name) + `statusFallback` are
// kept literal because platform names are registered marks (抖音 /
// B站 / 小红书 / 快手 / 视频号 / 百家号) and status badges (主线 /
// 支持中) are operator-defined lifecycle states. EN visitors see
// status via `marketing.landing.platforms.status_*` i18n keys.
const PLATFORM_STRIP: ReadonlyArray<{
  name: string
  cn: string
  iconId: string
  statusKey: 'marketing.landing.platforms.status_mainline' | 'marketing.landing.platforms.status_beta'
  statusFallback: string
  glow: string
  tile: string
  ring: string
}> = [
  {
    name: 'Douyin', cn: '抖音',
    iconId: 'douyin',
    statusKey: 'marketing.landing.platforms.status_mainline',
    statusFallback: '主线',
    glow: 'radial-gradient(circle, rgba(37,244,238,0.5) 0%, rgba(255,0,80,0.4) 70%, transparent 100%)',
    tile: 'bg-gradient-to-br from-[#25F4EE] to-[#FE2C55]',
    ring: 'group-hover:border-[#FE2C55]/50',
  },
  {
    name: 'Bilibili', cn: 'B站',
    iconId: 'bilibili',
    statusKey: 'marketing.landing.platforms.status_mainline',
    statusFallback: '主线',
    glow: 'radial-gradient(circle, rgba(0,161,214,0.55) 0%, rgba(251,114,153,0.35) 70%, transparent 100%)',
    tile: 'bg-gradient-to-br from-[#00A1D6] to-[#FB7299]',
    ring: 'group-hover:border-[#00A1D6]/50',
  },
  {
    name: '小红书', cn: '小红书',
    iconId: 'xiaohongshu',
    statusKey: 'marketing.landing.platforms.status_mainline',
    statusFallback: '主线',
    glow: 'radial-gradient(circle, rgba(255,36,66,0.55) 0%, transparent 70%)',
    tile: 'bg-gradient-to-br from-[#FF2442] to-[#FF6B6B]',
    ring: 'group-hover:border-[#FF2442]/50',
  },
  {
    name: 'Kuaishou', cn: '快手',
    iconId: 'kuaishou',
    statusKey: 'marketing.landing.platforms.status_mainline',
    statusFallback: '主线',
    glow: 'radial-gradient(circle, rgba(255,122,0,0.55) 0%, transparent 70%)',
    tile: 'bg-gradient-to-br from-[#FF7A00] to-[#FFB347]',
    ring: 'group-hover:border-[#FF7A00]/50',
  },
  {
    name: '视频号', cn: '视频号',
    iconId: 'tencent',
    statusKey: 'marketing.landing.platforms.status_beta',
    statusFallback: '支持中',
    glow: 'radial-gradient(circle, rgba(7,193,96,0.55) 0%, transparent 70%)',
    tile: 'bg-gradient-to-br from-[#07C160] to-[#3DDC84]',
    ring: 'group-hover:border-[#07C160]/50',
  },
  {
    name: '百家号', cn: '百家号',
    iconId: 'baijiahao',
    statusKey: 'marketing.landing.platforms.status_beta',
    statusFallback: '支持中',
    glow: 'radial-gradient(circle, rgba(215,0,15,0.5) 0%, rgba(245,166,35,0.4) 70%, transparent 100%)',
    tile: 'bg-gradient-to-br from-[#D7000F] to-[#F5A623]',
    ring: 'group-hover:border-[#D7000F]/50',
  },
] as const

const PLATFORM_DOTS: ReadonlyArray<{ id: string; color: string }> = [
  { id: 'douyin',      color: '#ff0050' },
  { id: 'bilibili',    color: '#00a1d6' },
  { id: 'xiaohongshu', color: '#ff2442' },
  { id: 'kuaishou',    color: '#ff7a00' },
  { id: 'tencent',     color: '#07c160' },
  { id: 'baijiahao',   color: '#D7000F' },
]

function PlatformsSection() {
  const { t } = useTranslation()
  return (
    <section id="platforms" className="relative overflow-hidden border-b border-border/30 px-6 py-20 scroll-mt-24 sm:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 20% 30%, rgba(0,161,214,0.06), transparent 60%), radial-gradient(ellipse 50% 35% at 80% 70%, rgba(255,0,80,0.06), transparent 60%)',
        }}
      />

      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-[12px] font-medium tracking-[0.18em] text-muted-foreground/60 uppercase">
            {t('marketing.landing.platforms.eyebrow', '已支持平台')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('marketing.landing.platforms.title_1', '国内主流平台 ')}
            <span className="text-muted-foreground/50">
              {t('marketing.landing.platforms.title_2', '全覆盖')}
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            {t('marketing.landing.platforms.description', '抖音、B站、小红书、快手、视频号、百家号 —— 一次上传,同步触达。')}
          </p>
        </div>

        <div
          data-reveal-group
          className="mt-12 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6"
        >
          {PLATFORM_STRIP.map((p) => (
            <div
              key={p.name}
              data-reveal-cell
              className={`group relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border border-border/40 bg-card/40 p-5 text-center backdrop-blur-sm transition-all duration-300 ${p.ring} hover:bg-card/70 hover:shadow-xl hover:shadow-foreground/[0.06] hover:-translate-y-1`}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: p.glow, filter: 'blur(24px)' }}
              />

              <div className={`relative flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 ${p.tile}`}>
                <PlatformIcon
                  platform={p.iconId}
                  variant="dark"
                  className="h-8 w-8 shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                />
              </div>

              <div className="relative">
                <div className="text-[13px] font-semibold text-foreground">{p.cn}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">
                  {p.name}
                </div>
              </div>
              <span
                className={`relative rounded-full px-2 py-0.5 text-[9px] font-medium ${
                  p.statusKey === 'marketing.landing.platforms.status_mainline'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {t(p.statusKey, p.statusFallback)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2.5">
          {PLATFORM_DOTS.map((d) => (
            <span
              key={d.id}
              aria-hidden
              className="h-2 w-2 rounded-full transition-transform duration-200 hover:scale-150"
              style={{ backgroundColor: d.color }}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Section 3 — Features (Bento grid) ────────────────────────────────────

type BentoCard = {
  icon: typeof Send
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
  bullets?: ReadonlyArray<{ key: string; fallback: string }>
  mockup?: ReactNode
  className: string
}

function MiniPublishMockup() {
  return (
    <div className="mt-4 space-y-2">
      {[
        { cn: '抖音',   id: 'douyin',      done: true },
        { cn: 'B站',    id: 'bilibili',    done: true },
        { cn: '小红书', id: 'xiaohongshu', done: true },
      ].map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2"
        >
          <PlatformIcon platform={p.id} className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11px] font-medium text-foreground">{p.cn}</span>
          {p.done && (
            <CheckCircle2
              className="ml-auto h-3 w-3 shrink-0 text-[var(--status-success-fg)]"
              aria-hidden
            />
          )}
        </div>
      ))}
      <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2">
        <span className="text-[11px] font-medium text-foreground">同步发布</span>
        <Send className="h-3 w-3 text-primary" aria-hidden />
      </div>
    </div>
  )
}

function MiniScheduleMockup() {
  return (
    <div className="mt-4 space-y-2">
      {[
        { time: '12:00', cn: '抖音',   id: 'douyin' },
        { time: '18:00', cn: '小红书', id: 'xiaohongshu' },
        { time: '20:00', cn: '快手',   id: 'kuaishou' },
      ].map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/60 px-3 py-2"
        >
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {item.time}
          </span>
          <PlatformIcon platform={item.id} className="h-3 w-3 shrink-0" />
          <span className="text-[11px] font-medium text-foreground">{item.cn}</span>
        </div>
      ))}
    </div>
  )
}

function MiniAiMockup() {
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          AI 文案
        </span>
      </div>
      {[
        { cn: '抖音',   id: 'douyin',      text: '🔥 夏季新品首发...' },
        { cn: 'B站',    id: 'bilibili',    text: '【新品开箱】值得入手...' },
      ].map((item) => (
        <div
          key={item.id}
          className="rounded-lg border border-border/40 bg-background/60 px-3 py-2"
        >
          <div className="mb-1 flex items-center gap-1.5">
            <PlatformIcon platform={item.id} className="h-3 w-3 shrink-0" />
            <span className="text-[10px] font-medium text-foreground">{item.cn}</span>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">{item.text}</p>
        </div>
      ))}
    </div>
  )
}

function MiniAccountMockup() {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {[
        { group: '个人号',   count: 4 },
        { group: '品牌矩阵', count: 6 },
        { group: '客户代运营', count: 2 },
      ].map((g) => (
        <div
          key={g.group}
          className="rounded-lg border border-border/40 bg-background/60 px-3 py-2"
        >
          <span className="text-[11px] font-medium text-foreground">{g.group}</span>
          <span className="ml-2 font-mono text-[9px] tabular-nums text-muted-foreground/60">
            {g.count} 账号
          </span>
        </div>
      ))}
    </div>
  )
}

const BENTO_CARDS: ReadonlyArray<BentoCard> = [
  {
    icon: Send,
    titleKey: 'marketing.landing.features.publish.title',
    titleFallback: '批量发布到多平台',
    descriptionKey: 'marketing.landing.features.publish.description',
    descriptionFallback: '一次上传,选中账号组,同步发布到全网平台。',
    bullets: [
      { key: 'marketing.landing.features.publish.bullet_1', fallback: '账号组一键选取' },
      { key: 'marketing.landing.features.publish.bullet_2', fallback: '视频/图文混合' },
      { key: 'marketing.landing.features.publish.bullet_3', fallback: '进度即时回传' },
    ],
    mockup: <MiniPublishMockup />,
    className: 'lg:col-span-2',
  },
  {
    icon: CalendarClock,
    titleKey: 'marketing.landing.features.schedule.title',
    titleFallback: '定时发布',
    descriptionKey: 'marketing.landing.features.schedule.description',
    descriptionFallback: '预排到流量高峰,任务自动排队。',
    mockup: <MiniScheduleMockup />,
    className: 'lg:col-span-1',
  },
  {
    icon: Sparkles,
    titleKey: 'marketing.landing.features.ai.title',
    titleFallback: 'AI 文案生成',
    descriptionKey: 'marketing.landing.features.ai.description',
    descriptionFallback: '一键得到各平台适配标题与话题。',
    mockup: <MiniAiMockup />,
    className: 'lg:col-span-1',
  },
  {
    icon: Users,
    titleKey: 'marketing.landing.features.accounts.title',
    titleFallback: '账号组管理',
    descriptionKey: 'marketing.landing.features.accounts.description',
    descriptionFallback: '分组管理,登录态实时检测,过期即时提示。',
    bullets: [
      { key: 'marketing.landing.features.accounts.bullet_1', fallback: '二维码扫码登录' },
      { key: 'marketing.landing.features.accounts.bullet_2', fallback: '登录态检测' },
      { key: 'marketing.landing.features.accounts.bullet_3', fallback: '分组管理' },
    ],
    mockup: <MiniAccountMockup />,
    className: 'lg:col-span-2',
  },
]

function BentoCardBlock({ card }: { card: BentoCard }) {
  const { t } = useTranslation()
  const Icon = card.icon
  return (
    <div
      className="group flex h-full flex-col rounded-2xl border border-border/40 bg-card/40 p-6 transition-all duration-300 hover:border-primary/30 hover:bg-card/60 hover:shadow-xl hover:shadow-foreground/[0.04]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          {t(card.titleKey, card.titleFallback)}
        </h3>
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
        {t(card.descriptionKey, card.descriptionFallback)}
      </p>

      {card.bullets && (
        <ul className="mt-4 space-y-2 text-[13px] text-muted-foreground">
          {card.bullets.map((b) => (
            <li key={b.key} className="flex items-center gap-2">
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]"
                aria-hidden
              />
              <span>{t(b.key, b.fallback)}</span>
            </li>
          ))}
        </ul>
      )}

      {card.mockup}
    </div>
  )
}

function FeaturesSection() {
  const { t } = useTranslation()
  return (
    <section id="features" className="relative overflow-hidden border-b border-border/30 px-6 py-20 sm:py-28 scroll-mt-24">
      <DotGridBg className="opacity-[0.03]" />

      <div className="relative mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-[12px] font-medium tracking-[0.18em] text-muted-foreground/60 uppercase">
            {t('marketing.landing.features.eyebrow', '核心能力')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <SplitText dataAttr="data-text-segment">
              {t('marketing.landing.features.title_1', '4 件让人头疼的事')}
            </SplitText>
            <span className="text-muted-foreground/50">
              {t('marketing.landing.features.title_2', ',我们替你做了')}
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t('marketing.landing.features.description', '多平台切换、文案重复编写、定时排队、账号管理 —— 创作者日常消耗最大的 4 件事。')}
          </p>
        </div>

        <div
          data-reveal-group
          className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-3"
        >
          {BENTO_CARDS.map((card) => (
            <div key={card.titleKey} data-reveal-cell className={card.className}>
              <BentoCardBlock card={card} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Section 4 — How It Works (3-step flow) ────────────────────────────────

const STEPS = [
  {
    icon: Upload,
    step: '01',
    titleKey: 'marketing.landing.how.step_upload.title',
    titleFallback: '上传视频素材',
    descriptionKey: 'marketing.landing.how.step_upload.description',
    descriptionFallback: '拖入视频文件,填写标题与简介。AI 自动生成各平台适配文案。',
  },
  {
    icon: MousePointerClick,
    step: '02',
    titleKey: 'marketing.landing.how.step_select.title',
    titleFallback: '选择账号组',
    descriptionKey: 'marketing.landing.how.step_select.description',
    descriptionFallback: '按个人/团队/矩阵场景分组,勾选要发布的平台账号。',
  },
  {
    icon: Rocket,
    step: '03',
    titleKey: 'marketing.landing.how.step_publish.title',
    titleFallback: '一键发布或定时',
    descriptionKey: 'marketing.landing.how.step_publish.description',
    descriptionFallback: '立即同步发布,或预排到流量高峰时段,任务自动排队运行。',
  },
] as const

function HowItWorksSection() {
  const { t } = useTranslation()
  return (
    <section className="border-b border-border/30 px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-[12px] font-medium tracking-[0.18em] text-muted-foreground/60 uppercase">
            {t('marketing.landing.how.eyebrow', '使用流程')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('marketing.landing.how.title_1', '三步完成 ')}
            <span className="text-muted-foreground/50">
              {t('marketing.landing.how.title_2', '无需写代码')}
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t('marketing.landing.how.description', '从上传到发布,整个流程不到一分钟。')}
          </p>
        </div>

        <div
          data-reveal-group
          className="mt-14 grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8"
        >
          {STEPS.map((s) => (
            <div
              key={s.step}
              data-reveal-cell
              className="group relative flex flex-col items-center rounded-2xl border border-border/30 bg-card/30 p-8 text-center transition-all duration-300 hover:border-primary/20 hover:bg-card/60"
            >
              {/* Step number — `data-step-number` is the GSAP
                  counter target. `data-value` carries the parsed
                  integer (1, 2, 3) so the hook doesn't have to
                  know about the i18n label set. The static
                  `s.step` (e.g. "01") stays as the no-JS fallback
                  so search engines + reduced-motion visitors see
                  the canonical number, and the tween overwrites
                  it on first scroll. */}
              <span
                data-step-number
                data-value={s.step}
                className="bg-gradient-to-br from-primary/30 to-primary/10 bg-clip-text font-mono text-5xl font-bold tabular-nums text-transparent"
              >
                {/* Initial value is "00" so the counter tween
                    (0 → target) shows a smooth 00 → 01 / 02 / 03
                    count-up without a flash back from the
                    canonical step label. CSS `data-step-number`
                    styling is unaffected. */}
                00
              </span>
              <div className="mt-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                <s.icon className="h-6 w-6" aria-hidden />
              </div>
              <h3 className="mt-5 text-base font-semibold tracking-tight text-foreground">
                {t(s.titleKey, s.titleFallback)}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {t(s.descriptionKey, s.descriptionFallback)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Section 5 — CTA ──────────────────────────────────────────────────────

const TRUST_ITEMS = [
  { icon: Lock,   key: 'marketing.landing.cta.trust_private',        fallback: '数据归属您 · 不上云' },
  { icon: Zap,    key: 'marketing.landing.cta.trust_no_code',        fallback: '无需编写一行代码' },
  { icon: Clock,  key: 'marketing.landing.cta.trust_24x7',           fallback: '全天候自动运行' },
  { icon: Globe,  key: 'marketing.landing.cta.trust_full_coverage',  fallback: '全网平台全覆盖' },
] as const

function CtaSection() {
  const { t } = useTranslation()
  return (
    <section
      data-cta-section
      className="relative overflow-hidden border-b border-border/30 px-6 py-24 sm:py-32"
    >
      {/* Background stack tuned for maximum emphasis on the
          conversion copy (the reviewer's "still reads as plain
          text" feedback):
            1. MeshGradient intensity="dramatic" — 1.4× the area,
               +6% primary tint, 14s/18s/22s cadence vs the hero's
               18s/24s/28s. The faster cadence reads as "more
               active" without becoming visually noisy.
            2. CtaSpotlightGlow — 1100×1100 focused radial centered
               on the h2 via `top-1/2 -translate-y-1/2`. The
               `data-cta-glow` attribute links it to the existing
               GSAP CTA pulse (scale 1.08, opacity 0.75, 2.8s yoyo)
               so the spotlight "breathes" with the section.
            3. GlowOrb — the section-level soft top wash. Kept
               because it adds a 3rd depth layer; without it the
               section reads as "spotlight only" which feels
               narrow.
            4. DotGridBg — subtle texture (opacity 0.03) to
               ground the mesh blobs in real space. */}
      <MeshGradient intensity="dramatic" />
      <CtaSpotlightGlow />
      <GlowOrb />
      <DotGridBg className="opacity-[0.03]" />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-10 text-center">
        <div>
          <p className="text-[12px] font-medium tracking-[0.18em] text-muted-foreground/60 uppercase">
            {t('marketing.landing.cta.eyebrow', '开始使用')}
          </p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            <span data-text-segment className="inline-block">
              {t('marketing.landing.cta.title_1', '现在就把发布流水线')}
            </span>
            <span
              data-text-segment
              className="block bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"
            >
              {t('marketing.landing.cta.title_2', '交给工具')}
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t('marketing.landing.cta.description', '选好视频素材与发布账号组,定时任务自动排队运行。不用写代码,也不用研究浏览器插件。')}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          {/* Primary CTA carries BOTH `shimmer` (light sweep) and
              `cta-ring` (animated box-shadow halo). The two
              affordances stack on the same rendered <Link> via
              className concatenation; the shimmer is a `::before`
              overlay, the cta-ring is `box-shadow` — they paint
              on different layers, no z-index fight. */}
          <Button
            asChild
            size="lg"
            className="shimmer cta-ring h-12 px-8 text-sm font-semibold"
          >
            <Link to={ROUTES.dashboard.root}>
              {t('marketing.landing.cta.cta_primary', '立即开始使用 →')}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-12 px-8 text-sm font-medium">
            <Link to={ROUTES.public.pricing}>
              {t('marketing.landing.cta.cta_secondary', '查看定价')}
            </Link>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground/70">
          {TRUST_ITEMS.map(({ icon: Icon, key, fallback }) => (
            <div key={key} className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 text-primary/70" aria-hidden />
              <span>{t(key, fallback)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function LandingPage() {
  // Two motion hooks share the same root ref. useRevealStagger
  // owns the entrance choreography (data-hero-cell /
  // data-reveal-cell / data-hero-mockup fade-up). useVisitorMotion
  // owns the ambient + interactive layer on top (text segment
  // stagger, mockup float, mouse parallax, glow breathe, step
  // counter, CTA pulse). Both register with the same `scope` ref
  // via useGSAP, so order is irrelevant — useGSAP scopes by
  // ref, not by registration order.
  //
  // Renamed from useLandingMotion → useVisitorMotion in
  // round-unify-grammar: the hook is now also called from
  // PricingPage and AboutPage so the name reflected that.
  const motionRoot = useRevealStagger()
  useVisitorMotion(motionRoot)
  return (
    <div ref={motionRoot} className="min-h-screen w-full bg-background text-foreground">
      <MarketingTopBar />
      <main>
        <HeroSection />
        <PlatformsSection />
        <FeaturesSection />
        <HowItWorksSection />
        <CtaSection />
      </main>
      <MarketingFooter />
    </div>
  )
}
