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
  test.beforeEach(async ({ page, context }) => {
    await mockShellApis(page)
    // Clear storage from any prior run so we start in a known
    // expanded state on every fresh test.
    await context.clearCookies()
    await page.addInitScript(() => {
      try {
        window.localStorage.clear()
      } catch {
        /* private mode — ignore */
      }
    })
  })

  test('collapse → LS flips → reload restores collapsed rail', async ({ page }) => {
    await page.goto('/publish')

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
  await page.route('**/api/account-groups', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  )
  await page.route('**/api/tasks', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  )
  await page.route('**/api/accounts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  )
}
