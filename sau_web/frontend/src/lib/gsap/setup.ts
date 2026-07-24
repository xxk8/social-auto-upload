/**
 * One-time GSAP setup.
 *
 * Module-load side-effects register ScrollTrigger so every component that
 * imports `gsap` (or `ScrollTrigger`) from this module gets scroll-linked
 * animations for free. `gsap.defaults` mirrors the legacy motion/react
 * cadence `[0.16, 1, 0.3, 1]` (≈ `power3.out`) so the merge from
 * `@sau/web-site` is roughly drop-in compatible in feel.
 *
 * Components MUST NOT import `gsap` or `gsap/ScrollTrigger` directly from
 * node_modules — go through `@/lib/gsap/setup` so registration happens
 * exactly once per app load, never on the SSR path.
 */
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
  // Cascade: `gsap.defaults({ ease, duration })` is read by every tween
  // created after this line. Matches the motion variants' timing.
  gsap.defaults({ ease: 'power3.out', duration: 0.8 })
}

export { gsap, ScrollTrigger }
export { useGSAP } from '@gsap/react'
export { usePrefersReducedMotion } from './usePrefersReducedMotion'
