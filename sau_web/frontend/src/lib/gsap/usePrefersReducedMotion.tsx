import { useEffect, useState } from 'react'

/**
 * Reactive boolean — true when the user has `prefers-reduced-motion: reduce`
 * set at the OS level. Updates live if the user toggles their system
 * setting mid-session (rare on desktop, common during a screen recording).
 *
 * Usage: call at the top of a component and bail out of motion-heavy
 * GSAP setup with `if (reduced) return` inside `useGSAP`. Elements stay
 * at their natural CSS state (visible, fully positioned) when reduced
 * motion is preferred — no extra `gsap.set` jump needed because
 * `gsap.from(...)` only applies `autoAlpha: 0` IMMEDIATELY when the
 * tween is actually created.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return reduced
}
