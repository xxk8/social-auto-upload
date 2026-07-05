/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Theme } from './ThemeProvider.helpers'
import { ThemeProviderContext } from './ThemeProvider.helpers'
export { useTheme } from './ThemeProvider.helpers'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

// OPT-follow-up-3-sweep-2: `useTheme`, the `Theme` / `ThemeProviderState`
// types, the `initialState` const, and the `ThemeProviderContext` object
// moved to `./ThemeProvider.helpers.ts`. This file's only remaining
// top-level export is the `ThemeProvider` React component; the imported
// context wraps `children`.

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'sau-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (typeof window !== 'undefined' ? (localStorage.getItem(storageKey) as Theme) || defaultTheme : defaultTheme),
  )

  const [systemDark, setSystemDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const resolved: 'light' | 'dark' = useMemo(() => {
    if (theme === 'system') return systemDark ? 'dark' : 'light'
    return theme
  }, [theme, systemDark])

  const setTheme = useCallback(
    (t: Theme) => {
      localStorage.setItem(storageKey, t)
      setThemeState(t)
    },
    [storageKey],
  )

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
  }, [resolved])

  return (
    <ThemeProviderContext.Provider {...props} value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

