import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, type SupportedLocale } from './config'

const LOCALE_STORAGE_KEY = 'sau-ui-locale'

/**
 * Locale hook — thin wrapper around `i18next.changeLanguage` that
 * also synchronises `localStorage` so the next page-boot reuses the
 * picker selection without re-running `navigator.language` detection.
 *
 * ## Why a hook at all
 *
 * `useTranslation()` already exposes `i18n` (the change-language call
 * site). The wrapper adds three things the raw `i18n` doesn't give us:
 *
 *   1. **Strictly-typed `locale` getter** — `i18n.language` is typed
 *      `string` because i18next doesn't know our `SupportedLocale`
 *      union. The hook returns a narrowed literal, so consumers
 *      `locale === 'zh-CN'` narrow in `switch`/`if` ladders.
 *
 *   2. **`localStorage` write** — `i18next` itself has built-in
 *      detection (we configure it via `detectInitialLocale` at boot)
 *      but does NOT persist user choice. Without the write, picking
 *      `en-US` from the picker would reset to `navigator.language`
 *      on the next page load.
 *
 *   3. **A `setLocale` that's pure functional** — no race with
 *      i18next's internal pending state (we await the change and
 *      then write; the await ensures the React tree has re-rendered
 *      with the new locale BEFORE localStorage is touched, so a
 *      crash mid-flip leaves the picker selection + storage in
 *      sync rather than "I picked x, displayed y, crashed to z").
 */
export function useLocale() {
  const { i18n } = useTranslation()
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(i18n.language)
    ? (i18n.language as SupportedLocale)
    : ('zh-CN' as SupportedLocale)

  const setLocale = useCallback(
    async (next: SupportedLocale) => {
      await i18n.changeLanguage(next)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
        } catch {
          // localStorage can be read-only in private browsing — the
          // locale change still reflects for the rest of the session.
        }
      }
    },
    [i18n],
  )

  return { locale, setLocale }
}
