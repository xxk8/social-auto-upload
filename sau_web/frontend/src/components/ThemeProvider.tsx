/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccentHue, Theme, UiDensity } from './ThemeProvider.helpers'
import { ThemeProviderContext } from './ThemeProvider.helpers'
export { useTheme } from './ThemeProvider.helpers'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  accentStorageKey?: string
  densityStorageKey?: string
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
  accentStorageKey = 'sau-accent-hue',
  densityStorageKey = 'sau-ui-density',
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (typeof window !== 'undefined' ? (localStorage.getItem(storageKey) as Theme) || defaultTheme : defaultTheme),
  )

  const [accentHue, setAccentHueState] = useState<AccentHue>(() => {
    if (typeof window === 'undefined') return 145
    const stored = localStorage.getItem(accentStorageKey)
    if (stored) {
      const n = Number(stored)
      if ([15, 45, 145, 175, 240, 280].includes(n)) return n as AccentHue
    }
    return 145
  })

  const [density, setDensityState] = useState<UiDensity>(() => {
    if (typeof window === 'undefined') return 'comfortable'
    const stored = localStorage.getItem(densityStorageKey)
    if (stored === 'compact' || stored === 'comfortable') return stored
    return 'comfortable'
  })

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

  const setAccentHue = useCallback(
    (h: AccentHue) => {
      localStorage.setItem(accentStorageKey, String(h))
      setAccentHueState(h)
    },
    [accentStorageKey],
  )

  const setDensity = useCallback(
    (d: UiDensity) => {
      localStorage.setItem(densityStorageKey, d)
      setDensityState(d)
    },
    [densityStorageKey],
  )

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
  }, [resolved])

  // Sync --accent-hue CSS custom property to the :root element
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent-hue', String(accentHue))
  }, [accentHue])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = density
  }, [density])

  return (
    <ThemeProviderContext.Provider
      {...props}
      value={{ theme, resolved, setTheme, accentHue, setAccentHue, density, setDensity }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

