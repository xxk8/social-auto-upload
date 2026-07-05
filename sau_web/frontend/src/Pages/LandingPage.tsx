import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/Components/ui/button'
import { Badge } from '@/Components/ui/badge'
import { BrandMark } from '@/Components/ui/brand-glyph'
import { ThemeToggle } from '@/Components/ThemeToggle'
import { SectionHeading } from '@/Components/ui/section-heading'
import { Stat } from '@/Components/ui/stat'
import { PlatformIcon } from '@/Components/ui/platform-icon'
import { useScrollPast } from '@/lib/use-scroll-past'
import { useRevealStagger } from '@/lib/use-reveal-stagger'
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
  ShieldCheck,
} from 'lucide-react'

// ── Marketing landing page (`/`) ────────────────────────────────────────
//
// Visitor-facing product page for paying customers (创作者 / 矩阵运营 /
// MCN). Tone: outcome-first, productivity-focused, no developer jargon.
// Raycast-inspired design: product mockup hero, alternating feature rows
// with visual mockups, how-it-works flow, dense footer.
//
// Sections (5):
//   1. Hero       — brand + headline + CTAs + stat row + product mockup
//   2. Platforms  — 6 supported platforms with real icons + capability pills
//   3. Features   — 4 alternating rows with mini visual mockups (id="features")
//   4. HowItWorks — 3-step flow: 上传 → 选账号 → 发布
//   5. CTA        — single primary + confidence bullets
//
// E2E invariants (landing-pricing-attribution.spec.ts + marketing-routing-
// split.spec.ts):
//   • Exactly 3 [data-hero-cell] elements with specific stat values/captions
//   • section#features visible
//   • TopBar header has links 定价→/pricing, 登录→/login
//   • Footer visible, contains "social-auto-upload"
//   • Primary CTA link matching /立即开始/ with href="/app"

// ── Section primitives ───────────────────────────────────────────────────
//
// Two shared primitives live under `@/Components/ui/`:
//   • `SectionHeading` (round 5) — visitor-section title block.
//     Required `variant='landing' | 'dashboard'` enforces sans-eyebrow
//     for marketing surfaces and prevents future landing pages from
//     drifting back to the pre-polish mono cadence.
//   • `Stat` (round 7) — visitor-stat cell (Hero row / Pricing rate).
//     Required `caption` enforces subject · predicate attribution at the
//     type level so bare-number outcome claims cannot compile.

// ── Product Mockup (faux dashboard window for the hero) ──────────────────
//
// Raycast pattern: the product UI IS the hero visual. Built entirely with
// Tailwind — no screenshot dependency. Shows the publish interface:
// platform cards with real PlatformIcon + amber publish CTA.

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
      className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg shadow-foreground/[0.03]"
    >
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

      {/* Main content — publish interface */}
      <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[14px] font-semibold tracking-tight text-foreground">
              发布中心
            </span>
            <Badge variant="secondary" className="text-[10px]">
              4 个平台已选
            </Badge>
          </div>

          {/* Platform selection grid */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MOCKUP_PLATFORMS.map((p) => (
              <div
                key={p.platform}
                className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2"
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

          {/* Video info fields */}
          <div className="mb-4 space-y-2.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/60 px-3 py-2">
              <Video className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[12px] text-muted-foreground">夏季新品发布视频.mp4</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                2:34
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/60 px-3 py-2">
              <Type className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[12px] text-muted-foreground">夏季新品发布 · 限时优惠</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/60 px-3 py-2">
              <Hash className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[12px] text-muted-foreground">夏季新品 · 限时优惠 · 穿搭</span>
            </div>
          </div>

          {/* Amber publish CTA */}
          <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.06] px-4 py-3">
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
  )
}

// ── Section 1 — Hero ───────────────────────────────────────────────────
//
// Hero stat row uses 3× `<Stat variant="stack" size="sm">`. All 3 cells
// follow subject · predicate caption rhythm. The product mockup below
// the stats is the Raycast-style "show the product" hero visual.

function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-border/40">
      {/* Subtle radial gradient — the only background decoration allowed
          by the design system (no glass, no gradient fills, no pulse) */}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--background),transparent_70%)] opacity-60"
        aria-hidden
      />
      <div className="relative mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        {/* Brand lockup */}
        <div className="flex items-center justify-center gap-3">
          <BrandMark size="lg" />
          <span className="text-[15px] font-medium tracking-tight text-foreground">
            social-auto-upload
          </span>
        </div>

        {/* Headline — punchy, benefit-driven (Raycast cadence) */}
        <h1 className="mx-auto mt-8 max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          一条视频 · 一键分发到 6 个平台
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          上传视频,选中账号组,定时发布到抖音、B站、小红书、快手。
          不再每天切换 6 个 App、复制 6 次文案、盯 6 个发布状态。
        </p>

        {/* CTAs */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/app">立即开始 →</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
            <a href="#features">了解能力 →</a>
          </Button>
        </div>

        {/* 3 stat cells — E2E invariant: exactly 3 [data-hero-cell] */}
        <div className="mt-12 grid w-full max-w-3xl grid-cols-3 gap-6 sm:gap-10">
          <div data-hero-cell>
            <Stat value="6" caption="主流平台 · 已接入" />
          </div>
          <div data-hero-cell>
            <Stat value="3h+/day" caption="典型多账号 · 每天省下" />
          </div>
          <div data-hero-cell>
            <Stat value="不上云" caption="数据归属您 · 私有部署" />
          </div>
        </div>

        {/* Product mockup — the "show the product" hero visual */}
        <ProductMockup />
      </div>
    </section>
  )
}

// ── Section 2 — Platforms ────────────────────────────────────────────────

type PlatformCard = {
  name: string
  cn: string
  iconId: string
  capabilities: ReadonlyArray<'视频' | '图文' | '定时' | 'AI 文案'>
  status: 'mainline' | 'beta' | 'wip'
}

const PLATFORMS: ReadonlyArray<PlatformCard> = [
  { name: 'Douyin',    cn: '抖音',   iconId: 'douyin',      capabilities: ['视频', '图文', '定时', 'AI 文案'], status: 'mainline' },
  { name: 'Bilibili',  cn: 'B站',    iconId: 'bilibili',    capabilities: ['视频', '定时', 'AI 文案'],          status: 'mainline' },
  { name: '小红书',    cn: '小红书', iconId: 'xiaohongshu', capabilities: ['视频', '图文', '定时', 'AI 文案'], status: 'mainline' },
  { name: 'Kuaishou',  cn: '快手',   iconId: 'kuaishou',    capabilities: ['视频', '图文', '定时', 'AI 文案'], status: 'mainline' },
  { name: '视频号',    cn: '视频号', iconId: 'tencent',     capabilities: ['视频', '定时'],                     status: 'beta' },
  { name: '百家号',    cn: '百家号', iconId: 'baijiahao',   capabilities: ['视频', '定时'],                     status: 'beta' },
]

function PlatformCardBlock({ platform }: { platform: PlatformCard }) {
  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border/40 bg-card/40 p-5 transition-all duration-200 hover:border-foreground/30 hover:bg-card/80">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <PlatformIcon platform={platform.iconId} className="h-5 w-5 shrink-0" />
          <div className="flex items-baseline gap-2">
            <span className="text-base font-medium tracking-tight text-foreground">
              {platform.cn}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground/60">
              {platform.name}
            </span>
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {platform.status === 'mainline' ? '主线' : platform.status === 'beta' ? '支持中' : '筹备中'}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {platform.capabilities.map((cap) => (
          <span
            key={cap}
            className="rounded-md bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {cap}
          </span>
        ))}
      </div>
    </div>
  )
}

function PlatformsSection() {
  return (
    <section id="platforms" className="border-b border-border/40 px-6 py-20 sm:py-24 scroll-mt-24">
      <SectionHeading
        variant="landing"
        eyebrow="已支持平台"
        title={
          <>
            国内主流短视频与图文平台 <span className="text-muted-foreground">全覆盖</span>
          </>
        }
        description="抖音、B站、小红书、快手已进入主线;视频号、百家号持续完善中,带你多平台同时在线。"
      />
      <div data-reveal-group className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORMS.map((p) => (
          <div key={p.name} data-reveal-cell>
            <PlatformCardBlock platform={p} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Section 3 — Features (alternating rows with visual mockups) ──────────
//
// Raycast hybrid layout: text on one side, animated visual mockup on the
// other. Each row leads with an OUTCOME; technical surface is hidden.

type FeatureRow = {
  icon: typeof Send
  title: string
  description: string
  bullets: ReadonlyArray<string>
  mockup: ReactNode
}

// ── Mini mockup: batch publish flow ───────────────────────────────────────
function BatchPublishMockup() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-5">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
        选择账号组
      </div>
      <div className="space-y-2">
        {[
          { cn: '抖音',   id: 'douyin' },
          { cn: 'B站',    id: 'bilibili' },
          { cn: '小红书', id: 'xiaohongshu' },
          { cn: '快手',   id: 'kuaishou' },
        ].map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/60 px-3 py-2"
          >
            <PlatformIcon platform={p.id} className="h-4 w-4 shrink-0" />
            <span className="text-[12px] font-medium text-foreground">{p.cn}</span>
            <CheckCircle2
              className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]"
              aria-hidden
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2.5">
        <span className="text-[12px] font-medium text-foreground">同步发布</span>
        <Send className="h-3.5 w-3.5 text-primary" aria-hidden />
      </div>
    </div>
  )
}

// ── Mini mockup: scheduling timeline ──────────────────────────────────────
function ScheduleMockup() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-5">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
        定时队列
      </div>
      <div className="space-y-2.5">
        {[
          { time: '12:00', platform: 'douyin',      cn: '抖音',   status: '已排期' },
          { time: '12:00', platform: 'bilibili',    cn: 'B站',    status: '已排期' },
          { time: '18:00', platform: 'xiaohongshu', cn: '小红书', status: '流量高峰' },
          { time: '20:00', platform: 'kuaishou',    cn: '快手',   status: '流量高峰' },
        ].map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/60 px-3 py-2"
          >
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {item.time}
            </span>
            <PlatformIcon platform={item.platform} className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[12px] font-medium text-foreground">{item.cn}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/70">{item.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Mini mockup: AI copy generation ───────────────────────────────────────
function AiCopyMockup() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          AI 文案生成
        </span>
      </div>
      <div className="space-y-2.5">
        {[
          { platform: 'douyin',      cn: '抖音',   text: '🔥 夏季新品首发!穿搭灵感一秒get...' },
          { platform: 'bilibili',    cn: 'B站',    text: '【新品开箱】这个夏天值得入手的好物...' },
          { platform: 'xiaohongshu', cn: '小红书', text: '夏日穿搭分享 🌿 清凉又高级的搭配公式...' },
        ].map((item, i) => (
          <div
            key={i}
            className="rounded-lg border border-border/40 bg-background/60 px-3 py-2.5"
          >
            <div className="mb-1 flex items-center gap-2">
              <PlatformIcon platform={item.platform} className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-medium text-foreground">{item.cn}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Mini mockup: account group management ──────────────────────────────────
function AccountGroupMockup() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            账号组管理
          </span>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          3 组 · 12 账号
        </Badge>
      </div>
      <div className="space-y-2">
        {[
          { group: '个人号',   count: 4, iconIds: ['douyin', 'bilibili', 'xiaohongshu', 'kuaishou'] },
          { group: '品牌矩阵', count: 6, iconIds: ['douyin', 'bilibili', 'xiaohongshu', 'kuaishou', 'tencent', 'baijiahao'] },
          { group: '客户代运营', count: 2, iconIds: ['douyin', 'xiaohongshu'] },
        ].map((g) => (
          <div
            key={g.group}
            className="rounded-lg border border-border/40 bg-background/60 px-3 py-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-foreground">{g.group}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                {g.count} 账号
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {g.iconIds.map((id) => (
                <PlatformIcon key={id} platform={id} className="h-3.5 w-3.5" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--status-success-fg)]" aria-hidden />
        <span className="text-[11px] text-muted-foreground">登录态实时检测 · 过期即时提示</span>
      </div>
    </div>
  )
}

const FEATURE_ROWS: ReadonlyArray<FeatureRow> = [
  {
    icon: Send,
    title: '批量发布到多平台',
    description: '一次上传一条视频,选中账号组,即可同步发布到 6 个平台。一次运营,全自动到达。',
    bullets: ['账号组一键选取', '视频/图文混合发布', '进度即时回传'],
    mockup: <BatchPublishMockup />,
  },
  {
    icon: CalendarClock,
    title: '定时发布与流量预热',
    description: '把发布时间预排到流量高峰。任务自动排队,你只需要选好素材,设定出发时间。',
    bullets: ['小时级定时', '任务列表实时刷新', '失败自动提示原因'],
    mockup: <ScheduleMockup />,
  },
  {
    icon: Sparkles,
    title: 'AI 一键生成多平台文案',
    description: '上传完一条视频,即可同步得到 6 套适配各平台风格的标题、简介与话题候选文案。',
    bullets: ['多模型切换', '一次生成多套候选', '保留润色空间'],
    mockup: <AiCopyMockup />,
  },
  {
    icon: Users,
    title: '账号组管理 · 状态一目了然',
    description: '按个人/团队/矩阵场景给账号分组,登录态、有效期、最近发布都集中在一个仪表盘。',
    bullets: ['分组管理', '二维码扫码登录', '过期即时提示'],
    mockup: <AccountGroupMockup />,
  },
]

function FeatureRowBlock({ feature, index }: { feature: FeatureRow; index: number }) {
  const Icon = feature.icon
  // Alternate layout: even index = text left, mockup right; odd = reversed
  const textLeft = index % 2 === 0
  return (
    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
      {/* Text side */}
      <div className={textLeft ? 'lg:order-1' : 'lg:order-2'}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/40 bg-card/60">
            <Icon className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
            0{index + 1}
          </span>
        </div>
        <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {feature.title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {feature.description}
        </p>
        <ul className="mt-5 space-y-2 text-[13px] text-muted-foreground">
          {feature.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <CheckCircle2
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]"
                aria-hidden
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Mockup side */}
      <div className={textLeft ? 'lg:order-2' : 'lg:order-1'}>
        {feature.mockup}
      </div>
    </div>
  )
}

function FeaturesSection() {
  return (
    <section id="features" className="border-b border-border/40 px-6 py-20 sm:py-24 scroll-mt-24">
      <SectionHeading
        variant="landing"
        eyebrow="能力"
        title="4 件让人头疼的事,我们替你做了"
        description="多平台切换、文案重复编写、定时排队、账号管理 —— 这是创作者日常消耗最大的 4 件事。"
      />
      <div className="mx-auto mt-14 max-w-5xl space-y-16 sm:space-y-20">
        {FEATURE_ROWS.map((f, i) => (
          <div key={f.title} data-reveal-cell>
            <FeatureRowBlock feature={f} index={i} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Section 4 — How It Works (3-step flow) ────────────────────────────────

const STEPS = [
  {
    icon: Upload,
    step: '01',
    title: '上传视频素材',
    description: '拖入视频文件,填写标题与简介。AI 自动生成各平台适配文案。',
  },
  {
    icon: MousePointerClick,
    step: '02',
    title: '选择账号组',
    description: '按个人/团队/矩阵场景分组,勾选要发布的平台账号。',
  },
  {
    icon: Rocket,
    step: '03',
    title: '一键发布或定时',
    description: '立即同步发布,或预排到流量高峰时段,任务自动排队运行。',
  },
] as const

function HowItWorksSection() {
  return (
    <section className="border-b border-border/40 px-6 py-20 sm:py-24">
      <SectionHeading
        variant="landing"
        eyebrow="使用流程"
        title={
          <>
            三步完成多平台发布 <span className="text-muted-foreground">无需写代码</span>
          </>
        }
        description="从上传到发布,整个流程不到一分钟。不用研究浏览器插件,不用编写脚本。"
      />
      <div data-reveal-group className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8">
        {STEPS.map((s) => (
          <div key={s.step} data-reveal-cell className="relative">
            {/* Connector line — only between steps on desktop */}
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-card/60">
                <s.icon className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <span className="mt-4 font-mono text-[11px] tabular-nums text-muted-foreground/50">
                {s.step}
              </span>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-foreground">
                {s.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {s.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Section 5 — CTA ──────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <SectionHeading
          variant="landing"
          eyebrow="开始使用"
          title="现在就把发布流水线交给工具"
          description="选好视频素材与发布账号组,定时任务自动排队运行。不用写代码,也不用研究浏览器插件。"
        />
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/app">立即开始使用 →</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/pricing">查看定价</Link>
          </Button>
        </div>
        <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 text-[12px] text-muted-foreground/80 sm:grid-cols-3">
          <div className="flex items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success-fg)]" aria-hidden />
            <span>数据归属您 · 不上云</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success-fg)]" aria-hidden />
            <span>无需编写一行代码</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success-fg)]" aria-hidden />
            <span>全天候自动运行</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Page composition ────────────────────────────────────────────────────

function TopBar() {
  // Round-8 motion grammar: TopBar bottom hairline flips from neutral
  // `--border` → sodium amber once the user scrolls past the Hero.
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
          to="/pricing"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          定价
        </Link>
        <Link
          to="/about"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          关于
        </Link>
        <Link
          to="/login"
          className="text-muted-foreground transition-colors hover:text-foreground"
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

export default function LandingPage() {
  // Round-8 motion grammar: scoped ref for the GSAP reveal-stagger.
  const motionRoot = useRevealStagger()
  return (
    <div ref={motionRoot} className="min-h-screen w-full bg-background text-foreground">
      <TopBar />
      <main>
        <HeroSection />
        <PlatformsSection />
        <FeaturesSection />
        <HowItWorksSection />
        <CtaSection />
      </main>
      <PageFooter />
    </div>
  )
}
