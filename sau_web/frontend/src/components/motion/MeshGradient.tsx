// ── MeshGradient — animated background of 3 blurred color blobs ────────
//
// Drives the "depth" layer behind the hero / CTA sections. Each blob
// is a radial gradient tinted with `var(--primary)` so the mesh
// auto-adapts to the current theme accent (green default, amber/blue/
// purple/red/teal on the 5 preset hues the Preferences dialog
// exposes). The 3 blobs drift in 3 different directions with
// different durations (18s / 24s / 28s) so the visual never settles
// into a repeating loop — prime-number-ish ratios make the perceived
// cycle ~3 minutes.
//
// CSS-only animation (NOT GSAP-driven) for two reasons:
//   1. The mesh runs CONTINUOUSLY across the whole session — putting
//      it on a GSAP tween would create a permanent tween ticking in
//      the background that useGSAP would have to clean up on every
//      route change. A `@keyframes` cycle handles cleanup for free
//      (the browser drops it on element unmount).
//   2. CSS transforms run on the compositor thread; GSAP `x`/`y` on
//      a position:absolute element also runs on the compositor
//      thread, but the GSAP path still ticks once per frame in JS.
//      A pure-CSS `transform: translate(...)` keyframe paints zero
//      JS frames per second.
//
// `aria-hidden` because the blobs are decorative — screen readers
// don't need to enumerate them. `pointer-events: none` so a blob
// sitting over a CTA button doesn't intercept the click.
//
// Reduced-motion respected: the `index.css` rule at
// `@media (prefers-reduced-motion: reduce)` overrides the animation
// to `none`, freezing the blobs in their initial position. The
// brand-aware radial gradient still tints the section, just static.

import { cn } from '@/lib/utils'

type MeshIntensity = 'subtle' | 'normal' | 'bold' | 'dramatic'

interface MeshGradientProps {
  className?: string
  intensity?: MeshIntensity
}

const INTENSITY_OPACITY: Record<MeshIntensity, string> = {
  // subtle: trust-mark / footer contexts — mesh is a hint, not a focus
  subtle: 'opacity-25',
  // normal: hero / CTA — the default marketing-landing density
  normal: 'opacity-50',
  // bold: reserved for the very-bottom CTA section where the mesh
  // does most of the "pull" work
  bold: 'opacity-70',
  // dramatic: maximum-emphasis CTA section where the mesh is
  // the primary depth source — pulls the eye to the conversion
  // copy. Paired with the .cta-ring button effect in
  // LandingPage. The 100% wrapper opacity means the blob
  // centers render at their native 30% primary tint (vs
  // 21% at bold-70%) — a 43% perceived brightness jump that
  // crosses the "premium" threshold the reviewer flagged.
  dramatic: 'opacity-100',
}

export function MeshGradient({ className, intensity = 'normal' }: MeshGradientProps) {
  // The `dramatic` variant uses a SECOND set of larger, more
  // saturated blob classes (`mesh-blob--dramatic-N`) so the
  // CTA section's mesh doesn't share identical 18s/24s/28s
  // drift cadence with the hero. Same 3-blob structure, but
  // ~1.4× the area, +6% primary tint, and a 14s/18s/22s cadence
  // — shorter cycles read as "more active" without the mesh
  // becoming visually noisy (the cycles stay prime-number-ish
  // to avoid a noticeable loop).
  const variantClass =
    intensity === 'dramatic' ? 'mesh-blob--variant-dramatic' : ''
  return (
    <div
      aria-hidden
      data-mesh-gradient
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        INTENSITY_OPACITY[intensity],
        variantClass,
        className
      )}
    >
      <div data-mesh-blob className={cn('mesh-blob', 'mesh-blob--1')} />
      <div data-mesh-blob className={cn('mesh-blob', 'mesh-blob--2')} />
      <div data-mesh-blob className={cn('mesh-blob', 'mesh-blob--3')} />
    </div>
  )
}
