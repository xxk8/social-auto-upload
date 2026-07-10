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
    // Stub the upload so the form can complete the submit pipeline
    // without touching the network. We don't care about the response
    // shape beyond `success: true` and a synthetic task_id because
    // the success-bannner pipeline only reads `result.task_id`.
    await mockUploadSuccess(page)
  })

  test('submit → countdown pill shows → 点击取消 → 不跳转', async ({ page }) => {
    // Navigate directly to /dashboard/publish (the canonical route).
    // PublishWizard defaults to step 0 (Upload), so we walk Upload →
    // Content → Review before submitting — the legacy single-form
    // anchor references (#video-file-input, 「提交视频」) were replaced
    // by the wizard when the 3-step flow landed.
    await page.goto('/dashboard/publish')

    // ── Step 0 (Upload) ────────────────────────────────────────────
    // Pick the bilibili group so the form has a row to submit against.
    // GroupPublishSelector's `handleGroupChange` auto-checks every
    // platform auth in the chosen group — for this fixture (one
    // bilibili auth) that puts bilibili in `groupSelection.platforms`
    // *immediately after the option click*. We deliberately do NOT
    // click the bilibili auth-row; doing so would TOGGLE bilibili
    // off (mirrors the OPT-3G fix in the sibling spec) and gate the
    // step-0 `canProceed()` on an empty group.
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /platform-group/ }).click()

    // We need a real <input type=file> at step 0. The wizard's dropzone
    // wraps the input in a <label> with aria-label="上传视频文件" — so
    // we drive the sr-only input through its accessible name (the id
    // itself is generated via useId() and unstable across mounts).
    // Stage a tiny file in the OS tempdir and point Playwright at it.
    const dir = mkdtempSync(join(tmpdir(), 'opt3i-e2e-'))
    const filePath = join(dir, 'sample.mp4')
    writeFileSync(filePath, Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))
    await page.getByLabel('上传视频文件').setInputFiles(filePath)

    // Step 0 → 1. WizardNav's 下一步 is enabled once canProceed() is
    // true (groupSelection non-empty + files.file set).
    await page.getByRole('button', { name: '下一步' }).click()

    // ── Step 1 (Content) ───────────────────────────────────────────
    // Fill the required title. ContentStep's <Label htmlFor=
    // 「wizard-content-title」> now resolves via getByLabel('标题').
    await page.getByLabel('标题').fill('OPT-3I e2e 验证取消按钮')

    // Step 1 → 2. canProceed() at step 1 requires content.title.trim()
    // non-empty; filled above.
    await page.getByRole('button', { name: '下一步' }).click()

    // ── Step 2 (Review) ────────────────────────────────────────────
    // WizardNav's final-step button label is 「提交」(STEP_LABELS[2]).
    // Submit. The pipeline POSTs /api/upload/video per group mapping;
    // our mock returns success → ReviewStep's onSubmit fires →
    // PublishPage's handleSubmitSuccess sets `submitSuccess` +
    // schedules the 4 s countdown.
    await page.getByRole('button', { name: '提交' }).click()

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

    // URL invariant: still on the publish page (no auto-nav).
    await page.waitForTimeout(200) // window for any pending navigate tick
    expect(new URL(page.url()).pathname).toBe('/dashboard/publish')

    // The 手动 导航 affordance should still be there — banner is
    // visible because submitSuccess is non-null even after cancel.
    await expect(
      page.getByRole('button', { name: '查看任务状态' }),
    ).toBeVisible()
  })
})

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
        body: JSON.stringify({ success: true, data: [
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
      ] }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/tasks',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(
    (url) => url.pathname === '/api/accounts',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
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

async function mockUploadSuccess(page: import('@playwright/test').Page) {
  // POST request — no _t timestamp param, so glob matching is safe.
  // Still use pathname predicate for consistency with the rest of the file.
  await page.route((url) => url.pathname === '/api/upload/video', async (route) => {
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
