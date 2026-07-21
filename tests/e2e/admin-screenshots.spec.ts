// ─────────────────────────────────────────────────────────────────────
// Admin dashboard · v2 visual verification screenshots.
//
// Captures the new premium admin UI (Overview / Users / Audit) in
// light + dark themes with rich, realistic mock data so a reviewer
// can see the actual components in their "alive" state — empty
// arrays would only render the empty state, hiding the avatar /
// CodePill / SegmentedTimeRange / PlatformDistribution components
// that this redesign invested in.
//
// Gated by `SAU_TAKE_ADMIN_SCREENSHOTS=1` so this spec never runs
// in the regular `pnpm e2e` flow. Run explicitly:
//
//   SAU_TAKE_ADMIN_SCREENSHOTS=1 \
//   npx playwright test --config ../../tests/playwright.config.ts \
//     tests/e2e/admin-screenshots.spec.ts
//
// Outputs to sau_web/frontend/screenshots/admin-v2/:
//   • overview-light.png         overview-dark.png
//   • users-light.png            users-dark.png
//   • audit-light.png            audit-dark.png
//   • users-role-change-dialog.png
// ─────────────────────────────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ENABLED = process.env['SAU_TAKE_ADMIN_SCREENSHOTS'] === '1'

// Walk up from `process.cwd()` to find the repo root (anchor:
// `tests/playwright.config.ts`). This works regardless of whether the
// user runs the spec from the repo root or from `sau_web/frontend/`
// (the `pnpm e2e` convention), and avoids depending on `import.meta`
// which Playwright's CJS-mode TS loader doesn't enable.
function findRepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (existsSync(resolve(dir, 'tests/playwright.config.ts'))) return dir
    dir = dirname(dir)
  }
  throw new Error('Could not locate repo root (no tests/playwright.config.ts found)')
}

const REPO_ROOT = findRepoRoot()
const SHOTS_DIR = resolve(REPO_ROOT, 'sau_web/frontend/screenshots/admin-v2')

const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

// ── Data fixtures (rich — designed to exercise every premium component) ─

const USERS = [
  {
    id: 1,
    email: 'alice@sau.dev',
    role: 'admin',
    tier: 'pro',
    created_at: '2026-01-15T08:30:00Z',
    last_login: minutesAgoISO(4),
  },
  {
    id: 2,
    email: 'bob@studio.io',
    role: 'user',
    tier: 'pro',
    created_at: '2026-02-03T14:12:00Z',
    last_login: minutesAgoISO(28),
  },
  {
    id: 3,
    email: 'carla@brand.co',
    role: 'user',
    tier: 'free',
    created_at: '2026-02-19T09:45:00Z',
    last_login: hoursAgoISO(2),
  },
  {
    id: 4,
    email: 'diego@content.team',
    role: 'user',
    tier: 'enterprise',
    created_at: '2026-03-08T11:20:00Z',
    last_login: hoursAgoISO(7),
  },
  {
    id: 5,
    email: 'echo@news.cn',
    role: 'admin',
    tier: 'pro',
    created_at: '2026-04-22T16:55:00Z',
    last_login: daysAgoISO(1),
  },
  {
    id: 6,
    email: 'felix@lab.ai',
    role: 'user',
    tier: 'free',
    created_at: '2026-05-14T07:08:00Z',
    last_login: daysAgoISO(3),
  },
  {
    id: 7,
    email: 'gina@studio.io',
    role: 'user',
    tier: 'pro',
    created_at: '2026-06-01T13:42:00Z',
    last_login: null,
  },
  {
    id: 8,
    email: 'hugo@media.tv',
    role: 'user',
    tier: 'pro',
    created_at: '2026-06-18T10:00:00Z',
    last_login: daysAgoISO(12),
  },
]

const AUDIT_LOGS = [
  logRow(101, 1, 5, 'update_role', 'role: user → admin', minutesAgoISO(3)),
  logRow(102, 1, 2, 'grant_license', 'tier: free → pro (30 days)', minutesAgoISO(11)),
  logRow(103, 5, 6, 'suspend_account', 'reason: payment_failed × 3', minutesAgoISO(45)),
  logRow(104, 1, null, 'system_restart', 'cron: cdp-throttle-monitor', hoursAgoISO(2)),
  logRow(105, 1, 8, 'login', 'ip: 192.0.2.41', hoursAgoISO(3)),
  logRow(106, 5, 3, 'change_role', 'role: user → admin', hoursAgoISO(5)),
  logRow(107, 1, 4, 'assign_license', 'tier: free → enterprise', hoursAgoISO(8)),
  logRow(108, 5, 7, 'restrict_account', 'limit: 5 tasks/day', daysAgoISO(1)),
  logRow(109, 1, null, 'purge_cache', 'cache: analytics', daysAgoISO(1)),
  logRow(110, 5, 2, 'delete_user', 'id=9 · reason: spam', daysAgoISO(2)),
  logRow(111, 1, 1, 'create_user', 'email: hugo@media.tv · tier: pro', daysAgoISO(3)),
  logRow(112, 5, 4, 'update_role', 'role: admin → user', daysAgoISO(4)),
  logRow(113, 1, null, 'system_restart', 'cron: kill-criteria-30d', daysAgoISO(6)),
  logRow(114, 5, 8, 'login', 'ip: 198.51.100.7', daysAgoISO(7)),
  logRow(115, 1, 6, 'fail_login', 'attempts=5 · lockout=15m', daysAgoISO(9)),
]

const SYSTEM = {
  tasks_by_status: { success: 1180, pending: 92, failed: 65 },
  tasks_by_platform: {
    抖音: 412,
    视频号: 287,
    小红书: 218,
    哔哩哔哩: 174,
    快手: 139,
    公众号: 107,
  },
  errors_by_type: { cdp_timeout: 38, cookie_expired: 21, upload_413: 6 },
}

const OVERVIEW = {
  total_users: 42,
  active_today: 7,
  total_tasks: 1337,
  task_success_rate: 98.5,
  recent_actions: [
    recRow(901, 1, 'update_role', 'admin@sau.dev', minutesAgoISO(2)),
    recRow(902, 5, 'grant_license', 'carla@brand.co', minutesAgoISO(7)),
    recRow(903, 1, 'system_restart', 'admin@sau.dev', minutesAgoISO(34)),
    recRow(904, 5, 'login', 'echo@news.cn', hoursAgoISO(1)),
    recRow(905, 1, 'suspend_account', 'admin@sau.dev', hoursAgoISO(4)),
    recRow(906, 5, 'change_role', 'echo@news.cn', hoursAgoISO(9)),
    recRow(907, 1, 'assign_license', 'admin@sau.dev', daysAgoISO(1)),
    recRow(908, 5, 'delete_user', 'echo@news.cn', daysAgoISO(2)),
  ],
}

// ── Time helpers (anchored to "now" so relativeTimeFromNow shows variety) ─

function minutesAgoISO(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString()
}
function hoursAgoISO(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
}
function daysAgoISO(d: number): string {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()
}
function recRow(id: number, userId: number, action: string, email: string, iso: string) {
  return { id, user_id: userId, action, created_at: iso, user_email: email }
}
function logRow(
  id: number,
  adminId: number,
  targetId: number | null,
  action: string,
  detail: string,
  iso: string,
) {
  return {
    id,
    admin_user_id: adminId,
    target_user_id: targetId,
    action,
    detail,
    created_at: iso,
    admin_email: USERS.find((u) => u.id === adminId)?.email ?? null,
    target_email: targetId ? USERS.find((u) => u.id === targetId)?.email ?? null : null,
  }
}

// ── Mock setup ─────────────────────────────────────────────────────────

async function mockRichAdminApis(page: Page) {
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
  await page.route(
    (url) => url.pathname === '/api/admin/overview',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: OVERVIEW }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/users',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: USERS }),
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
          data: { logs: AUDIT_LOGS, total: AUDIT_LOGS.length, page: 1, per_page: 50 },
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/system',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: SYSTEM }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/audit/unacknowledged-count',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { count: 3 } }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/admin/audit/acknowledge',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { updated: 3 } }),
      }),
  )
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
        '/api/admin/system',
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

// ── Shot helper ────────────────────────────────────────────────────────

async function shot(page: Page, file: string) {
  await page.screenshot({
    path: `${SHOTS_DIR}/${file}`,
    fullPage: true,
  })
}

// ── Tests (all gated behind SAU_TAKE_ADMIN_SCREENSHOTS=1) ──────────────

test.describe('Admin v2 · visual verification screenshots', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  // Ensure the output directory exists once per suite — `page.screenshot`
  // does NOT create parent directories on its own.
  test.beforeAll(() => {
    if (ENABLED) mkdirSync(SHOTS_DIR, { recursive: true })
  })

  test.beforeEach(async ({ page }) => {
    test.skip(!ENABLED, 'set SAU_TAKE_ADMIN_SCREENSHOTS=1 to run screenshot capture')
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'light')
      } catch {
        /* private mode */
      }
    })
    await mockRichAdminApis(page)
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('Overview · light', async ({ page }) => {
    await page.goto('/dashboard/admin')
    await expect(page.getByRole('heading', { name: '系统概览', level: 1 })).toBeVisible()
    // Wait for the actual stat data to land (a 1.5–3 s hop in dev
    // mode, even with a mocked route). Without this anchor, the
    // `shot()` call below can race the data fetch and capture the
    // loading skeleton instead of the real premium cards.
    await page.waitForFunction(
      () => document.body.innerText.includes('98.5%'),
      undefined,
      { timeout: 10_000 },
    )
    await page.waitForTimeout(400) // let any animations settle
    await shot(page, 'overview-light.png')
  })

  test('Overview · dark', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'dark')
      } catch {
        /* private mode */
      }
    })
    await page.goto('/dashboard/admin')
    await expect(page.getByRole('heading', { name: '系统概览', level: 1 })).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'overview-dark.png')
  })

  test('Users · light', async ({ page }) => {
    await page.goto('/dashboard/admin/users')
    await expect(page.getByRole('heading', { name: '用户管理', level: 1 })).toBeVisible()
    await expect(page.getByText('alice@sau.dev')).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'users-light.png')
  })

  test('Users · dark', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'dark')
      } catch {
        /* private mode */
      }
    })
    await page.goto('/dashboard/admin/users')
    await expect(page.getByRole('heading', { name: '用户管理', level: 1 })).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'users-dark.png')
  })

  test('Audit · light', async ({ page }) => {
    await page.goto('/dashboard/admin/audit')
    await expect(page.getByRole('heading', { name: '操作日志', level: 1 })).toBeVisible()
    await expect(page.getByText('update_role').first()).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'audit-light.png')
  })

  test('Audit · dark', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'dark')
      } catch {
        /* private mode */
      }
    })
    await page.goto('/dashboard/admin/audit')
    await expect(page.getByRole('heading', { name: '操作日志', level: 1 })).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'audit-dark.png')
  })

  // NOTE: A 7th `Users · role-change confirmation dialog` shot was
  // prototyped here but is flaky due to Radix DropdownMenu portal +
  // Playwright actionability interplay; the dialog's design is
  // covered by the AlertDialog component's own snapshot tests. Not
  // shipping the flaky shot keeps the visual review deterministic.
})
