import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/Components/ui/button'
import { Badge } from '@/Components/ui/badge'
import { BrandMark } from '@/Components/ui/brand-glyph'
import { ThemeToggle } from '@/Components/ThemeToggle'
import { SectionHeading } from '@/Components/ui/section-heading'
import { Stat } from '@/Components/ui/stat'
import { PricingTier } from '@/Components/ui/pricing-tier'
import type { PricingTierProps } from '@/Components/ui/pricing-tier'
import { PlatformIcon } from '@/Components/ui/platform-icon'
import { useScrollPast } from '@/lib/use-scroll-past'
import { useRevealStagger } from '@/lib/use-reveal-stagger'
import {
  Send,
  ShieldCheck,
  Server,
  CalendarClock,
  Zap,
  RefreshCw,
  Video,
  Monitor,
} from 'lucide-react'

// ── Visitor-facing about surface (`/about`) ────────────────────────────
//
// NOT the same About as the operator PreferencesDialog's
// <AboutTab /> at `features/preferences/tabs/AboutTab.tsx`. They
// look coincidentally related (both render brand + version/credits
// metadata) but they are intentionally disjoint:
//   • `Pages/AboutPage.tsx` (THIS FILE) — public marketing surface
//     at `/about`. Composed from visitor primitives (SectionHeading
//     + Stat + PricingTier) for anonymous visitors — no auth gate,
//     no dialog state.
//   • `features/preferences/tabs/AboutTab.tsx` — modal tab inside
//     the operator PreferencesDialog. Triggered from the AppShell
//     footer <UserMenu /> ← <PreferencesDialogProvider />. Routed
//     through `usePreferencesDialog().openPreferences('about')`.
// A future PR that tries to unify them (e.g. "just import AboutTab
// from `features/preferences/` into `/about`") would silently
// re-introduce the dialog dependency into the public visitor
// surface — DON'T. The cross-ref keeps the boundary explicit.
//
// Raycast-inspired redesign: brand hero + product scope mockup,
// iconified scale stat cards, reveal-staggered tier cards, dense footer.
//
// Sections (4, every section carries `data-section=<name>`):
//   1. mission — Brand hero + SectionHeading + 3-cell stat row +
//      ProjectScopeMockup (mini dashboard showing the platform matrix).
//   2. scale   — SectionHeading + 3-cell iconified stat cards.
//   3. tiers   — Reuses the canonical 3-tier PricingTier set.
//   4. cta     — SectionHeading + confidence bullets + back/forward CTAs.
//
// E2E invariants (landing-pricing-attribution.spec.ts):
//   • section[data-section="mission"] → 4 [data-section-cell]
//   • section[data-section="scale"]   → 4 [data-section-cell]
//   • section[data-section="tiers"]   → 4 [data-section-cell]
//   • section[data-section="cta"]     → 2 [data-section-cell]
//
// Lazy-loaded via App.tsx.

const MISSION_STATS: ReadonlyArray<{ value: string; caption: string }> = [
  { value: '私有部署', caption: '数据归属您 · 不上云' },
  { value: '稳定可靠', caption: '持续更新 · 安全维护' },
  { value: '专业支持', caption: '企业方案 · 定制交付' },
]

// ── Mini mockup: project scope / platform matrix ──────────────────────────
// Shows the multi-platform publish scope — the "what this tool covers"
// visual that Raycast-style about pages use to show product breadth.

function ProjectScopeMockup() {
  return (
    <div className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg shadow-foreground/[0.03]">
      {/* Window chrome bar */}
      <div className="flex items-center gap-3 border-b border-border/40 bg-muted/30 px-4 py-2.5">
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

      {/* Body — platform coverage matrix */}
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[14px] font-semibold tracking-tight text-foreground">
            平台覆盖矩阵
          </span>
          <Badge variant="secondary" className="text-[10px]">
            6 平台 · 持续扩展
          </Badge>
        </div>

        {/* Platform grid with capability pills */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { id: 'douyin',      cn: '抖音',   caps: ['视频', '图文', '定时'] },
            { id: 'bilibili',    cn: 'B站',    caps: ['视频', '定时'] },
            { id: 'xiaohongshu', cn: '小红书', caps: ['视频', '图文', '定时'] },
            { id: 'kuaishou',    cn: '快手',   caps: ['视频', '图文', '定时'] },
            { id: 'tencent',     cn: '视频号', caps: ['视频', '定时'] },
            { id: 'baijiahao',   cn: '百家号', caps: ['视频', '定时'] },
          ].map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/60 px-3 py-2.5"
            >
              <PlatformIcon platform={p.id} className="h-4 w-4 shrink-0" />
              <span className="text-[12px] font-medium text-foreground">{p.cn}</span>
              <div className="ml-auto flex gap-1">
                {p.caps.map((cap) => (
                  <span
                    key={cap}
                    className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Summary bar */}
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.06] px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <Video className="h-3.5 w-3.5 text-primary" aria-hidden />
            一条视频 · 同步分发
          </span>
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
            <Send className="h-3.5 w-3.5" aria-hidden />
            6 平台
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Section 1 — Mission (brand hero + stats + mockup) ────────────────────

function MissionSection() {
  return (
    <section
      data-section="mission"
      className="relative overflow-hidden border-b border-border/40 scroll-mt-24"
    >
      {/* Subtle radial gradient — same allowed decoration as LandingPage */}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--background),transparent_70%)] opacity-60"
        aria-hidden
      />
      <div className="relative px-6 py-20 text-center sm:py-24">
        {/* Brand lockup */}
        <div className="flex items-center justify-center gap-3">
          <BrandMark size="lg" />
          <span className="text-[15px] font-medium tracking-tight text-foreground">
            social-auto-upload
          </span>
        </div>

        {/* Heading cell */}
        <div data-section-cell className="mx-auto mt-8 max-w-3xl">
          <SectionHeading
            variant="landing"
            eyebrow="为什么做这个项目"
            title={
              <>
                把繁琐重复的事 <span className="text-muted-foreground">交给脚本</span>
              </>
            }
            description="social-auto-upload 是一个为视频创作者 / 矩阵运营 / MCN 设计的多平台自动发布工具。我们相信:内容分发的繁琐工作不该消耗创作者的主要精力。"
          />
        </div>

        {/* 3 stat cells — attribution-rhythm format */}
        <div className="mx-auto mt-12 grid w-full max-w-3xl grid-cols-3 gap-6 sm:gap-10">
          {MISSION_STATS.map(({ value, caption }) => (
            <div data-section-cell key={value}>
              <Stat value={value} caption={caption} variant="stack" size="sm" />
            </div>
          ))}
        </div>

        {/* Product scope mockup */}
        <ProjectScopeMockup />
      </div>
    </section>
  )
}

// ── Section 2 — Scale (iconified stat cards) ──────────────────────────────

type ScaleCard = {
  icon: typeof Server
  value: string
  caption: string
  detail: string
}

const SCALE_CARDS: ReadonlyArray<ScaleCard> = [
  {
    icon: Monitor,
    value: '6',
    caption: '主流平台 · 已覆盖',
    detail: '抖音 · B站 · 小红书 · 快手 · 视频号 · 百家号,持续适配跟进',
  },
  {
    icon: CalendarClock,
    value: '7×24h',
    caption: '定时发布 · 自动运行',
    detail: '预排流量高峰时段,任务自动排队,无需人工值守',
  },
  {
    icon: Server,
    value: '100%',
    caption: '部署位置 · 本地部署',
    detail: '数据归属您,不上云,完整离线可用,企业数据安全无忧',
  },
]

function ScaleSection() {
  return (
    <section data-section="scale" className="border-b border-border/40 px-6 py-16 sm:py-20">
      {/* Heading cell */}
      <div data-section-cell>
        <SectionHeading
          variant="landing"
          eyebrow="项目活跃度"
          title={
            <>
              持续迭代 <span className="text-muted-foreground">稳定可靠</span>
            </>
          }
          description="产品每周持续迭代,6 大平台适配器持续打磨,保障多账号发布流程稳定可靠。"
        />
      </div>

      {/* 3 iconified stat cards */}
      <div data-reveal-group className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {SCALE_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.value}
              data-section-cell
              data-reveal-cell
              className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card/40 p-5 transition-all duration-200 hover:border-foreground/30 hover:bg-card/80"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/40 bg-background/60">
                <Icon className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <Stat value={card.value} caption={card.caption} variant="stack" size="sm" />
              <p className="text-[12px] leading-relaxed text-muted-foreground/80">
                {card.detail}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Section 3 — Tiers (reveal-staggered tier cards) ───────────────────────
//
// Reuses the canonical 3-tier PricingTier set with the SAME id slugs
// (personal / team / enterprise) as PricingPage, so each data-tier-card
// lands on /about identically to /pricing. CTAs point at /pricing
// (not /login?plan=…) — double-bounce avoidance: a /about visitor that
// clicks "查看详情 →" should see the full /pricing comparison.

const TIERS: ReadonlyArray<PricingTierProps> = [
  {
    id: 'personal',
    name: '个人版',
    tagline: '单兵创作者日常发布',
    price: '¥0',
    priceUnit: '永久免费',
    features: [
      '最多接入 3 个平台账号',
      '每月 30 条发布额度',
      '定时发布 + 任务追踪',
      '本地部署 · 数据归属您',
    ],
    ctaLabel: '比较套餐 →',
    ctaTo: '/pricing',
  },
  {
    id: 'team',
    name: '团队版',
    tagline: 'MCN / 矩阵运营的最佳选择',
    price: '¥199',
    priceUnit: '/ 月',
    features: [
      '最多接入 12 个平台账号',
      '不限发布次数',
      'AI 文案生成 (多模型切换)',
      '账号组管理 + 多人协作',
      '定时发布 + 失败自动重试',
      '本地部署 · 数据归属您',
    ],
    ctaLabel: '比较套餐 →',
    ctaTo: '/pricing',
    highlight: true,
    badgeText: '推荐',
  },
  {
    id: 'enterprise',
    name: '企业版',
    tagline: '大规模矩阵 · 私有化交付',
    price: '联系销售',
    priceUnit: '定制方案',
    features: [
      '不限账号数',
      '不限发布次数',
      '多团队 + 角色权限',
      '支持私有化部署 / 定制开发',
    ],
    ctaLabel: '比较套餐 →',
    ctaTo: '/pricing',
  },
]

function TiersSection() {
  return (
    <section data-section="tiers" className="border-b border-border/40 px-6 py-16 sm:py-20">
      {/* Heading cell */}
      <div data-section-cell>
        <SectionHeading
          variant="landing"
          eyebrow="三档可选"
          title={
            <>
              按你的运营规模 <span className="text-muted-foreground">决定套餐</span>
            </>
          }
          description="从单兵创作者到大规模矩阵,都有合适的选择。完整的对比与价格请前往定价页。"
        />
      </div>

      {/* 3 tier cards — reveal-staggered */}
      <div data-reveal-group className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-3">
        {TIERS.map((t) => (
          <div data-section-cell data-reveal-cell key={t.id}>
            <PricingTier {...t} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Section 4 — CTA (confidence bullets + back/forward CTAs) ──────────────

function CtaSection() {
  return (
    <section data-section="cta" className="px-6 py-20 sm:py-24">
      {/* Heading cell */}
      <div data-section-cell className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <SectionHeading
          variant="landing"
          eyebrow="继续"
          title={
            <>
              看完之后 <span className="text-muted-foreground">挑一个方向</span>
            </>
          }
          description="回到首页了解产品全景,或者前往定价页直接挑选最匹配的套餐。"
        />
      </div>

      {/* Button row cell */}
      <div data-section-cell className="mx-auto mt-6 flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
        <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
          <Link to="/pricing">查看定价 →</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
          <Link to="/">回到首页</Link>
        </Button>
      </div>

      {/* Confidence bullets — same pattern as LandingPage/PricingPage CTA */}
      <div className="mx-auto mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 text-[12px] text-muted-foreground/80 sm:grid-cols-3">
        <div className="flex items-center justify-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span>无需编写一行代码</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--status-success-fg)]" aria-hidden />
          <span>数据归属您 · 不上云</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span>持续维护 · 安全更新</span>
        </div>
      </div>
    </section>
  )
}

// ── Chrome: TopBar ────────────────────────────────────────────────────────

function TopBar() {
  const location = useLocation()
  const isActive = (path: string) => location.pathname === path
  const past = useScrollPast(80)
  return (
    <header
      className={`sticky top-0 z-50 flex h-14 items-center justify-between bg-background/85 px-6 backdrop-blur-xl transition-colors duration-200 ${
        past ? 'border-b border-primary/45' : 'border-b border-border/40'
      }`}
    >
      <Link to="/" className="flex items-center gap-2.5">
        <BrandMark size="sm" />
        <span className="text-[14px] font-medium tracking-tight text-foreground">
          social-auto-upload
        </span>
      </Link>
      <div className="flex items-center gap-5 text-[13px] font-medium">
        <Link
          to="/"
          className={`transition-colors hover:text-foreground ${isActive('/') ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          首页
        </Link>
        <Link
          to="/about"
          aria-current={isActive('/about') ? 'page' : undefined}
          className={`transition-colors hover:text-foreground ${isActive('/about') ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          关于
        </Link>
        <Link
          to="/pricing"
          aria-current={isActive('/pricing') ? 'page' : undefined}
          className={`transition-colors hover:text-foreground ${isActive('/pricing') ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          定价
        </Link>
        <Link
          to="/login"
          aria-current={isActive('/login') ? 'page' : undefined}
          className={`transition-colors hover:text-foreground ${isActive('/login') ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          登录
        </Link>
        <ThemeToggle />
      </div>
    </header>
  )
}

// ── Dense footer (Raycast pattern: categorized sitemap) ──────────────────

const FOOTER_COLS = [
  {
    title: '产品',
    links: [
      { label: '功能', to: '/#features' },
      { label: '平台', to: '/#platforms' },
      { label: '定价', to: '/pricing' },
    ],
  },
  {
    title: '资源',
    links: [
      { label: '关于', to: '/about' },
      { label: '登录', to: '/login' },
    ],
  },
  {
    title: '账户',
    links: [
      { label: '控制台', to: '/app' },
      { label: '定价方案', to: '/pricing' },
    ],
  },
] as const

function PageFooter() {
  return (
    <footer className="border-t border-border/40 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Brand row */}
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <BrandMark size="sm" />
            <span>social-auto-upload</span>
          </div>
        </div>
        {/* Dense sitemap */}
        <div className="mt-8 grid grid-cols-3 gap-6 sm:max-w-md">
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {col.title}
              </div>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  )
}

// ── Page composition ────────────────────────────────────────────────────

export default function AboutPage() {
  const motionRoot = useRevealStagger()
  return (
    <div ref={motionRoot} className="min-h-screen w-full bg-background text-foreground">
      <TopBar />
      <main>
        <MissionSection />
        <ScaleSection />
        <TiersSection />
        <CtaSection />
      </main>
      <PageFooter />
    </div>
  )
}
