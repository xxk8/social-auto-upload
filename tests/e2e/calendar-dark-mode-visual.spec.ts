// ─────────────────────────────────────────────────────────────────────
// Calendar dark-mode visual regression
//
// Captures `/dashboard/calendar` in dark mode with deterministic
// mock tasks so future CSS changes that affect the calendar grid,
// event chips, or text contrast are caught by snapshot diff.
//
// Run:
//   pnpm e2e calendar-dark-mode-visual
//
// Update baseline after an intentional visual change:
//   pnpm e2e:visual:update --grep calendar-dark-mode-visual
//
// Baselines are stored in tests/e2e/__snapshots__/ and should be
// committed to version control.
// ─────────────────────────────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'

const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

// Deterministic calendar tasks spread across the visible month.
// The backend returns `effective_date` as the calendar pin.
const CALENDAR_TASKS = [
  {
    task_id: 'task-douyin-001',
    platform: 'douyin',
    account: 'work1',
    action: 'upload-video',
    status: 'scheduled',
    title: '抖音早高峰',
    scheduled_at: '2026-07-08T09:00:00Z',
    created: '2026-07-01T10:00:00Z',
    effective_date: '2026-07-08',
  },
  {
    task_id: 'task-xhs-002',
    platform: 'xiaohongshu',
    account: 'work2',
    action: 'upload-note',
    status: 'pending',
    title: '小红书图文',
    scheduled_at: '2026-07-15T14:00:00Z',
    created: '2026-07-02T11:00:00Z',
    effective_date: '2026-07-15',
  },
  {
    task_id: 'task-bili-003',
    platform: 'bilibili',
    account: 'work3',
    action: 'upload-video',
    status: 'success',
    title: 'B站教程',
    scheduled_at: null,
    created: '2026-07-10T08:00:00Z',
    effective_date: '2026-07-10',
  },
  {
    task_id: 'task-ks-004',
    platform: 'kuaishou',
    account: 'work1',
    action: 'upload-video',
    status: 'scheduled',
    title: '快手短视频',
    scheduled_at: '2026-07-22T11:30:00Z',
    created: '2026-07-05T09:00:00Z',
    effective_date: '2026-07-22',
  },
]

const CALENDAR_SUMMARY = {
  total: CALENDAR_TASKS.length,
  by_platform: { douyin: 1, xiaohongshu: 1, bilibili: 1, kuaishou: 1 },
  by_status: { scheduled: 2, pending: 1, success: 1 },
}

async function mockCalendarApis(page: Page) {
  // Register the catch-all FIRST. Playwright evaluates routes in
  // reverse registration order, so the specific handlers below will
  // win over this fallback.
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
    (url) => url.pathname === '/api/calendar/tasks',
    (route) => {
      // The calendar requests a month window; return the subset that
      // falls inside the requested range so the snapshot stays stable.
      const urlObj = new URL(route.request().url())
      const start = urlObj.searchParams.get('start') ?? ''
      const end = urlObj.searchParams.get('end') ?? ''
      const filtered = CALENDAR_TASKS.filter((t) => t.effective_date >= start && t.effective_date < end)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            tasks: filtered,
            summary: {
              ...CALENDAR_SUMMARY,
              total: filtered.length,
            },
          },
        }),
      })
    },
  )
}

test.describe('Calendar dark-mode visual regression', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // Pin the date so the calendar always opens to July 2026 and the
    // "today" highlight is stable across runs.
    await page.clock.setFixedTime(new Date('2026-07-14T10:00:00Z'))

    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'dark')
        localStorage.setItem('sau-ui-locale', 'zh-CN')
      } catch {
        /* private mode */
      }
    })
    await mockCalendarApis(page)
  })

  test('month view · dark', async ({ page }) => {
    await page.goto('/dashboard/calendar')

    // Wait for the calendar header to prove the page rendered.
    await expect(page.getByRole('heading', { name: '内容日历', level: 1 })).toBeVisible()

    // Wait for a deterministic event chip to appear.
    await expect(page.getByText('抖音早高峰').first()).toBeVisible()

    // Let motion / layout settle before capturing.
    await page.waitForTimeout(400)

    await expect(page).toHaveScreenshot('calendar-month-dark.png', {
      fullPage: true,
      maxDiffPixels: 100,
    })
  })

  test('week view · dark', async ({ page }) => {
    await page.goto('/dashboard/calendar')
    await expect(page.getByRole('heading', { name: '内容日历', level: 1 })).toBeVisible()
    await expect(page.getByText('抖音早高峰').first()).toBeVisible()

    // Switch to week view.
    await page.getByRole('button', { name: '周' }).click()
    await page.waitForTimeout(400)

    await expect(page).toHaveScreenshot('calendar-week-dark.png', {
      fullPage: true,
      maxDiffPixels: 100,
    })
  })
})
