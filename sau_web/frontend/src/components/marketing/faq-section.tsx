import { useTranslation } from 'react-i18next'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'

// ── MarketingFaqSection — shared by the visitor surfaces ───────────────────
//
// Accordion-based FAQ between body content and the conversion CTA,
// functioning as final objection-handling. Lives at
// `@/components/marketing/` so /, /pricing, /about can render the same
// FAQ strip without redefining the i18n key set, the open-row tint,
// or the inner-3xl container.
//
// Uses the canonical `@/components/ui/accordion` (Radix wrapper) so
// keyboard nav, ARIA semantics, and the AnimateAccordion animation are
// inherited for free.
//
// `data-[state=open]:bg-primary/[0.04]` paints a 4%-primary tint on the
// open row so visitors see what's "active" without the row claiming
// full primary chrome (DESIGN.md: lavender is scarce).
//
// max-w-3xl (768px) so eye scans Q → A without re-orienting every line
// — Linear/Vercel FAQ panels sit on a narrow container for the same
// reason.
//
// `className` prop: lets dense pages like /hotlist override the outer
// padding (e.g. `py-12 sm:py-16`) when this section sits as a tight
// footer-appended block rather than a full-pitch closing. Marketing
// pages that use the default airy padding can simply omit the prop.

const FAQ_ITEMS = [
  {
    qKey: 'marketing.faq.q_1',
    qFallback: '我的账号安全吗?Cookie 会泄漏吗?',
    aKey: 'marketing.faq.a_1',
    aFallback: 'Cookie 和登录态完全保存在你的本地。系统不收集、不上传任何账号信息,所有发布动作都在你自己的电脑上执行。',
  },
  {
    qKey: 'marketing.faq.q_2',
    qFallback: '我完全不会写代码,能用吗?',
    aKey: 'marketing.faq.a_2',
    aFallback: '能。扫码登录平台账号 — 拖入视频 — 选择账号组 — 一键发布。一步都不需要看代码。',
  },
  {
    qKey: 'marketing.faq.q_3',
    qFallback: '支持哪些平台?短期内还会加吗?',
    aKey: 'marketing.faq.a_3',
    aFallback: '目前主线支持抖音、B 站、小红书、快手;视频号与百家号处于 Beta。TikTok 与 YouTube 在路线图。',
  },
  {
    qKey: 'marketing.faq.q_4',
    qFallback: 'Cookie 过期了怎么办?',
    aKey: 'marketing.faq.a_4',
    aFallback: '系统会定时检测登录态,过期前提前 24 小时提醒,重新扫码登录即可。所有平台均走标准二维码登录。',
  },
  {
    qKey: 'marketing.faq.q_5',
    qFallback: '视频文件会传到哪里?',
    aKey: 'marketing.faq.a_5',
    aFallback: '全部本地处理。除非你主动开启云端备份,视频文件不会离开你的电脑。',
  },
] as const

export function FaqSection({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <section
      className={cn(
        'relative border-b border-border/30 px-6 py-20 sm:py-28',
        className,
      )}
    >
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <p className="text-[12px] font-medium tracking-[0.18em] text-muted-foreground/60 uppercase">
            {t('marketing.faq.eyebrow', '常见问题')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('marketing.faq.title_1', '还有什么疑问?')}
          </h2>
        </div>

        <Accordion
          type="single"
          collapsible
          className="mt-12 overflow-hidden rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm"
        >
          {FAQ_ITEMS.map((item) => (
            <AccordionItem
              key={item.qKey}
              value={item.qKey}
              className="border-b border-border/30 px-6 last:border-b-0 transition-colors data-[state=open]:bg-primary/[0.04]"
            >
              <AccordionTrigger className="text-left text-[15px] font-semibold text-foreground hover:no-underline">
                {t(item.qKey, item.qFallback)}
              </AccordionTrigger>
              <AccordionContent className="text-[14px] leading-relaxed text-muted-foreground">
                {t(item.aKey, item.aFallback)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
