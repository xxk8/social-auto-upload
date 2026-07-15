import { test, expect, type Page } from '@playwright/test'

/**
 * Round-OPT-accounts-Enter-confirm (2026-q3 follow-up): Playwright E2E
 * spec that PROVES the user's real-browser bug claim is fixed on
 * /dashboard/accounts:
 *
 * > "On /dashboard/accounts, when I click delete-this-group, why
 * >  doesn't Enter trigger the confirm? Enter SHOULD delete."
 *
 * The previous-turn code fix lives at
 * `sau_web/frontend/src/features/accounts/GroupDeleteDialog.tsx` —
 * a shared controlled-component used by BOTH the list view
 * (GroupListItem.tsx) and the grid view (SortableGroup.tsx). The
 * spec exercises both views so a regression in either path is caught
 * by CI on the realistic browser, not just inferred from vitest+jsdom
 * (vitest mocks Radix focus-traps unevenly).
 *
 * What's locked here, end-to-end in real Chromium:
 *
 *   1. Trash icon click → shadcn `<AlertDialog>` opens with role="dialog".
 *   2. Focus lands on the destructive button (text "删除") per
 *      `<GroupDeleteDialog />`::onOpenAutoFocus redirect — the core
 *      fix that swaps Radix's default cancel-focus for "click Trash
 *      → Enter confirms" UX.
 *   3. Pressing bare Enter fires `dispatch.handleDeleteGroup` (the
 *      DiaglogContent-level `onKeyDown` handler is a belt-and-suspenders
 *      path; the focused-button+Enter=click path is the primary).
 *   4. `dispatch.handleDeleteGroup` invokes the DELETE mutation which
 *      the mocked backend returns 200 for; the success toast
 *      (`分组 "<name>" 已删除`) appears within the toast container,
 *      confirming the wiring chain.
 *
 * Two tests for symmetry — mirrors `nt22-group-to-publish.spec.ts's`
 * (a)/(b) dual-pathway pattern:
 *
 *   (a) Grid view (= default `viewMode`). Locking this catches the
 *       regression where the inline `<GroupDeleteDialog>` helper was
 *       deleted from `SortableGroup.tsx` but its embedded trigger
 *       button (which used to live INSIDE the helper's
 *       `<AlertDialogTrigger asChild>` wrapper) was never replaced.
 *   (b) List view. Same machinery via a different row component
 *       (GroupListItem). Catches the symmetry break where the
 *       list-view wrapper diverges from the grid-view one.
 *
 * Why E2E (not just vitest): jsdom doesn't model Radix's
 * `DialogPrimitive.Close` auto-close + focus-trap + the synthetic
 * keydown→click activation chain in a way that's faithful to
 * Chromium's spec-compliant behavior. The user's explicit claim
 * ("Enter doesn't delete") is a real-browser behavioral assertion
 * that only an E2E spec can prove.
 *
 * Mock strategy (mirrors `nt22-group-to-publish.spec.ts::
 * mockAuthedShellForNT22`):
 *
 *   - `/api/auth/me` → authenticated admin user (AuthGuard green).
 *   - `/api/account-groups` (GET) → 2 synthetic groups so deleting
 *     one leaves the other visible (a count of 1 group on render
 *     would trivially pass the delete assertion).
 *   - `/api/account-groups/<id>` (DELETE) → 200 success with
 *     `{ success: true }`. Pattern matches any numeric id.
 *   - `/api/accounts` + `/api/tasks` → empty arrays (unmocked RQ
 *     hooks would otherwise retry-stall the page on mount).
 *   - Catch-all `/api/*` → empty arrays so any future unmocked
 *     endpoint doesn't stall axios retries.
 */

// ── Fixtures ────────────────────────────────────────────────────────────

const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-07-11T00:00:00Z',
}

const FAKE_GROUPS = [
  {
    id: 42,
    name: '测试分组-A',
    created: '2026-07-11T00:00:00Z',
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
    name: '测试分组-B',
    created: '2026-07-11T00:00:00Z',
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

async function mockAuthedShellApis(page: Page) {
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
      ].includes(url.pathname) &&
      !/^\/api\/account-groups\/\d+$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )
}

async function mockDeleteAccountGroup(page: Page) {
  await page.route(
    (url) => /^\/api\/account-groups\/\d+$/.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    },
  )
}

// ── Spec ────────────────────────────────────────────────────────────────

test.describe('Enter-confirm · /dashboard/accounts row-delete', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    await mockAuthedShellApis(page)
    await mockDeleteAccountGroup(page)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  // (a) Grid view (default). The previous-turn consistency fix added
  //     the missing Trash trigger button to SortableGroup.tsx; this
  //     test is the lock-in.
  test('grid view · click Trash → focus on 删除 → Enter → success toast', async ({
    page,
  }) => {
    await page.goto('/dashboard/accounts')

    // Wait for the AppShell sidebar to paint (`账号管理` is the active
    // sidebar link because we landed on the accounts page). Without
    // this wait, the Trash click can race the lazy chunk resolution.
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // ── ASSERTION 1: Two Trash buttons render (one per group card) ──
    // If the previous-turn SortableGroup bug regresses (i.e. the Trash
    // button gets lost again), the toHaveCount(2) catches it here
    // BEFORE we proceed to the click. Mirrors nt22 test (a)'s
    // preflight before click.
    const trashButtons = page.getByRole('button', { name: 'Delete group' })
    await expect(trashButtons).toHaveCount(2)

    // ── ACT: click the FIRST card's Trash ──────────────────────────
    await trashButtons.first().click()

    // ── ASSERTION 2: DeleteDialog opens with role=dialog ──────────
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // The dialog title + description render with the seeded group's
    // name as a regression guard (description-string interpolation must
    // still pass the props through).
    await expect(dialog.getByText('确认删除')).toBeVisible()
    await expect(dialog.getByText(/测试分组-A/)).toBeVisible()

    // ── ASSERTION 3: Focus is on the destructive button (删除) ─────
    // This is THE lock for the user's bug. The GroupDeleteDialog's
    // onOpenAutoFocus substitutes our own focus on the destructive
    // button for Radix's default cancel-focus. Without this assertion
    // a future refactor that removes the `e.preventDefault()` in
    // onOpenAutoFocus would silently regress — Enter would dismiss
    // instead of confirming, matching the user's original bug.
    const destructiveButton = dialog.getByRole('button', { name: '删除' })
    await expect(destructiveButton).toBeFocused()

    // ── ACT: press Enter ─────────────────────────────────────────
    // Two paths converge on onConfirm; the assert-to-have-fired chain
    // works regardless of which one triggers first:
    //   • Browser-native focused-button+Enter = click on the focused
    //     <button>, which falls through to its onClick={onConfirm}.
    //   • <AlertDialogContent onKeyDown> belt-and-suspenders: Enter
    //     bubbles up from the focused <button>; the BUTTON-tag early
    //     exit suppresses our explicit onConfirm call to avoid
    //     double-firing onConfirm.
    // Both paths produce exactly one DELETE mutation.
    await page.keyboard.press('Enter')

    // ── ASSERTION 4: dialog auto-closes via shadcn Close primitive
    await expect(dialog).not.toBeVisible({ timeout: 2000 })

    // ── ASSERTION 5: success toast appears with the deleted group name
    // AccountsProvider.handleDeleteGroup fires `addToast(`分组
    // "${name}" 已删除`, 'success')` after the DELETE mutation succeeds.
    // Searching with the seeded group name locks the chain end-to-end
    // (mocked DELETE → AccountsProvider catch → addToast → toaster
    // container).
    await expect(
      page.getByText('分组 "测试分组-A" 已删除', { exact: false }),
    ).toBeVisible({ timeout: 3000 })
  })

  // (b) List view. Mirrors (a) but the row container is GroupListItem
  //     instead of SortableGroup. Locks the symmetry: the shared
  //     `<GroupDeleteDialog>` machinery works the same in both view
  //     modes.
  test('list view · click Trash → focus on 删除 → Enter → success toast', async ({
    page,
  }) => {
    await page.goto('/dashboard/accounts')

    // Wait for AppShell sidebar.
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // Switch to list view. The view-mode toggle is rendered inside
    // the AccountsPage chrome; its discriminator is a button labeled
    // 「列表」. If a future refactor relabels the toggle, update
    // this locator — the contract anchor is "find the list-mode
    // segmented control".
    // Switch to list view via the locale-stable data-testid anchor
    // (locked on GroupToolbar.tsx) — a future i18n refactor that
    // relabels the visible aria-label won't break the contract.
    // NOTE: the OLD selector `getByRole('button', { name: '列表' })`
    // silently failed to locate the toggle because the actual
    // aria-label is the English string `'List view'`. This data-testid
    // anchor is the locale-stable replacement that actually works.
    await page.getByTestId('view-toggle-list').click()

    // Two Trash buttons render in list view (per GroupListItem).
    // The list-view button has the same aria-label="Delete group"
    // so the role-by-aria selector is identical.
    const trashButtons = page.getByRole('button', { name: 'Delete group' })
    await expect(trashButtons).toHaveCount(2)

    // Click the SECOND row's Trash (we delete the OTHER group, so
    // the success-toast assertion below is unambiguous about which
    // one was deleted).
    await trashButtons.nth(1).click()

    // Dialog opens with destructive button focused.
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('确认删除')).toBeVisible()
    await expect(dialog.getByText(/测试分组-B/)).toBeVisible()

    const destructiveButton = dialog.getByRole('button', { name: '删除' })
    await expect(destructiveButton).toBeFocused()

    // Press Enter.
    await page.keyboard.press('Enter')

    // Dialog closes + success toast.
    await expect(dialog).not.toBeVisible({ timeout: 2000 })
    await expect(
      page.getByText('分组 "测试分组-B" 已删除', { exact: false }),
    ).toBeVisible({ timeout: 3000 })
  })
})
