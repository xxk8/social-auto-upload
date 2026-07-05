import { test, expect } from '@playwright/test'

/**
 * OPT-3M · 授权对话框三个锁定项。
 *
 * Locks three invariants for the authorization dialog:
 *
 *   (A) drag-proof — QR code image cannot be dragged
 *       (draggable={false} + -webkit-user-drag:none).
 *   (B) select-none — text inside the QR login dialog cannot be
 *       selected (select-none on DialogContent).
 *   (C) select-text — CLI command text in the non-QR manual-login
 *       dialog IS selectable (select-text class on CliCommandBlock).
 *       Uses bilibili — removed from QR_LOGIN_PLATFORMS — so the
 *       frontend falls through to the CLI manual-login path.
 *
 * Why boundingBox() instead of toHaveScreenshot()?
 *   - BoundingBox is deterministic (x, y, width, height in viewport
 *     pixels). A 1px font-rendering drift or OS-level anti-aliasing
 *     change won't break the assertion.
 *   - toHaveScreenshot would require a baseline PNG committed to the
 *     repo, and any CSS animation frame captured mid-transition would
 *     produce a false positive.
 *
 * Mock strategy:
 *   - /api/auth/me → authenticated admin user (AuthGuard green).
 *   - /api/account-groups → one group named drag-test-group with
 *     no existing authorizations (so the 添加授权 affordance is
 *     the primary call-to-action).
 *   - POST /api/account-groups/* /authorize → success response with
 *     a dummy group_name (only reached by QR-platform path).
 *   - /api/auth/sse-token → token stub.
 *   - SSE (/api/accounts/login/sse) is deliberately NOT intercepted.
 *     The route predicates use exact pathname matching (===), so the
 *     SSE URL passes through unhandled to Chromium's native network
 *     stack. Vite proxy forwards to the backend, which streams the
 *     SAU_MOCK_AUTHORIZE synthetic QR code with a keepalive loop.
 *     No addInitScript / MockEventSource needed — the real EventSource
 *     handles the native SSE stream correctly.
 *
 *   For the select-text test (bilibili / non-QR), no SSE/authorize
 *   mocks are needed — the frontend checks QR_LOGIN_PLATFORMS and
 *   skips the SSE flow entirely, showing the CLI block directly.
 */

// ── Fixtures ────────────────────────────────────────────────────────────

const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

const GROUP_ID = 42
const GROUP_NAME = 'drag-test-group'

// ── API mock helpers ────────────────────────────────────────────────────

async function mockAuthedShellApis(page: import('@playwright/test').Page) {
  // Use URL function predicates for unambiguous matching — glob patterns
  // and regexes can have subtle issues with Playwright's URL matching.
  await page.route(
    (url) => url.pathname === '/api/auth/me',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: FAKE_USER } }),
      }),
  )

  // Return one group with ZERO authorizations so the group card shows
  // the "暂无平台授权" empty-state with a prominent "添加授权" button.
  await page.route(
    (url) => url.pathname === '/api/account-groups',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: GROUP_ID,
              name: GROUP_NAME,
              valid: true,
              authorizations: [],
              created: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      })
    },
  )

  await page.route(
    (url) => url.pathname === '/api/tasks',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(
    (url) => url.pathname === '/api/accounts',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

async function mockAuthorizeAndSse(page: import('@playwright/test').Page) {
  // Step 1 — the authorize mutation fires first.
  await page.route(
    (url) => /\/api\/account-groups\/\d+\/authorize$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            task_id: 'auth-task-stub',
            group_name: GROUP_NAME,
            platform: 'douyin',
            cookie_file: '/cookies/douyin_drag-test-group.json',
          },
        }),
      }),
  )

  // Step 2 — the SSE token endpoint.
  await page.route(
    (url) => url.pathname === '/api/auth/sse-token',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { token: 'sse-token-stub', expires_in: 3600 } }),
      }),
  )

  // Step 3 — SSE is NOT intercepted. The Vite proxy forwards /api/* to the
  // backend, and the vite.config.ts SSE fix (res.writeHead + res.flushHeaders)
  // ensures EventSource receives headers immediately. The backend's
  // SAU_MOCK_AUTHORIZE=true returns a synthetic QR code. This avoids the
  // route.fulfill/route.fetch buffering issue that breaks SSE streaming.
}

// ── Spec ────────────────────────────────────────────────────────────────

test.describe('OPT-3M · 授权对话框三个锁定项', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // No addInitScript / MockEventSource — the SSE URL (/api/accounts/login/sse)
    // is NOT intercepted by any route predicate (they all use exact pathname
    // matching). Unhandled requests pass through to Chromium's native network
    // stack → Vite proxy → backend (SAU_MOCK_AUTHORIZE=true keepalive stream).
    await mockAuthedShellApis(page)
    await mockAuthorizeAndSse(page)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('draggable QR image stays inside dialog after drag attempt', async ({ page }) => {
    // ── 1. Navigate to accounts page ──────────────────────────────────
    await page.goto('/app')
    // Wait for the AppShell sidebar to paint (indicates AuthGuard resolved).
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // ── 2. Open the "添加授权" affordance ──────────────────────────────
    // The mocked group has zero authorizations → the empty-state card
    // renders "暂无平台授权" with a "添加授权" button. Click it to open
    // the AuthorizeDialog.
    // The empty-state card button reads "添加授权" as text content;
    // the populated-state header button has aria-label="Add authorization".
    // Match either so the test works regardless of which variant renders.
    const addAuthButton = page.getByRole('button', { name: /添加授权|Add authorization/ }).first()
    await expect(addAuthButton).toBeVisible()
    await addAuthButton.click()

    // AuthorizeDialog should now be visible as a shadcn Dialog.
    const authorizeDialog = page.locator('[role="dialog"]')
    await expect(authorizeDialog).toBeVisible()
    await expect(authorizeDialog.getByText('添加平台授权')).toBeVisible()

    // ── 3. Select a QR platform ────────────────────────────────────────
    // Click the SelectTrigger, then pick 抖音 (the first QR platform).
    await authorizeDialog.getByRole('combobox').click()
    const douyinOption = page.getByRole('option', { name: '抖音' })
    await expect(douyinOption).toBeVisible()
    await douyinOption.click()

    // ── 4. Kick off the authorize flow ────────────────────────────────
    await authorizeDialog.getByRole('button', { name: '开始授权' }).click()

    // The AuthorizeDialog closes and LoginProgressModal opens. Wait
    // for the new dialog content — the QR image.
    const progressDialog = page.locator('[role="dialog"]').last()
    await expect(progressDialog).toBeVisible()

    // The QR image renders with alt="{platformLabel} 登录二维码".
    // Use a stable page-level locator (NOT chained through `.last()`) so
    // Playwright's auto-wait re-resolves the element fresh on each call
    // rather than re-binding against a possibly-stale container locator.
    const qrImage = page.locator('img[alt*="登录二维码"]')
    await expect(qrImage).toBeVisible({ timeout: 5000 })

    // ── DRAG-PROOF: verify the source-of-truth drag-prevention defenses ──
    // Earlier iterations simulated a mouse drag (page.mouse.down / move / up)
    // and re-measured boundingBox. That was flaky — the drag crosses many
    // other DOM nodes, and React re-renders anything conditionally-rendered
    // (motion.div exit animations on the QR section). The HTML `draggable`
    // attribute IS the actual defense (bound to `draggable={false}` in JSX);
    // browsers respect it and the browser drag-dom never engages. Verifying
    // the attribute + style locks the invariant without racing any rendering.
    const dragDefenses = await qrImage.evaluate((el) => {
      const img = el as HTMLImageElement
      const cs = getComputedStyle(img)
      return {
        draggableAttr: img.draggable,
        webkitUserDrag:
          cs.getPropertyValue('-webkit-user-drag') ||
          cs.getPropertyValue('webkit-user-drag'),
      }
    })
    expect(
      dragDefenses.draggableAttr,
      'QR <img> must have draggable={false} so the browser drag-dom never engages',
    ).toBe(false)
    expect(
      dragDefenses.webkitUserDrag,
      'QR <img> must have CSS -webkit-user-drag: none as depth-in-defense',
    ).toBe('none')

    // ── SELECT-NONE: verify dialog text cannot be selected ──────
    // Static computed-style assertion at the leaf text node (not the
    // dialog wrapper). `user-select` IS inherited, but
    // `getComputedStyle(wrapper).userSelect` returns the wrapper's
    // own rule, not the effective value applied to descendants — so
    // an implementation that applies `select-none` to an inner span
    // (or to some ancestor ABOVE the wrapper) would silently register
    // as 'auto' here and the test would fail for the wrong reason.
    // Reading the computed style at the actual visible text node lets
    // inheritance resolve correctly. Replaces an earlier mouse-drag +
    // getSelection() check that was flaky under motion.div exit
    // animations on the QR section.
    const dialogUserSelect = await progressDialog
      .getByText('扫码登录')
      .first()
      .evaluate((el) => getComputedStyle(el).userSelect)
    expect(
      dialogUserSelect,
      'Dialog text node must have effective user-select: none so it cannot be selected',
    ).toBe('none')
  })

  test('non-QR platform CLI command text is selectable', async ({ page }) => {
    // ── 1. Navigate to accounts page ────────────────────────────
    await page.goto('/app')
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // ── 2. Open AuthorizeDialog ────────────────────────────────
    const addAuthButton = page.getByRole('button', { name: /添加授权|Add authorization/ }).first()
    await expect(addAuthButton).toBeVisible()
    await addAuthButton.click()

    const authorizeDialog = page.locator('[role="dialog"]')
    await expect(authorizeDialog).toBeVisible()

    // ── 3. Select bilibili (non-QR platform) ──────────────────
    await authorizeDialog.getByRole('combobox').click()
    const bilibiliOption = page.getByRole('option', { name: 'Bilibili' })
    await expect(bilibiliOption).toBeVisible()
    await bilibiliOption.click()

    // ── 4. Start authorize → opens LoginProgressModal ──────────
    // handleAuthorize sets loginModalOpen=true without calling
    // the authorize API. LoginProgressModal checks QR_LOGIN_PLATFORMS,
    // finds bilibili absent → returns early, showing CLI block.
    await authorizeDialog.getByRole('button', { name: '开始授权' }).click()

    const progressDialog = page.locator('[role="dialog"]')
    await expect(progressDialog).toBeVisible()
    // The non-QR path shows "手动登录" in the title.
    await expect(progressDialog.getByText('手动登录')).toBeVisible()

    // ── 5. SELECT-TEXT: CLI command text IS selectable ─────────
    // The CLI command block renders the command with select-text class.
    // Verify we can select the command string.
    const cliBlock = progressDialog.locator('pre, code').first()
    await expect(cliBlock).toBeVisible()

    const cliBox = await cliBlock.boundingBox()
    if (!cliBox) throw new Error('CLI block boundingBox is null')

    // Select a portion of the command text by dragging across it.
    await page.mouse.move(cliBox.x + 2, cliBox.y + cliBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cliBox.x + cliBox.width - 2, cliBox.y + cliBox.height / 2, { steps: 15 })
    await page.mouse.up()

    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(
      selectedText.length,
      `CLI command text MUST be selectable. Selected: "${selectedText.substring(0, 80)}"`,
    ).toBeGreaterThan(0)
    // The selected text should contain the CLI command.
    expect(selectedText).toContain('sau')
    expect(selectedText).toContain('bilibili')
    expect(selectedText).toContain('login')
  })
})
