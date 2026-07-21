// ─────────────────────────────────────────────────────────────────────
// PricingPage motion layer visual regression
//
// Catches regressions in the round-unify-grammar pass that
// applied the LandingPage motion grammar to /pricing. The
// page must keep its hero MeshGradient + GlowOrb + pulsing-dot
// badge + h1 text-segment reveal, AND the bottom CTA section
// must keep the dramatic MeshGradient + CtaSpotlightGlow +
// .shimmer + .cta-ring affordance.
//
// Two-layer assertion strategy (mirrors landing-motion-layer.spec.ts):
//
//   1. STRUCTURAL — fast DOM-attribute checks. Fails in ~1 s when
//      a future refactor drops a data attribute, replaces a
//      Button className, or breaks the data-no-parallax opt-out
//      on the data-dense Tiers / PricingComparison sections.
//      Catches regressions the visual diff might miss (e.g. a
//      Class swap that still renders but loses the .cta-ring
//      halo).
//
//   2. VISUAL — full-page screenshots with `prefers-reduced-motion:
//      reduce` to freeze all GSAP tweens + CSS keyframes at
//      their natural rest state. Two themes (light + dark)
//      because the MeshGradient + CtaSpotlightGlow use the
//      oklch(--primary) tint which differs per theme.
//
// Run:
//   pnpm e2e:visual:pricing-motion
//
// Update baselines after an intentional visual change:
//   pnpm e2e:visual:pricing-motion:update
//
// Baselines are stored in
// tests/e2e/pricing-motion-layer.spec.ts-snapshots/ and should
// be committed to version control.
// ─────────────────────────────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'

// Pin the auth/me endpoint to anonymous so the visitor-facing
// pricing page mounts (otherwise an authed cookie would bounce to
// /dashboard/publish before the marketing page paints). Mirrors
// the same shape as `mockShellApis()` in
// landing-motion-layer.spec.ts but inlined here so this spec is
// self-contained.
async function mockShellApis(page: Page) {
  // IMPORTANT: Register the catch-all FIRST and the specific mocks
  // LAST. Playwright evaluates routes in reverse registration order,
  // so the specific handlers below win over this fallback.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
  )

  await page.route(
    (url) => url.pathname === '/api/auth/me',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'unauthenticated' }),
      }),
  )
}

test.describe('PricingPage motion layer visual regression', () => {
  // Mirror the global baseURL — `playwright.config.ts` already
  // points at :5180, but every spec in `tests/e2e/` re-declares
  // this inline so the target port is self-evident per file (no
  // chasing the global config to find out).
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // Pin locale to zh-CN so headline copy is stable and matches
    // the `按你的运营规模` fingerprint below. Theme is set per-
    // test via a second addInitScript so each visual test can
    // swap light ↔ dark without resetting the page.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-locale', 'zh-CN')
      } catch {
        /* private mode */
      }
    })
    await mockShellApis(page)
    // Freeze all animations + transitions for deterministic
    // screenshots. emulated at the page level so every animation
    // is at its natural rest state — mirrors production behavior
    // for users with the OS-level reduced-motion preference.
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  // ─── STRUCTURAL — fast DOM-attribute checks ─────────────────────
  test('motion-layer DOM attributes are present in the expected counts', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    // Default to light theme for the structural test — the
    // attributes are theme-independent.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sau-ui-theme', 'light')
      } catch {
        /* private mode */
      }
    })
    await page.goto('/pricing')

    // Wait for the page to commit. The hero h1 "按你的运营规模"
    // is the canonical "page mounted" fingerprint (post-
    // round-unify-grammar it reads as 2 data-text-segment spans).
    // A 600 ms wait past that gives the lazy-loaded
    // MarketingFooter + MarketingTopBar a chance to paint
    // before the structural counts.
    await expect(page.locator('h1', { hasText: '按你的运营规模' })).toBeVisible()
    await page.waitForTimeout(600)

    // (1) Hero text-segment reveal — 2 spans in the H1 (matches
    // the manual data-text-segment split between
    // "按你的运营规模" and "选择套餐").
    await expect(
      page.locator('section[data-hero-section] h1 [data-text-segment]'),
    ).toHaveCount(2)

    // (1a) Per-section h2 text-segment counts. After the
    // round-unify-grammar char-mode tuning, the CommonFeatures
    // h2 + CTA h2 use <SplitText mode="char"> for char-level
    // stagger reveal (was single-span before, where the 0.12s
    // stagger did nothing). Exact breakdown:
    //   - Hero h1: 2 spans (manual data-text-segment wraps)
    //   - CommonFeatures h2: 12 spans (SplitText char mode
    //     on "一套能力 · 任选你的规模" — 4 Chinese + space + · +
    //     space + 6 Chinese = 13 codepoints, but JSX collapses
    //     the double space around "·" to a single space per
    //     its whitespace rules for adjacent strings, so the
    //     rendered string is "一套能力 · 任选你的规模" with 12
    //     codepoints)
    //   - Highlight h2: 2 spans (manual data-text-segment wraps)
    //   - CTA h2: 9 spans (SplitText char mode on
    //     "就现在选一个方向" — 9 Chinese chars, no double spaces)
    // Total: 2 + 12 + 2 + 9 = 25. Pinned to zh-CN via the
    // beforeEach addInitScript.
    await expect(page.locator('[data-text-segment]')).toHaveCount(25)
    // Sanity splits — the 25 page-wide count is 2 (hero h1) +
    // 23 (CommonFeatures 12 + Highlight 2 + CTA 9). The hero
    // h1 is an h1, not an h2, so the h2-only selector picks
    // up the 23 char/wrap spans. The h1-only selector picks
    // up the 2 hero h1 manual spans.
    await expect(
      page.locator('section h2 [data-text-segment]'),
    ).toHaveCount(23)
    await expect(
      page.locator('section h1 [data-text-segment]'),
    ).toHaveCount(2)

    // (2) Mesh gradient stack — 2 (1 hero normal + 1 CTA
    // dramatic) + 3 blobs each (2 × 3 = 6 mesh blobs). The CTA
    // spotlight is a separate element (data-cta-glow, asserted
    // in (5) below), not a mesh gradient, so the count stays
    // at 2.
    await expect(page.locator('[data-mesh-gradient]')).toHaveCount(2)
    await expect(page.locator('[data-mesh-blob]')).toHaveCount(6)

    // (3) Glow orbs — 2 (1 in hero, 1 in CTA). The hero
    // `data-glow-orb` is the 600×600 breathing radial; the CTA
    // glow orb is the same component re-used for layered depth
    // against the dramatic MeshGradient.
    await expect(page.locator('[data-glow-orb]')).toHaveCount(2)

    // (4) Data-no-parallax opt-out — the 2 data-dense sections
    // (Tiers + PricingComparison) carry this attribute. The
    // ambient section parallax would shift the prices as the
    // user reads; the opt-out freezes them in place. Catches a
    // regression where a future refactor drops the attribute
    // and the parallax starts scrubbing the ¥199 / 联系销售
    // prices during scroll.
    await expect(page.locator('section[data-no-parallax]')).toHaveCount(2)

    // (5) CTA glow — primary CTA section has 1 CtaSpotlightGlow
    // (the 1100×1100 focused radial centered on the h2). It
    // carries `data-cta-glow` so the existing GSAP CTA pulse
    // animates it (scale 1.08 + opacity 0.75, 2.8s yoyo).
    await expect(
      page.locator('section[data-cta-section] [data-cta-glow]'),
    ).toHaveCount(1)

    // (6) Tier cards — 4 in the TiersSection (free / personal /
    // team / enterprise). The PricingComparison table also
    // renders 4 <th data-tier-card> headers, contributing 4
    // more to the page-wide count. Lock both numbers: the
    // TiersSection has 4 tier cards, and the page-wide total
    // is 8. `main > section` scopes away the marketing
    // TopBar / Footer chrome.
    const tiersSection = page.locator('main > section').nth(1) // 1st is Hero, 2nd is Tiers
    await expect(tiersSection.locator('[data-tier-card]')).toHaveCount(4)
    await expect(page.locator('[data-tier-card]')).toHaveCount(8) // 4 Tiers + 4 PricingComparison <th>

    // (7) Primary CTA has BOTH `.shimmer` (light sweep overlay)
    // and `.cta-ring` (animated box-shadow halo). The two
    // classes stack on the same rendered <Link> via className
    // concatenation; the shimmer is a `::before` overlay, the
    // cta-ring is `box-shadow` — they paint on different layers,
    // no z-index fight. Uses the CtaSection + role=link with
    // the "联系销售" text (the primary affordance on /pricing).
    const ctaPrimary = page
      .locator('section[data-cta-section]')
      .getByRole('link', { name: /联系销售/ })
    await expect(ctaPrimary).toHaveClass(/shimmer/)
    await expect(ctaPrimary).toHaveClass(/cta-ring/)

    // (8) Hero badge dot has the `.badge-dot-pulse` class. The
    // 1.6 s scale pulse is the deeper-scaled replacement for
    // Tailwind's `animate-pulse` (1 → 1.45 vs 1 → 1.05) so the
    // eyebrow badge reads as "alive" without competing with the
    // other ambient layers. The badge text in the round-unify-
    // grammar pass is "本地部署 · 14 天免费试用 · 免费版永久免费".
    await expect(
      page.locator('section[data-hero-section] .badge-dot-pulse'),
    ).toHaveCount(1)
  })

  // ─── VISUAL — full-page screenshots, light + dark ───────────────
  for (const { theme, name } of [
    { theme: 'light', name: 'light' },
    { theme: 'dark', name: 'dark' },
  ] as const) {
    test(`desktop · ${name} theme · full page`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      // Set the theme in the page context BEFORE first paint so
      // the ThemeProvider's initial state matches. The
      // beforeEach addInitScript already set the locale;
      // addInitScript calls run in order, last-write-wins per
      // key, so this per-test theme setting lands on top.
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('sau-ui-theme', t as string)
        } catch {
          /* private mode */
        }
      }, theme)
      await page.goto('/pricing')

      // Wait for the page to commit. The hero h1 is the
      // canonical "page mounted" fingerprint. The 800 ms
      // settle is wider than the structural test's 600 ms so
      // the dramatic-mesh variant (14s/18s/22s cadence blobs)
      // is past at least one tick of its initial keyframe
      // position before the screenshot.
      await expect(page.locator('h1', { hasText: '按你的运营规模' })).toBeVisible()
      await page.waitForTimeout(800)

      await expect(page).toHaveScreenshot(`pricing-motion-${name}-desktop.png`, {
        fullPage: true,
        maxDiffPixels: 200,
        // 30 s timeout — the full-page screenshot of a 6-section
        // pricing page (hero + tiers + comparison + commonfeatures
        // + highlight + CTA) with 6 mesh-blob radial gradients +
        // 1 CtaSpotlightGlow at 1100×1100 takes ~10-15 s on
        // cold start. Same rationale as the LandingPage test.
        timeout: 30_000,
      })
    })
  }
})
