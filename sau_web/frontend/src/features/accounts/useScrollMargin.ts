import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Distance from the scroll parent's content top to `targetRef`.
 * Required by @tanstack/react-virtual when the virtual list is nested
 * under padding / sticky chrome inside the scroll element.
 *
 * Re-measured on resize only — not on scroll (offset is layout-stable).
 */
export function useScrollMargin(
  scrollParent: HTMLElement | null,
  targetRef: RefObject<HTMLElement | null>,
): number {
  const [margin, setMargin] = useState(0)

  useLayoutEffect(() => {
    const target = targetRef.current
    if (!scrollParent || !target) {
      setMargin(0)
      return
    }

    const measure = () => {
      const spRect = scrollParent.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      const next = tRect.top - spRect.top + scrollParent.scrollTop
      setMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scrollParent)
    ro.observe(target)
    return () => ro.disconnect()
  }, [scrollParent, targetRef])

  return margin
}
