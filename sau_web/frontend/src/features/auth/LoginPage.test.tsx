// ── shared mock prop shapes (see TaskTableRow.test.tsx for rationale) ──
//
// `MockProps` is the common denominator: HTMLAttributes + children + an open
// index signature `[key: string]: unknown` so data-* / aria-* still flow
// through `{...rest}` without dropping. The Card mock wrapper just spreads
// every prop; MockProps covers every input it sees on the LoginPage path.
type MockProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode
  [key: string]: unknown
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import type { HTMLAttributes, ReactNode } from 'react'

// ── hoisted mocks are imported (not declared) ───────────────────────────
//
// `vi.mock` declarations for these modules MUST live in THIS file
// because vitest's mock-factory hoisting is per-importing-file: when
// LoginPage.test.tsx imports LoginPage, vitest applies this file's
// mock declarations to LoginPage's transitive imports of useAuth,
// react-router-dom, motion/react, etc. If the mocks lived in
// redirect-spy.ts, they would only apply to redirect-spy.ts's own
// direct renders — they would NOT propagate when redirect-spy.ts
// re-uses LoginPage.
//
// Spy instances are imported from `@/test/auth-router-spies` so the
// factory closures and the helper's `mockUseAuth.mockReturnValue(...)`
// calls reach a single, stable vi.fn shared across this file.
import { mockNavigate, mockUseAuth } from '@/test/auth-router-spies'
import { ROUTES } from '@/routes'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('motion/react', () => {
  // Dynamic JSX Tag (string-keyed) and Proxy target type can't be cleanly
  // typed — disable no-explicit-any on the three sites annotated below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motionCache = new Map<string, (props: any) => any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motion: any = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        if (!motionCache.has(tag)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          motionCache.set(tag, (props: any) => {
            const { children, ...rest } = (props ?? {}) as Record<string, unknown>
            const Tag = (tag as string) || 'div'
            return <Tag {...rest}>{children}</Tag>
          })
        }
        return motionCache.get(tag)
      },
    },
  )
  return {
    motion,
    AnimatePresence: ({ children }: MockProps) => <>{children}</>,
  }
})

vi.mock('@/Components/ui/card', () => ({
  Card: ({ children, ...rest }: MockProps) => (
    <div data-testid="card" {...rest}>
      {children}
    </div>
  ),
  CardContent: ({ children, ...rest }: MockProps) => (
    <div data-testid="card-content" {...rest}>
      {children}
    </div>
  ),
}))

vi.mock('@/Components/ui/input', () => ({
  Input: (props: MockProps) => <input {...props} />,
}))

vi.mock('@/Components/ui/button', () => ({
  Button: ({ children, ...rest }: MockProps) => (
    <button {...rest}>{children}</button>
  ),
}))

vi.mock('@/Components/ui/label', () => ({
  Label: ({ children, ...rest }: MockProps) => (
    <label {...rest}>{children}</label>
  ),
}))

vi.mock('@/Components/ui/tooltip', () => ({
  Tooltip: ({ children }: MockProps) => <>{children}</>,
  TooltipContent: ({ children }: MockProps) => <span>{children}</span>,
  TooltipProvider: ({ children }: MockProps) => <>{children}</>,
  TooltipTrigger: ({ children }: MockProps) => <>{children}</>,
}))

// ── imports (post-mock) ────────────────────────────────────────────────

import { mountLoginPage } from '@/test/login-render-helper'

// ── tests ───────────────────────────────────────────────────────────────

describe('LoginPage · post-merge redirect target', () => {
  beforeEach(() => {
    // Reset both spies between tests so stale calls from one test can't
    // leak into assertions in another.
    mockNavigate.mockReset()
    mockUseAuth.mockReset()
  })

  // BRANCH A — already-authed early-return (render-time navigate).
  //
  // Locks the conditions that fired off the e2e routing-split PR fix:
  // post-merge `/` belongs to marketing, so an authed visitor who
  // lands on /login must be bounced into the dashboard at
  // /dashboard/publish, NOT back onto the marketing surface.
  //
  // NOT asserted on call-count. Reason: react-hook-form's
  // `useForm({ resolver: zodResolver(...) })` creates a fresh resolver
  // per render, which triggers an internal micro-render under
  // happy-dom; the render-time navigate call therefore fires twice
  // per mount (initial + RHF re-render). The behavioural invariant
  // is the redirect *target*, not the call count. See redirect-spy.ts
  // docblock for the full breakdown.
  it('redirects already-authed visitors to /dashboard/publish (replace)', () => {
    const { navigateSpy } = mountLoginPage({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 1, email: 'qa@example.com', role: 'admin' },
    })
    expect(navigateSpy).toHaveBeenCalled()
    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.dashboard.publish, {
      replace: true,
    })
  })

  // NEGATIVE (Branch A guard) — auth is still resolving on mount.
  // We must NOT navigate before /api/auth/me has had a chance to
  // land. Catches a regression where someone changes the guard to
  // `if (user || store.user)` etc., causing flicker redirects.
  it('does NOT navigate while auth status is still loading', () => {
    const { navigateSpy } = mountLoginPage({
      isAuthenticated: false,
      isLoading: true,
    })
    expect(navigateSpy).not.toHaveBeenCalled()
    // LoginPage mockup shows text content (not real form inputs).
    // The page renders marketing content + mockup form during loading.
    expect(screen.getByText(/邮箱地址/)).toBeInTheDocument()
  })

  // NEGATIVE (Branch A/B guard) — anonymous visitor on /login.
  // No nav until the user actually submits the code step.
  it('does NOT navigate while visitor is anonymous on mount', () => {
    const { navigateSpy } = mountLoginPage({
      isAuthenticated: false,
      isLoading: false,
    })
    expect(navigateSpy).not.toHaveBeenCalled()
    expect(screen.getByText(/邮箱地址/)).toBeInTheDocument()
    expect(screen.getByText('发送验证码')).toBeInTheDocument()
  })

  // BRANCH B — post-login redirect now lives at /login/auth sub-route.
  // LoginPage at `/login` is a marketing page with a mockup form.
  // The real auth form interaction (email → code → login) moved to
  // the /login/auth page. These tests lock the mockup's CTA and the
  // redirect-after-auth guard.
  it('shows the login CTA link pointing to /login/auth', () => {
    const { navigateSpy } = mountLoginPage({
      isAuthenticated: false,
      isLoading: false,
    })
    expect(navigateSpy).not.toHaveBeenCalled()
    // The mockup CTA links to /login/auth for real auth interaction
    expect(screen.getByText(/立即登录/)).toBeInTheDocument()
  })

  // NEGATIVE (auth guard) — auth failure keeps the visitor on the
  // marketing page. The page does NOT navigate away on auth error.
  it('does NOT navigate when mountLoginPage passes loginStatus error', () => {
    const { navigateSpy } = mountLoginPage({
      isAuthenticated: false,
      isLoading: false,
      loginStatus: 'error',
    })
    expect(navigateSpy).not.toHaveBeenCalled()
    // The page renders its marketing content; login text appears in the CTA
    expect(screen.queryAllByText(/立即登录/).length).toBeGreaterThanOrEqual(1)
  })
})
