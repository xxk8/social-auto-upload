import { useTranslation } from 'react-i18next'
import { Quote } from 'lucide-react'
import { DotGridBg } from '@/components/motion/visitor-decor'
import { cn } from '@/lib/utils'

// ── MarketingTestimonialsSection — shared by the visitor surfaces ──────────
//
// Lives at `@/components/marketing/` so the marketing pages
// (/, /pricing, /hotlist, /about, /login) can render the same
// social-proof strip without re-declaring the testimonial data,
// the avatar palette, or the lavender-tinted background. Originally
// inline in LandingPage; extracted in the 5-page-alignment round so
// future testimonial additions land in 1 place instead of 4.
//
// DESIGN.md testimonial-card spec: bg=surface-1, text=ink, padding=32 (xl),
// rounded=lg (12px), body-lg (18/400). We use 15px / relaxed line-height
// so card heights line up with adjacent bento cells — body-lg would push
// the trio taller than the bento cards above and break the rhythm.
//
// Lavender tints at three magnitudes (15% / 11% / 7%) so the 3 avatars
// read as a deliberate gradient of "voice" rather than 3 identical badges.
// Per DESIGN.md don't-rule: no second chromatic accent; tints are linear
// alpha-interp outputs of the same primary hue.
//
// `className` prop: lets dense pages like /hotlist override the outer
// padding (e.g. `py-12 sm:py-16`) when this section sits as a tight
// footer-appended block rather than a full-pitch closing. Marketing
// pages that use the default airy padding can simply omit the prop.

const TESTIMONIALS = [
  {
    quoteKey: 'marketing.testimonials.quote_1',
    quoteFallback: '以前我一天要花 3 小时手动发布到 5 个平台,现在定时队列直接把视频放上去,我可以专心做内容。',
    nameKey: 'marketing.testimonials.author_1_name',
    nameFallback: 'M',
    roleKey: 'marketing.testimonials.author_1_role',
    roleFallback: '个人创作者',
    accent: 'bg-primary/15 text-primary',
  },
  {
    quoteKey: 'marketing.testimonials.quote_2',
    quoteFallback: '管理 12 个账号组,过去需要 4 个运营同事。现在一个就能搞定,出错还有 Cookie 过期提前提醒。',
    nameKey: 'marketing.testimonials.author_2_name',
    nameFallback: 'L',
    roleKey: 'marketing.testimonials.author_2_role',
    roleFallback: '矩阵运营',
    accent: 'bg-primary/[0.11] text-primary/95',
  },
  {
    quoteKey: 'marketing.testimonials.quote_3',
    quoteFallback: '我们工作室运营 80+ 账号,sau 是唯一靠谱的工具 — 不卡登录态、不卡验证码、不卡视频上传。',
    nameKey: 'marketing.testimonials.author_3_name',
    nameFallback: 'Y',
    roleKey: 'marketing.testimonials.author_3_role',
    roleFallback: '内容工作室合伙人',
    accent: 'bg-primary/[0.07] text-primary/85',
  },
] as const

function TestimonialCard({
  quote,
  name,
  role,
  accent,
}: {
  quote: string
  name: string
  role: string
  accent: string
}) {
  return (
    <div className="group flex h-full flex-col rounded-lg border border-border/40 bg-card p-8 transition-all duration-300 hover:border-primary/30 hover:bg-card/60">
      {/* Quote glyph at primary/30 so it reads as a decorative affordance,
          not a chromatic break. Lucide Quote sized to 20px for proportionality
          with the 15px quote body. */}
      <Quote className="h-5 w-5 text-primary/30" aria-hidden />
      <p className="mt-4 flex-1 text-[15px] leading-relaxed text-foreground/90">
        &ldquo;{quote}&rdquo;
      </p>
      {/* Footer — hairline-top divider + Avatar circle (initial) + Role label.
          Avatar uses {rounded.full} (DESIGN.md radii token: 9999px) at 36px
          (h-9 w-9). Role text in foreground to carry the visual weight of
          "who said this" — name initial stays in the avatar so we don't
          duplicate the first-name twice on the same row. */}
      <div className="mt-6 flex items-center gap-3 border-t border-border/30 pt-5">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold ${accent}`}
        >
          {name}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">
            {role}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TestimonialsSection({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <section
      className={cn(
        'relative overflow-hidden border-b border-border/30 px-6 py-20 sm:py-28',
        className,
      )}
    >
      <DotGridBg className="opacity-[0.025]" />

      <div className="relative mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-[12px] font-medium tracking-[0.18em] text-muted-foreground/60 uppercase">
            {t('marketing.testimonials.eyebrow', '用户反馈')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('marketing.testimonials.title_1', '创作者的真实声音')}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[12px] tracking-wider text-muted-foreground/50">
            {t('marketing.testimonials.subtitle', '示例反馈 · 真实场景')}
          </p>
        </div>

        {/* data-reveal-* hooks are picked up by useRevealStagger so the 3
            cards fade-up in sequence on scroll (same hook that animates
            the bento grid and the platform tiles). */}
        <div
          data-reveal-group
          className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-3"
        >
          {TESTIMONIALS.map((item) => (
            <div key={item.nameKey} data-reveal-cell>
              <TestimonialCard
                quote={t(item.quoteKey, item.quoteFallback)}
                name={t(item.nameKey, item.nameFallback)}
                role={t(item.roleKey, item.roleFallback)}
                accent={item.accent}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
