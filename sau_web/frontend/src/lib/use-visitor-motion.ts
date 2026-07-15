/* ──────────────────────────────────────────────────────────────────────
 * useVisitorMotion — unified ambient + interactive motion layer for
 * `/`, `/pricing`, `/about` (all 3 visitor surfaces share the same
 * design system grammar).
 *
 * Round-beautify origin: this hook started life as
 * `useLandingMotion` and lived on the `/` page only. The
 * round-unify-grammar pass extracted the LandingPage-specific bits
 * (mockup float + hero mouse parallax) into the same hook via
 * data-attribute opt-in, so /pricing and /about can call the same
 * hook and get the same ambient layer without writing any extra
 * GSAP code.
 *
 * Sister hook to `useRevealStagger`. That hook owns the *entrance*
 * grammar (data-hero-cell / data-reveal-cell / data-hero-mockup
 * fade-up choreography); this hook owns the *ambient + interactive*
 * layer that lives on top of it — continuous floats, mouse
 * parallax, scroll-linked counters, pulsing CTAs.
 *
 * Two hooks share the same root ref via `useGSAP({ scope: rootRef
 * })` — useGSAP's scope is order-independent, so the two setups
 * compose without stomping each other's tweens (the entrance from
 * useRevealStagger fires first; the ambient tweens below start at
 * `delay: 0.8` so the entrance lands before the float takes over).
 *
 * CALL ORDER CONTRACT: useRevealStagger must be called FIRST so
 * the entrance fade-up completes before useVisitorMotion's ambient
 * tweens start. The 0.8s delay on the mockup float papers over the
 * inverse order, but the contract is explicit to keep future
 * refactors honest — if a future caller swaps the order, the float
 * would briefly fight the entrance y-translate on
 * [data-hero-mockup].
 *
 * Opt-in grammar (every tween is a no-op if the data attribute is
 * missing — the hook is safe to call on any page):
 *
 *   data-text-segment     → per-section stagger reveal (h1 / h2)
 *   data-glow-orb         → breathing scale + opacity pulse
 *   data-mockup-float     → continuous yoyo y oscillation
 *   data-mockup-parallax  → mouse-driven x,y offset (with
 *                           data-hero-section as the event zone)
 *   data-step-number      → scroll-triggered 00 → N counter
 *   data-cta-glow         → spotlight scale + opacity pulse
 *   data-no-parallax      → section opt-out from the section-level
 *                           ambient parallax (data-dense sections
 *                           like pricing tables opt out so a
 *                           continuously scrubbing -24px doesn't
 *                           shift the numbers as the user reads)
 *
 * Three-layer DOM pattern on the Hero mockup (LandingPage only —
 * the mockup data attributes don't exist on /pricing or /about so
 * this branch is a no-op on those pages):
 *
 *   <div data-mockup-parallax>  ← mouse-driven x,y (event-driven)
 *     <div data-mockup-float>   ← continuous yoyo y oscillation
 *       <div data-hero-mockup>  ← entrance fade-up (useRevealStagger)
 *         <ProductMockup />
 *       </div>
 *     </div>
 *   </div>
 *
 * Each layer writes to a *different* transform dimension, so GSAP
 * never has to merge two live tweens on the same node (which would
 * trigger the well-known `overwrite: 'auto'` flicker).
 *
 * Reduced-motion respected via `gsap.matchMedia`: every animation
 * is gated on `(prefers-reduced-motion: no-preference)`. The
 * `useRevealStagger` mirror uses `reduce`; the mirror-image here
 * uses the negation so the test contract stays the same — a user
 * with `prefers-reduced-motion: reduce` sees NO ambient layer at
 * all, just the entrance reveal from useRevealStagger.
 *
 * Module exports only the hook (no runtime values), so it
 * satisfies `react-refresh/only-export-components`.
 * ────────────────────────────────────────────────────────────────────── */

import { type RefObject } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap/setup'

export function useVisitorMotion(rootRef: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      // Local registry of every ScrollTrigger this hook creates —
      // cleanup walks this list instead of using
      // `ScrollTrigger.getAll().filter(...)`, which would
      // accidentally kill triggers from other hooks (e.g. the
      // data-reveal-cell ScrollTriggers created by
      // useRevealStagger, which share the same scope).
      const createdTriggers: ScrollTrigger[] = []

      const mm = gsap.matchMedia()

      mm.add(
        { motion: '(prefers-reduced-motion: no-preference)' },
        (_context) => {
          // (1) Headline text segment reveal — `data-text-segment`
          // is the contract. ONE ScrollTrigger per section (NOT
          // per element) so the per-section stagger between
          // sibling segments is preserved — e.g. the Hero h1's
          // 3 pieces reveal 0.12s apart. ScrollTrigger fires
          // once, start: 'top 92%' — 8% into the viewport
          // feels instant for the Hero h1 (which is already in
          // view on page load) and reveals the CTA h2 + Features
          // h2 only when the user actually scrolls to them.
          // Without ScrollTrigger the CTA h2 would animate on
          // mount and the user would never see it (wasted
          // motion).
          gsap.utils.toArray<HTMLElement>('section').forEach((section) => {
            const segments = section.querySelectorAll<HTMLElement>('[data-text-segment]')
            if (segments.length === 0) return
            const trigger = ScrollTrigger.create({
              trigger: section,
              start: 'top 92%',
              once: true,
              onEnter: () => {
                gsap.from(segments, {
                  y: 28,
                  autoAlpha: 0,
                  duration: 0.9,
                // Stagger tuned for the longest text-segment
                // chain (12 chars on PricingPage's char-mode
                // CommonFeatures h2); global across all 3
                // visitor pages. Was 0.12 s (LandingPage
                // baseline) — halved after char-mode made
                // 0.12 × 12 feel mechanical. For 15+ char
                // h2s, prefer mode="word" over further tuning.
                stagger: 0.06,
                  ease: 'power3.out',
                })
              },
            })
            createdTriggers.push(trigger)
          })

          // (2) Glow orb breathe — the `<GlowOrb />` element from
          // `Components/motion/visitor-decor` renders a 600×600
          // radial gradient with `filter: blur(80px) + opacity:
          // 0.5`. Animating scale + opacity from this baseline
          // gives a subtle "the section is alive" rhythm. The
          // gradient container is `position: absolute` and
          // centered with `top: 0; translate(-50%, -50%)` —
          // scaling from transformOrigin: 'center center' so
          // the orb expands symmetrically rather than drifting
          // off-axis. No-op on pages without `<GlowOrb />`.
          gsap.utils.toArray<HTMLElement>('[data-glow-orb]').forEach((orb) => {
            gsap.to(orb, {
              scale: 1.18,
              opacity: 0.65,
              duration: 4.5,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
            })
          })

          // (3) Mockup float — continuous yoyo Y oscillation on
          // `[data-mockup-float]`. The `+=12` relative-to-current
          // pattern reads whatever y the parallax layer has
          // parked the node at and oscillates ±6px around it.
          // delay 0.8s so the entrance fade-up from
          // useRevealStagger (which targets [data-hero-mockup]
          // with duration ~0.6s + delay 0.35s) lands before the
          // float kicks in. No-op on pages without a mockup
          // (PricingPage and AboutPage's ProjectScopeMockup both
          // opt in via `data-mockup-float` on the wrapper).
          gsap.utils.toArray<HTMLElement>('[data-mockup-float]').forEach((node) => {
            gsap.to(node, {
              y: '+=12',
              duration: 4.5,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
              delay: 0.8,
            })
          })

          // (4) Mouse parallax on the Hero mockup — only fires
          // when the cursor is over the hero section (event-
          // driven, not per-frame). rAF-throttled via GSAP's
          // `overwrite: 'auto'` so each new mousemove cancels
          // the in-flight parallax tween (the float below is
          // on a different node so it doesn't get cancelled).
          // No-op on pages without `data-mockup-parallax` +
          // `data-hero-section` (PricingPage + AboutPage).
          const parallaxEl = document.querySelector<HTMLElement>('[data-mockup-parallax]')
          const heroEl = document.querySelector<HTMLElement>('[data-hero-section]')
          if (parallaxEl && heroEl) {
            const onMove = (e: MouseEvent) => {
              const rect = heroEl.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width - 0.5
              const y = (e.clientY - rect.top) / rect.height - 0.5
              gsap.to(parallaxEl, {
                x: x * 28,
                y: y * 16,
                duration: 1.2,
                ease: 'power2.out',
                overwrite: 'auto',
              })
            }
            const onLeave = () => {
              gsap.to(parallaxEl, {
                x: 0,
                y: 0,
                duration: 1.4,
                ease: 'power3.out',
              })
            }
            heroEl.addEventListener('mousemove', onMove)
            heroEl.addEventListener('mouseleave', onLeave)
            return () => {
              heroEl.removeEventListener('mousemove', onMove)
              heroEl.removeEventListener('mouseleave', onLeave)
            }
          }
          return undefined
        }
      )

      // (5) Step number counter — `[data-step-number]` carries
      // the target value as a `data-value` attribute so the
      // hook doesn't have to know about the i18n label set.
      // The text inside the span is a fallback that the tween
      // overwrites on each frame. ScrollTrigger fires once,
      // start: 'top 82%' — 18% into the viewport feels more
      // "noticed" than the entrance-choreography 88% used by
      // useRevealStagger. No-op on pages without
      // [data-step-number]. Currently only LandingPage's
      // "How It Works" section has them.
      gsap.utils.toArray<HTMLElement>('[data-step-number]').forEach((el) => {
        const target = parseInt(el.dataset.value ?? '0', 10)
        if (Number.isNaN(target)) return
        const counter = { val: 0 }
        const trigger = ScrollTrigger.create({
          trigger: el,
          start: 'top 82%',
          once: true,
          onEnter: () => {
            gsap.to(counter, {
              val: target,
              duration: 1.6,
              ease: 'power2.out',
              onUpdate: () => {
                el.textContent = String(Math.round(counter.val)).padStart(2, '0')
              },
            })
          },
        })
        createdTriggers.push(trigger)
      })

      // (6) CTA glow pulse — a small [data-cta-glow] element
      // (rendered by `<CtaSpotlightGlow />` from
      // `Components/motion/visitor-decor`) pulses at a 2.8s
      // cadence for layered depth. The 1.08× scale + 0.75
      // opacity flip reads as the page "breathing around the
      // conversion affordance" — subtle, but it lifts the
      // bottom-of-page CTA above the static marketing-pattern
      // default. No-op on pages without `<CtaSpotlightGlow />`.
      gsap.utils.toArray<HTMLElement>('[data-cta-glow]').forEach((glow) => {
        gsap.to(glow, {
          scale: 1.08,
          opacity: 0.75,
          duration: 2.8,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        })
      })

      // (7) Section ambient parallax — the section-level
      // translate is keyed to scroll progress. Each section's
      // content shifts up by 24px as the user scrolls past, so
      // deep sections feel like they're being lifted into the
      // viewport rather than scrolling flat. `scrub: 0.6` ties
      // the tween to the scrollbar (not just on/off), so it
      // always tracks the user's scroll position smoothly.
      //
      // Opt-out: a section with `data-no-parallax` is excluded
      // (data-dense sections like PricingComparison or the
      // tier-card grids opt out so a continuously scrubbing
      // -24px doesn't shift the numbers / prices as the user
      // reads). The hero section is also excluded (it has its
      // own entrance + mouse parallax via the data-hero-section
      // selector).
      const mmParallax = gsap.matchMedia()
      mmParallax.add({ motion: '(prefers-reduced-motion: no-preference)' }, () => {
        gsap.utils.toArray<HTMLElement>('section').forEach((section) => {
          if (section.dataset.heroSection !== undefined) return
          if (section.dataset.noParallax !== undefined) return
          const trigger = ScrollTrigger.create({
            trigger: section,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.6,
            animation: gsap.fromTo(section, { y: 24 }, { y: -24, ease: 'none' }),
          })
          createdTriggers.push(trigger)
        })
      })

      // Cleanup — kill ONLY the ScrollTriggers we created
      // (preserved by `createdTriggers`), then revert the two
      // matchMedia contexts so their inner cleanups fire. This
      // is the fix for the bug where the previous version
      // called `ScrollTrigger.getAll().filter(... matches
      // 'section')` and accidentally killed triggers from
      // useRevealStagger that share the same scope.
      return () => {
        createdTriggers.forEach((t) => t.kill())
        mmParallax.revert()
        mm.revert()
      }
    },
    { scope: rootRef }
  )
}
