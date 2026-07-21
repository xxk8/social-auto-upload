/* ──────────────────────────────────────────────────────────────────────
 * useScrollPast — boolean gate once window.scrollY crosses a threshold.
 *
 * Round 8 small helper. Used by visitor-surface TopBars to lift the
 * bottom hairline from neutral border-b → a single 1px amber accent
 * (subtle engineering-tool "you've crossed the Hero" signal). rAF-
 * throttled so scroll listeners don't re-render 60 times a second.
 *
 * Reduced-motion is irrelevant here — only a CSS class flips on/off,
 * no transform / opacity animation runs on the header itself.
 * ────────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react'

export function useScrollPast(thresholdPx = 80): boolean {
  const [past, setPast] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPast(window.scrollY > thresholdPx)
    let rafHandle: number | null = null
    const onScroll = () => {
      if (rafHandle !== null) return
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null
        const next = window.scrollY > thresholdPx
        setPast((prev) => (prev === next ? prev : next))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafHandle !== null) cancelAnimationFrame(rafHandle)
    }
  }, [thresholdPx])

  return past
}
