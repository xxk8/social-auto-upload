import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/ui/brand-glyph'
import MarketingFooter from '@/components/MarketingFooter'
import MarketingTopBar from '@/components/MarketingTopBar'
import { SectionHeading } from '@/components/ui/section-heading'
import { PricingTier } from '@/components/ui/pricing-tier'
import type { PricingTierProps } from '@/components/ui/pricing-tier'
import { PlatformIcon } from '@/components/ui/platform-icon'
import { PricingComparison } from '@/components/ui/pricing-comparison'
import { TestimonialsSection } from '@/components/marketing/testimonials-section'
import { FaqSection } from '@/components/marketing/faq-section'
import { useRevealStagger } from '@/lib/use-reveal-stagger'
import { useVisitorMotion } from '@/lib/use-visitor-motion'
import { MeshGradient } from '@/components/motion/MeshGradient'
import { SplitText } from '@/components/motion/SplitText'
import { GlowOrb, DotGridBg, CtaSpotlightGlow } from '@/components/motion/visitor-decor'
import { ROUTES } from '@/routes'
import {
  CheckCircle2,
  Send,
  CalendarClock,
  Sparkles,
  Users,
  ShieldCheck,
  Zap,
  Server,
  RefreshCw,
} from 'lucide-react'

// ── Visitor-facing pricing surface (`/pricing`) ───────────────────────────
//
// Raycast-inspired redesign: brand hero, styled tier cards, iconified
// common-features grid, alternating highlight rows with mini mockups,
// dense footer. Same engineering-tool aesthetic per DESIGN.md.
//
// E2E invariants (landing-pricing-attribution.spec.ts):
//   • /pricing returns HTTP 200
//   • 4 tier cards with data-tier-card="free"|"personal"|"team"|"enterprise"
//   • Exactly 1 [data-tier-card][data-recommended="true"]
//   • Exactly 1 .tier-recommended-accent element
//   • "推荐" badge text visible
//   • TopBar cross-link from / to /pricing works
//   • 免费版 text visible (tier mount fingerprint)

const TIERS: ReadonlyArray<PricingTierProps> = [
  {
    id: 'free',
    name: '免费版',
    tagline: '先尝鲜 · 零成本长期可用',
    price: '¥0',
    priceUnit: '永久免费',
    features: [
      '1 个平台账号',
      '每月 40 条发布额度',
      '定时发布 + 任务追踪',
      '本地部署 · 数据归属您',
      '升级专业版解锁 AI 内容生成 + 图片素材搜索',
    ],
    ctaLabel: '免费开始 →',
    ctaTo: '/login/auth?plan=free',
  },
  {
    id: 'personal',
    name: '个人版',
    tagline: '单兵创作者效率之选',
    price: '¥39',
    priceUnit: '/ 月',
    priceMeta: '年付 ¥399/年 ≈ ¥33/月',
    trial: '14 天免费试用',
    features: [
      '5 个平台账号',
      '每月 200 条发布额度',
      'AI 文案生成 (高级模型)',
      '账号组管理 + 数据统计面板',
      '定时发布 + 失败自动重试',
      '优先客服支持',
      '本地部署 · 数据归属您',
    ],
    ctaLabel: '开始试用 →',
    ctaTo: '/login/auth?plan=personal',
  },
  {
    id: 'team',
    name: '团队版',
    tagline: 'MCN / 矩阵运营的最佳选择',
    price: '¥199',
    priceUnit: '/ 月',
    priceMeta: '年付 ¥1999/年 ≈ ¥167/月',
    trial: '14 天免费试用',
    features: [
      '12 个平台账号',
      '不限发布次数',
      'AI 文案生成 (多模型切换)',
      '账号组管理 + 多人协作',
      '定时发布 + 失败自动重试',
      '数据看板 + 优先客服',
      '本地部署 · 数据归属您',
    ],
    ctaLabel: '立即订阅 →',
    ctaTo: '/login/auth?plan=team',
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
      'AI 文案生成 (私有模型可选)',
      '多团队 + 角色权限',
      'SSO / SCIM / 审计日志',
      '支持私有化部署 / 定制开发',
    ],
    ctaLabel: '联系销售 →',
    ctaTo: '/login/auth?plan=enterprise',
  },
]

// ── Common features with icons (replaces bare bullet list) ────────────────

const COMMON_FEATURES: ReadonlyArray<{
  icon: typeof Send
  title: string
  description: string
}> = [
  { icon: Send,          title: '批量发布',          description: '一条视频同步到 6 个平台' },
  { icon: CalendarClock, title: '定时发布',          description: '预排流量高峰,自动排队' },
  { icon: Users,         title: '账号组管理',        description: '按场景分组,一目了然' },
  { icon: Sparkles,      title: 'AI 文案生成',       description: '多平台适配,一键多套' },
  { icon: ShieldCheck,   title: '本地部署',          description: '数据归属您,不上云' },
  { icon: RefreshCw,     title: '持续维护',          description: '安全更新,平台适配跟进' },
]

// ── Tier highlight rows (alternating text + mockup, like LandingPage) ────

// ── Mini mockup: team plan dashboard preview ──────────────────────────────
function TeamDashboardMockup() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            团队工作台
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
          12 账号 · 3 协作者
        </span>
      </div>
      <div className="space-y-2">
        {[
          { group: '品牌矩阵 A', count: 4, ids: ['douyin', 'bilibili', 'xiaohongshu', 'kuaishou'] },
          { group: '品牌矩阵 B', count: 3, ids: ['douyin', 'bilibili', 'xiaohongshu'] },
          { group: '客户代运营',  count: 5, ids: ['douyin', 'bilibili', 'xiaohongshu', 'kuaishou', 'tencent'] },
        ].map((g) => (
          <div key={g.group} className="rounded-lg border border-border/40 bg-background/60 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-foreground">{g.group}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">{g.count} 账号</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {g.ids.map((id) => (
                <PlatformIcon key={id} platform={id} className="h-3.5 w-3.5" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Mini mockup: enterprise scale preview ─────────────────────────────────
function EnterpriseScaleMockup() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Server className="h-4 w-4 text-primary" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          私有化部署
        </span>
      </div>
      <div className="space-y-2.5">
        {[
          { label: '部署方式',   value: '本地服务器 / 私有云' },
          { label: '账号上限',   value: '不限' },
          { label: '角色权限',   value: '多团队 · 多角色' },
          { label: '安全合规',   value: 'SSO · 审计日志' },
          { label: '定制开发',   value: '支持' },
        ].map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-2">
            <span className="text-[12px] text-muted-foreground">{item.label}</span>
            <span className="text-[12px] font-medium text-foreground">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const HIGHLIGHT_ROWS: ReadonlyArray<{
  icon: typeof Send
  title: string
  description: string
  bullets: ReadonlyArray<string>
  mockup: ReactNode
}> = [
  {
    icon: Users,
    title: '团队版 · 矩阵运营利器',
    description: '12 个平台账号不限发布次数,多人协作管理账号组,AI 文案多模型切换,失败自动重试。',
    bullets: ['不限发布次数', '多人协作', 'AI 多模型切换', '失败自动重试'],
    mockup: <TeamDashboardMockup />,
  },
  {
    icon: Server,
    title: '企业版 · 私有化交付',
    description: '不限账号规模,多团队角色权限,SSO/SCIM 集成,审计日志,支持定制开发与私有化部署。',
    bullets: ['不限账号数', '多团队 · 角色权限', 'SSO / 审计日志', '定制开发支持'],
    mockup: <EnterpriseScaleMockup />,
  },
]

// ── Section: Hero ───────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section
      data-hero-section
      className="relative overflow-hidden border-b border-border/40"
    >
      {/* Background stack — mirrors LandingPage HeroSection:
            1. MeshGradient intensity="normal" — depth layer
            2. GlowOrb — 600×600 breathing radial (data-glow-orb)
            3. DotGridBg — subtle dot pattern
          Same design-system grammar across /, /pricing, /about. */}
      <MeshGradient intensity="normal" />
      <GlowOrb />
      <DotGridBg />
      <div className="relative mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        <div className="flex items-center justify-center gap-3">
          <BrandMark size="lg" />
          <span className="text-[15px] font-medium tracking-tight text-foreground">
            social-auto-upload
          </span>
        </div>
        {/* Pulsing-dot badge — same `badge-dot-pulse` rhythm
            LandingPage uses in its hero badge. Anchors the
            design-system identity across visitor surfaces. */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/30 px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground backdrop-blur-sm">
            <span
              className="badge-dot-pulse h-1.5 w-1.5 rounded-full bg-primary"
              aria-hidden
            />
            本地部署 · 14 天免费试用 · 免费版永久免费
          </div>
        </div>
        {/* mt-6 (not mt-8) — the badge above accounts for the
            gap between the brand lockup and the h1. Keeps the
            badge→h1 rhythm tight. */}
        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          {/* Manual `data-text-segment` spans (NOT `<SplitText>`)
              — SplitText splits on whitespace, which gives 1
              word for whitespace-less Chinese strings. Manual
              spans work for both zh-CN (no whitespace) and
              en-US (whitespace) translations without
              tokenization cost. Same pattern is used in
              AboutPage — see comment there. */}
          <span data-text-segment className="inline-block">按你的运营规模</span>{' '}
          <span data-text-segment className="inline-block text-muted-foreground">选择套餐</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          从单兵创作者到大规模矩阵,都有合适的选择。所有版本均包含本地部署能力,数据始终归属您。
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to={ROUTES.dashboard.root}>免费开始 →</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to={ROUTES.public.loginAuth as never}>联系销售</Link>
          </Button>
        </div>
        {/* Platform strip — shows the 6 supported platforms */}
        <div className="mt-12 flex items-center justify-center gap-4">
          {['douyin', 'bilibili', 'xiaohongshu', 'kuaishou', 'tencent', 'baijiahao'].map((p) => (
            <PlatformIcon key={p} platform={p} className="h-6 w-6 opacity-60" />
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Section: Tier cards ──────────────────────────────────────────────────

function TiersSection() {
  return (
    // `data-no-parallax` opts this section out of
    // `useVisitorMotion`'s ambient section parallax. The tier
    // cards are data-dense (prices, account counts, features)
    // — a continuously scrubbing -24px translate would shift
    // the prices as the user reads. Narrative sections
    // (CommonFeatures, Highlight, Cta) keep the default
    // ambient parallax.
    <section data-no-parallax className="border-b border-border/40 px-6 py-16 sm:py-20">
      <div data-reveal-group className="mx-auto grid max-w-6xl grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-2 xl:grid-cols-4">
        {TIERS.map((t) => (
          <div key={t.name} data-reveal-cell>
            <PricingTier {...t} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Section: Common features (iconified grid) ────────────────────────────

function CommonFeaturesSection() {
  return (
    <section className="border-b border-border/40 px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <SectionHeading
          variant="landing"
          eyebrow="所有版本均包含"
          title={
            // `<SplitText mode="char">` for char-level stagger
            // reveal (round-unify-grammar tuning). A single
            // `<span data-text-segment>` had no stagger because
            // there's only 1 element; with 13 char spans, the
            // 0.12s default stagger gives a ~1.4s cascading
            // reveal. Trade-off: longer reveal than LandingPage's
            // 0.24s 3-piece hero h1, but the section is mid-page
            // so a slower reveal reads as more deliberate.
            <SplitText dataAttr="data-text-segment" mode="char">
              一套能力 · 任选你的规模
            </SplitText>
          }
          description="不论哪个版本,都包含产品核心 4 件套 (批量发布 / 定时 / AI 文案 / 账号组管理) 与本地部署能力。"
        />
        <div data-reveal-group className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMMON_FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                data-reveal-cell
                className="flex flex-col gap-2 rounded-xl border border-border/40 bg-card/40 p-5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/40 bg-background/60">
                  <Icon className="h-4 w-4 text-primary" aria-hidden />
                </div>
                <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
                  {f.title}
                </h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {f.description}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ── Section: Highlight rows (alternating text + mockup) ──────────────────

function HighlightRow({ row, index }: { row: typeof HIGHLIGHT_ROWS[number]; index: number }) {
  const Icon = row.icon
  const textLeft = index % 2 === 0
  return (
    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
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
          {row.title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {row.description}
        </p>
        <ul className="mt-5 space-y-2 text-[13px] text-muted-foreground">
          {row.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]" aria-hidden />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={textLeft ? 'lg:order-2' : 'lg:order-1'}>
        {row.mockup}
      </div>
    </div>
  )
}

function HighlightSection() {
  return (
    <section className="border-b border-border/40 px-6 py-20 sm:py-24">
      <SectionHeading
        variant="landing"
        eyebrow="版本亮点"
        title={
          <>
            <span data-text-segment className="inline-block">团队与企业</span>{' '}
            <span data-text-segment className="inline-block text-muted-foreground">专属能力</span>
          </>
        }
        description="当你的运营规模成长,团队版和企业版提供更强大的协作与管理能力。"
      />
      <div className="mx-auto mt-14 max-w-5xl space-y-16 sm:space-y-20">
        {HIGHLIGHT_ROWS.map((row, i) => (
          <div key={row.title} data-reveal-cell>
            <HighlightRow row={row} index={i} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Section: CTA ──────────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section
      data-cta-section
      className="relative overflow-hidden px-6 py-20 sm:py-24"
    >
      {/* Background stack — mirrors LandingPage CtaSection:
            1. MeshGradient intensity="dramatic" — 1.4× area,
               +6% primary tint, faster cadence
            2. CtaSpotlightGlow — 1100×1100 focused radial
               centered on the h2 (data-cta-glow for 2.8s
               yoyo pulse)
            3. GlowOrb — soft top wash
            4. DotGridBg — subtle texture */}
      <MeshGradient intensity="dramatic" />
      <CtaSpotlightGlow />
      <GlowOrb />
      <DotGridBg className="opacity-[0.03]" />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <SectionHeading
          variant="landing"
          eyebrow="开始使用"
          title={
            // `<SplitText mode="char">` for char-level stagger
            // reveal (round-unify-grammar tuning). 8 char spans
            // × 0.12s = ~0.84s cascading reveal. Sits inside the
            // dramatic-CTA section so the extra reveal length
            // matches the section's "Conversion Zone" pacing.
            <SplitText dataAttr="data-text-segment" mode="char">
              就现在选一个方向
            </SplitText>
          }
          description="我们会陪你把当前工作流梳理一遍,推荐最合适的版本。付费版均含 14 天免费试用,免费版永久可用。"
        />
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          {/* Primary CTA carries both `shimmer` (light sweep)
              and `cta-ring` (animated box-shadow halo) — same
              design-system affordance as LandingPage. */}
          <Button
            asChild
            size="lg"
            className="shimmer cta-ring h-11 px-6 text-sm font-medium"
          >
            <Link to={"/login/auth" as never}>联系销售 →</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/dashboard">免费开始</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to={ROUTES.public.landing}>回到首页</Link>
          </Button>
        </div>
        <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 text-[12px] text-muted-foreground/80 sm:grid-cols-3">
          <div className="flex items-center justify-center gap-2">
            <Zap className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span>付费版 14 天免费试用</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--status-success-fg)]" aria-hidden />
            <span>免费版永久免费</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span>数据归属您 · 不上云</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function PricingPage() {
  // Two motion hooks share the same root ref. useRevealStagger
  // owns the entrance choreography (data-reveal-cell /
  // data-reveal-group fade-up). useVisitorMotion owns the
  // ambient + interactive layer on top (text-segment reveal,
  // glow breathe, CTA pulse, section ambient parallax).
  // Renamed from useLandingMotion → useVisitorMotion in
  // round-unify-grammar: /pricing and /about now share the
  // same hook so the 3 visitor surfaces feel like one design
  // system.
  const motionRoot = useRevealStagger()
  useVisitorMotion(motionRoot)
  return (
    <div ref={motionRoot} className="min-h-screen w-full bg-background text-foreground">
      <MarketingTopBar />
      <main>
        <HeroSection />
        <TiersSection />
        <PricingComparison tiers={TIERS} />
        <CommonFeaturesSection />
        <TestimonialsSection />
        <HighlightSection />
        <FaqSection />
        <CtaSection />
      </main>
      <MarketingFooter />
    </div>
  )
}
