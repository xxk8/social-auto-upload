import { test, expect } from '@playwright/test'

/**
 * Visitor-surface attribution rhythm (round 5–9).
 *
 * Locks in CI the two follow-up invariants to the round-4 paying-customer
 * calibration per DESIGN.md `boundaries.marketing-surface`:
 *
 *   (a) Hero stat row on `/` — every cell carries a subject · predicate
 *       caption. Bare-number outcome claims (e.g. `3h+ 每天省下`) were
 *       rejected in round 6 because they read as marketing fluff on the
 *       cold-neutral engineering-tool canvas of the landing surface.
 *       The three cells anchor to the round-7 `<Stat>` primitive whose
 *       required `caption` prop enforces this discipline at the type
 *       level — this spec catches drift in E2E the way the type
 *       gate cannot.
 *
 *   (b) `/pricing` HTTP 200 + 3 tier cards + 1 recommended-accent card
 *       (团队版). The recommended-tier chrome (`.tier-recommended-accent`
 *       inset hairline + "推荐" badge) was added in round 8 to give the
 *       middle-of-funnel choice a sodium-amber visual push without
 *       breaking the no-gradient / no-glass rule. The
 *       `<PricingTier>` primitive folded `TierCardBlock`'s inline markup
 *       into `@/Components/ui/pricing-tier` in round 9; this spec
 *       round 11 added a REQUIRED `id: 'personal' | 'team' | 'enterprise'`
       field to `PricingTierProps` + emits `data-tier-card={id}` + the
       conditional `data-recommended={highlight ? 'true' : undefined}`
       on the outer wrapper. Round-11 layered test-anchor
       architecture: data-attr layer PRIMARY (data attrs describe the
       logical role, copy-proof), class layer SECONDARY (classes
       describe the visual chrome) — both must agree on which tier
       is recommended, otherwise the data says 推荐 but no chrome
       paints (or vice versa); this spec keeps Chrome's chrome
       choice honest even after the refactor.
 *
 * Why this lives in tests/e2e/ rather than `src/Pages/*.test.tsx`:
 *   vitest can't catch the `/pricing` route actually serving 200 from
 *   the SPA (the React Router lazy-load + Suspense path), nor can it
 *   catch the case where `<PricingTier>` renders three identical cards
 *   because of a Vite chunk-split regression that drops tier-2/3.
 *   E2E is the right grain for both checks.
 *
 * Mocks `/api/**` blanket-style so no real backend / DB / cookies are
 * required — the assertions are pure routing + composition (no
 * domain data). Mirrors the mock discipline in
 * `marketing-routing-split.spec.ts` and `opt-3f-ai-collapse.spec.ts`.
 *
 * Also note: this spec complements (does NOT replace) the older
 * `marketing-routing-split.spec.ts`. That spec anchors pre-round-5
 * marketing copy + IDs (e.g. "免费开始使用", `#how-it-works`,
 * `#trust`); the post-round-9 copy + anchors (#platforms / #features
 * / #pricing link) are exercised here. Once the pre-round-5 anchors
 * are deleted from `LandingPage.tsx`, both specs should be merged or
 * the older one retired — tracked as a follow-up.
 */

test.describe('Visitor-surface attribution rhythm (round 5–9)', () => {
  // Mirror the global baseURL — `playwright.config.ts` already points
  // at :5180, but every spec in `tests/e2e/` re-declares this inline
  // so the target port is self-evident per file (no chasing the global
  // config to find out). Pre-merge all four e2e specs targeted :5174
  // (standalone marketing Vite, since removed via `sau_web/site/`
  // deletion); post-merge :5180 is the merged SPA port.
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // Precise pathname-based mock — `url.pathname.startsWith('/api/')`
    // only matches the Flask backend routes (e.g. /api/auth/me,
    // /api/account-groups). A blanket `**/api/**` glob would also
    // intercept Vite-served source files like /src/api/client.ts,
    // returning JSON instead of JavaScript and breaking the React
    // app mount entirely.
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => {
        // For auth/me, return explicit anonymous (success:false) so
        // useAuth triggers clearAuth(), setting isLoading=false.
        // For everything else, return a neutral empty object.
        if (route.request().url().includes('/api/auth/me')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, message: 'unauthenticated' }),
          })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: {} }),
        })
      },
    )
  })

  test('LandingPage / renders 3 Hero stat cells with subject · predicate captions', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)

    // Scope to the 3 Hero cells via `data-hero-cell` (set on the wrap
    // <div> introduced in round 8 by the GSAP reveal-stagger hook —
    // the same hook used by Platforms / Features / Tiers in their
    // TiersSection child lists, so don't reuse the dataset for any
    // framework-wide count).
    const heroStats = page.locator('[data-hero-cell]')
    await expect(heroStats).toHaveCount(3)

    // Each cell must carry BOTH a value and a caption that passes
    // subject · predicate regex. The regex enforces non-empty
    // bookends around the U+00B7 middle dot, ruling out:
    //   - bare numbers (single bookend)
    //   - " · …"-prefixed predicates (empty subject)
    //   - "… · "-suffixed subjects (empty predicate)
    const SUBJECT_PREDICATE = /^.+\s·\s.+$/
    const expectedHeroCells = [
      { value: '6',       caption: '主流平台 · 已接入' },
      { value: '3h+/day', caption: '典型多账号 · 每天省下' },
      { value: '不上云',   caption: '数据归属您 · 私有部署' },
    ] as const

    for (const { value, caption } of expectedHeroCells) {
      // `filter({ hasText: … })` narrows to the single cell whose
      // caption matches — each caption is distinct so the count is 1.
      const cell = page.locator('[data-hero-cell]', { hasText: caption })
      await expect(cell).toHaveCount(1)
      await expect(cell).toContainText(value)
      expect(caption, `caption "${caption}" must read as (subject) · (predicate)`).toMatch(SUBJECT_PREDICATE)
    }
  })

  test('/pricing returns 200 + 3 tier cards + 1 recommended-accent with stable data-testids', async ({ page }) => {
    const response = await page.goto('/pricing')
    expect(response?.status()).toBe(200)

    // ── PRIMARY: round-11 data-attr layer (PRIMARY per
    //    round-11 layered test-anchor architecture) ──────────────
    // `<PricingTier>` required-types `id: 'personal' | 'team' | 'enterprise'`
    // (PriceTierProps) and emits `data-tier-card={id}` on the outer
    // wrapper. That makes the LOGICAL tier identity a renaming-proof
    // browser selection — copy edits to `个人版`, `团队版`, `企业版`
    // cannot break this count. One tier per slug, so each count = 1.
    await expect(page.locator('[data-tier-card="personal"]')).toHaveCount(1)
    await expect(page.locator('[data-tier-card="team"]')).toHaveCount(1)
    await expect(page.locator('[data-tier-card="enterprise"]')).toHaveCount(1)

    // Exactly one tier is recommended. The boolean attr is emitted
    // conditionally (`undefined` on non-highlight tiers), so the
    // value `"true"` is present on one and only one element — no
    // `.not()` filter dance needed.
    await expect(page.locator('[data-tier-card][data-recommended="true"]')).toHaveCount(1)

    // ── SECONDARY: class-based chrome layer ──────────────────────
    // Data attrs describe the LOGICAL role (which tier is recommended);
    // classes describe the VISUAL chrome (round-8 sodium-amber inset
    // hairline + "推荐" badge — the no-gradient / no-glass-rule push).
    // Both layers must agree on which tier is recommended; otherwise
    // the data says "团队版 is 推荐" but no chrome paints, or chrome
    // paints on a different tier than the data says it should.
    await expect(page.locator('.tier-recommended-accent')).toHaveCount(1)

    // Sanity (held last because copy is the most brittle layer):
    // the recommended badge text still reads "推荐". If this fails,
    // copy designers changed the badge — not a structural regression —
    // and the value above is what to investigate.
    await expect(page.getByText('推荐', { exact: true })).toBeVisible()
  })

  test('TopBar cross-link from / to /pricing works', async ({ page }) => {
    await page.goto('/')
    // Scope to TopBar nav — the footer also has a 定价 link
    // and strict mode would throw on 2-element match.
    await page.locator('header').getByRole('link', { name: '定价' }).click()
    await expect(page).toHaveURL(/\/pricing$/)
    // Tier-card fingerprint for the route having mounted (vs. an
    // unmounted /pricing shelling out a Suspense fallback).
    await expect(page.getByText('个人版', { exact: true })).toBeVisible()
  })

  /**
   * Round 12 — `data-section` + `[data-section-cell]` architecture lock.
   *
   * These three tests pin the round-12 visitor-surface refactor so copy
   * drift cannot accidentally merge two sections, drop a stat row, or
   * collapse `/login` and `/login/auth` back into one. The tests
   * exercise:
   *
   *   (a) `/about`     — 4 outer sections (mission|scale|tiers|cta),
   *                      each carrying `data-section="<name>"` on the
   *                      `<section>`, plus per-section `[data-section-cell]`
   *                      count assertions:
   *                        mission: 4 cells (heading wrapper + 3 stats)
   *                        scale:   4 cells (heading wrapper + 3 stats)
   *                        tiers:   4 cells (heading wrapper + 3 tier cards)
   *                        cta:     2 cells (heading wrapper + button row)
   *
   *   (b) `/login`     — 3 outer sections (mission|tiers|cta) (no
   *                      `scale` row because /login is the shorter
   *                      visitor pitch):
   *                        mission: 4 cells
   *                        tiers:   4 cells
   *                        cta:     2 cells
   *
   *   (c) `/login/auth` — the auth form sub-route. Locks that the form
   *                      lives at `/login/auth` (NOT `/login`, which
   *                      post-round-12 hosts the visitor pitch). The
   *                      form-step fingerprint is `邮箱地址` label +
   *                      `发送验证码` button — both copy + structure
   *                      anchored so a future copy change surfaces here.
   *
   * Why data-attrs and not copy?
   *   - copy is the most brittle layer (rebrand / i18n would invalidate
   *     `个人版`-style assertions)
   *   - `data-section` is set on the OUTER `<section>` once per
   *     section, so renaming a heading's `title` / `description` /
   *     `eyebrow` cannot move the section boundary
   *   - `[data-section-cell]`, set per cell, is structural — the count
   *     locks the cell-list cadence even if stat rows grew or shrank
   *     (that would surface as the cell count drifting)
   *
   * Why pre-round-5 baseline survives:
   *   - the existing 3 tests above still cover `/` (Hero stat rows)
   *     and `/pricing` (3 tier cards + recommended accent) — those
   *     invariants are unchanged by round 12 (LandingPage +
   *     PricingPage keep their existing `data-hero-cell` +
   *     `data-tier-card` markers; the new convention applies only to
   *     /about + /login + /login/auth).
   */
  test('/about returns 200 + mounts 4 sections (mission|scale|tiers|cta) with expected data-section-cell counts', async ({ page }) => {
    const response = await page.goto('/about')
    expect(response?.status()).toBe(200)

    // Outer section boundary lock. Exactly one `<section>` carries
    // each `data-section="<name>"` attribute — collapsing two sections,
    // splitting one into two, or deleting any of these would surface as
    // either count=2 or count=0.
    await expect(page.locator('section[data-section="mission"]')).toHaveCount(1)
    await expect(page.locator('section[data-section="scale"]')).toHaveCount(1)
    await expect(page.locator('section[data-section="tiers"]')).toHaveCount(1)
    await expect(page.locator('section[data-section="cta"]')).toHaveCount(1)

    // Per-section cell counts. Each SectionHeading is wrapped in a
    // single `[data-section-cell]`, and stat-row / tier-grid children
    // also carry the marker. The cta section has 2 cells (heading
    // wrapper + button row), not 3 — anchoring the exact count rules
    // out accidentally adding more cells (e.g. extra back-links).
    await expect(page.locator('section[data-section="mission"] [data-section-cell]')).toHaveCount(4)
    await expect(page.locator('section[data-section="scale"]   [data-section-cell]')).toHaveCount(4)
    await expect(page.locator('section[data-section="tiers"]   [data-section-cell]')).toHaveCount(4)
    await expect(page.locator('section[data-section="cta"]     [data-section-cell]')).toHaveCount(2)
  })

  test('/login returns 200 + mounts 3 sections (mission|tiers|cta) with expected data-section-cell counts', async ({ page }) => {
    const response = await page.goto('/login')
    expect(response?.status()).toBe(200)

    // /login (visitor pitch) intentionally has 3 sections, NOT 4 —
    // the `scale` row lives only on /about because /login is the
    // shorter pitch surface. Locking that `scale` does NOT mount here
    // is the architectural reason this is on round-12's list.
    await expect(page.locator('section[data-section="mission"]')).toHaveCount(1)
    await expect(page.locator('section[data-section="tiers"]')).toHaveCount(1)
    await expect(page.locator('section[data-section="cta"]')).toHaveCount(1)

    // No `scale` row on /login — explicit absence assertion so a future
    // round that copy-pastes the AboutPage scale section into LoginPage
    // surfaces as a regression (assertion would still pass for scale
    // but tests below already fail by section count = 4 instead of 3).
    await expect(page.locator('section[data-section="scale"]')).toHaveCount(0)

    // mission: 1 wrapper + 3 stats; tiers: 1 wrapper + 3 tier cards;
    // cta: 1 wrapper + 1 button row (= 2 cells).
    await expect(page.locator('section[data-section="mission"] [data-section-cell]')).toHaveCount(4)
    await expect(page.locator('section[data-section="tiers"]   [data-section-cell]')).toHaveCount(4)
    await expect(page.locator('section[data-section="cta"]     [data-section-cell]')).toHaveCount(2)
  })

  test('/login/auth returns 200 + email-step form mounts (邮箱地址 + 发送验证码)', async ({ page }) => {
    // Round-12 architecture: the auth form moved to /login/auth (the
    // sub-route), while /login now hosts the visitor pitch. This lock
    // confirms the architectural split lands at the right URLs — the
    // form-step fingerprint is `邮箱地址` label + `发送验证码` button,
    // both copy + structure anchored so a future translation drift or
    // form-structure rewrite surfaces here.
    //
    // We deliberately do NOT exercise the full email+code submission
    // flow (that ships in `marketing-routing-split.spec.ts` test 2);
    // this spec's job is the ROUTING + COMPOSITION layer only.
    //
    // The pre-existing blanket `/api/**` mock returns `{success:true,
    // data:[]}` for /api/auth/me — useAuth's `useQuery` reads this as
    // `data.user` undefined, so the authStore's `isAuthenticated`
    // stays false and LoginAuthPage's mount-time `useEffect` redirect
    // trip (`if (isAuthenticated) navigate('/app/publish')`) does NOT
    // fire, keeping the form mounted. No need for an explicit
    // anonymous-visit override.
    const response = await page.goto('/login/auth')
    expect(response?.status()).toBe(200)

    // Email-step fingerprint. `<Label htmlFor="email">邮箱地址</Label>`
    // pairs with the `<Input id="email">` so getByLabel resolves
    // structurally — a future rename to e.g. `邮箱` would invalidate
    // this lock immediately, which is the intent.
    await expect(page.getByLabel('邮箱地址')).toBeVisible()

    // Submit button on the email-step — the type=submit button reads
    // `发送验证码` while idle, `发送中…` while pending. Both branches
    // resolve via getByRole's accessible name, which means `发送中…`
    // would also satisfy this assertion during a pending request —
    // acceptable because the form is at-rest on first paint.
    await expect(page.getByRole('button', { name: '发送验证码' })).toBeVisible()
  })

  /**
   * Round 13 — TopBar cross-link coverage for the round-12 visitor
   * surfaces (`/about` and `/login`). Mirrors the round-9 /pricing
   * cross-link test above so a future regression that drops a TopBar
   * link or breaks its `href` attribute surfaces here instead of
   * silently redirecting visitors to the wrong surface.
   *
   * Same playbook throughout: `await page.goto('/')` (so we land on
   * the marketing landing page rather than the destination route
   * directly — this exercises the actual `<Link>` element on the
   * TopBar chrome) → click the TopBar link by its accessible name →
   * assert the URL matches → assert the destination route mounted by
   * checking a section fingerprint.
   *
   * Special care for /login: the new round-13 useEffect bounce
   * redirects authed visitors landing on /login straight to
   * /app/publish. The spec's blanket every-api mock returns
   * `{success: true, data: []}` for the auth-me endpoint, which
   * useAuth interprets as anonymous (`data.length === 0`), so the
   * bounce doesn't fire and the visitor pitch mounts cleanly. Add
   * an explicit anonymous-visit override IF this stops passing — the
   * pattern is a `page.route` override on the auth-me endpoint
   * returning `{success: false}`; see the `mockAnonymousVisit()`
   * helper in `marketing-routing-split.spec.ts` for the full snippet.
   * Note: JSDoc blocks terminate on the two-character sequence
   * star-slash — avoid putting that substring inside a block
   * comment body (use prose descriptions for glob patterns).
   */
  test('TopBar cross-link from / to /about works', async ({ page }) => {
    await page.goto('/')
    // Scope to TopBar nav so strict mode doesn't fail on footer duplicate.
    await page.locator('header').getByRole('link', { name: '关于' }).click()
    await expect(page).toHaveURL(/\/about$/)
    // Section fingerprint for the route having mounted — `mission` is
    // the first section; if Suspense fell back, no `[data-section]`
    // markers would paint.
    await expect(page.locator('section[data-section="mission"]')).toHaveCount(1)
  })

  test('TopBar cross-link from / to /login works', async ({ page }) => {
    await page.goto('/')
    // Scope to TopBar nav so strict mode doesn't fail on footer duplicate.
    await page.locator('header').getByRole('link', { name: '登录' }).click()
    await expect(page).toHaveURL(/\/login$/)
    // Section fingerprint for the visitor pitch mounting (vs. /login/auth
    // sub-route where the form lives — the trailing `$` regex anchor
    // rules out `/login?plan=<tier>` style deep-link URLs that would
    // still legitimately mount the same pitch but indicate a different
    // intent: mid-funnel traffic, not direct TopBar nav).
    await expect(page.locator('section[data-section="mission"]')).toHaveCount(1)
  })
})
