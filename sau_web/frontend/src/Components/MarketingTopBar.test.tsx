/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/Components/ui/tooltip'
import MarketingTopBar from './MarketingTopBar'
import { mockUseAuth } from '@/test/auth-router-spies'
import { makeQueryClient } from '@/test/render-harness.helpers'

// ─────────────────────────────────────────────────────────────────────────
// MarketingTopBar · visitor-facing nav chrome (5 marketing pages share
// this).
//
// Why this file exists:
//
//   1. The 5 marketing pages (LandingPage / PricingPage / HotListPage /
//      AboutPage / LoginPage) all render the same <MarketingTopBar />
//      component. Before the v1 chrome-unification round, each page
//      inlined its own header — order, item set, active-state logic
//      drifted between pages and visitors saw inconsistent chrome.
//      This file pins the shared component's contract so a future
//      regression in ONE page (e.g. accidentally rendering a local
//      TopBar alongside the shared one) trips red here first.
//
//   2. The 登录 CTA's active-state visual upgrade (round
//      OPT-ftr-V9-vision-fix): on /login + /login/auth, the button
//      gets `shadow-md shadow-primary/40` superimposed on the default
//      `shadow-sm shadow-primary/20`. Without these test pins, a future
//      regression that drops either the active-detection branch OR
//      the `aria-[current=page]:` variants would silently leave the
//      CTA visually identical to other pages' identical-look button.
//
//   3. The 登录 CTA's destination + search-param-preservation: clicking
//      it lands on `/login/auth` (NOT `/login`), preserving inbound
//      `?plan=` / `?intent=` so deep-links from PricingPage tier cards
//      + the contact-sales route survive the bounce. Asserts on the
//      rendered `href` attribute (not the Link's `to` prop) so a
//      future Slot/Link refactor that breaks the href-to attribute
//      pipeline trips red.
//
//   4. Authed chrome — when useAuth().isAuthenticated is true, the
//      CTA row is replaced by a <UserMenu mode="mobile"> in the same
//      slot, so the 4 preference tabs + 登出 (5th dropdown item) are
//      shared verbatim across all 4 chrome surfaces (MarketingTopBar
//      authed branch + AppShell sidebar footer expanded + AppShell
//      sidebar footer collapsed + AppShell mobile AppBar).
//
// Harness notes:
//
//   • useAuth + usePreferencesDialog are mocked so the test tree
//     doesn't boot the real authStore / TanStack Query /
//     /api/auth/me fetch, nor the PreferencesDialogProvider chain.
//     Mirrors the AppShell.test.tsx / UserMenu.test.tsx pattern.
//
//   • <TooltipProvider> wraps the tree because UserMenu (rendered in
//     the authed branch) uses Radix Tooltip on its mobile-mode
//     trigger. Without TooltipProvider, the authed-branch test (g)
//     throws "Tooltip must be used within TooltipProvider".
//
//   • <QueryClientProvider> wraps because UserMenu (transitively)
//     reads TanStack Query when the authed branch renders. Without
//     QueryClientProvider, useQuery throws "No QueryClient set".
//
//   • 3 lazy-loaded pages / api.client / AuthGuard are NOT mocked
//     here because MarketingTopBar doesn't import any of them
//     directly — only the UserMenu (authed branch) does, and the
//     hooks layer (useAuth) is the only thing UserMenu reads from
//     the real Provider chain. Keeps the harness narrowly scoped.
// ─────────────────────────────────────────────────────────────────────────

// Round-NT-28-i18n — stub `useTranslation` so the test tree doesn't
// need a real <I18nextProvider> mount. t() returns the second-arg
// fallback (the Chinese literal) so test assertions that look up
// '首页' / '登录' / '导航菜单' match verbatim without per-test locale
// bootstrapping. Mirrors the AppShell.test.tsx / UserMenu.test.tsx
// pattern of stubbing external hooks. Hoisted before the
// auth-context mock so MarketingTopBar's import resolution order is
// deterministic — vitest hoists vi.mock anyway, so this comment is
// for human reading order only.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>(
      'react-i18next',
    )
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
      i18n: {
        language: 'zh-CN',
        changeLanguage: vi.fn().mockResolvedValue(undefined),
      },
    }),
  }
})

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// Round-OPT-prefs-dialog-v7 (test surface) — barrel-level mock
// rather than 2 sub-path mocks because MarketingTopBar.tsx
// imports BOTH PreferencesDialogProvider AND PreferencesDialog
// from the `@/features/preferences` barrel, and the production
// code's reference resolution at module-load creates an import
// graph that drags the real Dialog.jsx (with its eager-loaded
// tab sub-components) into the test mount tree on the authed
// branch. happy-dom doesn't load that module graph reliably;
// 2 separate sub-path mocks don't intercept the barrel's
// re-export chain. Single barrel-level mock keeps the test
// surface deterministic: pass-through Provider (children
// render normally), stub usePreferencesDialog (UserMenu call
// sites become no-op callbacks), null PreferencesDialog (real
// dialog JSX never evaluates even when isAuthenticated).
vi.mock('@/features/preferences', () => ({
  PreferencesDialogProvider: ({ children }: { children: ReactNode }) => children,
  usePreferencesDialog: () => ({
    open: false,
    activeTab: 'account',
    openPreferences: vi.fn(),
    closePreferences: vi.fn(),
    setActiveTab: vi.fn(),
  }),
  PreferencesDialog: () => null,
}))

// Round-VISION-FIX scroll-past spy — `useScrollPast(80)` reads
// `window.scrollY > 80` via a scroll listener + rAF. happy-dom
// doesn't fire real scroll events on `window.dispatchEvent`, so the
// hook's effect initialiser stays at `false` forever in tests. We
// mock the hook at the module boundary and let each test opt into
// `past === true` via `mockReturnValueOnce(true)` so the
// `border-primary` vs `border-border/40` className conditional in
// MarketingTopBar can be exercised synchronously without driving
// the real rAF loop. The hoisted spy pattern (vs an ad-hoc `let
// pastValue = false`) matches the `auth-router-spies.ts` shape so
// future tests asserting `useScrollPast.mock.calls` can do so
// without re-mocking the module.
//
// Mocked module lanes (returnValue vs returnValueOnce):
//   • `mockReturnValue(false)` is set ONCE at hoist time so the
//     default past === false across all tests in this file.
//   • `mockReturnValueOnce(true)` queues a one-shot override for
//     tests that want to exercise the past === true branch.
//     After the queued value is consumed (one render), subsequent
//     renders fall back to the default `false` again.
const mockUseScrollPast = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/lib/use-scroll-past', () => ({
  useScrollPast: () => mockUseScrollPast(),
}))

// Round-OPT-chrome-responsive breakpoint context — matchMedia
// mock that simulates the `useBreakpoint`-style contract. The
// marketing TopBar uses Tailwind CSS responsive utilities
// (`hidden sm:inline`, `md:hidden`, `hidden md:flex`) so the
// rendered DOM is the same at every viewport in jsdom
// (happy-dom has no real CSS resolution). Still: each test
// documents its assumed viewport via `mockMatchMedia({ ... })`
// so future devs reading the test trace can see whether the
// behavior they're asserting was scoped to <sm / <md / ≥md —
// and so a regression that de-Tailwindifies the responsive
// layer (e.g. switches to a useMediaQuery hook) trips red
// here FIRST because the mock-returns-false contract changes.
//
// `query` parsing: `'(min-width: 640px)'` → sm bucket;
// `'(min-width: 768px)'` → md bucket. Anything else stays
// `true` (default match) for sanity.
function mockMatchMedia({
  sm = true,
  md = true,
}: { sm?: boolean; md?: boolean } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('640px')
      ? sm
      : query.includes('768px')
        ? md
        : true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function mountTopBar({ initialPath = '/' }: { initialPath?: string } = {}) {
  return render(
    <TooltipProvider>
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={[initialPath]}>
          <MarketingTopBar />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  )
}

function setAuth({
  isAuthenticated = false,
}: { isAuthenticated?: boolean } = {}) {
  mockUseAuth.mockReturnValue({
    user: isAuthenticated
      ? { id: 1, email: 'qa@example.com', role: 'admin' as const }
      : null,
    isAuthenticated,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  } as any)
}

describe('MarketingTopBar · visitor-facing nav chrome (5 marketing pages share this)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    // `mockClear` strips `.mock.calls` / `.results` history but keeps
    // the hoisted `() => false` implementation intact (vs `mockReset`
    // which would also clear the implementation, surfacing
    // `useScrollPast returned undefined` at render time). The
    // `mockReturnValueOnce(true)` queue in test (h) below is queued
    // PER test, so no carryover between tests.
    mockUseScrollPast.mockClear()
    // Round-OPT-chrome-responsive viewport context — every test
    // in this file simulates ≥md (default desktop). Per-test
    // overrides via `mockMatchMedia({ md: false })` (etc.) for
    // <sm / <md contract assertions (j)/(k). happy-dom doesn't
    // resolve media queries, so this mock is a label-only
    // bookmark — but it WILL participate in real assertions
    // the moment a future refactor moves MarketingTopBar to a
    // JS-side useMediaQuery hook (currently CSS-only).
    mockMatchMedia({ sm: true, md: true })
  })

  // (a) All 5 nav items render, in the canonical order 首页 · 定价 ·
  //     热榜 · 关于 · 登录. The order is the source of truth per
  //     the file-level comment in MarketingTopBar.tsx — a future
  //     regression (e.g. swapping 定价 and 登录 without flipping
  //     `isCta`) would still render in some order, but this test
  //     pins the EXACT order so a re-shuffle trips red immediately.
  //     Uses `getAllByRole('link')` + slice to filter out the brand
  //     link (`social-auto-upload`) — the brand link is also a `<a>`
  //     but isn't a nav item.
  it('renders the 5 nav items + brand in the canonical order (首页 · 定价 · 热榜 · 关于 · 登录)', () => {
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })
    const links = screen.getAllByRole('link')
    // The brand link's text is rendered as `>_<span>social-auto-upload</span>`
    // (the `>_` is the BrandMark icon's accessible text); an exact-string
    // match (`!== 'social-auto-upload'`) misses it. Use `.includes(...)`
    // so any prefix/glyph-and-label rendering of the brand stays out of
    // the nav-label list. The TypeScript non-null assertion `t!` is safe:
    // `t` came from a string-returning `trim()`, fires as `string`.
    const navLabels = links
      .map((l) => l.textContent?.trim() ?? '')
      .filter((t) => !t.includes('social-auto-upload'))
    expect(navLabels).toEqual([
      '首页',
      '定价',
      '热榜',
      '关于',
      '登录',
    ])
  })

  // (b) The 登录 CTA's rendered href is `/login/auth` (NOT `/login`)
  //     so a click lands DIRECTLY on the verification code form,
  //     bypassing the marketing-pitch screen and avoiding an
  //     `登录 → /login → 登录 → /login/...` re-loop. The static
  //     `NAV_ITEMS[4].to` is the literal `/login` string used ONLY
  //     as a logical identifier for the active-span branch — the
  //     rendered `to` is the computed `loginAuthHref`. Asserts on
  //     the DOM `<a href>` attribute (not the React `to` prop) so a
  //     future Slot/Link refactor that breaks the href pipeline trips
  //     red.
  it('登录 CTA href is /login/auth (no /login re-bounce on click)', () => {
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })
    const cta = screen.getByRole('link', { name: '登录' })
    expect(cta.getAttribute('href')).toBe('/login/auth')
  })

  // (c) Inbound `?plan=` / `?intent=` / `?reason=` search params are
  //     preserved across the CTA bounce. Mirrors the `authHref`
  //     contract in `Pages/LoginPage.tsx` and the in-component
  //     `authHref` pattern in `Pages/LoginAuthPage.tsx`'s form —
  //     deep links from PricingPage tier cards and the contact-sales
  //     flow must survive the bounce. Catches a regression where
  //     MarketingTopBar drops its `useSearchParams` import or
  //     assembles `loginAuthHref` without the search string.
  it('登录 CTA preserves inbound ?plan= search param (?plan=team → /login/auth?plan=team)', () => {
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/?plan=team' })
    const cta = screen.getByRole('link', { name: '登录' })
    expect(cta.getAttribute('href')).toBe('/login/auth?plan=team')
  })

  // (d) On `/` (home), the CTA does NOT carry `aria-current="page"`
  //     + the default `shadow-sm shadow-primary/20` envelope is
  //     present. The active-state variants (`aria-[current=page]:
  //     shadow-md` etc.) are ALWAYS emitted in className regardless
  //     of path — they only fire at runtime when `aria-current="page"`
  //     propagates via Radix Slot AND the browser resolves the
  //     `aria-[current=page]:` variant selector match. So the
  //     relevant invariant on `/` is pinpointable through the
  //     `aria-current` attribute + the default envelope being
  //     present; the variant-selector class tokens themselves are
  //     a single-source-of-truth concern (test (e) locks they ARE
  //     present), not a per-path concern. Without the
  //     `aria-current` pin, the active branch regression would
  //     silently leave the CTA visually identical to other pages'
  //     identical-look button.
  it('on /, 登录 CTA has NO aria-current="page" BUT default shadow envelope present', () => {
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })
    const cta = screen.getByRole('link', { name: '登录' })

    // No a11y marker
    expect(cta.getAttribute('aria-current')).not.toBe('page')

    // Default envelope present (regression shield — a future refactor
    // that drops the default AND keeps the active variants would
    // otherwise stay green; also: the default shadow is what the user
    // actually sees on `/`, /pricing, /hotlist, /about.)
    expect(cta.className).toMatch(/\bshadow-sm\b/)
    expect(cta.className).toMatch(/\bshadow-primary\/20\b/)

    // The active variant class tokens ARE emitted regardless of
    // path — they only fire at runtime via the `aria-[current=page]:`
    // selector. Pinning them via `not.toMatch` here was a category
    // mistake; test (e) below locks their emission as a single-
    // source-of-truth invariant.
    expect(cta.className).toContain('aria-[current=page]:shadow-md')
  })

  // (e) Round OPT-ftr-V9-vision-fix — PRIMARY assertion. On `/login`,
  //     the 登录 CTA carries:
  //       (i)   `aria-current="page"` a11y marker
  //       (ii)  `aria-[current=page]:shadow-md` variant selector
  //       (iii) `aria-[current=page]:shadow-primary/40` variant
  //     PLUS the default `shadow-sm shadow-primary/20` envelope is
  //     still emitted (so a future regression that drops the
  //     default + adds the active variants would trip the
  //     `shadow-sm` pin in this same test).
  //
  //     Without these three pins, a regression that drops either
  //     (a) the active-span branch (pathname.startsWith('/login/'))
  //     OR (b) the `aria-[current=page]:` variant classes would
  //     silently leave the CTA visually identical to /'s
  //     identical-look button. The active-class pins assert on the
  //     className EMISSION (not the visual style — jsdom doesn't
  //     compute styles). At browser runtime the variant selector
  //     fires only when aria-current="page" propagates via Radix
  //     Slot to the inner <a>, so the upgrade is conditional on the
  //     a11y marker that's pinned in (i).
  it('on /login, 登录 CTA has aria-current="page" + aria-[current=page]:shadow-md/40 active upgrade', () => {
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/login' })
    const cta = screen.getByRole('link', { name: '登录' })

    // (i) a11y marker
    expect(cta.getAttribute('aria-current')).toBe('page')

    // (ii) + (iii) active-state variants
    expect(cta.className).toMatch(/\baria-\[current=page\]:shadow-md\b/)
    expect(cta.className).toMatch(
      /\baria-\[current=page\]:shadow-primary\/40\b/,
    )

    // Default shadow envelope still present (regression shield —
    // see comment above).
    expect(cta.className).toMatch(/\bshadow-sm\b/)
    expect(cta.className).toMatch(/\bshadow-primary\/20\b/)
  })

  // (f) The CTA's active-span covers the WHOLE conversion flow —
  //     both `/login` (marketing pitch) AND `/login/auth` (the
  //     verification code form). MarketingTopBar is NOT actually
  //     rendered on `/login/auth` per the comment header in
  //     MarketingTopBar.tsx, but the active-span branch is written
  //     to handle that future route too (e.g. if a follow-up
  //     chrome-treatment adds a "Header preview" option). Asserts
  //     here so the branch is locked even though the production
  //     route currently doesn't exercise it.
  it('on /login/auth, 登录 CTA also has aria-current="page" + active variants (flow-span coverage)', () => {
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/login/auth' })
    const cta = screen.getByRole('link', { name: '登录' })
    expect(cta.getAttribute('aria-current')).toBe('page')
    expect(cta.className).toMatch(/\baria-\[current=page\]:shadow-md\b/)
    expect(cta.className).toMatch(
      /\baria-\[current=page\]:shadow-primary\/40\b/,
    )
  })

  // (g) Round OPT-marketing-chrome v5 contract — when the visitor
  //     is authenticated, the 登录 CTA is REPLACED (not hidden
  //     silently) by a `<UserMenu mode="mobile" />` in the same
  //     visual slot, so the dropdown's 4 PREFERENCE_ITEMS + 登出
  //     (5th item) are shared verbatim across MarketingTopBar
  //     authed branch + AppShell sidebar footer expanded/collapsed
  //     + AppShell mobile AppBar. Asserts:
  //
  //       (i)   the CTA link is GONE
  //       (ii)  the UserMenu mobile-mode trigger renders
  //             (data-testid pinned in v4 chrome-consolidation
  //             round) so test harnesses + e2e specs have a stable
  //             anchor on the authed path.
  //
  //     Locks the v5 single-source-of-truth chrome contract.
  it('when authenticated, 登录 CTA is replaced by <UserMenu mode="mobile" />', () => {
    setAuth({ isAuthenticated: true })
    mountTopBar({ initialPath: '/' })
    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument()
    expect(screen.getByTestId('user-menu-trigger-mobile')).toBeInTheDocument()
  })

  // (h) Round-VISION-FIX — scroll-past 80 px bumps the bottom
  //     hairline from the neutral `border-border/40` envelope to a
  //     full-opacity `border-primary` accent (was /45, perceptually
  //     invisible per browser-use inspection). Locks the new
  //     signal-strength bump so a future regression that drops the
  //     opacity bump OR drops the scroll-past conditional entirely
  //     trips red. Asserts on the rendered <header> element's
  //     className (banner role) — the header tag is the only DOM
  //     element that gets the conditional class, so descendants
  //     (nav / ThemeToggle / Button asChild) cannot pollute the
  //     assertion.
  //
  //     The `mockReturnValueOnce(true)` opt-in is the single
  //     per-test seam: subsequent renders/hook calls fall back to
  //     `false` (the hoisted default), so (h) is the only test
  //     exercising past === true.
  it('scroll-past > 80px: header border lifts to border-primary (full-opacity scroll signal)', () => {
    setAuth({ isAuthenticated: false })
    mockUseScrollPast.mockReturnValueOnce(true)
    mountTopBar({ initialPath: '/' })
    const header = screen.getByRole('banner')
    // Leading-space substring match pins the conditional class
    // presence (header template joins the conditional with a space
    // before the existing class string, so ' border-primary' is
    // always preceded by a space and trailed by end-of-string —
    // both leading-space query match reliably).
    expect(header.className).toContain(' border-primary')
    // Regression shield — past=true must NOT also include the
    // neutral border token (otherwise the conditional is being
    // `||`-ed not `?`-ternary'd, which would render BOTH at once).
    expect(header.className).not.toContain(' border-border/40')
  })

  // (i) Default (scroll < 80 px / jsdom never scrolls): header
  //     border stays neutral `border-border/40`. This pins the
  //     non-scrolled baseline so test (h)'s upgrade is provably
  //     SCROLL-CONDITIONAL, not "border-primary always".
  it('default (no scroll): header border stays neutral border-border/40', () => {
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })
    const header = screen.getByRole('banner')
    expect(header.className).toContain(' border-border/40')
    // No `border-primary` XML token — the conditional MUST default
    // to the neutral class. Leading-space substring match keeps the
    // assertion narrowly scoped to the actual className token (no
    // risk of false-positive matching `text-primary-foreground`
    // inside Button child className strings, which is excluded by
    // querying `banner` role only).
    expect(header.className).not.toContain(' border-primary')
  })

  // (j) Round-OPT-chrome-responsive — at <sm viewport (320 px
  //     iPhone SE 1 / 360 px Android / 375 px iPhone / 414 px iPhone
  //     Plus / 480 px large mobile), the BrandMark's
  //     `<span>social-auto-upload</span>` wordmark must carry the
  //     `hidden sm:inline` Tailwind responsive tokens so the
  //     browser drops the label at <640 px viewport width. Pins
  //     the mobile breakpoint contract at design-time; a future
  //     regression that re-introduces the always-on label (e.g.
  //     drops the `hidden` utility) would silently crowd 320 px
  //     visitors again. matchMedia mock = <sm (sm:false).
  //
  //     Selector: `getByText('social-auto-upload')` matches the
  //     brand-text `<span>` exactly (BrandMark icon's textContent
  //     is `'>_'` per `Components/ui/brand-glyph.tsx::BrandMark` —
  //     the aria-hidden icon's textContent inside the icon does
  //     NOT contain 'social-auto-upload' so the query is
  //     unambiguous).
  it('at <sm viewport, brand-text label has hidden + sm:inline tokens (mobile contract)', () => {
    mockMatchMedia({ sm: false, md: false })
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })
    const brandLabel = screen.getByText('social-auto-upload')
    expect(brandLabel.className).toMatch(/\bhidden\b/)
    expect(brandLabel.className).toMatch(/\bsm:inline\b/)
  })

  // (k) Round-OPT-chrome-responsive — at <md viewport, the 4
  //     static nav links collapse into a Radix DropdownMenu
  //     inside a `<div className="md:hidden">` wrapper. The
  //     inline-cluster wrapper `<div className="hidden ... md:flex">`
  //     stays in the DOM (CSS-side hides it at <md in real
  //     browsers) so the assertion verifies DESIGN INTENT
  //     rather than runtime visibility. matchMedia mock = <md
  //     (md:false). Also asserts the menu trigger button is
  //     reachable by aria-label="导航菜单".
  //
  //     Note: the inline cluster's wrapper className is queried
  //     via `document.querySelector('div.hidden.md\\:flex')`
  //     AND its `md:flex` token, NOT a getByRole query —
  //     because the 4 inline links are inside a `hidden`
  //     wrapper, accessible-name queries still find them BUT
  //     they would be ambiguous with the same-named dropdown
  //     items inside the DropdownMenu content (which is in
  //     document.body via Radix Portal). Selecting via wrapper
  //     className avoids the cross-wrapper ambiguity.
  it('at <md viewport, mobile menu trigger is reachable + inline-cluster wrapper carries hidden md:flex', () => {
    mockMatchMedia({ md: false })
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })
    // Mobile trigger button (icon + "导航菜单" aria-label).
    const menuBtn = screen.getByRole('button', { name: '导航菜单' })
    expect(menuBtn).toBeInTheDocument()
    // Inline cluster wrapper: now carries `hidden md:flex`
    // tokens (CSS-side hides at <md in browsers; pins design
    // intent in jsdom).
    const inlineCluster = document.querySelector(
      'div.hidden.md\\:flex',
    )
    expect(inlineCluster).not.toBeNull()
    expect(inlineCluster?.className).toMatch(/\bmd:flex\b/)
  })

  // (l) Round-OPT-chrome-responsive design-time guard —
  //     MIN_CAN_RENDER_WIDTH is 480 px (the mobile step just below
  //     the sm breakpoint at 640). At <md the mobile chrome is    //     composed of: brand lockup icon (round-OPT-ios-hig-tap-
    //     target bumped from 28×28 to 36×36 at <sm) + nav cluster
    //     (DropdownMenu trigger + 登录 CTA + ThemeToggle compact) +
    //     outer container padding. Layout-math total at <md =
    //     36 brand-icon (mobile HIG) + 32 menu-trigger + ~94 登录 CTA +
    //     28 ThemeToggle compact + 20 nav-gap (gap-5 × 1) +
    //     48 outer padding (px-6 × 2) = 258 px. The 480 px viewport
    //     provides 222 px of headroom (was 190 px with the prior
    //     28×28 brand mark).
  //
  // Viewport-awareness note — test runs at <sm only. parseTwUnit
  // regex `\bh-(\d+)\b` returns FIRST h-N match (viewport-blind).
  // ≥sm flip-back covered by test (m) via className PRESENCE
  // (structural), not width computation (dimensional).
  // parseTwUnit returning 0 (no regex match) is silent — current
  // equality is the parse-fail detector (would fail loudly at
  // zero != target); a future `toBeGreaterThan(8)` lower-bound
  // would under-count softer (h-2 = 8 px = broken-parse parking).
  // Heuristic reads className STRING token order (first match via
  // String.match); Tailwind compiled output applies them per
  // @media source-order — different orderings, heuristic uses only
  // the former (Tailwind default config only; `@layer` overrides
  // or important variants (e.g. `sm:!h-7`) may flip precedence).
  // TODO(round-OPT-future-parse-tw-viewport): retire when parseTwUnitWithViewport lands.
  //
  //     Pin the chrome at design-time: each element's rendered
  //     className maps to a known Tailwind utility → pixel width.
  //     The aggregate sum is asserted ≤ 480 px so a future PR
  //     that (a) adds a 5th nav item, (b) swaps the dropdown
  //     trigger to a 6-char text label, (c) inflates ThemeToggle
  //     to default h-8 w-8 (instead of compact h-7 w-7),
  //     (d) increases outer px-6 to px-8, or (e) widens the gap
  //     utility to gap-6 / gap-8, etc., trips red at design-time
  //     rather than waiting for an e2e Playwright 480-px viewport
  //     test.
  //
  //     Implemented as a `matchMedia` mock + className reads +
  //     sum check because jsdom doesn't compute layout — this
  //     test is a STATIC check on the source-of-truth class
  //     strings, not a runtime layout measurement. Same pattern
  //     is reusable for any future chrome refactor that re-opens
  //     the responsive budget. The constant is hoisted to the
  //     test-local scope (above the `it`) so a future dev
  //     bumping the design admin-knowingly can do so without
  //     hunting through assertions.
  const MIN_CAN_RENDER_WIDTH_PX = 480

  it('mobile chrome fits <sm <md (480 px viewport) min-can-render design-time guard', () => {
    mockMatchMedia({ sm: false, md: false })
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })

    // Per-element class assertions — each maps to a known width.
    // Sum = 28 + 32 + 94 + 28 + 60 + 48 = 290 px ≤ 480 px ✓.
    const header = document.querySelector('header')!
    expect(header.className).toMatch(/\bpx-6\b/) // outer L+R = 48 px

    // Brand icon: data-testid="brand-mark" (added directly to
    // `Components/ui/brand-glyph.tsx::BrandMark`'s <div> in the
    // round-OPT-stable-testids follow-up). Scoped to header — if a
    // future chrome-preview surface nests another BrandMark inside
    // header (e.g. authed UserMenu trigger), `document.querySelector`
    // would silently first-match the wrong one; `header.querySelector`
    // keeps the lookup bound to the chrome under test.
    // Mobile target box: 36×36 (`size="md"` baseline at <sm).
    // The className co-occurs with `sm:h-7 sm:w-7 sm:text-[13px]`
    // overrides that flip back to 28×28 desktop density at ≥sm
    // — those override tokens are inert below the sm breakpoint,
    // so the first h-N match `\bh-9(\d+)` correctly drives
    // parseTwUnit → boxWidthFromClass to 36 px here. Test (m)
    // pins the override presence at ≥sm viewport for the
    // flip-back contract.
    const brandIcon = header.querySelector('[data-testid="marketing-brand-mark"]')
    expect(brandIcon).not.toBeNull()
    expect(brandIcon?.className ?? '').toMatch(/\bh-9 w-9\b/) // 36 px (mobile iOS HIG)

    const menuBtn = screen.getByRole('button', { name: '导航菜单' })
    expect(menuBtn.className).toMatch(/\bh-8 w-8\b/) // 32 px

    const cta = screen.getByRole('link', { name: '登录' })
    expect(cta.className).toMatch(/\bh-8 px-4\b/) // ~94 px

    const themeBtn = header.querySelector('[data-testid="theme-toggle"]')
    expect(themeBtn).not.toBeNull()
    expect(themeBtn?.className ?? '').toMatch(/\bh-7 w-7\b/) // 28 px (compact)

    const nav = header.querySelector('nav')!
    expect(nav.className).toMatch(/\bgap-5\b/) // 60 px (3 gaps between 4 children)

    // Dynamic aggregate — parses each rendered className via inline
    // Tailwind utility helpers (`twPx` / `parseTwUnit` /
    // `parseTextFontSize` / `boxWidthFromClass`) instead of the
    // hardcoded `28 + 32 + 94 + 28 + 60 + 48` constant the prior
    // round used. Future PRs that bump `h-N` / `w-N` / `px-N` /
    // `text-[N]` / `gap-N` on any chrome element (e.g. `BrandMark`
    // `size="md"` for 44×44 iOS HIG tap target) are auto-tracked —
    // no manual constant drag-along needed. Pin: 1 Tailwind unit =
    // 4 px (assumes rem=16 per Tailwind default).
    function twPx(n: number): number { return n * 4 }
    function parseTwUnit(
      className: string,
      util: 'h' | 'w' | 'gap' | 'px',
    ): number {
      const m = className.match(new RegExp(`\\b${util}-(\\d+)\\b`))
      return m ? parseInt(m[1], 10) : 0
    }
    function parseTextFontSize(className: string): number {
      // Parses `text-[Npx]` arbitrary value. Named tokens
      // (`text-sm`=14, `text-md`=16, ...) fall back to 14 px
      // default — covers the chrome's `text-[13px]` case fully
      // and is conservative for any future `text-sm` migration.
      const m = className.match(/\btext-\[(\d+)px\]/)
      return m ? parseInt(m[1], 10) : 14
    }
    function boxWidthFromClass(
      className: string,
      textChars: number = 0,
    ): number {
      const h = twPx(parseTwUnit(className, 'h'))
      const w = twPx(parseTwUnit(className, 'w'))
      const px = twPx(parseTwUnit(className, 'px')) * 2 // both sides
      if (w > 0) return Math.max(h, w) // explicit-width element
      return h + px + parseTextFontSize(className) * textChars
    }

    const outerPadding =
      twPx(parseTwUnit(header.className, 'px')) * 2
    const brandIconEl = brandIcon as HTMLElement
    const brandWidth = boxWidthFromClass(brandIconEl.className)
    const menuWidth = boxWidthFromClass(menuBtn.className)
    const ctaWidth = boxWidthFromClass(cta.className, 2) // 登录 = 2 chars
    const themeBtnEl = themeBtn as HTMLElement
    const themeWidth = boxWidthFromClass(themeBtnEl.className)
    const innerGaps =
      twPx(parseTwUnit(nav.className, 'gap')) *
      Math.max(0, nav.children.length - 1)
    const totalChrome =
      outerPadding + brandWidth + menuWidth + ctaWidth + themeWidth + innerGaps

    // Belt-and-suspenders — each parsed width matches the design
    // constant. Catches parser-regex bugs as single-failure
    // pinpoints rather than silent aggregate drift. CTA range
    // pinned conservatively (80-120) because text width varies
    // ±5 px with browser anti-aliasing / font kerning.
    expect(outerPadding).toBe(48)
    expect(brandWidth).toBe(36)
    expect(menuWidth).toBe(32)
    expect(themeWidth).toBe(28)
    expect(ctaWidth).toBeGreaterThanOrEqual(80)
    expect(ctaWidth).toBeLessThanOrEqual(120)

    expect(totalChrome).toBeLessThanOrEqual(MIN_CAN_RENDER_WIDTH_PX)
  })

  // (m) Round-OPT-ios-hig-tap-target — at ≥sm viewport the
  //     BrandMark's sm:-prefixed overrides sm:h-7 sm:w-7
  //     sm:text-[13px] must be present so the desktop chrome
  //     flips back from the mobile 36×36 target to the
  //     conventional 28×28 density. Pins the override
  //     mechanism so a future PR that refactors BrandMark to
  //     a single `h-7 w-7` default (forgetting the mobile
  //     upgrade) trips red here. matchMedia mock: ≥sm
  //     (sm:true, md:true).
  //
  // Cross-ref test (l) header for parseTwUnit viewport-blindness — this test asserts PRESENCE not DIMENSION.
  it('at ≥sm viewport, BrandMark sm:h-7 / sm:w-7 / sm:text-[13px] flips chrome back to 28×28 desktop density', () => {
    mockMatchMedia({ sm: true, md: true })
    setAuth({ isAuthenticated: false })
    mountTopBar({ initialPath: '/' })
    const header = screen.getByRole('banner')
    const brandIcon = header.querySelector('[data-testid="marketing-brand-mark"]')
    expect(brandIcon).not.toBeNull()
    // Override presence — co-occurrence of these tokens in
    // className is what makes the breakpoint flip work at
    // CSS layer (Tailwind compiled media query wins source
    // order over base utilities).
    expect(brandIcon?.className ?? '').toMatch(/\bsm:h-7\b/)
    expect(brandIcon?.className ?? '').toMatch(/\bsm:w-7\b/)
    expect(brandIcon?.className ?? '').includes('sm:text-[13px]')
    // Sanity — the underlying baseline size is still `md`
    // (h-9 w-9 text-[17px]); at ≥sm the overrides win, but
    // they're explicit per-token, not just `size="sm"`.
    expect(brandIcon?.className ?? '').toMatch(/\bh-9 w-9\b/)
  })
})
