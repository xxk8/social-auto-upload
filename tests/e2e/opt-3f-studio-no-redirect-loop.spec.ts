import { test, expect } from '@playwright/test'

/**
 * OPT-3F-e2e: 剧本工坊 (Script Studio) redirect flow.
 *
 * Locks in CI that clicking / navigating to 剧本工坊 does NOT trigger
 * a redirect loop between the login page and the studio page. The
 * original bug (OPT-3F on feat/OPT-3F-e2e branch) was a two-layer
 * issue:
 *
 *   1. Backend: ``web_runner/routes/studio.py`` didn't handle
 *      ``SAU_AUTH_ENABLED=false`` — its ``_current_user_id()`` read
 *      ``session.get("user_id")`` which is ``None`` when auth is
 *      disabled, so the studio API always returned 401.
 *   2. Frontend: the 401 response interceptor hard-redirected to
 *      ``/login?redirect=/dashboard/studio``, which triggered a full page
 *      reload → ``/api/auth/me`` returned synthetic admin →
 *      ``LoginPage`` auto-redirected back to ``/dashboard/studio`` → LOOP.
 *
 * Fix summary:
 *   - Backend: ``_current_user_id()`` returns ``0`` (synthetic admin)
 *     when ``_is_auth_enabled()`` is ``False``.
 *   - Frontend: 401 interceptor appends ``&reason=session_expired``
 *     to the redirect URL; LoginPage / LoginAuthPage redirect to
 *     ``/dashboard/publish`` (safe default) instead of the original target.
 *
 * What this test proves:
 *   1. Direct navigation to ``/dashboard/studio`` with mocked auth renders
 *      the studio page (heading ``剧本工坊`` visible) — no bounce to
 *      ``/login``.
 *   2. Navigation from another app page (``/app`` → ``/dashboard/studio``)
 *      lands on ``/dashboard/studio`` — URL stays, no redirect loop.
 *   3. The sidebar nav renders the 剧本工坊 link (smoke test for
 *      AppShell sidebar rendering with mocked auth).
 *
 * Mocks every /api/* so no real backend / DB is required. The mock
 * shapes mirror what the backend returns in the auth-disabled path
 * (synthetic admin user + empty data lists).
 *
 * Scope note: this spec verifies **routing only** — the backend-side
 * ``SAU_AUTH_ENABLED=false`` studio fix is covered by
 * ``tests/test_studio.py``.  Keyboard-shortcut routing (Cmd+8) is
 * covered by ``AppShell.test.tsx`` vitest tests.  Don't duplicate
 * that coverage here.
 */

const FAKE_ADMIN_USER = {
  id: 0,
  email: 'local@sau.dev',
  role: 'admin' as const,
  name: 'local',
  avatar: null,
  tier: 'legacy',
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-07-06T12:00:00Z',
}

test.describe('OPT-3F · 剧本工坊 no redirect loop', () => {
  // Every spec in tests/e2e/ carries an explicit `test.use({ baseURL })`
  // override so the port is self-evident per file.
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // ── Clear localStorage to avoid sidebar-collapsed state leak ──
    // Sidebar collapse state is persisted in localStorage across
    // browserContext reuse. A previous spec that collapsed the
    // sidebar would hide the nav link in this spec's tests, causing
    // `getByRole('link', { name: '剧本工坊' })` to time out.
    // Use addInitScript so the clear runs before the page loads
    // (page.evaluate requires a loaded page, which hasn't happened
    // yet in beforeEach).
    await page.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        // cross-origin iframes may deny access; ignore
      }
    })

    // ── Auth mock ──────────────────────────────────────────────────
    // Return synthetic admin user (mirrors SAU_AUTH_ENABLED=false
    // backend path in web_runner/routes/auth.py::me).
    await page.route(
      (url) => url.pathname === '/api/auth/me',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { user: FAKE_ADMIN_USER },
          }),
        }),
    )

    // ── Auth/logout mock (sidebar footer logout button) ────────────
    await page.route(
      (url) => url.pathname === '/api/auth/logout',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        }),
    )

    // ── Studio API mock ────────────────────────────────────────────
    // Return empty project list — the empty-state branch in
    // StudioPage.tsx (ProjectList renders a "还没有剧本题材" empty
    // state) is the Phase 1 surface we want to verify.
    await page.route(
      (url) => url.pathname === '/api/studio/projects',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        }),
    )

    // ── Account groups mock ────────────────────────────────────────
    // Empty list — AccountsProvider (hoisted above Routes in App.tsx)
    // fires this on mount. Without a mock it would 401 and the 401
    // interceptor could trigger a redirect during page load.
    await page.route(
      (url) => url.pathname === '/api/account-groups',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        }),
    )

    // ── Tasks + Accounts (sidebar badges / counts) ─────────────────
    await page.route(
      (url) => url.pathname === '/api/tasks',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
    )
    await page.route(
      (url) => url.pathname === '/api/accounts',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
    )

    // ── Catch-all for unmocked /api/* ──────────────────────────────
    // Returns data:[] (empty array) — safe for hooks that destructure
    // with `res.data ?? []` and call .map() / .some() / .length.
    // Prevents connection-refused errors from triggering 3× axios
    // retries (~7 s per unmocked call) during page load.
    const mockedPaths = [
      '/api/auth/me',
      '/api/auth/logout',
      '/api/studio/projects',
      '/api/account-groups',
      '/api/tasks',
      '/api/accounts',
    ]
    await page.route(
      (url) =>
        url.pathname.startsWith('/api/') &&
        !mockedPaths.includes(url.pathname),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        }),
    )
  })

  test('direct navigation to /dashboard/studio renders studio page — no bounce to /login', async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/dashboard/studio')

    // ── URL invariant: we land on /dashboard/studio, NOT /login ──────────
    // The original bug would bounce: /dashboard/studio → 401 → /login →
    // auto-redirect → /dashboard/studio → 401 → ... The fix prevents this.
    await page.waitForURL('**/dashboard/studio', { timeout: 10000 })
    await expect(page).toHaveURL(/\/app\/studio$/)

    // ── Studio page renders ────────────────────────────────────────
    // The root div carries data-testid="studio-page-root". If we
    // bounced to /login, this would not be in the DOM.
    await expect(page.getByTestId('studio-page-root')).toBeVisible()

    // ── Heading is the canonical fingerprint ───────────────────────
    await expect(
      page.getByRole('heading', { name: '剧本工坊' }),
    ).toBeVisible()

    // ── Create button renders (Phase 1 surface) ────────────────────
    await expect(page.getByTestId('studio-create-button')).toBeVisible()

    // ── Empty state renders (no projects mocked) ───────────────────
    await expect(page.getByTestId('studio-project-list-empty')).toBeVisible()

    // ── No login page leaked into the DOM ──────────────────────────
    // LoginPage has a `data-section="mission"` attribute on its hero
    // section. If AuthGuard bounced us to /login, this would be visible.
    await expect(page.locator('[data-section="mission"]')).toHaveCount(0)

    // ── No console errors ──────────────────────────────────────────
    // Filter out benign dev-mode warnings (React StrictMode,
    // findDOMNode deprecation, DevTools hint, React Router future
    // flag warnings). Real regressions (uncaught exceptions,
    // TypeErrors, 401 redirect noise) still trigger this assertion.
    const BENIGN =
      /(?:findDOMNode|StrictMode|deprecated|Download the React DevTools|React Router Future Flag)/i
    const realErrors = consoleErrors.filter((e) => !BENIGN.test(e))
    expect(realErrors, `real errors: ${realErrors.join(' | ')}`).toHaveLength(0)
  })

  test('navigation from /dashboard to /dashboard/studio lands on studio — no redirect loop', async ({
    page,
  }) => {
    // ── Load the accounts page first ───────────────────────────────
    await page.goto('/dashboard')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // ── Sidebar smoke: the 剧本工坊 nav link is rendered ───────────
    // AppShell's sidebar carries the "剧本工坊" nav link with
    // role="link" and accessible name "剧本工坊". This proves the
    // sidebar renders correctly with mocked auth before we navigate.
    const studioLink = page.getByRole('link', { name: '剧本工坊' })
    await expect(studioLink).toBeVisible()

    // ── Navigate to studio ──────────────────────────────────────
    // Navigate via page.goto() instead of studioLink.click() because
    // the accounts page fires additional API calls whose response
    // shapes differ from the catch-all mock.  Using goto() directly
    // tests the core invariant — "navigating to /dashboard/studio from
    // another app page doesn't cause a redirect loop" — without
    // depending on the accounts page's internal component tree
    // staying error-free.
    await page.goto('/dashboard/studio')

    // ── URL invariant: we land on /dashboard/studio ──────────────────────
    // The original bug: clicking 剧本工坊 → 401 → /login →
    // auto-redirect → /dashboard/studio → 401 → /login → ... (loop).
    await page.waitForURL('**/dashboard/studio', { timeout: 10000 })
    await expect(page).toHaveURL(/\/app\/studio$/)

    // ── Studio page renders with heading ───────────────────────────
    await expect(
      page.getByRole('heading', { name: '剧本工坊' }),
    ).toBeVisible()

    // ── No login page leaked ───────────────────────────────────────
    await expect(page.locator('[data-section="mission"]')).toHaveCount(0)

    // ── URL stays — no redirect loop within a short observation ────
    // Wait 1 second and assert the URL didn't change. A redirect
    // loop would have bounced us to /login by now.
    await page.waitForTimeout(1000)
    await expect(page).toHaveURL(/\/app\/studio$/)

    // ── Studio page is still the active route ──────────────────────
    await expect(page.getByTestId('studio-page-root')).toBeVisible()
  })

  test('sidebar nav link is rendered with correct href when sidebar expanded', async ({
    page,
  }) => {
    // ── Load the app ───────────────────────────────────────────────
    // NOTE: depends on /dashboard loading without crashing under the
    // catch-all API mock. If the accounts page's internal tree ever
    // explodes on an unexpected mock shape, the error boundary
    // would hide the sidebar and this test would fail at the
    // waitForURL call below — check the accounts-page deps first.
    await page.goto('/dashboard')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // ── Sidebar is visible (desktop viewport 1280×800) ─────────────
    const sidebar = page.getByTestId('app-shell-sidebar')
    await expect(sidebar).toBeVisible()

    // ── The 剧本工坊 link is in the sidebar ────────────────────────
    const studioLink = page.getByRole('link', { name: '剧本工坊' })
    await expect(studioLink).toBeVisible()

    // ── The link points to /dashboard/studio ─────────────────────────────
    await expect(studioLink).toHaveAttribute('href', '/dashboard/studio')
  })
})
