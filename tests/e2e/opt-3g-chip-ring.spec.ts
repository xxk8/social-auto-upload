import { test, expect } from '@playwright/test'

/**
 * OPT-3F-e2e (2/3): chip → controlled Accordion + ring-2 highlight.
 *
 * Surface anchors (verified against feat/OPT-3J on feat/OPT-3F-e2e):
 *   - chip: `data-testid="pending-platform-configs-chip"`
 *   - platform section ids: `#advanced-section-{douyin|bilibili|tencent}`
 *   - Accordion highlight class: `ring-2 ring-primary`
 *
 * What this proves:
 *   - When the user checks a bilibili platform row in GroupPublishSelector,
 *     the chip with badge count `1 项平台专属待配置` appears.
 *   - Clicking the chip flips the controlled Accordion from `value=""`
 *     to `value="advanced"` so the platform-specific block renders.
 *   - The bilibili section carries the ring classes (highlight persists
 *     while the click handler's 3 s auto-clear timer hasn't elapsed).
 *
 * Note: we don't assert the sha256 of the ring classes (Tailwind v4
 * JIT would be brittle); instead we check for the canonical
 * `ring-primary` substring AND the presence of the Radix Accordion
 * `data-state="open"` on the panel.
 */
test.describe('OPT-3G · chip → controlled Accordion + per-platform ring', () => {
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
    await mockShellApisWithBilibiliGroup(page)
  })

  test('click chip ⇒ opens accordion + highlights first pending platform', async ({ page }) => {
    // Navigate directly to /dashboard/publish (the canonical route).
    await page.goto('/dashboard/publish')

    // Pick the bilibili group from the dropdown. GroupPublishSelector's
    // `handleGroupChange` auto-checks every platform the group holds —
    // for this fixture (one bilibili auth) that means bilibili is in
    // `value.platforms` immediately after the option click. The chip
    // only renders when at least one checked platform matches a
    // platform-specific section (douyin / bilibili / tencent), so the
    // auto-check is enough to surface the chip — we deliberately do
    // NOT click the bilibili row, which would TOGGLE bilibili off and
    // collapse the chip before the assertion fires.
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /bilibili-测试账号组/ }).click()

    // The chip should now be present and announce `1 项平台专属待配置`.
    const chip = page.getByTestId('pending-platform-configs-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('1 项平台专属待配置')

    // Click the chip → Accordion opens + ring lands on bilibili section.
    await chip.click()

    // Anchor the bilibili section locator once (used by all assertions
    // below). Author R2 closeout: keep the declaration above its first
    // usage so TS doesn't flag a block-scoped 'used before declaration'.
    const bilibiliSection = page.locator('#advanced-section-bilibili')

    // Tighter check (author R1 MINOR-5): scope to the section-id we just
    // revealed so we don't match unrelated regions elsewhere on the page.
    // Radix AccordionContent flips `data-state` to `open` at this anchor.
    await expect(bilibiliSection).toHaveAttribute('data-state', 'open')

    // The bilibili section is in the DOM and carries the ring classes.
    await expect(bilibiliSection).toBeVisible()
    await expect(bilibiliSection).toHaveClass(/ring-2/)
    await expect(bilibiliSection).toHaveClass(/ring-primary/)
  })
})

async function mockShellApisWithBilibiliGroup(
  page: import('@playwright/test').Page,
) {
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
        body: JSON.stringify({ success: true, data: [
        {
          id: 99,
          name: 'bilibili-测试账号组',
          valid: true,
          authorizations: [
            {
              id: 7,
              platform: 'bilibili',
              cookie_file: '/cookies/bilibili-test.json',
              valid: true,
              created: '2025-01-01T00:00:00Z',
            },
          ],
          created: '2025-01-01T00:00:00Z',
        },
      ] }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/tasks',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }),
  )
  await page.route(
    (url) => url.pathname === '/api/accounts',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }),
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
