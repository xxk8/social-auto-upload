// ──────────────────────────────────────────────────────────────────────────
// features/preferences/shared/theme-modes.ts
//
// Shared registry + component for the dialog's only real interactive
// surface (theme picker). Lives in `features/preferences/shared/`
// because the index.ts barrel exclusion-list (`shared/{payments,
// themes,InfoRow}`) explicitly anticipated a `themes` helper as an
// internal-but-cohabiting module — it just didn't exist yet before
// round-OPT-3G+ (this PR). The slice-hierarchy invariant is
// preserved: this module is NOT re-exported from
// `@/features/preferences` barrel (consumers reach the picker via
// `<PersonalizationTab />` or `<OverviewTab />`, NOT via
// `@/features/preferences/shared/theme-modes` directly).
//
// Source-of-truth (round-OPT-3G+):
//   • THEMES                — canonical list of ThemeMeta rows
//   • ThemeModesRadio        — single component shared across tabs
//
// Why pull this out (instead of duplicating across two tabs):
//   • Round-OPT-3G+ added OverviewTab which renders the SAME picker
//     inline so the operator can change theme without a tab nav.
//     Duplicating `<div role="radiogroup">…</div>` + `onKeyDown` +
//     width padding across two tabs would diverge in 2-3 subtle
//     ways within a quarter — keyboard handler, ARIA wiring, future
//     theme additions. Single component rules that out.
//   • Matches the existing Account/SettingsTab + UpgradeBanner
//     pattern (TIER_MAP is referenced by both the route body and
//     the banner helper — same source-of-truth discipline).
//
// On `eslint-disable react-refresh/only-export-components`:
// `THEMES` is a registry constant, not a React component. The rule
// is configured per-directory to allow this kind of file-paired
// export (see openspec/config.yaml). We do NOT need the eslint-
// disable banner here — this file exports one React component and
// one constant, both of which are Fast-Refresh compliant payloads.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { Theme } from '@/Components/ThemeProvider.helpers'
import { cn } from '@/lib/utils'

/** Single source of truth for the 3 light/dark/system theme rows. */
export interface ThemeMeta {
  id: Theme
  label: string
  description: string
  Icon: typeof Sun
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  { id: 'light', label: '浅色', description: '明亮背景 · 适合日间使用', Icon: Sun },
  { id: 'dark', label: '深色', description: '深色背景 · 长时间阅读更舒适', Icon: Moon },
  { id: 'system', label: '跟随系统', description: '由操作系统外观自动切换', Icon: Monitor },
]

interface ThemeModesRadioProps {
  theme: Theme
  setTheme: (next: Theme) => void
  /**
   * Visual density: `default` (px-4 py-4) is the canonical
   * PersonalizationTab padding. `compact` (px-3 py-3) is the denser
   * variant for in-place usage in surface-tight cards (OverviewTab).
   * Both share the same keyboard contract + ARIA wiring.
   */
  size?: 'default' | 'compact'
  /**
   * `data-testid` for the radiogroup root. Default =
   * `personalization-theme-modes` (preserves the existing test
   * contract). OverviewTab overrides to `overview-theme-modes`
   * so tests can scope assertions to a specific surface.
   */
  testId?: string
  /**
   * Hide the explanatory caption ("engineering aesthetic — accent
   * fixed sodium-amber…") below the radios. Default = show
   * (PersonalizationTab uses it for full disclosure). OverviewTab
   * hides it because the Overview surface IS the at-a-glance
   * wrapper and the caption belongs on the full Personalization
   * page only.
   */
  hideCaption?: boolean
}

export function ThemeModesRadio({
  theme,
  setTheme,
  size = 'default',
  testId = 'personalization-theme-modes',
  hideCaption = false,
}: ThemeModesRadioProps) {
  // WAI-ARIA APG radioset keyboard contract: ArrowDown/ArrowUp + ArrowRight/ArrowLeft
  // all cycle the selection with circular wrap; auto-activation
  // (focus follows selection). Memoized so a re-render with the
  // same theme doesn't re-create the closure.
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown'
      ) {
        return
      }
      e.preventDefault()
      const currentIdx = THEMES.findIndex(({ id }) => id === theme)
      const direction =
        e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
      const nextIdx = (currentIdx + direction + THEMES.length) % THEMES.length
      setTheme(THEMES[nextIdx].id)
      const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      )
      buttons[nextIdx]?.focus()
    },
    [theme, setTheme],
  )

  const padClass = size === 'compact' ? 'px-3.5 py-3.5' : 'px-4 py-4'
  const gapClass = size === 'compact' ? 'gap-3' : 'gap-4'

  return (
    <>
      <div
        className={cn('grid grid-cols-1 sm:grid-cols-3', gapClass)}
        role="radiogroup"
        aria-label="主题模式"
        data-testid={testId}
        onKeyDown={onKeyDown}
      >
        {THEMES.map(({ id, label, description, Icon }) => {
          const selected = theme === id
          const labelId = `theme-label-${id}`
          const descId = `theme-desc-${id}`
          return (
            <button
              key={id}
              role="radio"
              aria-checked={selected}
              aria-labelledby={labelId}
              aria-describedby={descId}
              data-testid={`theme-mode-${id}`}
              onClick={() => setTheme(id)}
              className={cn(
                'group relative flex flex-col items-start gap-2.5 rounded-xl border text-left transition-all duration-200 outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                padClass,
                selected
                  ? 'border-primary/50 ring-1 ring-primary/25 bg-primary/[0.06] shadow-sm'
                  : 'border-border/50 hover:border-border hover:bg-muted/40 hover:shadow-sm',
              )}
            >
              {/* Selected checkmark badge — top-right corner, fades in
                  with the card's selected state. Reads as a confidence
                  tick rather than a fill block. */}
              {selected && (
                <span
                  aria-hidden
                  className="absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    className="shrink-0"
                  >
                    <path
                      d="M2 5l2 2 4-4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                    selected
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted/60 text-muted-foreground group-hover:text-foreground/80',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span
                  id={labelId}
                  className={cn(
                    'text-sm transition-colors',
                    selected
                      ? 'font-semibold text-foreground'
                      : 'font-medium text-foreground/90',
                  )}
                >
                  {label}
                </span>
              </div>
              <span
                id={descId}
                className="text-xs text-muted-foreground leading-relaxed"
              >
                {description}
              </span>
            </button>
          )
        })}
      </div>
      {!hideCaption && (
        <p className="text-xs text-muted-foreground leading-relaxed mt-3">
          工程化界面美学 — 色板可在下方「主题色」选择器中切换。
        </p>
      )}
    </>
  )
}
