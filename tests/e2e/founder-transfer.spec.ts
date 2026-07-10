// ─────────────────────────────────────────────────────────────────────
// Founder transfer · admin users page · end-to-end (round ai-api-keys-founder).
//
// One happy-path test drives the full transfer flow against a mocked
// /api/** layer (mirrors the mock discipline in admin-tab-shortcuts
// and admin-screenshots specs — no real backend / DB / cookies
// required). The flow pins the seven cross-stack invariants that a
// future refactor could silently break:
//
//   1. AuthGuard resolves to an admin user whose `is_founder=true`.
//      Without this, the Founder dropdown menu item is gated off
//      and the test never reaches the action.
//   2. Founder pill renders inline on the viewer's row before
//      transfer (sanity‑check the gating works in BOTH directions).
//   3. Dropdown menu surfaces the "移交 Founder 身份" item ONLY when
//      the viewer IS founder (mirror of backend's @founder_required).
//      The item is enabled for non-self, non-founder targets.
//   4. AlertDialog opens with the recipient + irreversible warning
//      on click.
//   5. Confirm fires POST /api/admin/founder/transfer; the mock
//      responds with success:true so the toast + cache invalidation
//      chain runs.
//   6. After invalidation, /api/admin/users re-fetches and the
//      MOCKED response flips target.is_founder=true and
//      viewer.is_founder=false — the page re-renders with the new
//      Founder pill placement.
//   7. The Founder pill moves from viewer → target row, never
//      appearing on both rows simultaneously (the partial-unique
//      index invariant lifted to UI).
//
// Mock strategy:
//   • /api/auth/me is stateful via a per-test counter that flips
//     `is_founder: true → false` on the second fetch (mirrors
//     invalidation of `['me']`).
//   • /api/admin/users is stateful via a per-test counter that
//     flips target.is_founder=false → true on the second fetch
//     (mirrors invalidation of `['admin','users']`).
//   • /api/admin/founder/transfer echoes the request body so the
//     page's `result.data.prior_founder.email` /
//     `result.data.new_founder.email` toast is exercised end-to-end.
//   • All other /api/** routes return `{ success: true, data: [] }`
//     so unmocked shell endpoints never stall the page.
//
// Why this lives in tests/e2e/ rather than the vitest hooks in
// AdminDashboard.test.tsx: this test exercises the FULL Radix
// DropdownMenu → AlertDialog → React-Query cache-invalidation
// lifecycle, which only a real browser can drive deterministically.
// vitest/jsdom skips the portal + focus-management choreography.
// ─────────────────────────────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'

test.describe('Founder transfer · admin users page · end-to-end', () => {
  test.use({ baseURL: 'http://localhost:5180' })

  // ── Fixtures ─────────────────────────────────────────────────────
  // FAKE_VIEWER = current founder (the caller of the transfer
  // endpoint). FAKE_TARGET = the recipient (currently NOT founder;
  // will become the new founder post-transfer).
  const FAKE_VIEWER = {
    id: 1,
    email: 'founder@sau.dev',
    role: 'admin' as const,
    tier: 'pro',
    created_at: '2026-01-01T00:00:00Z',
    last_login: '2026-06-26T00:00:00Z',
    is_founder: true,
  }
  const FAKE_TARGET = {
    id: 2,
    email: 'target@sau.dev',
    role: 'user' as const,
    tier: 'free',
    created_at: '2026-02-01T00:00:00Z',
    last_login: '2026-06-25T00:00:00Z',
    is_founder: false,
  }

  // ── Stateful mock layer ──────────────────────────────────────────
  // The mock counters track how many times each route fired and
  // respond with the "post-transfer" shape on subsequent calls.
  // React Query's invalidate-on-success drives two fetches per
  // mutation (one for `['me']`, one for `['admin','users']`); the
  // counter logic is `first fetch → pre-transfer state, ≥ 2nd fetch
  // → post-transfer state`.
  async function mockFounderTransferEndpoints(
    page: Page,
    fetchCount: { me: number; users: number },
  ) {
    await page.route(
      (url) => url.pathname === '/api/auth/me',
      (route) => {
        fetchCount.me += 1
        // Pre-transfer: is_founder=true. Post-transfer (any
        // subsequent fetch triggered by ['me'] invalidation):
        // is_founder=false. The backend's @founder_required gate
        // would now reject /api/admin/founder/transfer, but the UI
        // doesn't call it again — we just need the gate to hide the
        // dropdown item on the next render.
        const isFounder = fetchCount.me === 1
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { user: { ...FAKE_VIEWER, is_founder: isFounder } },
          }),
        })
      },
    )

    await page.route(
      (url) => url.pathname === '/api/admin/users',
      (route) => {
        fetchCount.users += 1
        // Pre-transfer: target isn't founder. Post-transfer (any
        // subsequent fetch triggered by ['admin','users']
        // invalidation): target becomes the founder.
        const post = fetchCount.users >= 2
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              { ...FAKE_VIEWER, is_founder: post ? false : FAKE_VIEWER.is_founder },
              { ...FAKE_TARGET, is_founder: post ? true : FAKE_TARGET.is_founder },
            ],
          }),
        })
      },
    )

    await page.route(
      (url) => url.pathname === '/api/admin/founder/transfer',
      (route) => {
        const body = (route.request().postDataJSON() ?? {}) as {
          target_user_id?: number
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              prior_founder: {
                id: FAKE_VIEWER.id,
                email: FAKE_VIEWER.email,
              },
              new_founder: {
                id: body.target_user_id ?? FAKE_TARGET.id,
                email: FAKE_TARGET.email,
              },
              transferred_at: new Date().toISOString(),
            },
          }),
        })
      },
    )

    // Shell endpoints the AdminUsersPage sidebar/nav mounts on
    // initial paint but doesn't render in this flow's DOM tree —
    // we still need them so authStore / queryClient don't error.
    await page.route(
      (url) =>
        url.pathname === '/api/account-groups' ||
        url.pathname === '/api/accounts' ||
        url.pathname === '/api/tasks',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        }),
    )

    // Catch-all for any other /api/** call. Pinned list matches
    // admin-tab-shortcuts.ts so a future route added by an
    // unrelated feature surfaces here as a missing route.
    const PINNED = [
      '/api/auth/me',
      '/api/admin/users',
      '/api/admin/founder/transfer',
      '/api/account-groups',
      '/api/accounts',
      '/api/tasks',
    ]
    await page.route(
      (url) => url.pathname.startsWith('/api/') && !PINNED.includes(url.pathname),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        }),
    )
  }

  test('admin (founder) → select non-self target → confirm → new Founder pill placement on target row', async ({ page }) => {
    // Reset the theme so light-mode classes capture deterministically
    // (matches the admin-screenshots pre-init script).
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'light')
      } catch {
        /* private mode — ignore */
      }
    })

    const fetchCount = { me: 0, users: 0 }
    await mockFounderTransferEndpoints(page, fetchCount)
    await page.setViewportSize({ width: 1280, height: 800 })

    // ── (1) AuthGuard resolves to founder-sau (is_founder=true). ──
    await page.goto('/dashboard/admin/users')
    await expect(page.getByRole('heading', { name: '用户管理', level: 1 })).toBeVisible()

    // ── (2) Founder pill renders inline on viewer's own row. ─────
    // Sanity-check that the viewer is rendered with the Founder
    // chip BEFORE the transfer — the inline mounting contract.
    await expect(page.getByTitle('AI API Key 唯一管理者（Founder）')).toBeVisible()

    // ── (3) Dropdown menu surfaces the Founder transfer item only
    //       for the target row (viewer self-row is Founder so
    //       its menu item is disabled via the u.id === currentUser?.id
    //       belt). ────────────────────────────────────────────────
    await page.getByRole('button', { name: /变更角色 target@sau\.dev/ }).click()
    const founderMenuItem = page.getByTestId('founder-transfer-2')
    await expect(
      page.getByRole('menuitem', { name: '移交 Founder 身份' }),
    ).toBeVisible()
    // Target is a fresh user (not founder) — the menu item is NOT
    // aria-disabled.
    await expect(founderMenuItem).not.toHaveAttribute('aria-disabled', 'true')
    // Close the menu before re-opening for the action (Radix portals
    // can collide between sequential opens).
    await page.keyboard.press('Escape')

    // ── (4) Open the target's dropdown again → click Founder menu
    //       → AlertDialog mounts with the recipient + warning. ───
    await page.getByRole('button', { name: /变更角色 target@sau\.dev/ }).click()
    await page.getByTestId('founder-transfer-2').click()
    await expect(page.getByText(/此操作不可撤销/)).toBeVisible()

    // ── (5) Click confirm → POST /api/admin/founder/transfer → mock
    //       echoes prior + new founder pair → React Query invalidates
    //       ['me'] + ['admin','users'] + ['admin','audit'] → both
    //       mock endpoints are re-fetched → viewer loses
    //       is_founder, target gains it. ────────────────────────
    //
    // Anchor the test on response events rather than counter
    // arithmetic: `waitForResponse` resolves when the response
    // ARRIVES, eliminating the React Query refetchOnMount / focus
    // race that drives spurious fetches alongside the invalidation
    // cycle. The mock counters are debug-only after this point.
    const transferResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/admin/founder/transfer') &&
        r.request().method() === 'POST' &&
        r.status() === 200,
    )
    await page.getByTestId('founder-transfer-confirm').click()
    await transferResponse

    // After onSuccess invalidates `['admin','users']`, the second
    // fetch lands with the post-transfer shape. Waiting for it
    // explicitly gives the DOM one render-tick to repaint — the
    // assertion below resolves on the first mount where the new
    // FounderPill lands on the target row.
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/admin/users') && r.status() === 200,
      { timeout: 5_000 },
    )

    // ── (6) New Founder pill placement: on the target row only. ──
    // We assert row-scoped because the `Founder` text + title would
    // be ambiguous if scoped globally (it's only ever on ONE row,
    // but React re-render ordering isn't deterministic).
    const targetRow = page
      .getByRole('row')
      .filter({ hasText: 'target@sau.dev' })
    await expect(
      targetRow.getByTitle('AI API Key 唯一管理者（Founder）'),
    ).toBeVisible()

    // ── (7) Inverse: viewer's row no longer carries Founder pill. ─
    // This is the partial-unique index invariant surfaced into UI:
    // exactly one user carries the Founder badge at any time.
    const viewerRow = page
      .getByRole('row')
      .filter({ hasText: 'founder@sau.dev' })
    await expect(
      viewerRow.getByTitle('AI API Key 唯一管理者（Founder）'),
    ).not.toBeVisible()

    // Sanity: the dropdown menu on the viewer's OWN row no longer
    // surfaces the Founder menu item at all (the conditional
    // `{isCurrentFounder && (...)}` short-circuits once viewer
    // loses founder status from the ['me'] invalidation re-fetch).
    await page
      .getByRole('button', { name: /变更角色 founder@sau\.dev/ })
      .click()
    // `queryByRole` returns a `Locator`, NOT an `Element | null`;
    // `.toBeNull()` would TypeError. Use `.toHaveCount(0)` instead,
    // which is the canonical Locator-API nullness check.
    await expect(
      page.getByRole('menuitem', { name: '移交 Founder 身份' }),
    ).toHaveCount(0)
  })
})
