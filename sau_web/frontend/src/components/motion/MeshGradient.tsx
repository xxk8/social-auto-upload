// ── MeshGradient — animated background of 3 soft color blobs ────────
//
// Drives the "depth" layer behind the hero / CTA sections. Each blob
// is a radial gradient tinted with `var(--primary)` so the mesh
// auto-adapts to the current theme accent. Soft edges come from the
// gradient stops themselves — NO `filter: blur` (that forces large
// offscreen rasterization and is a primary FPS killer under continuous
// transform animation).
//
// CSS-only animation (NOT GSAP-driven) so continuous drift costs zero
// JS frames. Compositor-friendly: only `transform` is animated.
//
// Off-screen pause: an IntersectionObserver sets `data-in-view` on the
// root; CSS only runs keyframes when that attribute is present. Tabs
// that scroll mesh out of view stop painting the animation.
//
// Reduced-motion: `@media (prefers-reduced-motion: reduce)` freezes
// the blobs; the brand-aware gradient still tints the section.

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

type MeshIntensity = 'subtle' | 'normal' | 'bold' | 'dramatic'

interface MeshGradientProps {
  className?: string
  intensity?: MeshIntensity
}

const INTENSITY_OPACITY: Record<MeshIntensity, string> = {
  subtle: 'opacity-25',
  normal: 'opacity-50',
  bold: 'opacity-70',
  dramatic: 'opacity-100',
}

export function MeshGradient({ className, intensity = 'normal' }: MeshGradientProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      el?.setAttribute('data-in-view', '')
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.setAttribute('data-in-view', '')
        } else {
          el.removeAttribute('data-in-view')
        }
      },
      // Start a little before fully visible so the mesh is already
      // animating when the section enters the viewport.
      { root: null, rootMargin: '80px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const variantClass =
    intensity === 'dramatic' ? 'mesh-blob--variant-dramatic' : ''

  return (
    <div
      ref={rootRef}
      aria-hidden
      data-mesh-gradient
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        INTENSITY_OPACITY[intensity],
        variantClass,
        className,
      )}
    >
      <div data-mesh-blob className={cn('mesh-blob', 'mesh-blob--1')} />
      <div data-mesh-blob className={cn('mesh-blob', 'mesh-blob--2')} />
      <div data-mesh-blob className={cn('mesh-blob', 'mesh-blob--3')} />
    </div>
  )
}
