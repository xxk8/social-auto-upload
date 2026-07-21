import { test, expect } from '@playwright/test'

/**
 * Admin tab keyboard shortcuts · e2e verification.
 *
 * Verifies that Cmd/Ctrl+1/2/3 navigate between admin dashboard tabs
 * (概览 / 用户 / 审计) in a real Chromium browser. These shortcuts are
 * implemented in AdminNavTabs.tsx via a document-level keydown handler.
 *
 * Why an e2e test (not just unit)?
 *   - The shortcut handler attaches to `document` and reads
 *     `navigator.platform` for modifier detection (⌘ vs Ctrl+).
 *     Platform-aware behaviour can only be validated against the
 *     actual browser's key event emission.
 *   - Browser tab-switching conflicts (Chrome maps Cmd+1 to the
 *     first browser tab) must be verified to NOT break our in-app
 *     navigation — calling `e.preventDefault()` is the contract.
 *   - The handler checks `e.target` for typing suppression; real
 *     focus management across React portals (Radix Dialogs) is
 *     only trustworthy in a live DOM.
 *
 * Mock strategy (same playbook as opt-3m-dialog-drag-proof.spec.ts):
 *   - /api/auth/me → authenticated admin user (AuthGuard green).
 *   - /api/admin/overview → empty stats + empty recent_actions.
 *   - /api/admin/users → empty user list.
 *   - /api/admin/audit → empty logs.
 *   - /api/admin/audit/unacknowledged-count → 0 (no badge).
 *   - Catch-all /api/* → { success: true, data: [] } so unmocked
 *     endpoints don't stall the shell with axios retries.
 */

// ── Fixtures ────────────────────────────────────────────────────────────

const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

// ── API mock helpers ────────────────────────────────────────────────────

async function mockAuthedShellApis(page: import('@playwright/test').Page) {
  await page.route(
    (url) => url.pathname === '/api/auth/me',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: FAKE_USER } }),
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

  // Admin-specific endpoints
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
        body: JSON.stringify({
          success: true,
          data: { logs: [], total: 0, page: 1, per_page: 50 },
        }),
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

  // Acknowledge endpoint (AuditPage calls this on mount)
  await page.route(
    (url) => url.pathname === '/api/admin/audit/acknowledge',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { updated: 0 } }),
      }),
  )

  // Catch-all for any remaining /api/* calls
  await page.route(
    (url) =>
      url.pathname.startsWith('/api/') &&
      ![
        '/api/auth/me',
        '/api/account-groups',
        '/api/accounts',
        '/api/tasks',
        '/api/admin/overview',
        '/api/admin/users',
        '/api/admin/audit',
        '/api/admin/audit/unacknowledged-count',
        '/api/admin/audit/acknowledge',
      ].includes(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
}

// ── Helper: assert active tab via data-state ────────────────────────────

async function expectActiveTab(page: import('@playwright/test').Page, tabValue: string) {
  const tab = page.getByTestId(`admin-nav-tab-${tabValue}`)
  await expect(tab).toHaveAttribute('data-state', 'active')
}

// ── Spec ────────────────────────────────────────────────────────────────

test.describe('Admin tab keyboard shortcuts · Cmd/Ctrl+1/2/3', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'light')
      } catch {
        /* private mode — ignore */
      }
    })
    await mockAuthedShellApis(page)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  // (a) Cmd+1/2/3 cycles through admin tabs on the admin page.
  // This is the canonical "happy path" — each shortcut navigates
  // to its corresponding tab and the tab's data-state flips to active.
  test('Cmd+1/2/3 navigates between admin tabs', async ({ page }) => {
    await page.goto('/dashboard/admin')

    // Wait for the admin shell to paint (AuthGuard resolved + admin nav visible).
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    // Default: overview is active.
    await expectActiveTab(page, 'overview')
    await expect(page).toHaveURL(/\/app\/admin$/)

    // Cmd+2 → Users tab
    await page.keyboard.press('Meta+2')
    await expectActiveTab(page, 'users')
    await expect(page).toHaveURL(/\/app\/admin\/users$/)

    // Cmd+3 → Audit tab
    await page.keyboard.press('Meta+3')
    await expectActiveTab(page, 'audit')
    await expect(page).toHaveURL(/\/app\/admin\/audit$/)

    // Cmd+1 → back to Overview tab
    await page.keyboard.press('Meta+1')
    await expectActiveTab(page, 'overview')
    await expect(page).toHaveURL(/\/app\/admin$/)
  })

  // (b) Ctrl+1/2/3 (Windows/Linux modifier) also works.
  // Playwright emits ctrlKey=true when `Control` is used; the handler
  // checks `e.metaKey || e.ctrlKey`, so both paths are covered.
  test('Ctrl+1/2/3 navigates between admin tabs (Win/Linux modifier)', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    await page.keyboard.press('Control+2')
    await expectActiveTab(page, 'users')
    await expect(page).toHaveURL(/\/app\/admin\/users$/)

    await page.keyboard.press('Control+3')
    await expectActiveTab(page, 'audit')
    await expect(page).toHaveURL(/\/app\/admin\/audit$/)
  })

  // (c) Admin shortcuts are ignored outside admin pages. The handler's
  // `isOnAdminPage()` guard returns early when pathname !== /dashboard/admin/*.
  // On /app, Meta+2 triggers the MAIN sidebar nav (→ /dashboard/publish), so we
  // assert the URL does NOT land on an admin page — the point is that the
  // admin shortcut specifically didn't fire.
  test('admin shortcuts are ignored on non-admin pages', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    await page.keyboard.press('Meta+2')

    // The URL must NOT contain /dashboard/admin — the admin handler didn't fire.
    // (The main-nav handler may have navigated to /dashboard/publish; that's fine.)
    await expect(page).not.toHaveURL(/\/app\/admin/)
  })

  // (d) Typing suppression: when focus is inside an input, the
  // handler's `isTyping` gate blocks the shortcut.
  test('shortcuts are suppressed when typing in an input', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    // Inject a focused input into the page.
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'text'
      input.id = 'test-input'
      document.body.appendChild(input)
      input.focus()
    })

    // Cmd+2 while typing → should NOT navigate.
    await page.keyboard.press('Meta+2')

    // URL must still be /dashboard/admin (did NOT jump to /dashboard/admin/users).
    await expect(page).toHaveURL(/\/app\/admin$/)
    await expectActiveTab(page, 'overview')

    // Clean up the injected input.
    await page.evaluate(() => {
      const el = document.getElementById('test-input')
      el?.remove()
    })
  })

  // (e) Modal suppression: when a dialog is open, the handler's
  // `[role="dialog"][aria-modal="true"]` guard blocks navigation.
  test('shortcuts are suppressed when a modal dialog is open', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    // Inject a fake open Radix Dialog into the DOM.
    await page.evaluate(() => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.id = 'test-dialog'
      document.body.appendChild(dialog)
    })

    // Cmd+2 while a dialog is open → should NOT navigate.
    await page.keyboard.press('Meta+2')

    await expect(page).toHaveURL(/\/app\/admin$/)
    await expectActiveTab(page, 'overview')

    // Clean up.
    await page.evaluate(() => {
      const el = document.getElementById('test-dialog')
      el?.remove()
    })
  })

  // (f) Shift+Cmd+2 is blocked. The handler checks `e.shiftKey` and
  // returns early — without this test, a future refactor that drops
  // the shift guard would silently break.
  test('Shift+Cmd+2 does NOT navigate', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    // Playwright's `Shift+Meta+2` sends a keydown with both shiftKey
    // and metaKey set to true.
    await page.keyboard.press('Shift+Meta+2')

    await expect(page).toHaveURL(/\/app\/admin$/)
    await expectActiveTab(page, 'overview')
  })

  // (g) Alt+Cmd+2 is blocked. The handler checks `e.altKey` and returns
  // early — mirrors the Shift blocker test.
  test('Alt+Cmd+2 does NOT navigate', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    await page.keyboard.press('Alt+Meta+2')

    await expect(page).toHaveURL(/\/app\/admin$/)
    await expectActiveTab(page, 'overview')
  })

  // (h) textarea typing suppression. The handler gates on `tag === 'textarea'`
  // in addition to `<input>`.
  test('shortcuts are suppressed when typing in a textarea', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    await page.evaluate(() => {
      const ta = document.createElement('textarea')
      ta.id = 'test-textarea'
      document.body.appendChild(ta)
      ta.focus()
    })

    await page.keyboard.press('Meta+2')

    await expect(page).toHaveURL(/\/app\/admin$/)
    await expectActiveTab(page, 'overview')

    await page.evaluate(() => {
      const el = document.getElementById('test-textarea')
      el?.remove()
    })
  })

  // (j) Mouse click navigation: clicking a tab trigger navigates to
  // the corresponding admin page. This complements the keyboard
  // shortcut tests and locks the onValueChange → navigate contract
  // in AdminNavTabs.tsx.
  test('clicking tabs navigates between admin pages', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    // Click "用户管理" tab → navigates to /dashboard/admin/users
    await page.getByTestId('admin-nav-tab-users').click()
    await expectActiveTab(page, 'users')
    await expect(page).toHaveURL(/\/app\/admin\/users$/)

    // Click "审计日志" tab → navigates to /dashboard/admin/audit
    await page.getByTestId('admin-nav-tab-audit').click()
    await expectActiveTab(page, 'audit')
    await expect(page).toHaveURL(/\/app\/admin\/audit$/)

    // Click "概览" tab → back to /dashboard/admin
    await page.getByTestId('admin-nav-tab-overview').click()
    await expectActiveTab(page, 'overview')
    await expect(page).toHaveURL(/\/app\/admin$/)
  })

  // (i) contenteditable typing suppression. The handler gates on
  // `target.isContentEditable === true`.
  test('shortcuts are suppressed when typing in contenteditable', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByTestId('admin-nav-tab-overview')).toBeVisible()

    await page.evaluate(() => {
      const div = document.createElement('div')
      div.contentEditable = 'true'
      div.id = 'test-ce'
      document.body.appendChild(div)
      div.focus()
    })

    await page.keyboard.press('Meta+2')

    await expect(page).toHaveURL(/\/app\/admin$/)
    await expectActiveTab(page, 'overview')

    await page.evaluate(() => {
      const el = document.getElementById('test-ce')
      el?.remove()
    })
  })
})
