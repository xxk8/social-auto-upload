import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/lib/i18n/useLocale'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

const NATIVE_LABEL: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  'en': 'English',
  'en-US': 'English',
}

/**
 * LocalePicker — visitor-facing chrome control, sibling of
 * `<ThemeToggle size="compact" />` in `<MarketingTopBar />`'s nav
 * cluster. Three commitments:
 *
 *  1. **Native-language labels** — "中文" / "English" (NOT "Chinese"
 *     / "English"). Localizing the picker is the only way to
 *     "speak the visitor's language first" rather than forcing them
 *     to read a translated-English label before they can read the
 *     picker. Project precedent: NOT in code yet, but applied in
 *     the architect's chrome-mockup review.
 *
 *  2. **Compact envelope** — `h-8 w-8 icon-only` matching the
 *     `<ThemeToggle size="compact" />` v5-chrome-consolidation.
 *     Saving 4-px vs `size="default"` keeps MarketingTopBar within
 *     its 320 px mobile chrome budget (`browser-use` 320×568
 *     validation per MarketingTopBar.tsx §"Round-OPT-chrome-
 *     responsive"). `aria-label` carries the accessible name so
 *     screen-readers hear "切换语言 / Switch language" rather
 *     than seeing the icon-only affordance with no descriptor.
 *
 *  3. **Active checkmark on the current locale** — a small ✓ glyph
 *     inside the active `<DropdownMenuItem>` (data-testid=
 *     `locale-option-<locale>` so e2e specs can scope). Mirrors
 *     the `<ThemeModesRadio>` checked-badge pattern in
 *     `features/preferences/shared/theme-modes.tsx`.
 */
export function LocalePicker() {
  const { t } = useTranslation()
  const { locale, setLocale } = useLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
          aria-label={t('locale.switch_label', 'Switch language')}
          data-testid="locale-picker-trigger"
          title={t('locale.switch_label', 'Switch language')}
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[180px]">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
          {t('locale.select_label', 'Select language')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LOCALES.map((loc) => {
          const active = locale === loc
          return (
            <DropdownMenuItem
              key={loc}
              onClick={() => setLocale(loc)}
              data-testid={`locale-option-${loc}`}
              data-active={active ? 'true' : undefined}
              className={cn(
                'cursor-pointer items-center gap-2.5',
                active && 'text-foreground font-medium',
              )}
            >
              <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">
                {active && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M2 5l2 2 4-4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span className="flex-1">{NATIVE_LABEL[loc]}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50">
                {loc}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
