import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/Components/ui/button'
import { BrandMark } from '@/Components/ui/brand-glyph'
import { ThemeToggle } from '@/Components/ThemeToggle'
import { SectionHeading } from '@/Components/ui/section-heading'
import { PricingTier } from '@/Components/ui/pricing-tier'
import type { PricingTierProps } from '@/Components/ui/pricing-tier'
import { PlatformIcon } from '@/Components/ui/platform-icon'
import { useScrollPast } from '@/lib/use-scroll-past'
import { useRevealStagger } from '@/lib/use-reveal-stagger'
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
//   • 3 tier cards with data-tier-card="personal"|"team"|"enterprise"
//   • Exactly 1 [data-tier-card][data-recommended="true"]
//   • Exactly 1 .tier-recommended-accent element
//   • "推荐" badge text visible
//   • TopBar cross-link from / to /pricing works
//   • Individual版 text visible (tier mount fingerprint)

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
      'AI 文案生成 (基础模型)',
      '定时发布 + 任务追踪',
      '本地部署 · 数据归属您',
    ],
    ctaLabel: '比较套餐 →',
    ctaTo: '/login/auth?plan=personal',
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
    ctaLabel: '比较套餐 →',
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
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--background),transparent_70%)] opacity-60" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        <div className="flex items-center justify-center gap-3">
          <BrandMark size="lg" />
          <span className="text-[15px] font-medium tracking-tight text-foreground">
            social-auto-upload
          </span>
        </div>
        <h1 className="mx-auto mt-8 max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          按你的运营规模 <span className="text-muted-foreground">选择套餐</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          从单兵创作者到大规模矩阵,都有合适的选择。所有版本均包含本地部署能力,数据始终归属您。
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/app">免费开始 →</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/login/auth?intent=contact">联系销售</Link>
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
    <section className="border-b border-border/40 px-6 py-16 sm:py-20">
      <div data-reveal-group className="mx-auto grid max-w-5xl grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-3">
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
          title="一套能力 · 任选你的规模"
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
            团队与企业 <span className="text-muted-foreground">专属能力</span>
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
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <SectionHeading
          variant="landing"
          eyebrow="开始使用"
          title="现在就选一个方向"
          description="我们会陪你把当前工作流梳理一遍,推荐最合适的版本,并提供 14 天试用 (以商务确认为准)。"
        />
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/login/auth?intent=contact">联系销售 →</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/app">免费开始</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-11 px-6 text-sm font-medium">
            <Link to="/">回到首页</Link>
          </Button>
        </div>
        <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 text-[12px] text-muted-foreground/80 sm:grid-cols-3">
          <div className="flex items-center justify-center gap-2">
            <Zap className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span>14 天试用</span>
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
          to="/pricing"
          aria-current={isActive('/pricing') ? 'page' : undefined}
          className={`transition-colors hover:text-foreground ${isActive('/pricing') ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          定价
        </Link>
        <Link
          to="/about"
          aria-current={isActive('/about') ? 'page' : undefined}
          className={`transition-colors hover:text-foreground ${isActive('/about') ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          关于
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
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <BrandMark size="sm" />
            <span>social-auto-upload</span>
          </div>
        </div>
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

export default function PricingPage() {
  const motionRoot = useRevealStagger()
  return (
    <div ref={motionRoot} className="min-h-screen w-full bg-background text-foreground">
      <TopBar />
      <main>
        <HeroSection />
        <TiersSection />
        <CommonFeaturesSection />
        <HighlightSection />
        <CtaSection />
      </main>
      <PageFooter />
    </div>
  )
}
