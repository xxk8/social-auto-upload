// ─────────────────────────────────────────────────────────────────────
// PageWrapper visual regression
//
// Catches layout regressions introduced by changes to the shared
// PageWrapper component (padding, max-width, PageHeader spacing,
// responsive behaviour).
//
// Runs against the local Web Shell on :5180. Mock all /api routes so
// the test is deterministic and does not need a real backend.
//
// Run:
//   pnpm e2e pagewrapper-visual-regression
//
// Update baselines after an intentional visual change:
//   pnpm e2e:update-snapshots pagewrapper-visual-regression
//
// Baselines are stored in tests/e2e/__snapshots__/ and should be
// committed to version control.
// ─────────────────────────────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'

// Stable, deterministic user fixture.
const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

// Pages that exercise the PageWrapper variants across the dashboard.
const PAGES = [
  { route: '/dashboard', name: 'accounts', variant: 'default', waitText: '账号管理' },
  { route: '/dashboard/admin', name: 'admin-overview', variant: 'default-topnav', waitText: '系统概览' },
  { route: '/dashboard/publish', name: 'publish', variant: 'publish', waitText: '发布中心' },
  { route: '/dashboard/analytics', name: 'analytics', variant: 'default', waitText: '数据分析' },
  { route: '/dashboard/settings', name: 'settings', variant: 'default', waitText: '设置' },
  { route: '/dashboard/studio', name: 'studio', variant: 'default', waitText: '剧本工坊' },
  { route: '/dashboard/crawl', name: 'crawl', variant: 'default', waitText: '数据采集' },
] as const

async function mockShellApis(page: Page) {
  // IMPORTANT: Register the catch-all FIRST and the specific mocks LAST.
  // Playwright evaluates routes in reverse registration order, so the
  // specific handlers below will win over this fallback.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )

  await page.route(
    (url) => url.pathname === '/api/auth/me',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: FAKE_USER } }),
      }),
  )

  // Empty deterministic responses keep the UI in empty states so the
  // PageWrapper shell (padding / spacing / max-width) is what we are
  // actually comparing, not volatile data.
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
    (url) => url.pathname === '/api/accounts',
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
    (url) => url.pathname === '/api/logs',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )

  // Admin routes
  await page.route(
    (url) => url.pathname === '/api/admin/overview',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            total_users: 0,
            active_today: 0,
            total_tasks: 0,
            task_success_rate: 0,
            recent_actions: [],
          },
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/users',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/audit',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { logs: [], total: 0, page: 1, per_page: 50 } }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/system',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/audit/unacknowledged-count',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { count: 0 } }),
      }),
  )

  // Analytics
  await page.route(
    (url) => url.pathname === '/api/analytics/summary',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            total: 0,
            prev_total: 0,
            success: 0,
            today: 0,
            by_day: [],
            by_platform: {},
            failure_reasons: [],
          },
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/analytics/accounts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )

  // License / settings
  await page.route(
    (url) => url.pathname === '/api/license/status',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { active: false, tier: 'free', expires_at: null },
        }),
      }),
  )

  // Studio
  await page.route(
    (url) => url.pathname === '/api/studio/projects',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )

  // Crawler
  await page.route(
    (url) => url.pathname === '/api/crawl/health',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { ok: true, crawled_content_rows: 0, crawled_comments_rows: 0 },
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/crawl/sentiment-summary',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { positive: 0, negative: 0, neutral: 0, pending: 0 },
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/crawl/data',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/crawl/comments',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
}

async function capturePage(page: Page, route: string, name: string, waitText: string) {
  await page.goto(route)

  // Wait for the route-specific PageHeader <h1> to appear — this
  // proves the AuthGuard has committed and PageWrapper content has
  // rendered. Using `h1` avoids matching duplicate text elsewhere on
  // the page (e.g. sidebar labels, buttons).
  await expect(page.locator('h1', { hasText: waitText })).toBeVisible()

  // Give animations (motion, skeletons) a moment to settle.
  await page.waitForTimeout(400)

  // Screenshot the full page so we capture the wrapper's max-width,
  // padding, and vertical spacing in one shot.
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    maxDiffPixels: 100,
  })
}

test.describe('PageWrapper visual regression', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'light')
        // Pin locale to zh-CN so PageHeader titles are stable and
        // match the waitText values below (avoids navigator.language
        // differences between local dev and CI).
        localStorage.setItem('sau-ui-locale', 'zh-CN')
      } catch {
        /* private mode */
      }
    })
    await mockShellApis(page)
  })

  for (const { route, name, waitText } of PAGES) {
    test(`${name} · desktop`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await capturePage(page, route, `pagewrapper-${name}-desktop`, waitText)
    })

    test(`${name} · mobile`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await capturePage(page, route, `pagewrapper-${name}-mobile`, waitText)
    })
  }
})
