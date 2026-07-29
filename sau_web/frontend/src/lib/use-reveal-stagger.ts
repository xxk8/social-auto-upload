/* ──────────────────────────────────────────────────────────────────────
 * useRevealStagger — round-8 motion grammar for visitor surfaces.
 *
 * Two-phase entrance choreography:
 *   1. `[data-hero-cell]` elements fade-in immediately on mount
 *      (the Hero stat row uses these — the user is already looking).
 *   2. Cells inside `[data-reveal-group]` containers fade-in on first
 *      viewport entry (Platform/Feature/Tier grids use these).
 *
 * Token contract (see `index.css` `--motion-*` block):
 *   duration : 550ms per cell   (matches CSS hover-transition baseline)
 *   ease     : power2.out       (engineering-tool precision; no spring)
 *   stagger  : 70ms between     (within group, top→down, left→right)
 *   offset   : translateY 14px  (small lift, no flying-distance)
 *
 * Reduced-motion respected via gsap.matchMedia: the entire setup is
 * skipped when `(prefers-reduced-motion: reduce)` matches, and cells
 * render in their natural state without any GSAP transform.
 *
 * Module is a React hook (no runtime exports), so it satisfies
 * `react-refresh/only-export-components` automatically.
 * ────────────────────────────────────────────────────────────────────── */

import { useRef } from 'react'
// Always go through the shared setup so ScrollTrigger is registered once.
import { gsap, useGSAP } from '@/lib/gsap/setup'

export function useRevealStagger() {
  const rootRef = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add(
      { reduceMotion: '(prefers-reduced-motion: reduce)' },
      (context) => {
        const { reduceMotion } = context.conditions as { reduceMotion: boolean }
        if (reduceMotion) return

        // (1) Hero entrance — fires once per page load, no scroll trigger.
        // `[data-hero-cell]` matches anywhere within scope regardless of
        // whether it sits inside a `[data-reveal-group]` ancestor.
        gsap.fromTo(
          '[data-hero-cell]',
          { y: 12, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.5,
            stagger: 0.08,
            ease: 'power2.out',
            delay: 0.15,
          }
        )

        // (1b) Hero product mockup entrance — Raycast-style "the product IS
        // the hero visual" reveal. Slightly longer delay so the stat row
        // lands first, then the mockup slides up with a gentler ease.
        // Only fires if a `[data-hero-mockup]` element exists in scope.
        gsap.fromTo(
          '[data-hero-mockup]',
          { y: 24, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.6,
            ease: 'power2.out',
            delay: 0.35,
          }
        )

        // (2) Scroll-revealed groups — each `[data-reveal-group]` is one
        // trigger boundary; its `[data-reveal-cell]` children share a
        // staggered fade-in.
        const groups = gsap.utils.toArray<HTMLElement>('[data-reveal-group]')
        groups.forEach((group) => {
          const cells = group.querySelectorAll<HTMLElement>('[data-reveal-cell]')
          if (!cells.length) return
          gsap.fromTo(
            cells,
            { y: 14, autoAlpha: 0 },
            {
              y: 0,
              autoAlpha: 1,
              duration: 0.55,
              stagger: 0.07,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: group,
                start: 'top 88%',
                once: true,
              },
            }
          )
        })

        // (3) Standalone cells — `[data-reveal-cell]` NOT nested inside a
        // group. Each is its own scroll-triggered tween. Useful for
        // section-level single fade-in (the LandingPage / PricingPage
        // CTA sections, for example).
        const standalone = gsap.utils
          .toArray<HTMLElement>('[data-reveal-cell]')
          .filter((el) => !el.closest('[data-reveal-group]'))
        standalone.forEach((cell) => {
          gsap.fromTo(
            cell,
            { y: 14, autoAlpha: 0 },
            {
              y: 0,
              autoAlpha: 1,
              duration: 0.6,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: cell,
                start: 'top 92%',
                once: true,
              },
            }
          )
        })
      }
    )
  }, { scope: rootRef })

  return rootRef
}
