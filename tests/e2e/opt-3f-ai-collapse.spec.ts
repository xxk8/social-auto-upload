import { test, expect } from '@playwright/test'

/**
 * OPT-3F-e2e (1/3): AI sidebar collapse + localStorage persistence.
 *
 * Surface anchors (verified against feat/OPT-3J on feat/OPT-3F-e2e):
 *   - `ls key:   'sau-publish-ai-collapsed'`
 *   - expanded mode close button: aria-label "收起 AI 助手"
 *   - collapsed mode expand button: aria-label "打开 AI 助手"
 *
 * What this proves:
 *   - User clicks "收起 AI 助手" → LS key flipped to "true".
 *   - Reload → panel renders in collapsed state (rail), expand
 *     button (aria-label="打开 AI 助手") is visible AND the
 *     expanded-state close button (aria-label="收起 AI 助手") is
 *     not visible in the rail DOM tree.
 *   - User clicks "打开 AI 助手" → LS key flipped to "false"; reload
 *     returns to expanded state.
 *
 * The form/groups API is mocked so the publish page can mount without
 * a live backend. The shell's TanStack Query calls return canned
 * shapes that {@link mockShellApis} mirrors from the existing Python
 * fixtures the vitest tests already rely on.
 */
test.describe('OPT-3F · AI sidebar collapse + LS persistence', () => {
  // Explicit `test.use({ baseURL: 'http://localhost:5180' })` —
  // mirrors the global `use.baseURL` already set in
  // `playwright.config.ts`. Kept per-spec so every e2e spec in
  // tests/e2e/ is self-contained about which port it targets,
  // independent of any future global-config flip. Pre-merge this
  // spec was authored against :5174 (the standalone marketing
  // Vite, since removed via `sau_web/site/` deletion); post-merge
  // :5180 is the merged SPA port serving both marketing + dashboard.
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    await mockShellApis(page)
    // Playwright provides a fresh context per test (no storageState
    // configured), so localStorage is already clean. Do NOT use
    // addInitScript to clear LS — it fires on every page load
    // including page.reload(), which breaks LS-persistence tests.
  })

  test('collapse → LS flips → reload restores collapsed rail', async ({ page }) => {
    // Navigate directly to /dashboard/publish (the canonical route).
    // /publish is a legacy shim that Navigates → /dashboard/publish;
    // going direct avoids the extra redirect tick.
    await page.goto('/dashboard/publish')

    // Sanity: expanded panel renders the close button + the panel
    // region id we anchor assertions on.
    await expect(page.getByRole('button', { name: '收起 AI 助手' })).toBeVisible()

    // Click the OPT-3F collapse affordance.
    await page.getByRole('button', { name: '收起 AI 助手' }).click()

    // LS key must immediately reflect the user choice.
    const lsValue = await page.evaluate(() =>
      window.localStorage.getItem('sau-publish-ai-collapsed'),
    )
    expect(lsValue).toBe('true')

    // Reload; on hydrate the lazy initializer reads LS and the panel
    // should render in collapsed state — the close button disappears
    // and the open-in-rail button takes its place.
    await page.reload()
    await expect(page.getByRole('button', { name: '打开 AI 助手' })).toBeVisible()
    await expect(page.getByRole('button', { name: '收起 AI 助手' })).toHaveCount(0)

    // And the inverse path: open back up, LS clears, reload restores
    // the expanded panel.
    await page.getByRole('button', { name: '打开 AI 助手' }).click()
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem('sau-publish-ai-collapsed'),
      ),
    ).toBe('false')
    await page.reload()
    await expect(page.getByRole('button', { name: '收起 AI 助手' })).toBeVisible()
  })
})

/**
 * Mock the absolute-minimum slice of /api that PublishPage mounts on:
 *   - GET /api/account-groups — drives the group picker
 *   - GET /api/tasks           — drives the OPT-V-2 last-task-tone stat
 *   - GET /api/accounts        — drives the KPI counter
 *
 * Returning `[]` keeps the page in its empty-state without firing
 * any of the deeper action branches (login, video upload). The
 * 副作用 of `[]` is that chip / file upload / form submit surfaces
 * we exercise elsewhere are not reachable on this spec — by design.
 */
async function mockShellApis(page: import('@playwright/test').Page) {
  // Auth mock — needed for AuthGuard to flip isAuthenticated
  // so the PublishPage (behind /app/* → AppShell) can mount.
  // Function predicates: unambiguous pathname matching handles
  // the axios _t=timestamp query param correctly.
  await page.route(
    (url) => url.pathname === '/api/auth/me',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: { id: 1, email: 'qa@example.com', role: 'admin', created_at: '2026-01-01T00:00:00Z', last_login: '2026-06-26T00:00:00Z' } } }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/account-groups',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/tasks',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/accounts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )

  // Catch-all for unmocked /api/* endpoints — prevents connection-refused
  // errors from triggering 3× axios retries (~7 s per unmocked call).
  // Returns data:[] (empty array) — safe for hooks that destructure
  // with `res.data ?? []` and call .map()/.some()/.length on the result.
  await page.route(
    (url) => url.pathname.startsWith('/api/') && !['/api/auth/me', '/api/account-groups', '/api/tasks', '/api/accounts'].includes(url.pathname),
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }),
  )
}
