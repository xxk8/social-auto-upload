// ──────────────────────────────────────────────────────────────────────────
// features/preferences/shared/accent-hue-picker.ts
//
// Accent hue / theme colour picker — companion to theme-modes.tsx.
// Lets the operator override the default --accent-hue (GitHub green)
// with a preset palette. State is managed via useTheme().setAccentHue()
// and persisted to localStorage in ThemeProvider.
//
// Shares the same data-testid convention as ThemeModesRadio so tests
// can target `accent-hue-${hue}` per swatch button.
// ──────────────────────────────────────────────────────────────────────────

import { Palette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_PALETTES } from '@/components/ThemeProvider.helpers'
import type { AccentHue } from '@/components/ThemeProvider.helpers'

interface AccentHuePickerProps {
  accentHue: AccentHue
  setAccentHue: (hue: AccentHue) => void
}

export function AccentHuePicker({ accentHue, setAccentHue }: AccentHuePickerProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">主题色</span>
      </div>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label="主题色选择"
      >
        {ACCENT_PALETTES.map(({ id, label, description, swatch }) => {
          const selected = accentHue === id
          return (
            <button
              key={id}
              role="radio"
              aria-checked={selected}
              aria-label={`${label} — ${description}`}
              data-testid={`accent-hue-${id}`}
              onClick={() => setAccentHue(id)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all outline-none',
                'focus-visible:ring-1 focus-visible:ring-ring',
                selected
                  ? 'border-primary/45 ring-1 ring-primary/30 bg-foreground/5'
                  : 'border-border/40 hover:bg-foreground/[0.04]',
              )}
            >
              <span
                className="inline-block h-4 w-4 rounded-full shrink-0"
                style={{ background: swatch }}
              />
              <span className="font-medium text-foreground">{label}</span>
              <span className="text-muted-foreground hidden sm:inline">
                {description}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}