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
  test.beforeEach(async ({ page }) => {
    await mockShellApisWithBilibiliGroup(page)
  })

  test('click chip ⇒ opens accordion + highlights first pending platform', async ({ page }) => {
    await page.goto('/publish')

    // Pick the bilibili group from the dropdown. The chip only shows
    // when at least one checked platform matches a platform-specific
    // section (douyin / bilibili / tencent).
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /bilibili-测试账号组/ }).click()

    // The bilibili row in the platform list: the row has aria for the
    // bilibili label. Clicking the row toggles the Checkbox.
    const bilibiliRow = page.locator('.auth-row', {
      has: page.locator('text=Bilibili'),
    })
    await bilibiliRow.click()

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
  await page.route('**/api/account-groups', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
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
      ]),
    }),
  )
  await page.route('**/api/tasks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/accounts', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}
