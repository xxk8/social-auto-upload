// ── MarketingFooter — single source of truth for the 5 visitor-facing
//    marketing surfaces (`/`, `/pricing`, `/hotlist`, `/about`, `/login`).
//
// Why this exists: before this component, each of the 5 marketing pages
// inlined its own `<footer>` with subtly different content + style:
//   • LandingPage's `资源` column listed 3 items (热榜 · 关于 · 登录).
//   • PricingPage / AboutPage / LoginPage's `资源` column listed 2
//     items (关于 · 登录 only).
//   • HotListPage didn't have a footer at all.
// This component locks BOTH the canonical content (3 columns × {产品[3],
// 资源[3], 账户[2]}, with 热榜 present) AND the canonical style
// (LandingPage's polished variant).
//
// Round-NT-28-i18n: FOOTER_COLS now stores i18n lookup keys + Chinese
// fallbacks. The component resolves each key via `t(...)` so the
// carousel of 5 marketing pages mirrors the chrome across locales.
// Per docs/dev/adr-i18n-invariant.md, the literal "social-auto-upload"
// wordmark stays UN-translated (it's a brand mark, comparable to e.g.
// "GitHub"); subtitle, copyright, and the 8 sitemap labels are
// localized through src/locales/{zh-CN,en-US}.json.

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES, type PublicRoute, type DashboardRoute } from '@/routes'
import { BrandMark } from '@/Components/ui/brand-glyph'

// Anchor links (e.g. `/#features`) aren't navigable routes — they're
// hash fragments that React Router treats as same-page scrolls. The
// `string & {}` escape hatch accepts them while keeping the union
// members visible for IDE autocomplete.
type FooterLinkTo = PublicRoute | DashboardRoute | (string & {})

const FOOTER_COLS = [
  {
    titleKey: 'marketing.footer.columns.product.title',
    labelFallback: '产品',
    links: [
      { labelKey: 'marketing.footer.columns.product.features', labelFallback: '功能', to: '/#features' as FooterLinkTo },
      { labelKey: 'marketing.footer.columns.product.platforms', labelFallback: '平台', to: '/#platforms' as FooterLinkTo },
      { labelKey: 'marketing.footer.columns.product.pricing', labelFallback: '定价', to: ROUTES.public.pricing },
    ],
  },
  {
    titleKey: 'marketing.footer.columns.resources.title',
    labelFallback: '资源',
    links: [
      { labelKey: 'marketing.footer.columns.resources.hotlist', labelFallback: '热榜', to: ROUTES.public.hotlist },
      { labelKey: 'marketing.footer.columns.resources.about', labelFallback: '关于', to: ROUTES.public.about },
      { labelKey: 'marketing.footer.columns.resources.login', labelFallback: '登录', to: ROUTES.public.login },
    ],
  },
  {
    titleKey: 'marketing.footer.columns.account.title',
    labelFallback: '账户',
    links: [
      { labelKey: 'marketing.footer.columns.account.console', labelFallback: '控制台', to: ROUTES.dashboard.root },
      { labelKey: 'marketing.footer.columns.account.plans', labelFallback: '定价方案', to: ROUTES.public.pricing },
    ],
  },
] as const

export default function MarketingFooter() {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-border/30 bg-muted/10 px-6 py-14">
      <div className="mx-auto max-w-5xl">
        {/* Brand row — wordmark stays as a brand literal. */}
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <BrandMark size="md" />
            <div>
              <span className="block text-lg font-bold tracking-tight text-foreground">
                social-auto-upload
              </span>
              <span className="text-[11px] text-muted-foreground/50">
                {t('marketing.footer.subtitle', '多平台视频自动发布工具')}
              </span>
            </div>
          </div>
        </div>

        {/* Sitemap — 3 columns × {labels}, each label resolved via t() */}
        <div className="mt-10 grid grid-cols-3 gap-8 sm:max-w-md">
          {FOOTER_COLS.map((col) => (
            <div key={col.titleKey}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                {t(col.titleKey, col.labelFallback)}
              </div>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.labelKey}>
                    <Link
                      to={link.to}
                      className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t(link.labelKey, link.labelFallback)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Copyright — localizable */}
        <div className="mt-10 border-t border-border/20 pt-5">
          <p className="text-[12px] text-muted-foreground/50">
            {t('marketing.footer.copyright', '© social-auto-upload. 保留所有权利.')}
          </p>
        </div>
      </div>
    </footer>
  )
}
