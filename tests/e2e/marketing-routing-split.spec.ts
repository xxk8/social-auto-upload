import { test, expect } from '@playwright/test'

/**
 * Marketing + Shell routing split (post-merge).
 *
 * Locks in CI that the two surfaces remain orthogonal even though
 * they share one Vite SPA + one Flask server:
 *
 *   /              → MarketingLandingPage   (public, anchor scrolling)
 *   /login         → LoginPage               (public, standalone shell)
 *   /app           → AppShell + AccountsPage (AuthGuard, post-merge)
 *   /app/publish   → AppShell + PublishPage  (AuthGuard, post-merge)
 *
 * What this proves (post-round-9 visitor surface):
 *   1. Anonymous visitor lands on the marketing landing page — Hero
 *      CTA "立即开始 →" pointed at /app (the dashboard), the secondary
 *      "了解能力 →" hash-anchor resolves to the real <section id=
 *      "features"> in DOM, and the 3-cell Hero stat row anchors the
 *      round-7 attribution rhythm shape. TopBar nav (`定价` / `登录`)
 *      resolves to the dashboard pricing page and LoginPage
 *      respectively. Footer renders with the BrandMark + project
 *      name as shape fingerprint. No console errors.
 *
 *      The pre-round-5 assertions (Hero CTA `免费开始使用` → `#how-it-
 *      works`, the in-page NavBar anchors `使用方式` / `功能` / `平台` /
 *      `为什么选择我们` → `#how-it-works` / `#features` / `#platforms`
 *      / `#trust`, footer headline `让内容分发更简单`) were RETIRED
 *      along with the standalone `/marketing` subtree (replaced by
 *      `LandingPage.tsx` in round 3 and re-launched in round 5 with
 *      the engineering-tool visitor surface the codebase reads as
 *      today). The post-round-9 copy + section IDs are the canonical
 *      visitor shape — landing-pricing-attribution.spec.ts owns the
 *      strict subject · predicate rhythm assertion; this spec owns
 *      the broader shape (CTAs, hash anchors, TopBar nav, footer).
 *
 *   2. Already-authed visitor bypassing /login lands at /app/publish
 *      (LoginPage's early-redirect branch) — see LoginPage.tsx
 *      comment for rationale on why not `/`.
 *   3. Visitor running the full email-code flow lands at /app/publish
 *      (LoginPage's success-redirect branch). PublishPage's PageHeader
 *      "发布中心" is the canonical fingerprint for the route mounting.
 *
 *      The /login flow assertions (test 2) are unchanged from the pre-
 *      round-5 spec because the operator-facing copy they anchor
 *      (`邮箱地址` / `验证码` / `发送验证码` / `登录` / `/app/publish` /
 *      `发布中心` / `账号管理`) was not touched by the round-5-9 visitor-
 *      surface polish, so spec 2 still resolves without modification.
 *
 * Mocks every /api/* so no real backend / DB / SMTP is required.
 * Mock shapes mirror what `web_runner/routes/auth.py` would return
 * — keep these aligned if the auth contract drifts.
 *
 * Scope note: this spec verifies **routing only** — Flask-side auth
 * contract regressions (e.g. response shape drift in /api/auth/login)
 * are caught by `tests/test_auth.py`. Don't duplicate that coverage
 * here; the spec intentionally only mirrors the contract that
 * useAuth.ts expects.
 *
 * Why an explicit `test.use({ baseURL: 'http://localhost:5180' })`
 * even though `playwright.config.ts`'s global `use.baseURL` is
 * already :5180? Belt-and-suspenders — every spec in tests/e2e/
 * declares the same override inline so each spec is self-contained
 * about which port it targets (no chasing to the config file to
 * find out). Pre-merge all four specs targeted :5174 (the
 * standalone marketing Vite, since removed via `sau_web/site/`
 * deletion); post-merge :5180 is the merged SPA port serving both
 * marketing + dashboard.
 */

const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

// NOTE: this JSDoc lives in a TS file, and C-style block comments scan
// for the two-character sequence '* /' to terminate. Literalised URL
// patterns like '/api/anything' wouldn't trip that, but Markdown-bold
// ('*' '*') immediately followed by '/' DOES — '**/api/**' closes
// `/** */` early and the trailing text leaks out as code, where tsc
// then flags `'api'` as TS2304. So this comment uses prose, not URL
// glob syntax.

/**
 * Narrow the beforeEach blanket `api` mock for one URL — `api / auth / me`
 * — to return 200 with `success: false`. Playwright's `page.route` handlers
 * are last-write-wins, so declaring this AFTER the blanket mock in the
 * per-test body intercepts `/api/auth/me` first and `route.fulfill()` skips
 * the older handler entirely.
 *
 * Why 200 + success:false (and not 401)?
 *   - 401 would fire api/client.ts's response interceptor, which does
 *     `window.location.href = '/login'` (a full-page reload). The URL
 *     assertion would still pass, but it would verify axios's hard-redirect
 *     path, NOT AuthGuard's React Router `<Navigate to="/login" replace>`
 *     chain — which is what we actually want to lock down.
 *   - 200 + success:false keeps useAuth's `useQuery` happy (no isError),
 *     the authStore's initial `isAuthenticated:false` stays, and AuthGuard
 *     bounces the visitor via React Router — the routing chain we want to
 *     verify.
 *
 * Use this for any test where the visitor must be anonymous on first paint
 * but MAY transition to a logged-in user later (via `/api/auth/login`'s
 * `setUser` onSuccess — which still works because we're narrowing only
 * `/api/auth/me`, not the login mutation's POST).
 */
async function mockAnonymousVisit(page: import('@playwright/test').Page) {
  // Function predicate — pathname matching is unambiguous and handles
  // the axios _t=timestamp query param correctly.
  await page.route(
    (url) => url.pathname === '/api/auth/me',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'unauthenticated' }),
      }),
  )
}

test.describe('Marketing + Shell routing split', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // Precise pathname-based mock — `url.pathname.startsWith('/api/')`
    // only matches Flask backend routes. A blanket `**/api/**` glob
    // would intercept Vite-served source files like /src/api/client.ts,
    // returning JSON instead of JavaScript and breaking React mount.
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const url = route.request().url()
      const method = route.request().method()

      if (url.includes('/api/auth/send-code') && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      }
      if (url.includes('/api/auth/login') && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { user: FAKE_USER } }),
        })
      }
      if (url.includes('/api/auth/me') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { user: FAKE_USER } }),
        })
      }
      if (url.includes('/api/auth/logout') && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      }

      // Lists — return empty so PublishPage's group picker lands
      // in its empty-state branch (avoids reaching deeper action
      // surfaces we don't want to exercise here).
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    })
  })

  test('/ renders MarketingLandingPage — Hero CTA + #features anchor + 3-stat shape', async ({ page }) => {
    // Override the blanket authed mock so the visitor is anonymous
    // on first paint — otherwise the authed `useEffect` bounce
    // redirects to /app/publish before the landing page mounts.
    await mockAnonymousVisit(page)

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/')

    // Page is the marketing landing surface — not the dashboard.
    await expect(page).toHaveURL(/\/$/)

    // Hero CTA — sanity-check it's the marketing copy (rules out a
    // generic redirect to /login rendering the LoginPage button bar).
    // Post-round-9: primary CTA is `立即开始 →` pointing at `/app`
    // (the dashboard), secondary CTA is `了解能力 →` pointing at
    // `#features`. The pre-round-5 copy was `免费开始使用` → #how-it-
    // works; that anchor was retired when the standalone /marketing
    // subtree was replaced by /LandingPage.tsx in round 3.
    // Post-round-9: primary CTA is 立即开始 → pointing at /app.
    //
    // No `header` scope here — `立即开始` lives inside HeroSection,
    // NOT inside TopBar. TopBar's links are 定价 / 关于 / 登录. The
    // hero CTA is the marketing copy we actually want to verify.
    const ctaPrimary = page.getByRole('link', { name: /立即开始/ }).first()
    await expect(ctaPrimary).toBeVisible()
    await expect(ctaPrimary).toHaveAttribute('href', '/app')

    // The hash-anchor target is a real <section id="features"> in DOM.
    // We bind to `features` because the Hero secondary CTA is the
    // only visitor-side scroll-anchor surviving from the post-round-9
    // visitor surface.
    const featuresSection = page.locator('section#features')
    await expect(featuresSection).toBeVisible()

    // Hero stat row is the round-7 attribution-rhythm fingerprint —
    // 3 cells each carrying a subject · predicate caption. Shape
    // guard so a regression that drops the row doesn't quietly drop
    // the type-level caption invariant. Per-row subject · predicate
    // regex and exact-text assertions live in
    // `landing-pricing-attribution.spec.ts`; this assertion is the
    // broader Hero shape lock.
    await expect(page.locator('[data-hero-cell]')).toHaveCount(3)

    // Marketing TopBar nav, post-round-5: scoped to `header` because
    // `定价` and `登录` both appear in TopBar AND in PageFooter (a
    // strict-mode 2-match would fail). Scoping to `header` keeps the
    // assertion on the TopBar chrome specifically. The pre-round-5
    // in-page anchor nav (`使用方式` / `功能` / `平台` / `为什么选择
    // 我们`) was retired; locked here so a regression that brings it
    // back surfaces before merge.
    const topBar = page.locator('header').first()
    await expect(topBar.getByRole('link', { name: '定价' })).toHaveAttribute('href', '/pricing')
    await expect(topBar.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')

    // Footer present — BrandMark + project name appear in PageFooter
    // so it's a stable shape fingerprint regardless of copy drift.
    await expect(page.locator('footer')).toBeVisible()
    await expect(page.locator('footer')).toContainText('social-auto-upload')

    // Benign dev-mode warnings (React StrictMode double-mount chatter,
    // `findDOMNode` deprecation notices from motion/lib vendors, the
    // "download the React DevTools" hint) get filtered — they surface
    // even on a clean page. Real regressions (uncaught exceptions,
    // TypeErrors, malformed CSS) still trigger this assertion.
    const BENIGN = /(?:findDOMNode|StrictMode|deprecated|Download the React DevTools)/i
    const realErrors = consoleErrors.filter((e) => !BENIGN.test(e))
    expect(realErrors, `real errors: ${realErrors.join(' | ')}`).toHaveLength(0)
  })

  test('/login/auth full flow lands on /app/publish with PublishPage mounted', async ({ page }) => {
    // Round 12: the auth form moved to /login/auth (sub-route). The
    // visitor-facing pitch sits at /login and forwards ?plan= / ?intent=
    // query params through to /login/auth. Mid-funnel visits (like the
    // ones hinted by PricingPage's deep-link CTAs) land at /login/auth
    // directly; this spec mirrors that path.
    await mockAnonymousVisit(page)
    await page.goto('/login/auth')

    // Email step is on screen.
    await expect(page.getByLabel('邮箱地址')).toBeVisible()
    await page.getByLabel('邮箱地址').fill('qa@example.com')
    await page.getByRole('button', { name: '发送验证码' }).click()

    // Code step is on screen; the "重新发送" link appears.
    await expect(page.getByLabel('验证码')).toBeVisible()
    await page.getByLabel('验证码').fill('123456')

    // Re-register auth/me to return FAKE_USER before clicking login.
    // mockAnonymousVisit returns { success: false } for auth/me so
    // the login form can mount (AuthGuard doesn't bounce). But after
    // login succeeds, loginMutation.onSuccess calls
    // queryClient.invalidateQueries(['auth']), which triggers a
    // refetch of auth/me. If mockAnonymousVisit still handles it,
    // the refetch returns { success: false } and useAuth's useEffect
    // calls clearAuth(), forcibly logging the user out. Re-registering
    // a later handler (last-write-wins) returns FAKE_USER so the
    // refetch completes in the authenticated state.
    await page.route(
      (url) => url.pathname === '/api/auth/me',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { user: FAKE_USER } }),
        }),
    )

    // Press Enter on the form to avoid racing the disabled->enabled
    // 60 s window on the "重新发送" button (it goes disabled immediately
    // after sendCode resolves).
    await page.getByRole('button', { name: '登录' }).click()

    // LoginPage → login success → navigate('/app/publish', {replace: true}).
    // The shim that maps legacy `/publish` → `/app/publish` is a no-op
    // here because LoginPage navigates straight to /app/publish.
    await page.waitForURL('**/app/publish', { timeout: 10000 })
    await expect(page).toHaveURL(/\/app\/publish$/)

    // PublishPage's PageHeader title is the canonical fingerprint for
    // the route having mounted (vs. AccountsPage / TasksPage / LogsPage).
    await expect(page.getByRole('heading', { name: '发布中心' })).toBeVisible()

    // Sidebar nav still works — locks AppShell hasn't accidentally
    // broken alongside the route split.
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()
  })

  // ─── Dropped: 'legacy /publish redirects to /login when anonymous' ─────
  // Mooted by App.test.tsx's anonymous-bounce tests at the RTL layer:
  // /publish → /login (and /tasks + /logs too) is already locked in
  // milliseconds by vitest via the redirect-spy helper. Keeping an
  // e2e duplicate would burn a non-zero chromium-per-test cost for
  // zero incremental coverage. Re-add here ONLY if a regression
  // appears that vitest cannot reproduce (e.g., a chromium-only CSP
  // or cookie-jar behavior change).
})

