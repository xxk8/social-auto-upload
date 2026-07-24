// ──────────────────────────────────────────────────────────────────────────
// features/preferences/shared/accent-hue-picker.tsx
// Accent hue swatch picker — circle grid, Linear-style.
// ──────────────────────────────────────────────────────────────────────────

import { Check } from 'lucide-react'
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
      <div
        className="flex flex-wrap gap-3"
        role="radiogroup"
        aria-label="主题色选择"
      >
        {ACCENT_PALETTES.map(({ id, label, description, swatch }) => {
          const selected = accentHue === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${label} — ${description}`}
              data-testid={`accent-hue-${id}`}
              title={`${label} · ${description}`}
              onClick={() => setAccentHue(id)}
              className={cn(
                'group flex flex-col items-center gap-1.5 outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg',
              )}
            >
              <span
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-150',
                  'ring-offset-2 ring-offset-background',
                  selected
                    ? 'scale-105 ring-2 ring-foreground/80'
                    : 'ring-1 ring-border/50 group-hover:scale-105 group-hover:ring-border',
                )}
                style={{ background: swatch }}
              >
                {selected && (
                  <Check
                    className="h-4 w-4 text-white drop-shadow-sm"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                )}
              </span>
              <span
                className={cn(
                  'text-[11px] tracking-tight',
                  selected ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        当前：
        <span className="ml-1 font-medium text-foreground">
          {ACCENT_PALETTES.find((p) => p.id === accentHue)?.label ?? '—'}
        </span>
        <span className="mx-1.5 text-border">·</span>
        {ACCENT_PALETTES.find((p) => p.id === accentHue)?.description}
      </p>
    </div>
  )
}
