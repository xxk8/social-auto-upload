import { useEffect } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/Components/ui/button'
import { BrandMark } from '@/Components/ui/brand-glyph'
import { ThemeToggle } from '@/Components/ThemeToggle'
import { SectionHeading } from '@/Components/ui/section-heading'
import { Stat } from '@/Components/ui/stat'
import { PricingTier } from '@/Components/ui/pricing-tier'
import type { PricingTierProps } from '@/Components/ui/pricing-tier'
import { useScrollPast } from '@/lib/use-scroll-past'
import { useRevealStagger } from '@/lib/use-reveal-stagger'
import { useAuth } from '@/features/auth/useAuth'
import {
  Mail,
  ShieldCheck,
  Clock,
  ArrowRight,
  Send,
  CalendarClock,
  Users,
} from 'lucide-react'

// ── Visitor-facing login pitch (`/login`) ──────────────────────────────
//
// Raycast-inspired redesign: brand hero with login form preview mockup,
// stat row, tier comparison cards, dense footer. The actual auth form
// lives at the sub-route `/login/auth`; this page composes a marketing
// explanation of what the user gets when they sign in.
//
// E2E invariants (landing-pricing-attribution.spec.ts):
//   • /login returns HTTP 200
//   • 3 sections with data-section="mission"|"tiers"|"cta" (NO "scale")
//   • mission: 4 [data-section-cell] (1 heading wrapper + 3 stats)
//   • tiers:   4 [data-section-cell] (1 heading wrapper + 3 tier cards)
//   • cta:     2 [data-section-cell] (1 heading wrapper + 1 button row)
//   • Authed visitors redirect to /app/publish (useEffect + early return)
//   • authHref preserves ?plan= / ?intent= query params
//
// Lazy-loaded via App.tsx.

const MISSION_STATS: ReadonlyArray<{ value: string; caption: string }> = [
  { value: '邮箱登录',   caption: '验证码直发邮箱 · 不需密码' },
  { value: '60 秒',     caption: '验证码时效 · 限定窗口' },
  { value: '本地优先',   caption: '账号密码 · 不上传服务器' },
]

// Tier set mirrors PricingPage + /about for slug-identity (each emits
// the same `data-tier-card="personal|team|enterprise"`). CTAs differ
// from /pricing: /login's tier CTAs send the visitor to /pricing so
// they compare plans first.
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

// ── Login form preview mockup (Raycast "show the product" pattern) ────────
//
// Shows what the /login/auth form looks like — email + code step, so
// the visitor understands the flow before clicking through.

function LoginFormMockup() {
  return (
    <div
      data-hero-mockup
      className="mx-auto mt-14 max-w-sm overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg shadow-foreground/[0.03]"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-3 border-b border-border/40 bg-muted/30 px-4 py-2.5">
        <BrandMark size="sm" />
        <span className="text-[13px] font-medium tracking-tight text-foreground">
          登录
        </span>
      </div>

      {/* Form body */}
      <div className="space-y-4 p-6">
        {/* Email field */}
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-foreground">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            邮箱地址
          </div>
          <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/60 px-3 py-2.5">
            <span className="text-[13px] text-muted-foreground">creator@example.com</span>
            <span className="brand-cursor ml-auto h-3.5 w-px bg-primary" aria-hidden />
          </div>
        </div>

        {/* Send code button */}
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.06] px-4 py-2.5">
          <span className="text-[13px] font-medium text-foreground">发送验证码</span>
          <ArrowRight className="h-3.5 w-3.5 text-primary" aria-hidden />
        </div>

        {/* Security features */}
        <div className="space-y-2 border-t border-border/40 pt-4">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--status-success-fg)]" aria-hidden />
            <span>账号密码不上传服务器</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span>验证码 60 秒时效窗口</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Feature pills (compact icon + label for the mission section) ──────────

const FEATURE_PILLS: ReadonlyArray<{ icon: typeof Mail; label: string }> = [
  { icon: Send,          label: '批量发布' },
  { icon: CalendarClock, label: '定时发布' },
  { icon: Users,         label: '账号组管理' },
]

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
          to="/about"
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

const FOOTER_COLS: ReadonlyArray<{
  title: string
  links: ReadonlyArray<{ label: string; to: string }>
}> = [
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
]

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

export default function LoginPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  // Round-8 motion grammar: scoped ref for the GSAP reveal-stagger.
  const motionRoot = useRevealStagger()
  const [searchParams] = useSearchParams()

  // Round-13 redirect: authed visitors who land on /login (the
  // visitor pitch) bounce straight to /app/publish.
  useEffect(() => {
    if (isAuthenticated) navigate('/app/publish', { replace: true })
  }, [isAuthenticated, navigate])

  if (isAuthenticated) return null

  // Preserve `?plan=` / `?intent=` query params when forwarding to
  // /login/auth (the actual auth form lives at the new sub-route).
  const authHref = `/login/auth${searchParams.toString() ? `?${searchParams.toString()}` : ''}`

  return (
    <div ref={motionRoot} className="min-h-screen w-full bg-background text-foreground">
      <TopBar />
      <main>
        {/* ── Section 1 — Mission (hero with login form mockup) ─────────── */}
        <section data-section="mission" className="relative overflow-hidden border-b border-border/40 px-6 py-20 sm:py-24 scroll-mt-24">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--background),transparent_70%)] opacity-60" aria-hidden />
          <div className="relative mx-auto max-w-5xl text-center">
            <div className="flex items-center justify-center gap-3">
              <BrandMark size="lg" />
              <span className="text-[15px] font-medium tracking-tight text-foreground">
                social-auto-upload
              </span>
            </div>
            <div data-section-cell>
              <SectionHeading
                variant="landing"
                eyebrow="登录"
                title={
                  <>
                    登录到 <span className="text-muted-foreground">social-auto-upload</span>
                  </>
                }
                description="账号密码不上传服务器 · 验证码直发邮箱 · 60 秒时效窗口。一次登录,管控所有账号组。"
              />
            </div>

            {/* Stat row — E2E: mission section must have 4 [data-section-cell] total */}
            <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-10">
              {MISSION_STATS.map(({ value, caption }) => (
                <div data-section-cell key={value}>
                  <Stat value={value} caption={caption} variant="stack" size="sm" />
                </div>
              ))}
            </div>

            {/* Feature pills */}
            <div className="mt-8 flex items-center justify-center gap-3">
              {FEATURE_PILLS.map((p) => {
                const Icon = p.icon
                return (
                  <div
                    key={p.label}
                    className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/40 px-3 py-1.5"
                  >
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                    <span className="text-[12px] font-medium text-foreground">{p.label}</span>
                  </div>
                )
              })}
            </div>

            {/* Login form preview mockup */}
            <LoginFormMockup />
          </div>
        </section>

        {/* ── Section 2 — Tiers ──────────────────────────────────────────── */}
        <section data-section="tiers" className="border-b border-border/40 px-6 py-16 sm:py-20">
          <div data-section-cell>
            <SectionHeading
              variant="landing"
              eyebrow="还没选好套餐?"
              title="登录前 · 先看定价"
              description="从单兵创作者到大规模矩阵,都有合适的选择。完整对比请前往定价页。"
            />
          </div>
          <div className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-3">
            {TIERS.map((t) => (
              <div data-section-cell key={t.id}>
                <PricingTier {...t} />
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 3 — CTA ────────────────────────────────────────────── */}
        <section data-section="cta" className="px-6 py-20 sm:py-24">
          <div data-section-cell className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
            <SectionHeading
              variant="landing"
              eyebrow="继续"
              title="看完之后 · 准备登录"
              description="点击下方按钮进入验证码登录,或先回到首页了解产品全景。"
            />
          </div>
          <div data-section-cell className="mx-auto mt-6 flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
            <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
              <Link to={authHref}>立即登录 →</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 px-6 text-sm font-medium">
              <Link to="/pricing">查看定价</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="h-11 px-6 text-sm font-medium">
              <Link to="/">回到首页</Link>
            </Button>
          </div>
        </section>
      </main>
      <PageFooter />
    </div>
  )
}
