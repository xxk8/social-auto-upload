import { useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useSearchParams } from '@/lib/router/useSearchParams'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/ui/brand-glyph'
import MarketingFooter from '@/components/MarketingFooter'
import MarketingTopBar from '@/components/MarketingTopBar'
import { SectionHeading } from '@/components/ui/section-heading'
import { Stat } from '@/components/ui/stat'
import { PricingTier } from '@/components/ui/pricing-tier'
import type { PricingTierProps } from '@/components/ui/pricing-tier'
import { useRevealStagger } from '@/lib/use-reveal-stagger'
import { useAuth } from '@/features/auth/useAuth'
import { PricingComparison } from '@/components/ui/pricing-comparison'
import { ROUTES } from '@/routes'
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
//   • tiers:   4 [data-section-cell] (1 heading wrapper + 3 tier cards) — 4 档套餐
//   • cta:     2 [data-section-cell] (1 heading wrapper + 1 button row)
//   • Authed visitors redirect to /dashboard/publish (useEffect + early return)
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
    id: 'free',
    name: '免费版',
    tagline: '先尝鲜 · 零成本长期可用',
    price: '¥0',
    priceUnit: '永久免费',
    features: [
      '1 个平台账号',
      '每月 40 条发布额度',
      'AI 文案生成 (基础模型)',
      '定时发布 + 任务追踪',
    ],
    ctaLabel: '免费开始 →',
    ctaTo: '/pricing',
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
    ],
    ctaLabel: '开始试用 →',
    ctaTo: '/pricing',
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
      '数据看板 + 优先客服',
    ],
    ctaLabel: '立即订阅 →',
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
    ctaLabel: '联系销售 →',
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

export default function LoginPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  // Round-8 motion grammar: scoped ref for the GSAP reveal-stagger.
  const motionRoot = useRevealStagger()
  const [searchParams] = useSearchParams()

  // Round-13 redirect: authed visitors who land on /login (the
  // visitor pitch) bounce to their original destination, or
  // /dashboard/publish if none was preserved.
  //
  // Round-OPT-3F: when a 401 response interceptor triggered the
  // redirect (`reason=session_expired`), the original destination
  // is the page whose API just returned 401. Navigating back there
  // would immediately trigger the same 401 → creating a redirect
  // loop. Instead we redirect to /dashboard/publish — the user can
  // re-authenticate and then manually visit the original page.
  useEffect(() => {
    if (isAuthenticated) {
      const reason = searchParams.get('reason')
      const dest = reason === 'session_expired'
        ? '/dashboard/publish'
        : (searchParams.get('redirect') || '/dashboard/publish')
      navigate({ to: dest as never })
    }
  }, [isAuthenticated, navigate, searchParams])

  if (isAuthenticated) return null

  // Preserve `?plan=` / `?intent=` query params when forwarding to
  // /login/auth. Use `ROUTES.public.loginAuth` (not a string literal)
  // so the route manifest stays the source of truth — future renames
  // auto-propagate. The query-string suffix widens the result to `string`.
  const authHref = `${ROUTES.public.loginAuth}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`

  return (
    <div ref={motionRoot} className="min-h-screen w-full bg-background text-foreground">
      <MarketingTopBar />
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
          <div className="mx-auto mt-10 grid max-w-6xl grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-2 xl:grid-cols-4">
            {TIERS.map((t) => (
              <div data-section-cell key={t.id}>
                <PricingTier {...t} />
              </div>
            ))}
          </div>
          <div className="mt-12">
            <PricingComparison
              tiers={TIERS}
              eyebrow="功能对比"
              title="一表看清差异"
              description="横向对比四个版本的核心能力,绿色对勾代表包含,灰色叉号代表不包含。"
            />
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
              <Link to={ROUTES.public.pricing}>查看定价</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="h-11 px-6 text-sm font-medium">
              <Link to={ROUTES.public.landing}>回到首页</Link>
            </Button>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
