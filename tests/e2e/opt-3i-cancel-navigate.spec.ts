import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * OPT-3F-e2e (3/3): submit success → countdown pill → click 取消 ⇒
 * no auto-navigate to /tasks.
 *
 * Surface anchors (verified against feat/OPT-3J on feat/OPT-3F-e2e):
 *   - Banner injected by `PublishSuccessBanner` whenever the
 *     `submitSuccess` Zustand field flips non-null.
 *   - 取消 pill: `<button aria-label={`剩 X 秒自动跳转到任务列表，点击取消`}>`
 *     with `tabular-nums` text `<Xs>`.
 *   - Cancel handler: `handleCancelAutoNavigate` clears the interval
 *     + drops `navigateCountdown` to null; the pill unmounts because
 *     `cancelCountdown === null || cancelCountdown <= 0` ⇒ hidden.
 *   - URL invariant: never auto-navigates while cancelled. We also
 *     assert that the user can navigate manually afterwards via the
 *     persistent `查看任务状态` button.
 *
 * Authoring note: this spec would be cleaner if we could drive a real
 * submit, but PublishSuccessBanner's pill ONLY appears AFTER the
 * VideoForm's submit() returns. Submitting for real would require:
 *   - a logged-in account cookie
 *   - a real <input type=file> with a non-trivial file
 *   - a sequence of POSTs to /api/videos/upload
 * Mocking all three is more work than the spec is worth here.
 * Instead we shorten-test the cancel handler's two consequences:
 *
 *   (A) `cancelPill visible` — assert the pill is mounted when the
 *       banner shows up. We drive submit via a programmatic flip of
 *       the page's submitSuccess store-equivalent by clicking the
 *       real submit button after mocking all upstream deps.
 *
 *   (B) `clickCancelPill ⇒ no navigation` — after click, assert the
 *       pill vanishes and the URL stays on /publish.
 */
test.describe('OPT-3I · cancel post-submit 退回避免自动跳转', () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApis(page)
    // Stub the upload so the form can complete the submit pipeline
    // without touching the network. We don't care about the response
    // shape beyond `success: true` and a synthetic task_id because
    // the success-bannner pipeline only reads `result.task_id`.
    await mockUploadSuccess(page)
  })

  test('submit → countdown pill shows → 点击取消 → 不跳转', async ({ page }) => {
    await page.goto('/publish')

    // Pick a bilibili group so the form has a row to submit against.
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /platform-group/ }).click()
    await page
      .locator('.auth-row', { has: page.locator('text=Bilibili') })
      .click()

    // Fill the required title. The submit pipeline also requires a
    // file, which we attach via a tiny temp .mp4 stub. check() makes
    // the Checkbox read `checked` so the publish call uses it.
    await page.getByLabel('标题').fill('OPT-3I e2e 验证取消按钮')

    // We need a real <input type=file> to drive the upload. Stage a
    // tiny file in the OS tempdir and point Playwright at it.
    const dir = mkdtempSync(join(tmpdir(), 'opt3i-e2e-'))
    const filePath = join(dir, 'sample.mp4')
    writeFileSync(filePath, Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))
    await page.locator('#video-file-input').setInputFiles(filePath)

    // Submit. The pipeline POSTs /api/videos/upload per group mapping;
    // our mock returns success so the form emits handleSubmitSuccess
    // → PublishPage schedules the 4 s countdown + sets submitSuccess.
    await page.getByRole('button', { name: '提交视频' }).click()

    // Pill should be visible with `Xs 后跳转到任务列表 · 取消` copy.
    // The aria-label is `剩 X 秒自动跳转到任务列表，点击取消`.
    const cancelPill = page.getByRole('button', {
      name: /剩 \d+ 秒自动跳转到任务列表，点击取消/,
    })
    await expect(cancelPill).toBeVisible({ timeout: 5000 })

    // Click the pill → handleCancelAutoNavigate fires → countdown
    // goes to null → pill unmounts.
    await cancelPill.click()
    await expect(cancelPill).toHaveCount(0)

    // URL invariant: still on /publish (no auto-nav).
    await page.waitForTimeout(200) // window for any pending navigate tick
    expect(new URL(page.url()).pathname).toBe('/publish')

    // The 手动 导航 affordance should still be there — banner is
    // visible because submitSuccess is non-null even after cancel.
    await expect(
      page.getByRole('button', { name: '查看任务状态' }),
    ).toBeVisible()
  })
})

async function mockShellApis(page: import('@playwright/test').Page) {
  await page.route('**/api/account-groups', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 42,
          name: 'platform-group',
          valid: true,
          authorizations: [
            {
              id: 9,
              platform: 'bilibili',
              cookie_file: '/cookies/bilibili.json',
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

async function mockUploadSuccess(page: import('@playwright/test').Page) {
  await page.route('**/api/upload/video', async (route) => {
    // The VideoForm POSTs multipart with `platform` + `account` etc.
    // We acknowledge any variant with a stub success body.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { task_id: 'task-opt3i-e2e-stub' },
      }),
    })
  })
}
