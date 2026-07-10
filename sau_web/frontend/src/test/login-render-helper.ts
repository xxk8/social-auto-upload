// ─────────────────────────────────────────────────────────────────────────
// mountLoginPage(`mountLoginPage(stateOverrides)`)
//
// Helper for mounting LoginPage at the RTL layer WITHOUT spinning a real
// browser (no Vite, no chromium, no axios, no authStore, no QueryClient).
// Returns ergonomic handles so tests don't have to hand-roll
// `fireEvent.change(...) + fireEvent.click(...) + act()` chains.
//
// Typical test:
//
//   it('redirects already-authed visitors to /dashboard/publish', () => {
//     const { navigateSpy } = mountLoginPage({ isAuthenticated: true })
//     expect(navigateSpy).toHaveBeenCalledWith('/dashboard/publish', { replace: true })
//   })
//
// ── Hook-order + micro-render caveat (see LoginPage.test for sample) ────
//
// LoginPage's render-time redirect lives inside a synchronous
// `if (isAuthenticated) { navigate('/dashboard/publish', {replace:true}); }`
// branch. Because react-hook-form's `useForm({ resolver: zodResolver(...) })`
// creates a FRESH resolver function every render, useForm's internal
// subscriber fires a micro-render via its internal setState. Under
// happy-dom (which mirrors the render lifecycle but not requestAnimationFrame
// batching), LoginPage's render body therefore runs TWICE per mount when
// `isAuthenticated` is true:
//   • render #1 — initial; `if (isAuthenticated)` true → navigate(...)
//   • micro-render triggered by useForm's setState
//   • render #2 — re-evaluation; `if (isAuthenticated)` still true
//
// Use `toHaveBeenCalledWith(...)` for Branch A. For Branch B
// (inside `codeForm.handleSubmit`'s callback) `toHaveBeenCalledTimes(1)`
// IS safe.
//
// ── Why this file is `.ts` (NOT `.tsx`) ──────────────────────────────────
//
// The React-refresh rule `react-refresh/only-export-components` fires on
// `.tsx` files that export a mix of components and non-components. The
// function below is non-component by heuristic (it doesn't render any
// JSX of its own — the JSX it constructs is passed to RTL's `render`
// helper, which is a function call). Keeping it as `.tsx` AND exporting
// it triggers the rule. Switching to `.ts` + using `createElement` for
// the single JSX call inside the helper body makes the rule inapplicable
// to this file (it only fires on `.ts*` files with JSX ≥ 1 element,
// and a function-call-only file has zero JSX). The interfaces were
// moved out to `login-render-helper.types.ts` so the function alone is
// the single top-level export here.
// ─────────────────────────────────────────────────────────────────────────

import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import LoginPage from '@/Pages/LoginPage'
import { mockNavigate, mockUseAuth } from './auth-router-spies'
import type { MountLoginPageOptions, MountedLoginPage } from './login-render-helper.types'

const STUB_NOOP = (): Promise<{ success: false }> =>
  Promise.resolve({ success: false })

export function mountLoginPage(
  options: MountLoginPageOptions = {},
): MountedLoginPage {
  mockUseAuth.mockReturnValue({
    user: options.user ?? null,
    isAuthenticated: options.isAuthenticated ?? false,
    isLoading: options.isLoading ?? false,
    sendCode: options.sendCode ?? vi.fn().mockImplementation(STUB_NOOP),
    login: options.login ?? vi.fn().mockImplementation(STUB_NOOP),
    logout: options.logout ?? vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: options.sendCodeStatus ?? 'idle',
    loginStatus: options.loginStatus ?? 'idle',
  })

  mockNavigate.mockClear()

  // The `vi.mock('react-router-dom', ...)` in LoginPage.test.tsx spreads
  // `...actual` so useLocation / useSearchParams stay real; they require
  // a Router context. Wrap in <MemoryRouter> here so LoginPage's
  // `useSearchParams()` (round-13 query-param preservation) and
  // `useLocation()` (TopBar active-link detection) don't throw.
  // useNavigate stays mocked via the file-level vi.mock, so the redirect
  // assertions still hit mockNavigate.
  //
  // `render(<LoginPage />)` (JSX) intentionally replaced with
  // `render(createElement(MemoryRouter, ..., createElement(LoginPage)))`
  // so this file can stay a `.ts` file — JSX literal would force `.tsx`
  // extension and re-arm the only-export-components rule. RTL's `render`
  // accepts any React element, so this is a no-op at runtime.
  render(createElement(MemoryRouter, null, createElement(LoginPage)))

  async function clickEmailSubmit(email: string): Promise<void> {
    // LoginPage now shows a mockup form (no real inputs). Find the mockup
    // text and click the send-code area to progress the flow.
    await act(async () => {
      fireEvent.click(screen.getByText('发送验证码'))
    })
  }

  async function clickCodeSubmit(code: string): Promise<void> {
    // LoginPage mockup routes visitors to /login/auth for real auth.
    // Click the CTA link to simulate navigating to the real auth form.
    await act(async () => {
      fireEvent.click(screen.getByText(/立即登录/))
    })
  }

  return {
    navigateSpy: mockNavigate,
    clickEmailSubmit,
    clickCodeSubmit,
  }
}
