import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PersonalizationPage from '../PersonalizationPage'
import userEvent from '@testing-library/user-event'

// useTheme is mocked so PersonalizationPage reads the theme from
// the mock return without booting ThemeProvider + localStorage.
// Mirrors the helper below.
vi.mock('@/Components/ThemeProvider.helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/Components/ThemeProvider.helpers')>()
  return {
    ...actual,
    useTheme: () => mockUseTheme(),
  }
})

const mockUseTheme = vi.hoisted(() => vi.fn())

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
}

function mountPersonalization() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/dashboard/personalization']}>
        <PersonalizationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function setTheme(theme: 'light' | 'dark' | 'system') {
  mockUseTheme.mockReturnValue({
    theme,
    setTheme: vi.fn(),
    resolvedTheme: theme,
    accentHue: 145,
    setAccentHue: vi.fn(),
  })
}

describe('PersonalizationPage · theme picker', () => {
  beforeEach(() => {
    mockUseTheme.mockReset()
  })

  // (a) The 3 theme modes (浅色 / 深色 / 跟随系统) render inside
  // a WAI-ARIA radiogroup. Locks the round of polish that added the
  // WAI-ARIA radio group so a future regression (e.g. accidental
  // drop of role=radiogroup) trips red.
  it('renders 3 themes inside a radiogroup', () => {
    setTheme('light')
    mountPersonalization()
    const radiogroups = screen.getAllByRole('radiogroup')
    // First radiogroup = theme modes, second = accent hue picker
    expect(radiogroups).toHaveLength(2)
    expect(radiogroups[0]).toHaveAttribute('aria-label', '主题模式')
    expect(screen.getByRole('radio', { name: '浅色' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '深色' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeInTheDocument()
  })

  // (b) The aria-checked state reflects the current theme. Default
  // 'light' → 浅色 radio is checked, dark/system unchecked. Locks
  // the visual-feedback contract so a future bug where aria-checked
  // stops reacting to `setTheme` is caught.
  it('marks the active theme radio with aria-checked=true', () => {
    setTheme('dark')
    mountPersonalization()
    expect(screen.getByRole('radio', { name: '深色' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '浅色' })).toHaveAttribute('aria-checked', 'false')
  })

  // (c) Clicking a theme radio invokes setTheme. The userEvent.click
  // pattern (NOT fireEvent.click) is canonical for Radix-like
  // portals in happy-dom — it awaits the full pointer chain so the
  // post-`await` state update commits before expectations run.
  // Same fix as UserMenu.test.tsx (round-OPT-mobile-chrome test).
  it('clicking a theme radio invokes setTheme with the new id', async () => {
    const user = userEvent.setup()
    const setThemeSpy = vi.fn()
    mockUseTheme.mockReturnValue({
      theme: 'light',
      setTheme: setThemeSpy,
      resolvedTheme: 'light',
      accentHue: 145,
      setAccentHue: vi.fn(),
    })

    mountPersonalization()
    await user.click(screen.getByRole('radio', { name: '深色' }))
    expect(setThemeSpy).toHaveBeenCalledWith('dark')
  })

  // (d) Cycling protection: arrow-key navigation should cycle through
  // the 3 themes (light → dark → system → light). Locks the WAI-ARIA
  // radiogroup keyboard-nav contract; a future regression where
  // ArrowRight on the last item crashes instead of wraps trips red.
  it('ArrowRight cycles from system back to light', async () => {
    const user = userEvent.setup()
    const setThemeSpy = vi.fn()
    mockUseTheme.mockReturnValue({
      theme: 'system',
      setTheme: setThemeSpy,
      resolvedTheme: 'system',
      accentHue: 145,
      setAccentHue: vi.fn(),
    })

    mountPersonalization()
    // Focus the active radio first.
    const systemRadio = screen.getByRole('radio', { name: '跟随系统' })
    systemRadio.focus()
    await user.keyboard('{ArrowRight}')
    // Arrow wraps: system → light
    expect(setThemeSpy).toHaveBeenCalledWith('light')
  })
})
