// ──────────────────────────────────────────────────────────────────────────
// Components/ThemeProvider.helpers.ts — `react-refresh/only-export-components`
// allow-list.
//
// Companion to `Components/ThemeProvider.tsx`. The original had two value-
// level exports: `useTheme` (a hook) and `Theme` (a type union — type-only,
// not rule-firing). The hook reads `ThemeProviderContext`, which is a React
// context object — also value-level. To keep the rule inviolate, every
// runtime export that is not a component moves here.
//
// Consumers update:
//   - `<ThemeProvider>` from `@/Components/ThemeProvider` (unchanged)
//   - `useTheme`, `Theme`, `ThemeProviderState`, `ThemeProviderContext`
//     from `@/Components/ThemeProvider.helpers`
// ──────────────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'

export type AccentHue = 15 | 45 | 145 | 175 | 240 | 280

export interface AccentPaletteMeta {
  id: AccentHue
  label: string
  description: string
  /** Preview swatch colour (CSS oklch string). */
  swatch: string
}

/** Canonical accent palette presets. Keyed by OKLCH hue value. */
export const ACCENT_PALETTES: ReadonlyArray<AccentPaletteMeta> = [
  { id: 145, label: '绿',          description: 'GitHub green · 自然信号',              swatch: 'oklch(0.55 0.17 145)' },
  { id: 45,  label: '琥珀',         description: '暖色 · 高对比 CTA',                   swatch: 'oklch(0.55 0.17 45)' },
  { id: 240, label: '蓝',          description: '冷色 · 工业界面',                      swatch: 'oklch(0.55 0.17 240)' },
  { id: 280, label: '紫',          description: '品牌感 · 创意产品',                    swatch: 'oklch(0.55 0.17 280)' },
  { id: 175, label: '青',          description: '清新 · 科技感',                        swatch: 'oklch(0.55 0.17 175)' },
  { id: 15,  label: '红',          description: '强烈 · 促销 / 警告',                   swatch: 'oklch(0.55 0.17 15)' },
]

export type ThemeProviderState = {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  accentHue: AccentHue
  setAccentHue: (hue: AccentHue) => void
}

const initialState: ThemeProviderState = {
  theme: 'system',
  resolved: 'light',
  setTheme: () => null,
  accentHue: 145,
  setAccentHue: () => null,
}

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}