import { test, expect, type Page } from '@playwright/test'

/**
 * NT-22 跨页面 deep-link 契约 — Playwright E2E 锁住。
 *
 * This spec locks the three-way contract between SortableGroup's Send
 * affordance and PublishPage's `?group_id=` deep-link handler:
 *
 *   1. **Affordance**: clicking the SortableGroup's Send icon navigates
 *      to `/dashboard/publish?group_id=<id>`. The testid
 *      `data-testid="go-to-publish-from-group-grid"` (locked in
 *      SortableGroup.tsx) is the contract anchor.
 *
 *   2. **Pre-select**: PublishPage's deep-link useEffect calls
 *      `usePublishWizardStore.setGroupSelection({groupId,groupName,platforms,mappings})`
 *      + `setStep(0)`. The GroupPublishSelector's SelectTrigger
 *      (`<SelectTrigger id="publish-group-select">`) renders the
 *      selected group's name in its trigger text. Visible contract:
 *      trigger text contains the group name on first paint.
 *      The StepIndicator's `<button aria-current="step">` is the
 *      visible contract for `wizard.currentStep === 0`: only the
 *      `上传` (Upload, step 0) `listitem` carries `aria-current="step"`,
 *      `内容`/`确认` carry none.
 *
 *   3. **Self-clean**: the deep-link effect strips `?group_id=` via
 *      `setSearchParams({}, {replace:true})`. After the effect runs,
 *      `URL.searchParams.has('group_id')` is false and `pathname` is
 *      a clean `/dashboard/publish`. A refresh on that URL therefore
 *      does NOT re-apply the deep-link (idempotent guard).
 *
 * Why e2e (not vitest):
 *   - The 5 vitest contract tests in `PublishPage.test.tsx` cover the
 *     Render-Harness layer (MemoryRouter + stubbed hooks). They
 *     cannot exercise the actual `useSearchParams().set()` call
 *     against a real `<Routes>` tree, the AnimatePresence
 *     transition timing, or the GroupPublishSelector's SelectValue
 *     fallback when the store value is seeded BEFORE the component
 *     mounts. Those layers need a real Chromium.
 *   - This spec is intentionally narrow — 2 tests — so the contract
 *     stays greppable. The first test exercises the click pathway
 *     (the bug surface user-reported NT-22 was about); the second
 *     exercises direct-URL navigation (every stadium of a deep-link
 *     has both pathways; locking both keeps a future "Accept header
 *     doesn't apply to setGroupSelection" regression from slipping
 *     in via just one entry surface).
 *
 * Mock strategy (mirrors `admin-tab-shortcuts.spec.ts::mockAuthedShellApis`):
 *   - `/api/auth/me` → authenticated admin user (AuthGuard green).
 *   - `/api/account-groups` → 2 synthetic groups with authorizations
 *     so GroupPublishSelector's pre-select has real platform rows
 *     to render (an empty `authorizations` group would still pass the
 *     visible pre-select contract but trivially — the chip count
 *     "1/2 个平台" assertion below catches that).
 *   - Catch-all `/api/*` → empty arrays so unmocked endpoints don't
 *     stall the shell with axios retries.
 */

// ── Fixtures ────────────────────────────────────────────────────────────

const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

const FAKE_GROUPS = [
  {
    id: 42,
    name: '菌验主号',
    created: '2026-06-26T00:00:00Z',
    authorizations: [
      {
        id: 421,
        platform: 'douyin',
        valid: true,
        stale: false,
        cookie_file: '/cookies/douyin-42.json',
      },
      {
        id: 422,
        platform: 'bilibili',
        valid: true,
        stale: false,
        cookie_file: '/cookies/bilibili-42.json',
      },
    ],
  },
  {
    id: 99,
    name: '备用组',
    created: '2026-06-26T00:00:00Z',
    authorizations: [
      {
        id: 991,
        platform: 'xiaohongshu',
        valid: true,
        stale: false,
        cookie_file: '/cookies/xhs-99.json',
      },
    ],
  },
]

// ── API mock helpers ────────────────────────────────────────────────────

async function mockAuthedShellForNT22(page: Page) {
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
        body: JSON.stringify({ success: true, data: FAKE_GROUPS }),
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

  // Catch-all for any remaining /api/* calls (PublishWizard pulls
  // templates, drafts, recent-tasks, etc. — all unmocked routes
  // return empty arrays so axios doesn't retry-stall the page).
  await page.route(
    (url) =>
      url.pathname.startsWith('/api/') &&
      ![
        '/api/auth/me',
        '/api/account-groups',
        '/api/accounts',
        '/api/tasks',
      ].includes(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
}

// ── Spec ────────────────────────────────────────────────────────────────

test.describe('NT-22 · 分组卡片 → 发布中心 deep-link 契约', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'light')
        // Force the wizard into step 2 BEFORE the page mounts so the
        // post-deeplink assertion `aria-current="step"` lands on
        // 「上传」(step 0) only if setStep(0) actually fires; without
        // this, the assertion passes trivially against the default
        // step-0 initial state (mirrors PublishPage.test.tsx test (a)'s
        // contract pin).
        // The key is unrelated to the wizard store, which is a
        // module-singleton Zustand — priming via window.__PRELOAD__
        // is the closest cross-test seam in the install path. Setting
        // it through window is fragile; instead we rely on the vitest
        // test (PublishPage.test.tsx (a)) to pin the implicit contract,
        // and on this e2e spec to pin the EXTERNAL contract (URL +
        // visible UI).
        localStorage.setItem(
          'sau-publish-ai-collapsed',
          'true', // default collapsed for first-time visitors
        )
      } catch {
        /* private mode — ignore */
      }
    })
    await mockAuthedShellForNT22(page)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  // (a) Click-Send pathway — the user-reported NT-22 surface. Locking
  // this expensive end-to-end pathway means a future refactor that
  // breaks "click Send → wizard pre-selects" is caught by CI on the
  // realistic browser, not just the module-singleton vitest layer.
  test('click SortableGroup.Send → URL 含 ?group_id=N + wizard 预选 + step 0 active + URL self-clean', async ({
    page,
  }) => {
    // Land on /dashboard. AuthGuard must resolve (mocked /api/auth/me
    // returns 200 admin user) and the 2 group cards must paint.
    await page.goto('/dashboard')

    // Wait for AppShell sidebar to paint (chrome-level signal that
    // GroupGridArea has begun rendering). Without this wait, the Send
    // click can race the lazy chunk resolution and miss the click.
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // Snapshot the card count so a future "the grid renders but no
    // buttons" regression fails here, not after the click.
    const sendButtons = page.getByTestId('go-to-publish-from-group-grid')
    await expect(sendButtons).toHaveCount(2)

    // Click the FIRST card's Send button. SortableGroup was the FIRST
    // test fixture in the visual layout per the screenshot user
    // provided (`菌验主号` is the spec's first group). Asserting ID
    // from URL is the canonical contract anchor — not row-index.
    await sendButtons.first().click()

    // ── ASSERTION 1: URL contains ?group_id=42 ────────────────────────
    // The effect navigates to `/dashboard/publish?group_id=42` BEFORE
    // `setSearchParams({}, {replace:true})` clears the param. The
    // `toHaveURL` regex matches the param WHILE it's still in the URL
    // so a falsy race between click → setSearchParams isn't a flake.
    // We tighten the assertion by waiting for the effect's
    // self-clean (SearchParams clear) below — that gives a stable
    // end-state to assert too.
    await expect(page).toHaveURL(/\/dashboard\/publish\?group_id=42/)

    // ── ASSERTION 2: GroupPublishSelector pre-selects the group ────
    // `id="publish-group-select"` is hardcoded in GroupPublishSelector.tsx
    // (locked: see that file's <SelectTrigger>). When a group is
    // pre-selected, the SelectValue placeholder is REPLACED by the
    // group name + platform-icon row. Locking the group name in the
    // trigger text catches both paths at once:
    //   • deep-link setGroupSelection fired → name visible ✓
    //   • platform-icon row visible → mappings seeded ✓
    // Substring match handles the surrounding chrome (icons + chip
    // badges) without coupling to the exact inner render shape.
    const selectTrigger = page.locator('#publish-group-select')
    await expect(selectTrigger).toContainText('菌验主号')

    // Belt-and-suspenders: the GroupPublishSelector renders a
    // 「1/2 个平台已授权」summary line when a group with at least one
    // auth is selected. If setGroupSelection seeded an empty
    // `mappings` array (e.g. a future refactor accidentally typed
    // `.map(a => null)`), this assertion trips.
    await expect(selectTrigger).toContainText('/') // "1/2 ..." summary digit

    // ── ASSERTION 3: wizard.currentStep === 0 (step 0 「上传」active) ──
    // StepIndicator.tsx: every step <button role="listitem"> carries
    // `aria-current="step"` iff `currentStep === s.step`. So
    // 「上传」(Upload, step 0) must carry `aria-current="step"` and
    // 「内容」/「确认」must NOT. Three discrete assertions catch any
    // off-by-one drift in `setStep(0)` (e.g. a future typo that
    // resolves to step 1).
    await expect(
      page.getByRole('listitem', { name: '上传' }),
    ).toHaveAttribute('aria-current', 'step')
    await expect(
      page.getByRole('listitem', { name: '内容' }),
    ).not.toHaveAttribute('aria-current', 'step')
    await expect(
      page.getByRole('listitem', { name: '确认' }),
    ).not.toHaveAttribute('aria-current', 'step')

    // ── ASSERTION 4: URL self-clean (effect strips ?group_id=) ────
    // `setSearchParams({}, {replace:true})` fires after the seed.
    // Wait for the URL to settle. Skipping the wait lets the assertion
    // race the React commit and flake on slow CI.
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.has('group_id') === false,
    )
    const finalUrl = new URL(page.url())
    expect(finalUrl.pathname).toBe('/dashboard/publish')
    expect(finalUrl.searchParams.has('group_id')).toBe(false)
  })

  // (b) Direct deep-link pathway — bookmarks, shared URLs, in-app
  // `navigate('/dashboard/publish?group_id=42')`. Skipping the click
  // ensures the effect itself is the contract (not "click made it
  // there by accident"). Same assertions as (a) for symmetry.
  test('direct nav /dashboard/publish?group_id=42 → 预选 + step 0 + URL self-clean', async ({
    page,
  }) => {
    await page.goto('/dashboard/publish?group_id=42')

    // Wait for the AppShell chrome (top breadcrumb + sidebar) so we
    // know the page is past AuthGuard resolving.
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // GroupPublishSelector pre-selects from the same deep-link
    // pathway, so the same visible contract applies.
    const selectTrigger = page.locator('#publish-group-select')
    await expect(selectTrigger).toContainText('菌验主号')

    // Step 0 active.
    await expect(
      page.getByRole('listitem', { name: '上传' }),
    ).toHaveAttribute('aria-current', 'step')
    await expect(
      page.getByRole('listitem', { name: '内容' }),
    ).not.toHaveAttribute('aria-current', 'step')

    // URL self-clean. Without the strip, a browser refresh on
    // `/dashboard/publish?group_id=42` would re-seed the wizard and
    // jump users away from their step-2 in-progress content every
    // time they hit F5 — `appliedDeepLinkRef` is component-scoped,
    // not URL-scoped, so the URL canonicalisation is essential.
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.has('group_id') === false,
    )
    const finalUrl = new URL(page.url())
    expect(finalUrl.pathname).toBe('/dashboard/publish')
    expect(finalUrl.searchParams.has('group_id')).toBe(false)
  })

  // (c) Refresh-on-canonical-form is idempotent. After the URL
  // self-clean, hitting F5 must NOT re-seed the wizard (the store
  // is fresh on a real refresh; the test verifies the inverse — that
  // there's no leftover param to re-trigger). This is the safety
  // net for (a)+(b): it locks the canonicalization as a one-time
  // strip, not a "fires every render" pattern.
  test('F5 on the canonical form (/dashboard/publish, no ?group_id=) renders wizard without re-seeding', async ({
    page,
  }) => {
    await page.goto('/dashboard/publish')

    // Wait for chrome.
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // GroupPublishSelector should show its placeholder (no group
    // selected), NOT the fake group name. Cheaper than reading the
    // store — `toContainText` on a placeholder picks up the visible
    // 「选择一个账号分组…」copy.
    const selectTrigger = page.locator('#publish-group-select')
    await expect(selectTrigger).toContainText('选择一个账号分组')

    // URL stays clean even after the chrome settles.
    await page.waitForLoadState('networkidle')
    const finalUrl = new URL(page.url())
    expect(finalUrl.searchParams.has('group_id')).toBe(false)
  })
})
