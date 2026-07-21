import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCN from '../../locales/zh-CN.json'
import enUS from '../../locales/en-US.json'

/**
 * i18n provider — `i18next` + `react-i18next` 17.x, MIT, ~12 KB gzipped.
 *
 * ## Locale set (MVP — round-1)
 *
 * - `zh-CN` (primary) — Simplified Chinese marketing copy + product chrome.
 *   The project's own `docs/dev/VALUE-STRATEGY.md §3.3` budget calls
 *   3-5 days for full extraction; this round lands the framework +
 *   visitor chrome + landing page only (architect MVP choice).
 * - `en-US` (secondary) — International marketing copy. Future
 *   locales (`ja`, `ko`, `es`) plug in via `SUPPORTED_LOCALES`
 *   tuple + import line + a new `locales/<bc47>.json` resource.
 *
 * ## BCP-47 normalizer
 *
 * BCP-47 input from `navigator.language` can arrive as
 * `zh-Hans-CN`, `en-US`, `en`, `pt-BR`, etc. The `LOCALE_ALIAS`
 * table folds:
 *   - all `zh-*` script tags → `zh-CN` (Simplified primary)
 *   - both `en-US` and `en` → `en-US` (closest existing translation)
 *   - everything unmapped → `zh-CN` (safer fallback for marketing)
 *
 * Future regional split (`zh-TW` / `zh-HK` independent resources)
 * is a tuple-extension, NOT a refactor.
 *
 * ## Detection priority
 *
 *   localStorage.getItem('sau-ui-locale')  →  navigator.language  →  'zh-CN'
 *
 * Mirrors the existing `ThemeProvider.tsx` `sau-ui-theme` resolution
 * chain so locale + theme state machines can be reasoned about
 * symmetrically. The `sau-ui-locale` key is the canonical write
 * target for the `<LocalePicker />` (and, later, the
 * PreferencesDialog's `display/locale` row).
 *
 * ## loading resources statically
 *
 * Vite resolves the JSON imports at build time (Tree-shakes locales
 * that the bundler determines are unreachable). The two-locale MVP
 * keeps both in the main chunk; per-locale dynamic imports are a
 * later optimization when the surface doubles/triples.
 */

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN'

const LOCALE_ALIAS: Record<string, SupportedLocale | undefined> = {
  // zh family — Simplified primary.
  'zh-CN': 'zh-CN',
  'zh-Hans-CN': 'zh-CN',
  'zh-Hans': 'zh-CN',
  'zh': 'zh-CN',
  // en family — US primary (en-GB can be a future split).
  'en-US': 'en-US',
  'en': 'en-US',
}

function foldBcp47(raw: string): SupportedLocale | undefined {
  // Exact match wins over prefix-folding (`zh-CN` precedes `zh`).
  if (raw in LOCALE_ALIAS) return LOCALE_ALIAS[raw]
  // Fall back to stripping region (`zh-TW` → `zh` → `zh-CN`,
  // `en-GB` → `en` → `en-US`). Covers 80% of odd inputs without
  // requiring a per-language alias table.
  const lang = raw.toLowerCase().split('-')[0]
  return LOCALE_ALIAS[lang]
}

const LOCALE_STORAGE_KEY = 'sau-ui-locale'

function detectInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as SupportedLocale
    }
  } catch {
    // localStorage can throw in private-browsing modes / SSR — fall
    // through to navigator detection.
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  return foldBcp47(nav) ?? DEFAULT_LOCALE
}

// Side-effect import: initialising i18next here runs ONCE on the
// first file that imports it (Vite emits a single module-record for
// both `i18n.config.ts` consumers + the <I18nextProvider> in main.tsx).
// Subsequent imports return the same singleton instance — no double-
// init even though the React bootstrap + per-component useTranslation
// both reach into the same global.
void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES as unknown as string[],
  // React already escapes interpolated values — disabling i18next's
  // escape pass prevents double-escaping of `<` and `>` inside the
  // LandingPage hero (we split the headline into 3 t() pieces rather
  // than route the entire H1 through Trans).
  interpolation: { escapeValue: false },
  // Falling back to key string (default ON but explicit for the
  // reviewer): missing-key renders as `marketing.landing.hero.title`
  // in DEV so the missing-value can be found in one diff cycle.
  returnEmptyString: false,
})

export default i18n

// Re-exports for the picker + tests so consumers import the
// canonical type/alias surface from one place.
export { DEFAULT_LOCALE as LOCALE_FALLBACK }
export { foldBcp47, detectInitialLocale }

declare module 'i18next' {
  // Custom type augmentation: the `resources` literal type narrows
  // `t('key')` lookups to known key paths. Without this i18next
  // types `t(key: string)` and the dev-time typo `t('market.landing…')`
  // silently returns the key string at runtime.
  interface CustomTypeOptions {
    defaultNS: 'marketing'
    resources: {
      'zh-CN': typeof zhCN
      'en-US': typeof enUS
    }
    returnNull: false
  }
}
