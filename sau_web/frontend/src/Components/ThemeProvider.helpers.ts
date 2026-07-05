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

export type ThemeProviderState = {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: 'system',
  resolved: 'light',
  setTheme: () => null,
}

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}
