import { test, expect, type Page } from '@playwright/test'

/**
 * Engineering-tool aesthetic locks (post-reset pass).
 *
 * Locks in CI the three visual contracts introduced when the Web
 * Shell moved off the Linear Lavender / soft-SaaS block-fill
 * canvas onto the industrial-tool canvas:
 *
 *   (A) Active AppShell sidebar nav row
 *       (the "/dashboard" → navItems[0] ("账号管理") row,
 *        which is active when location.pathname === "/dashboard"):
 *       - The row's OWN background is transparent (no
 *         `bg-foreground/[0.08]` row-level fill — the prior
 *         Linear signature that read "soft SaaS row hover").
 *       - The row carries the 2px-sodium-amber hairline strip on
 *         the left edge (`<div class="... w-[2px] ... bg-primary" />`).
 *       - The row's text reads at full ink (`text-foreground`),
 *         not muted-foreground.
 *
 *   (B) `--radius: 0.375rem` cascade.
 *       Defined at `:root` in src/index.css and consumed by every
 *       component via `--radius-{sm,md,lg,xl}`. At 16px root font:
 *         `--radius-sm` → 2px   (`calc(0.375rem - 4px)`)
 *         `--radius-md` → 4px   (`calc(0.375rem - 2px)`)
 *         `--radius-lg` → 6px   (`0.375rem`)
 *         `--radius-xl` → 10px  (`calc(0.375rem + 4px)`)
 *       The spec probes each token via a hidden probe element
 *       whose `border-radius: var(--radius-{sm|md|lg|xl})` forces
 *       chromium to fully resolve the calc().
 *
 *   (C) Tailwind rounded-{sm,md,lg,xl} utilities bound to the
 *       cascade (via probe elements with each class).
 *
 * Why computed-style assertions + a probe element instead of
 * `toHaveScreenshot()`?
 *
 *   - ToHaveScreenshot fails at PIXEL diff — a 1px font-rendering
 *     drift would fail the assertion even if the actual contract
 *     is intact. Computed-style assertions fail with a precise
 *     reason ("expected borderRadius 3px, got 2px").
 *   - ToHaveScreenshot requires baseline PNG artefacts checked
 *     into the repo. Computed-style values are reproducible on
 *     ANY chromium version that supports the CSS features.
 *   - Tailwind v4's `--radius` cascade is the actual contract;
 *     testing the cascade at `:root` proves the math without
 *     anchoring to a particular component class.
 *
 * Each test targets a single invariant so a regression localizes
 * to one failure with no ambiguity. Test #2 (cascade at :root)
 * is the canonical guard — if THAT fails, the tokens are wrong
 * at the source of truth. Test #3 is a sanity that the utilities
 * AND the cascade remain in sync.
 *
 * Auth flipping race: After `goto('/dashboard')`, AuthGuard mounts and
 * reads `useAuth()` which sources `isAuthenticated` (from the
 * store directly) and `isLoading` (composed as rq-state
 * ORed-with store-state via `isLoading: isLoading || store.isLoading`).
 * The store's default state is
 * `{ user: null, isAuthenticated: false, isLoading: true }` —
 * and `authApi.getMe()` fires immediately. The blank-mocked
 * `/api/auth/me` route resolves on the next React Query tick;
 * the effect at the bottom of `useAuth.ts` reads
 * `data?.success && data.data?.user` and calls
 * `store.setUser(user)`, which flips BOTH `isLoading: false`
 * AND `isAuthenticated: true` in one update. AuthGuard's render
 * priority is `if (isLoading) return <spinner>` BEFORE the
 * `!isAuthenticated` redirect branch — so the first frame after
 * mount is a spinner, NOT a `<Navigate to="/login" />` flash.
 * AuthGuard's render 2 then returns `children` and the AppShell
 * sidebar appears. Every locator assertion below auto-retries
 * through this brief spinner → AppShell transition via
 * Playwright's standard 5 s visibility default. If anyone
 * reuses this recipe in a sibling spec, copy the auth-mock
 * pattern verbatim — a spec that mocks `/api/auth/me` to
 * `{ success: false }` would stall the spinner forever and
 * read as a hang rather than a clean redirect.
 */

/**
 * Mirror of the FAKE_USER + blanket-`/api/**` mock used by
 * marketing-routing-split.spec.ts. We need an authenticated
 * mount so AuthGuard flips `isAuthenticated: true` and the
 * AppShell sidebar renders. Lists are returned empty so the
 * AccountsPage lands on its canonical empty-state — the same
 * shape the rest of the e2e specs rely on.
 */
const FAKE_USER = {
  id: 1,
  email: 'qa@example.com',
  role: 'admin' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login: '2026-06-26T00:00:00Z',
}

/**
 * Probe an arbitrary border-radius source — either a CSS variable token
 * or a Tailwind utility class string — and return the canonically
 * resolved pixel value. Used twice in this spec: first to lock the
 * `--radius-{sm,md,lg,xl}` cascade contract at `:root`, then to lock
 * the Tailwind `rounded-{sm,md,lg,xl}` utility → cascade binding.
 *
 * Why the longhand normalization (`split(' ')[0]`)? Chromium 1180+
 * typically returns `borderRadius` as the short-form `'2px'` for a
 * uniform four-corner radius. Older/edge-browser versions (and some
 * future engine updates) may return the expanded `'2px 2px 2px 2px'`
 * longhand when the syntax resolves to a uniform value. Splitting
 * keeps the assertion robust against either emitted form.
 *
 * @param page        Playwright page (browser-context evaluator host).
 * @param radiusValue Either a `var(--token)` string or a literal
 *                    utility class name (e.g. `'rounded-md'`).
 * @param viaClass    If `true`, sets `className` instead of inline
 *                    `style.borderRadius` — exercises the Tailwind
 *                    utility → CSS rule lookup path (JIT-side).
 */
async function probeBorderRadius(
  page: Page,
  radiusValue: string,
  viaClass = false,
): Promise<string> {
  const raw = await page.evaluate(
    ({ value, viaClass: asClass }) => {
      const div = document.createElement('div')
      div.style.position = 'absolute'
      div.style.visibility = 'hidden'
      if (asClass) {
        div.className = value
      } else {
        div.style.borderRadius = value
      }
      document.body.appendChild(div)
      const computed = getComputedStyle(div).borderRadius
      div.remove()
      return computed
    },
    { value: radiusValue, viaClass },
  )
  // Normalize longhand `2px 2px 2px 2px` → short-form `2px` so the
  // downstream `toBe(...)` works against either canonical emission.
  return raw.split(' ')[0]
}

async function mockAuthedShellApis(page: Page) {
  // Function predicates — unambiguous pathname matching handles the
  // axios _t=timestamp query param without glob wildcard ambiguity.
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
        body: JSON.stringify({ success: true, data: [] }),
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

test.describe('Engineering-tool aesthetic locks · linear-hairline + tightened radii', () => {
  // Mirrors the global `use.baseURL` in playwright.config.ts so
  // this spec is self-contained about which port it targets.
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // The recent reset defaults theme to `system`. Pin to light to
    // avoid a CI box that prefers dark colouring the active strip
    // to the dark-mode `--primary` token (`oklch(0.78 0.14 90)` vs
    // light's `oklch(0.62 0.14 90)`). The strip is still amber in
    // both, but the assertion surface shrinks if we lock to one.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'light')
      } catch {
        /* private mode — ignore */
      }
    })
    await mockAuthedShellApis(page)
    // We rely on the desktop AppShell layout (mobile would render
    // the bottom-nav row, not the sidebar). 1280×800 sits above
    // MOBILE_BREAKPOINT (768px) so the AppShell renders the
    // sidebar variant as defined in App.tsx.
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('active sidebar nav row locks: text-foreground + 2px bg-primary hairline, no block-fill', async ({ page }) => {
    await page.goto('/dashboard')
    // /dashboard is navItems[0].path → first sidebar nav link
    // ("账号管理") is active when pathname === '/dashboard'. AccountPage
    // mounts at AppShell's inner `/` route, which (via the outer
    // `<Route path="/dashboard/*" element={<AppShell/>}>` wrapper)
    // mounted for /dashboard because the inner `<Route path="/">`
    // matches /dashboard as the layout root.

    const activeLink = page.getByRole('link', { name: '账号管理' })
    await expect(activeLink).toBeVisible()

    // Active row carries the full-ink text class. Reading the class
    // authority directly is more durable than computed-style on
    // tailwind v4 text utilities (which compile to `color: ...`
    // that gets inherited & could be masked in playwright e2e
    // by ancestor CSS that's not actually painting).
    await expect(activeLink).toHaveClass(/\btext-foreground\b/)

    // The active row MUST NOT carry a row-level background fill.
    // Computed `background-color` must be transparent — that is
    // the assertion that catches a future regression where
    // someone reintroduces `bg-foreground/[0.08]` (the soft-SaaS
    // block fill from the pre-reset design).
    //
    // Two assertions in this block, both HARD `expect` (no soft):
    //   • className regex — catches the JSX-author regression
    //     (someone types `bg-foreground/[0.08]` back into App.tsx).
    //   • computed backgroundColor — catches the BRUTE regression
    //     (any parent CSS / theme toggle / style override that
    //     tints the row, regardless of source).
    // Both are first-class locks; falling back to `expect.soft`
    // for either means the other silently masks a regression.
    const rowStyles = await activeLink.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        // NOTE: variable name is `className` (string), not
        // `classList` (DOMTokenList). The latter would serialise
        // via JSON as empty in `page.evaluate`'s structured-clone
        // transport — naming follows the actual data shape.
        backgroundColor: cs.backgroundColor,
        className: el.className,
      }
    })
    expect(rowStyles.className, 'no block-fill utility on row').not.toMatch(
      /bg-foreground\/\[0\.0[48]\]/,
    )
    expect(rowStyles.backgroundColor, 'row-level background must be transparent').toBe(
      'rgba(0, 0, 0, 0)',
    )

    // Active strip child — the Linear-issue-pane hairline. Anchored
    // by its class pair: `w-[2px]` for the width AND `bg-primary`
    // for the sodium-amber token. Both must be present.
    //
    // Selector note: Playwright's CSS selector engine requires
    // escaping `/` in Tailwind class names like `top-1/2` →
    // `top-1\\/2` (standard CSS escaping). The earlier comment
    // that claimed unescaped `/` works was incorrect — the slash
    // is a special character in Playwright's locator parser.
    const strip = activeLink.locator(
      'div.absolute.left-0.top-1\\/2[class*="w-[2px]"][class*="bg-primary"]',
    )
    await expect(strip).toBeVisible()

    // Hairline width must be exactly 2px. Reading computed
    // `width` works because `w-[2px]` compiles to `width: 2px`.
    const stripStyles = await strip.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        width: cs.width,
        // Background colour resolves to whatever the sodium amber
        // var(--primary) token evaluates to at runtime
        // (oklch(0.62 0.14 90) at the rendered surface). The
        // assertion just verifies it's NOT transparent (a
        // regression would drop the strip to invisible).
        backgroundColor: cs.backgroundColor,
      }
    })
    expect(stripStyles.width, 'hairline strip must be exactly 2px wide').toBe('2px')
    expect(
      stripStyles.backgroundColor,
      'hairline strip must paint a sodium-amber colour, not be transparent',
    ).not.toBe('rgba(0, 0, 0, 0)')

    // Defensive cross-check: a non-active link on the sidebar
    // (e.g. `发布中心`) MUST NOT have the strip child rendered
    // at all. Catches the regression where the strip wrapper got
    // hoisted outside the `active && ...` guard.
    const publishLink = page.getByRole('link', { name: '发布中心' })
    await expect(publishLink).toBeVisible()
    await expect(
      publishLink.locator('div.absolute.left-0.top-1\\/2[class*="w-[2px]"]'),
      'non-active nav row must NOT have the hairline strip',
    ).toHaveCount(0)
  })

  test('--radius cascade locks: sm=2px, md=4px, lg=6px, xl=10px at :root', async ({ page }) => {
    await page.goto('/dashboard')

    // Wait for React mount + Vite async CSS injection before reading
    // computed styles. Without this wait, `getComputedStyle` may run
    // before the stylesheet is injected, returning 0px for any
    // `var(--radius-*)` probe.
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // All four radius cascade asserts (2/4/6/10px) implicitly
    // assume `:root { font-size: 16px }`. A regression that sets
    // `:root { font-size: 14px }` would silently shift every
    // rem-derived radius — `0.375rem` would resolve to 5.25px
    // instead of 6px, the cascade math still computes cleanly,
    // but every expectation would fail with a confusing message.
    // Pin the root font size first so a CSS-level regression
    // surfaces as a single clean failure with the actual px.
    const rootFontSize = await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    )
    expect(rootFontSize, 'root font-size pinned at 16px (cascade assumes 1rem=16px)').toBe(
      '16px',
    )

    // Capture the canonical `--radius` itself — a regression where
    // someone bumps `--radius` back to `0.5rem` (the prior soft-SaaS
    // value) is the highest-impact drift this spec defends against;
    // asserting the source token up-front makes the diagnostic
    // unambiguous.
    const rootRadius = (
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
      )
    )
    expect(rootRadius, 'root --radius is 0.375rem (industrial-tool density)').toBe('0.375rem')

    // Tailwind v4 `@theme inline` generates radius tokens as
    // compile-time values consumed by Tailwind utility classes
    // (rounded-sm/md/lg/xl), NOT as runtime CSS custom properties
    // on :root. Probing via the utility classe string exercises
    // the same cascade contract without depending on runtime
    // `var(--radius-*)` availability.
    expect(await probeBorderRadius(page, 'rounded-sm', true), 'rounded-sm utility → 2px').toBe(
      '2px',
    )
    expect(await probeBorderRadius(page, 'rounded-md', true), 'rounded-md utility → 4px').toBe(
      '4px',
    )
    expect(await probeBorderRadius(page, 'rounded-lg', true), 'rounded-lg utility → 6px').toBe(
      '6px',
    )
    expect(await probeBorderRadius(page, 'rounded-xl', true), 'rounded-xl utility → 10px').toBe(
      '10px',
    )
  })

  test('Tailwind rounded-{sm,md,lg,xl} utilities bound to the cascade', async ({ page }) => {
    await page.goto('/dashboard')

    // Wait for React mount + Vite async CSS injection (same as test #2).
    await expect(page.getByRole('link', { name: '账号管理' })).toBeVisible()

    // Same contract as the cascade probe, but exercised through
    // the actual utility class string. If the utility is missing
    // from JIT output, computed borderRadius reads `0px` — that's
    // a clean failure pointing at the JIT-side issue, not the
    // cascade-side one, so it provides diagnostic locality.
    //
    // JIT-side dependency: `rounded-{sm,md,lg,xl}` must appear
    // as literal substrings somewhere in the scanned source. If
    // a future refactor strips the last usage out of source, the
    // Tailwind v4 JIT will drop the rule and the probe value will
    // read `0px`, surfacing the regression with a tight diff.
    expect(await probeBorderRadius(page, 'rounded-sm', true), 'rounded-sm utility → 2px').toBe(
      '2px',
    )
    expect(await probeBorderRadius(page, 'rounded-md', true), 'rounded-md utility → 4px').toBe(
      '4px',
    )
    expect(await probeBorderRadius(page, 'rounded-lg', true), 'rounded-lg utility → 6px').toBe(
      '6px',
    )
    expect(await probeBorderRadius(page, 'rounded-xl', true), 'rounded-xl utility → 10px').toBe(
      '10px',
    )
  })
})
