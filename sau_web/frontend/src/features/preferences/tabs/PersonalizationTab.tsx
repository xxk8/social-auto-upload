// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/PersonalizationTab.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): PersonalizationTab is
// the 'personalization' tab body for the PreferencesDialog. Mirrors
// /dashboard/personalization route surface (PersonalizationContent ==
// PersonalizationTab) so both stay in lockstep through the same
// useTheme() hook + THEMES list. Switching `深色` from either
// surface updates useTheme() and the entire app reacts instantly.
//
// Round-OPT-3G+ refactor: the WAI-ARIA radiogroup + the THEMES list +
// the per-radio button now live in `shared/theme-modes.ts`. Both
// this tab AND OverviewTab render the SAME `<ThemeModesRadio>`
// component (this tab uses `size="default"` with the disclosure
// caption; Overview uses `size="compact"` and `hideCaption`).
// Single source of truth — keyboard handler + ARIA wiring + future
// theme additions land once and both call sites inherit.
//
// data-testid invariants preserved unchanged:
//   • `personalization-theme-modes` (radiogroup)
//   • `theme-mode-${id}`              (per radio button)
//   These are the same strings PersonalizationPage.test.tsx and
// PreferencesDialog.test.tsx have pinned since round-OPT-prefs-dialog
// v3, so the refactor is a pure-internal change.
// ──────────────────────────────────────────────────────────────────────────

import { Sun, Palette } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTheme } from '@/components/ThemeProvider.helpers'
import { ThemeModesRadio } from '../shared/theme-modes'
import { AccentHuePicker } from '../shared/accent-hue-picker'

export function PersonalizationTab() {
  const { theme, setTheme, accentHue, setAccentHue } = useTheme()

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px] flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sun className="h-4 w-4" />
            </span>
            主题
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeModesRadio theme={theme} setTheme={setTheme} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px] flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="h-4 w-4" />
            </span>
            主题色
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AccentHuePicker accentHue={accentHue} setAccentHue={setAccentHue} />
        </CardContent>
      </Card>
    </div>
  )
}
