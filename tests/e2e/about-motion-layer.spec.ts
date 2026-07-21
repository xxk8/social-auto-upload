// ─────────────────────────────────────────────────────────────────────
// AboutPage motion layer visual regression
//
// Catches regressions in the round-unify-grammar pass that
// applied the LandingPage motion grammar to /about. The
// page must keep its mission-section MeshGradient + GlowOrb +
// h2 text-segment reveal, AND the bottom CTA section must
// keep the dramatic MeshGradient + CtaSpotlightGlow + .shimmer
// + .cta-ring affordance.
//
// Two-layer assertion strategy (mirrors landing-motion-layer.spec.ts):
//
//   1. STRUCTURAL — fast DOM-attribute checks. Fails in ~1 s when
//      a future refactor drops a data attribute, replaces a
//      Button className, or breaks the data-no-parallax opt-out
//      on the data-dense Scale + Tiers sections. Catches
//      regressions the visual diff might miss (e.g. a
//      regression where a future refactor re-adds the
//      data-mockup-float wrapper to ProjectScopeMockup that
//      the round-unify-grammar pass intentionally removed).
//
//   2. VISUAL — full-page screenshots with `prefers-reduced-motion:
//      reduce` to freeze all GSAP tweens + CSS keyframes at
//      their natural rest state. Two themes (light + dark)
//      because the MeshGradient + CtaSpotlightGlow use the
//      oklch(--primary) tint which differs per theme.
//
// Run:
//   pnpm e2e:visual:about-motion
//
// Update baselines after an intentional visual change:
//   pnpm e2e:visual:about-motion:update
//
// Baselines are stored in
// tests/e2e/about-motion-layer.spec.ts-snapshots/ and should
// be committed to version control.
// ─────────────────────────────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'

// Pin the auth/me endpoint to anonymous so the visitor-facing
// about page mounts (otherwise an authed cookie would bounce to
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

test.describe('AboutPage motion layer visual regression', () => {
  // Mirror the global baseURL — `playwright.config.ts` already
  // points at :5180, but every spec in `tests/e2e/` re-declares
  // this inline so the target port is self-evident per file.
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // Pin locale to zh-CN so headline copy is stable and matches
    // the `把繁琐重复的事` fingerprint below. Theme is set
    // per-test via a second addInitScript so each visual test
    // can swap light ↔ dark without resetting the page.
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
    await page.goto('/about')

    // Wait for the page to commit. The mission section h2
    // "把繁琐重复的事" is the canonical "page mounted" fingerprint
    // (post-round-unify-grammar it reads as 2 data-text-segment
    // spans). AboutPage has no <h1> in the content body — only
    // <h2>s via SectionHeading — so we wait on the h2 instead.
    // A 600 ms wait past that gives the lazy-loaded
    // MarketingFooter + MarketingTopBar a chance to paint
    // before the structural counts.
    await expect(
      page.locator('section[data-section="mission"] h2', { hasText: '把繁琐重复的事' }),
    ).toBeVisible()
    await page.waitForTimeout(600)

    // (1) Mission text-segment reveal — 2 spans in the h2
    // (matches the manual data-text-segment split between
    // "把繁琐重复的事" and "交给脚本").
    await expect(
      page.locator('section[data-section="mission"] h2 [data-text-segment]'),
    ).toHaveCount(2)

    // (1a) TOTAL [data-text-segment] across the page. The exact
    // breakdown:
    //   - Mission h2: 2 spans (one per `data-text-segment` wrap)
    //   - Scale h2: 2 spans
    //   - Tiers h2: 2 spans
    //   - CTA h2: 2 spans
    // Total: 2 + 2 + 2 + 2 = 8. Pinned to zh-CN via the
    // beforeEach addInitScript.
    await expect(page.locator('[data-text-segment]')).toHaveCount(8)

    // (1b) Per-section h2 text-segment counts — every SectionHeading
    // h2 has 2 spans (the manual split between the primary
    // phrase and the muted suffix). Catches a regression where
    // a future refactor drops a `data-text-segment` from one
    // section's heading.
    await expect(
      page.locator('section[data-section="scale"] h2 [data-text-segment]'),
    ).toHaveCount(2)
    await expect(
      page.locator('section[data-section="tiers"] h2 [data-text-segment]'),
    ).toHaveCount(2)
    await expect(
      page.locator('section[data-section="cta"] h2 [data-text-segment]'),
    ).toHaveCount(2)

    // (2) Mesh gradient stack — 2 (1 mission normal + 1 CTA
    // dramatic) + 3 blobs each (2 × 3 = 6 mesh blobs). The CTA
    // spotlight is a separate element (data-cta-glow, asserted
    // in (5) below), not a mesh gradient, so the count stays
    // at 2.
    await expect(page.locator('[data-mesh-gradient]')).toHaveCount(2)
    await expect(page.locator('[data-mesh-blob]')).toHaveCount(6)

    // (3) Glow orbs — 2 (1 in mission, 1 in CTA). The mission
    // `data-glow-orb` is the 600×600 breathing radial; the CTA
    // glow orb is the same component re-used for layered depth
    // against the dramatic MeshGradient.
    await expect(page.locator('[data-glow-orb]')).toHaveCount(2)

    // (4) Data-no-parallax opt-out — the 2 data-dense sections
    // (Scale with prominent "6" / "7×24h" / "100%" numbers +
    // Tiers with "¥0" / "¥199" / "联系销售" prices) carry this
    // attribute. The ambient section parallax would shift the
    // numbers as the user reads; the opt-out freezes them in
    // place. Catches a regression where a future refactor drops
    // the attribute and the parallax starts scrubbing the
    // large numbers during scroll.
    await expect(page.locator('section[data-no-parallax]')).toHaveCount(2)
    await expect(
      page.locator('section[data-section="scale"][data-no-parallax]'),
    ).toHaveCount(1)
    await expect(
      page.locator('section[data-section="tiers"][data-no-parallax]'),
    ).toHaveCount(1)

    // (5) CTA glow — primary CTA section has 1 CtaSpotlightGlow
    // (the 1100×1100 focused radial centered on the h2). It
    // carries `data-cta-glow` so the existing GSAP CTA pulse
    // animates it (scale 1.08 + opacity 0.75, 2.8s yoyo).
    await expect(
      page.locator('section[data-cta-section] [data-cta-glow]'),
    ).toHaveCount(1)

    // (6) Data-section-cell counts — locked to the e2e
    // invariants in AboutPage.tsx (4 + 4 + 4 + 2 = 14 across
    // the 4 sections). The mission/scale/tiers sections each
    // have 4 cells (1 heading + 3 content cards); the CTA
    // section has 2 cells (1 heading + 1 button row).
    await expect(
      page.locator('section[data-section="mission"] [data-section-cell]'),
    ).toHaveCount(4)
    await expect(
      page.locator('section[data-section="scale"] [data-section-cell]'),
    ).toHaveCount(4)
    await expect(
      page.locator('section[data-section="tiers"] [data-section-cell]'),
    ).toHaveCount(4)
    await expect(
      page.locator('section[data-section="cta"] [data-section-cell]'),
    ).toHaveCount(2)

    // (7) Tier cards — 3 in the AboutPage TiersSection
    // (personal / team / enterprise). AboutPage's tier set
    // omits the free tier (which lives on /pricing only).
    // The TiersSection is the 3rd section in main (1st
    // mission, 2nd scale, 3rd tiers).
    const tiersSection = page.locator('main > section').nth(2) // 1st mission, 2nd scale, 3rd tiers
    await expect(tiersSection.locator('[data-tier-card]')).toHaveCount(3)

    // (8) ProjectScopeMockup wrapper carries `data-reveal-group` +
    // `data-reveal-cell` for the entrance fade-up. CRITICAL
    // regression lock: the round-unify-grammar pass
    // intentionally removed `data-mockup-float` from this
    // wrapper (the mockup is a supporting visual inside the
    // mission section, not a hero focal point — the float
    // would over-animate a secondary element). Asserting
    // `data-mockup-float` count = 0 catches a regression
    // where a future refactor re-adds the float.
    await expect(
      page.locator('section[data-section="mission"] [data-reveal-group] [data-reveal-cell]'),
    ).toHaveCount(1)
    await expect(page.locator('[data-mockup-float]')).toHaveCount(0)

    // (9) Primary CTA has BOTH `.shimmer` (light sweep overlay)
    // and `.cta-ring` (animated box-shadow halo). The two
    // classes stack on the same rendered <Link> via className
    // concatenation; the shimmer is a `::before` overlay, the
    // cta-ring is `box-shadow` — they paint on different layers,
    // no z-index fight. Uses the CtaSection + role=link with
    // the "查看定价" text (the primary affordance on /about).
    const ctaPrimary = page
      .locator('section[data-cta-section]')
      .getByRole('link', { name: /查看定价/ })
    await expect(ctaPrimary).toHaveClass(/shimmer/)
    await expect(ctaPrimary).toHaveClass(/cta-ring/)
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
      await page.goto('/about')

      // Wait for the page to commit. The mission section h2
      // is the canonical "page mounted" fingerprint. The 800
      // ms settle is wider than the structural test's 600 ms
      // so the dramatic-mesh variant (14s/18s/22s cadence
      // blobs) is past at least one tick of its initial
      // keyframe position before the screenshot.
      await expect(
        page.locator('section[data-section="mission"] h2', { hasText: '把繁琐重复的事' }),
      ).toBeVisible()
      await page.waitForTimeout(800)

      await expect(page).toHaveScreenshot(`about-motion-${name}-desktop.png`, {
        fullPage: true,
        maxDiffPixels: 200,
        // 30 s timeout — the full-page screenshot of a 4-section
        // about page (mission + scale + tiers + CTA) with 6
        // mesh-blob radial gradients + 1 CtaSpotlightGlow at
        // 1100×1100 takes ~10-15 s on cold start. Same rationale
        // as the LandingPage test.
        timeout: 30_000,
      })
    })
  }
})
