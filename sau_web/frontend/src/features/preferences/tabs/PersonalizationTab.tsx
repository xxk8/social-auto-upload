// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/PersonalizationTab.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): PersonalizationTab is
// the 'personalization' tab body for the PreferencesDialog. Mirrors
// /app/personalization route surface (PersonalizationContent ==
// PersonalizationTab) so both stay in lockstep through the same
// useTheme() hook + THEMES list. Switching `深色` from either
// surface updates useTheme() and the entire app reacts instantly.
//
// WAI-ARIA radiogroup semantics preserved exactly: arrow keys
// cycle the active radio button with circular wrap + the new
// focus follows the selection (auto-activation). Sets
// `theme-mode-${id}` testid on each radio + the
// `personalization-theme-modes` group testid on the radiogroup
// itself, so PersonalizationPage.test.tsx's canonical WAI-ARIA
// contract (radiogroup + radios + arrow cycle) keeps pinning the
// same selectors regardless of file location.
// ──────────────────────────────────────────────────────────────────────────

import { Monitor, Moon, Sun } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/Components/ui/card'
import { useTheme } from '@/Components/ThemeProvider.helpers'
import type { Theme } from '@/Components/ThemeProvider.helpers'
import { cn } from '@/lib/utils'

// ── THEMES (PersonalizationTab-local source-of-truth) ──────────────
// Canonical light / dark / system theme list. Source-of-truth for
// the theme picker — single-source contract: this file is the only
// export surface for the picker options, and both
// /app/personalization (PersonalizationContent == this component)
// and the PreferencesDialog 'personalization' pane render the
// SAME list. Future copy revisions land here once and both
// surfaces inherit in lockstep.
interface ThemeMeta {
  id: Theme
  label: string
  description: string
  Icon: typeof Sun
}

const THEMES: ReadonlyArray<ThemeMeta> = [
  { id: 'light', label: '浅色', description: '明亮背景 · 适合日间使用', Icon: Sun },
  { id: 'dark', label: '深色', description: '深色背景 · 长时间阅读更舒适', Icon: Moon },
  { id: 'system', label: '跟随系统', description: '由操作系统外观自动切换', Icon: Monitor },
]

export function PersonalizationTab() {
  const { theme, setTheme } = useTheme()

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-[15px]">主题</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* WAI-ARIA radio group — same canonical contract as
            PersonalizationPage so the dialog and the full page
            behave identically under keyboard navigation.
            Buttons enlarged (py-3 → py-4) and now carry a 1-line
            description under each label so the picker reads as
            three product choices. */}
        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          role="radiogroup"
          aria-label="主题模式"
          data-testid="personalization-theme-modes"
          onKeyDown={(e) => {
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
            const nextIdx =
              (currentIdx + direction + THEMES.length) % THEMES.length
            setTheme(THEMES[nextIdx].id)
            const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="radio"]',
            )
            buttons[nextIdx]?.focus()
          }}
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
                  'flex flex-col items-start gap-2 px-4 py-4 rounded-lg border text-left transition-all outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  selected
                    ? 'border-primary/45 ring-1 ring-primary/30 bg-foreground/5'
                    : 'border-border/40 hover:bg-foreground/[0.04]',
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span
                    id={labelId}
                    className="text-sm font-medium text-foreground"
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
        <p className="text-xs text-muted-foreground leading-relaxed">
          工程化界面美学 — accent 颜色固定 sodium-amber，v1 不提供自定义
          picker。后续如需多套预设，请走 DESIGN.md 边界更新流程。
        </p>
      </CardContent>
    </Card>
  )
}
