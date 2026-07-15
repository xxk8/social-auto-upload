// ─────────────────────────────────────────────────────────────────────
// LandingPage motion layer visual regression
//
// Catches regressions in the GSAP motion layer added in the
// round-beautify PR (useLandingMotion hook + MeshGradient +
// SplitText + .cta-ring / .shimmer / .mesh-blob CSS layer).
//
// Two-layer assertion strategy:
//
//   1. STRUCTURAL — fast, deterministic DOM-attribute checks that
//      fail when the motion grammar is broken (missing data
//      attributes, wrong counts, missing CSS classes). These
//      catch the case where a future refactor drops a
//      `data-text-segment` or replaces the Button className such
//      that `.cta-ring` no longer paints, even if the visual
//      screenshot diff is silent. ~1 s per test, no I/O beyond
//      the page load itself.
//
//   2. VISUAL — full-page screenshots with `prefers-reduced-motion:
//      reduce` to freeze all GSAP tweens + CSS keyframes at
//      their natural rest state. Two themes (light + dark)
//      because the MeshGradient + CtaSpotlightGlow use the
//      oklch(--primary) tint which differs per theme — a
//      regression in the dark variant wouldn't surface in a
//      light-only baseline. ~10-30 s per test (page load +
//      paint + 800 ms settle + full-page screenshot diff).
//
// Why emulateMedia({ reducedMotion: 'reduce' }) over JS injection?
//   The GSAP motion layer reads `gsap.matchMedia({ motion:
//   '(prefers-reduced-motion: no-preference)' })` to gate every
//   ambient tween. useRevealStagger mirrors the gate with the
//   inverse condition. emulateMedia flips the media query, so
//   every matchMedia add() short-circuits — no tweens are
//   created, no ScrollTriggers fire, and the CSS
//   `@media (prefers-reduced-motion: reduce)` overrides freeze
//   the mesh-blob + shimmer + cta-ring keyframes. The resulting
//   DOM is at its natural rest state (visible, fully
//   positioned, no transforms applied), which is what the
//   screenshot diff compares against.
//
//   Cleaner than a kill-tween + clear-ScrollTrigger injection
//   that would have to walk the GSAP context tree on every
//   page mount (and any new tween created after the injection
//   would slip through). The media-query approach mirrors
//   production behavior for users with the OS-level
//   reduced-motion preference — same DOM, same paint.
//
// Run:
//   pnpm e2e:visual:landing-motion
//
// Update baselines after an intentional visual change:
//   pnpm e2e:visual:landing-motion:update
//
// Baselines are stored in
// tests/e2e/landing-motion-layer.spec.ts-snapshots/ and should
// be committed to version control.
// ─────────────────────────────────────────────────────────────────────

import { test, expect, type Page } from '@playwright/test'

// Pin the auth/me endpoint to anonymous so the visitor-facing
// landing page mounts (otherwise an authed cookie would bounce to
// /dashboard/publish before the marketing page paints). Mirrors
// the same shape as `mockAnonymousVisit()` in
// marketing-routing-split.spec.ts but inlined here so this spec
// is self-contained.
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

test.describe('LandingPage motion layer visual regression', () => {
  // Mirror the global baseURL — `playwright.config.ts` already
  // points at :5180, but every spec in `tests/e2e/` re-declares
  // this inline so the target port is self-evident per file (no
  // chasing the global config to find out).
  test.use({ baseURL: 'http://localhost:5180' })

  test.beforeEach(async ({ page }) => {
    // Pin locale to zh-CN so headline copy is stable and matches
    // the `一条视频` fingerprint below. Theme is set per-test via
    // a second addInitScript so each visual test can swap light ↔
    // dark without resetting the page.
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
    // is at its natural rest state (or final-frame for the
    // scroll-triggered reveals that depend on the section being
    // in the viewport at start — fullPage:true captures the
    // entire layout regardless of scroll position).
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  // ─── STRUCTURAL — fast DOM-attribute checks ─────────────────────
  //
  // These run before the visual tests so a broken animation
  // grammar fails in ~1 s without paying the 10-30 s
  // screenshot cost. They're independent of theme + viewport
  // so a single test covers the whole grammar.
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
    await page.goto('/')

    // Wait for the page to commit. The H1 hero headline is the
    // canonical "page mounted" fingerprint (post-round-9 it
    // reads "一条视频 一键分发 到全网平台" via the 3
    // data-text-segment spans). A 600 ms wait past that gives
    // the lazy-loaded MarketingFooter + MarketingTopBar a chance
    // to paint before the structural counts.
    await expect(page.locator('h1', { hasText: '一条视频' })).toBeVisible()
    await page.waitForTimeout(600)

    // (1) Hero text-segment reveal — 3 spans in the H1
    await expect(
      page.locator('section[data-hero-section] h1 [data-text-segment]'),
    ).toHaveCount(3)

    // (1a) TOTAL [data-text-segment] across the page — the lock
    // that catches a silent regression where <SplitText> stops
    // splitting the Features h2 (e.g. a future refactor that
    // drops the `dataAttr` prop, or a SplitText internal bug
    // that breaks the regex split). The exact breakdown:
    //   - Hero h1: 3 spans (one per `t('...headline_N')` call)
    //   - CTA h2: 2 spans (one per `t('...cta.title_N')` call)
    //   - Features h2 via <SplitText mode="word">: 2 word spans
    //     (the fallback "4 件让人头疼的事" has 1 whitespace, so
    //     `children.split(/(\s+)/)` yields ["4", " ", "件让人
    //     头疼的事"] — 2 word tokens + 1 whitespace token; the
    //     whitespace token renders as a raw text node, NOT a
    //     data-text-segment span)
    // Total: 3 + 2 + 2 = 7. Pinned to zh-CN via the
    // beforeEach addInitScript; an en-US reword of the Features
    // h2 would change the count, but that's the right
    // regression to surface (the new wording would need an
    // updated baseline + a corresponding update to this count).
    await expect(page.locator('[data-text-segment]')).toHaveCount(7)

    // (1b) Step number counter targets — the JSX is
    //   <span data-step-number data-value={s.step}>00</span>
    // where `s.step` is the canonical "01" / "02" / "03"
    // string. The GSAP counter tween in use-landing-motion.ts
    // reads `el.dataset.value` and uses `padStart(2, '0')` on
    // the final value, so a hand-edit that changes `s.step`
    // from "01" to "1" would still produce a visible "01" at
    // rest, but the tween DURING the animation would briefly
    // flash to "00" before counting up — because the target
    // is now `1` (number) and the tween interpolates from 0.
    // This lock catches that class of regression at the
    // source (the data-value attribute) rather than at the
    // visible end state. Selectors use `data-value` (NOT
    // `data-step-number`) because `data-step-number` is set
    // as a boolean attribute (no value) — only `data-value`
    // carries the "01" / "02" / "03" string.
    await expect(page.locator('[data-value="01"]')).toHaveCount(1)
    await expect(page.locator('[data-value="02"]')).toHaveCount(1)
    await expect(page.locator('[data-value="03"]')).toHaveCount(1)

    // (2) Mockup 3-layer DOM — parallax (outer) + float (middle)
    // + entrance (inner, on the ProductMockup's own root). Each
    // layer writes to a different transform dimension; a
    // regression that collapses them would surface as count
    // mismatches here.
    await expect(page.locator('[data-mockup-parallax]')).toHaveCount(1)
    await expect(page.locator('[data-mockup-float]')).toHaveCount(1)
    await expect(page.locator('[data-hero-mockup]')).toHaveCount(1)

    // (3) Glow orb in hero section
    await expect(
      page.locator('section[data-hero-section] [data-glow-orb]'),
    ).toHaveCount(1)

    // (4) Mesh gradient in hero + CTA (2 total) + 3 blobs each
    // (2 × 3 = 6 mesh blobs). The CTA spotlight is a separate
    // element (data-cta-glow, asserted in (6) below), not a
    // mesh gradient, so the count stays at 2.
    await expect(page.locator('[data-mesh-gradient]')).toHaveCount(2)
    await expect(page.locator('[data-mesh-blob]')).toHaveCount(6)

    // (5) Step number counter — 3 in the How It Works section.
    // Each carries `data-value="01"|"02"|"03"` so the GSAP
    // counter tween knows the target.
    await expect(page.locator('[data-step-number]')).toHaveCount(3)

    // (6) CTA glow — primary CTA section has 1 CtaSpotlightGlow
    // (the 1100×1100 focused radial centered on the h2). It
    // carries `data-cta-glow` so the existing GSAP CTA pulse
    // animates it.
    await expect(
      page.locator('section[data-cta-section] [data-cta-glow]'),
    ).toHaveCount(1)

    // (7) Primary CTA has BOTH `.shimmer` (light sweep overlay)
    // and `.cta-ring` (animated box-shadow halo). The two
    // classes stack on the same rendered <Link> via className
    // concatenation; the shimmer is a `::before` overlay, the
    // cta-ring is `box-shadow` — they paint on different layers,
    // no z-index fight.
    const ctaPrimary = page
      .locator('section[data-cta-section]')
      .getByRole('link', { name: /立即开始使用/ })
    await expect(ctaPrimary).toHaveClass(/shimmer/)
    await expect(ctaPrimary).toHaveClass(/cta-ring/)

    // (8) Hero badge dot has the `.badge-dot-pulse` class. The
    // 1.6 s scale pulse is the deeper-scaled replacement for
    // Tailwind's `animate-pulse` (1 → 1.45 vs 1 → 1.05) so the
    // eyebrow badge reads as "alive" without competing with the
    // other ambient layers.
    await expect(
      page.locator('section[data-hero-section] .badge-dot-pulse'),
    ).toHaveCount(1)

    // (9) Hero primary CTA has `.shimmer` too (light sweep
    // overlay). The hero doesn't need a `.cta-ring` — the ring
    // is reserved for the bottom-of-page conversion affordance.
    const heroPrimaryCta = page
      .locator('section[data-hero-section]')
      .getByRole('link', { name: /立即开始/ })
    await expect(heroPrimaryCta).toHaveClass(/shimmer/)
  })

  // ─── VISUAL — full-page screenshots, light + dark ───────────────
  //
  // Two themes because the MeshGradient + CtaSpotlightGlow
  // layers tint via `oklch(--primary)` which differs per
  // theme — a dark-mode-only regression (e.g. primary-tint
  // bloom that's too bright in dark mode) wouldn't surface in
  // a light-only baseline.
  //
  // maxDiffPixels: 200 (vs. the pagewrapper spec's 100) is
  // intentional. The motion layer carries 6 mesh-blob radial
  // gradients (3 in hero, 3 in CTA) + 1 CtaSpotlightGlow (1100×
  // 1100 with `mix-blend-mode: screen`) — even when frozen via
  // `prefers-reduced-motion: reduce`, the radial-gradient edges
  // antialias differently between local Chromium builds (CI vs
  // dev machine) and between macOS / Linux renderers. 100 px
  // would routinely trip on this anti-aliasing variance; 200 px
  // is wide enough to absorb it without letting through
  // genuine layout shifts. Bump + regenerate baselines if a
  // future mesh-blob size change legitimately exceeds this
  // threshold.
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
      await page.goto('/')

      // Wait for the page to commit. The H1 hero headline is the
      // canonical "page mounted" fingerprint. The 800 ms
      // settle is wider than the structural test's 600 ms so
      // the dramatic-mesh variant (14s/18s/22s cadence blobs)
      // is past at least one tick of its initial keyframe
      // position before the screenshot — otherwise the diff
      // against the baseline could drift on the first frame
      // if Playwright races the CSS animation resolution.
      await expect(page.locator('h1', { hasText: '一条视频' })).toBeVisible()
      await page.waitForTimeout(800)

      await expect(page).toHaveScreenshot(`landing-motion-${name}-desktop.png`, {
        fullPage: true,
        maxDiffPixels: 200,
        // 30 s timeout — the full-page screenshot of a 5-section
        // landing page (hero + platforms + features + how-it-works
        // + CTA) with 6 mesh-blob radial gradients + 1
        // CtaSpotlightGlow at 1100×1100 takes ~10-15 s on cold
        // start. The default 5 s assertion timeout trips on CI
        // even when the test would otherwise pass. 30 s leaves
        // headroom for slow Chromium builds + CI runner
        // variance without making the test feel slow locally.
        timeout: 30_000,
      })
    })
  }
})
