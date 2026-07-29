// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/PersonalizationTab.tsx
// Theme / accent / density / locale
// ──────────────────────────────────────────────────────────────────────────

import { Check, Globe, Palette, Rows3, Sun } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DENSITY_OPTIONS,
  useTheme,
  type UiDensity,
} from '@/components/ThemeProvider.helpers'
import { ThemeModesRadio } from '../shared/theme-modes'
import { AccentHuePicker } from '../shared/accent-hue-picker'
import { useLocale } from '@/lib/i18n/useLocale'
import type { SupportedLocale } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

const LOCALE_OPTIONS: ReadonlyArray<{
  id: SupportedLocale
  label: string
  description: string
}> = [
  { id: 'zh-CN', label: '中文', description: '简体中文界面' },
  { id: 'en-US', label: 'English', description: 'English UI' },
]

export function PersonalizationTab() {
  const { theme, setTheme, accentHue, setAccentHue, density, setDensity } = useTheme()
  const { locale, setLocale } = useLocale()

  // Treat bare `en` the same as en-US for radio selection.
  const activeLocale: SupportedLocale =
    locale === 'en' || locale === 'en-US' ? 'en-US' : 'zh-CN'

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/40 shadow-none ring-1 ring-border/40">
        <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
          <CardTitle className="flex items-center gap-2.5 text-[14px] font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sun className="h-3.5 w-3.5" />
            </span>
            外观模式
          </CardTitle>
          <CardDescription className="text-[12px]">
            选择浅色、深色，或跟随系统外观
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <ThemeModesRadio theme={theme} setTheme={setTheme} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/40 shadow-none ring-1 ring-border/40">
        <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
          <CardTitle className="flex items-center gap-2.5 text-[14px] font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="h-3.5 w-3.5" />
            </span>
            主题色
          </CardTitle>
          <CardDescription className="text-[12px]">
            用于按钮、选中态与强调标记的品牌色
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <AccentHuePicker accentHue={accentHue} setAccentHue={setAccentHue} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/40 shadow-none ring-1 ring-border/40">
        <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
          <CardTitle className="flex items-center gap-2.5 text-[14px] font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Rows3 className="h-3.5 w-3.5" />
            </span>
            界面密度
          </CardTitle>
          <CardDescription className="text-[12px]">
            控制列表与卡片的行高（本机保存）
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <div
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            role="radiogroup"
            aria-label="界面密度"
            data-testid="personalization-density"
          >
            {DENSITY_OPTIONS.map((opt) => {
              const selected = density === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`density-mode-${opt.id}`}
                  onClick={() => setDensity(opt.id as UiDensity)}
                  className={cn(
                    'relative flex flex-col gap-1.5 rounded-xl border p-3.5 text-left outline-none transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-primary/20',
                    selected
                      ? 'border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20'
                      : 'border-border/50 hover:border-border hover:bg-muted/30',
                  )}
                >
                  {selected && (
                    <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                    </span>
                  )}
                  <span className="text-[13px] font-semibold tracking-tight">{opt.label}</span>
                  <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                  {/* density preview bars */}
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1 flex flex-col rounded-md border border-border/40 bg-muted/40 px-2',
                      opt.id === 'compact' ? 'gap-0.5 py-1.5' : 'gap-1.5 py-2',
                    )}
                  >
                    <span className="h-1 w-full rounded-full bg-foreground/15" />
                    <span className="h-1 w-4/5 rounded-full bg-foreground/10" />
                    <span className="h-1 w-3/5 rounded-full bg-foreground/10" />
                  </span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/40 shadow-none ring-1 ring-border/40">
        <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
          <CardTitle className="flex items-center gap-2.5 text-[14px] font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Globe className="h-3.5 w-3.5" />
            </span>
            语言
          </CardTitle>
          <CardDescription className="text-[12px]">
            切换界面语言（营销页与部分文案已接入 i18n）
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <div
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            role="radiogroup"
            aria-label="界面语言"
            data-testid="personalization-locale"
          >
            {LOCALE_OPTIONS.map((opt) => {
              const selected = activeLocale === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`locale-mode-${opt.id}`}
                  onClick={() => void setLocale(opt.id)}
                  className={cn(
                    'relative flex flex-col gap-1 rounded-xl border p-3.5 text-left outline-none transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-primary/20',
                    selected
                      ? 'border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20'
                      : 'border-border/50 hover:border-border hover:bg-muted/30',
                  )}
                >
                  {selected && (
                    <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                    </span>
                  )}
                  <span className="text-[13px] font-semibold tracking-tight">{opt.label}</span>
                  <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
