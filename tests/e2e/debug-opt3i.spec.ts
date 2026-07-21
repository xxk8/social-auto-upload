import { test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * DEBUG-ONLY: temporary diagnostic spec that mirrors opt-3i and
 * reports the post-submit DOM state. Used to locate where the
 * submit → PublishSuccessBanner.cancelCountdown chain breaks in
 * the wizard's 3-step flow.
 */
test('debug opt-3i submit chain', async ({ page }) => {
  page.on('console', (msg) => console.log(`[browser-${msg.type()}]`, msg.text()))
  page.on('pageerror', (err) => console.log(`[pageerror]`, err.message))
  page.on('request', (req) => {
    if (req.url().includes('/api/')) {
      console.log(`[request]`, req.method(), req.url())
    }
  })
  page.on('response', async (res) => {
    if (res.url().includes('/api/')) {
      console.log(`[response]`, res.status(), res.url())
    }
  })

  await page.route((u) => u.pathname === '/api/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { user: { id: 1, email: 'qa@example.com', role: 'admin', created_at: '2026-01-01T00:00:00Z', last_login: '2026-06-26T00:00:00Z' } },
      }),
    }),
  )
  await page.route((u) => u.pathname === '/api/account-groups', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
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
        ],
      }),
    }),
  )
  await page.route((u) => u.pathname === '/api/tasks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }),
  )
  await page.route((u) => u.pathname === '/api/accounts', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }),
  )
  await page.route((u) => u.pathname === '/api/upload/video', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { task_id: 'task-opt3i-e2e-stub' } }) }),
  )
  await page.route(
    (u) =>
      u.pathname.startsWith('/api/') &&
      !['/api/auth/me', '/api/account-groups', '/api/tasks', '/api/accounts', '/api/upload/video'].includes(u.pathname),
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }),
  )

  await page.goto('/dashboard/publish')
  console.log('── after goto: url=', page.url())

  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: /platform-group/ }).click()
  console.log('── after group select: url=', page.url())

  const dir = mkdtempSync(join(tmpdir(), 'opt3i-debug-'))
  const fp = join(dir, 'sample.mp4')
  writeFileSync(fp, Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))
  await page.getByLabel('上传视频文件').setInputFiles(fp)
  console.log('── after setInputFiles: url=', page.url())

  // Step 0 → 1
  await page.getByRole('button', { name: '下一步' }).click()
  console.log('── after 下一步 (0→1): url=', page.url())

  await page.getByLabel('标题').fill('DEBUG-OPT3I')
  console.log('── after fill 标题')

  // Step 1 → 2
  await page.getByRole('button', { name: '下一步' }).click()
  console.log('── after 下一步 (1→2): url=', page.url())

  // List buttons BEFORE 提交 click
  const btnsBefore = await page.getByRole('button').allTextContents()
  console.log('── buttons before 提交 click:', JSON.stringify(btnsBefore))

  await page.getByRole('button', { name: '提交' }).click()
  console.log('── immediately after 提交 click: url=', page.url())

  // Poll the page for state every 500ms x 5
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500)
    const url = page.url()
    const banner = await page.locator('text=提交成功').count()
    const cancelPill = await page.getByRole('button', { name: /剩.*秒.*点击取消/ }).count()
    const btns = await page.getByRole('button').allTextContents()
    console.log(`── +${(i + 1) * 500}ms url=${url} banner=${banner} cancelPill=${cancelPill} btns_count=${btns.length}`)
    if (i === 0 || i === 4) {
      console.log(`   btns[${i}]: ${JSON.stringify(btns.slice(0, 30))}`)
    }
  }
})
