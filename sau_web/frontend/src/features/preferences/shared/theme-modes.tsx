// ──────────────────────────────────────────────────────────────────────────
// features/preferences/shared/theme-modes.tsx
// Theme mode radiogroup — shared by PersonalizationTab + OverviewTab.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { Monitor, Moon, Sun, Check } from 'lucide-react'
import type { Theme } from '@/components/ThemeProvider.helpers'
import { cn } from '@/lib/utils'

export interface ThemeMeta {
  id: Theme
  label: string
  description: string
  Icon: typeof Sun
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  { id: 'light', label: '浅色', description: '明亮背景 · 适合日间', Icon: Sun },
  { id: 'dark', label: '深色', description: '深色背景 · 护眼阅读', Icon: Moon },
  { id: 'system', label: '跟随系统', description: '跟随 OS 自动切换', Icon: Monitor },
]

interface ThemeModesRadioProps {
  theme: Theme
  setTheme: (next: Theme) => void
  size?: 'default' | 'compact'
  testId?: string
  hideCaption?: boolean
}

/** Mini surface mock so the operator sees what each mode looks like. */
function ThemePreview({ mode }: { mode: Theme }) {
  const isDark = mode === 'dark'
  const isSystem = mode === 'system'
  return (
    <div
      aria-hidden
      className={cn(
        'relative w-full overflow-hidden rounded-lg border',
        isSystem
          ? 'border-border/50'
          : isDark
            ? 'border-white/10 bg-[#0f1011]'
            : 'border-border/60 bg-[#f7f8f8]',
      )}
      style={
        isSystem
          ? {
              background:
                'linear-gradient(105deg, #f7f8f8 0% 48%, #0f1011 52% 100%)',
            }
          : undefined
      }
    >
      <div className="aspect-[16/9] p-2 sm:p-2.5">
        {/* title bar */}
        <div
          className={cn(
            'mb-1.5 flex items-center gap-1 rounded-sm px-1.5 py-1',
            isDark || isSystem ? 'bg-black/20' : 'bg-black/[0.04]',
          )}
        >
          <span className={cn('h-1 w-1 rounded-full', isDark ? 'bg-white/25' : 'bg-black/20')} />
          <span className={cn('h-1 w-1 rounded-full', isDark ? 'bg-white/25' : 'bg-black/20')} />
          <span className={cn('h-1 w-1 rounded-full', isDark ? 'bg-white/25' : 'bg-black/20')} />
          <span
            className={cn(
              'ml-1 h-1 flex-1 rounded-full max-w-[40%]',
              isDark ? 'bg-white/15' : 'bg-black/10',
            )}
          />
        </div>
        {/* content bars */}
        <div className="space-y-1">
          <div
            className={cn(
              'h-1.5 w-[72%] rounded-full',
              isDark ? 'bg-white/20' : isSystem ? 'bg-black/15' : 'bg-black/12',
            )}
          />
          <div
            className={cn(
              'h-1.5 w-[48%] rounded-full',
              isDark ? 'bg-white/12' : isSystem ? 'bg-black/10' : 'bg-black/[0.08]',
            )}
          />
          <div
            className={cn(
              'mt-2 h-4 w-full rounded-md',
              isDark ? 'bg-white/[0.06]' : 'bg-black/[0.04]',
            )}
          />
        </div>
      </div>
      {/* primary accent chip */}
      <div className="absolute bottom-2 right-2 h-2 w-5 rounded-full bg-primary/80" />
    </div>
  )
}

export function ThemeModesRadio({
  theme,
  setTheme,
  size = 'default',
  testId = 'personalization-theme-modes',
  hideCaption = false,
}: ThemeModesRadioProps) {
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
      const direction = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
      const nextIdx = (currentIdx + direction + THEMES.length) % THEMES.length
      setTheme(THEMES[nextIdx].id)
      const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      buttons[nextIdx]?.focus()
    },
    [theme, setTheme],
  )

  const padClass = size === 'compact' ? 'p-2.5 sm:p-3' : 'p-3 sm:p-3.5'
  const gapClass = size === 'compact' ? 'gap-2.5' : 'gap-3'

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
                'group relative flex flex-col gap-2.5 rounded-xl border text-left outline-none transition-all duration-200',
                'focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                padClass,
                selected
                  ? 'border-primary/40 bg-primary/[0.05] shadow-sm ring-1 ring-primary/20'
                  : 'border-border/50 bg-card hover:border-border hover:bg-muted/30',
              )}
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
                >
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                </span>
              )}

              <ThemePreview mode={id} />

              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                    selected
                      ? 'bg-primary/12 text-primary'
                      : 'bg-muted text-muted-foreground group-hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span
                  id={labelId}
                  className={cn(
                    'text-[13px] tracking-tight',
                    selected ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
                  )}
                >
                  {label}
                </span>
              </div>
              {size !== 'compact' && (
                <span id={descId} className="text-[11px] leading-relaxed text-muted-foreground">
                  {description}
                </span>
              )}
              {size === 'compact' && (
                <span id={descId} className="sr-only">
                  {description}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {!hideCaption && (
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          主题即时生效，并保存在本机。可在下方选择主题强调色。
        </p>
      )}
    </>
  )
}
