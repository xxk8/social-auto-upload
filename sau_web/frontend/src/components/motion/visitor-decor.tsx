// ── Visitor decor — shared background components for visitor surfaces ─────
//
// Extracted from LandingPage so /pricing and /about can compose the
// same background stack (MeshGradient + GlowOrb + DotGridBg +
// CtaSpotlightGlow) without duplicating the JSX or losing the
// `data-*` attribute contract that `useVisitorMotion` targets.
//
// All three components are `aria-hidden` + `pointer-events: none` —
// they're decorative depth layers, not interactive content. Each
// carries the same `data-*` attribute the visitor motion hook
// targets (GlowOrb → `data-glow-orb`; CtaSpotlightGlow →
// `data-cta-glow`; DotGridBg has no data attribute because the
// hook doesn't animate it — it just renders static dots).
//
// Brand-aware: every primary-tinted gradient uses
// `color-mix(in oklab, var(--primary) N%, transparent)` so the
// decor auto-adapts to the current theme accent (the
// PreferencesDialog hue switcher). No hard-coded brand colors.

import { cn } from '@/lib/utils'

// ── DotGridBg — subtle dot pattern texture ────────────────────────────────
//
// 24px × 24px radial dot grid with a 60% ellipse mask fading from
// the top. Opacity 4% by default — reads as paper texture, not
// pattern. LandingPage passes `className="opacity-[0.03]"` on the
// CTA section to mute it further against the dramatic MeshGradient.

interface DotGridBgProps {
  className?: string
}

export function DotGridBg({ className = '' }: DotGridBgProps) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{
        backgroundImage:
          'radial-gradient(circle, var(--foreground) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.04,
        maskImage:
          'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        WebkitMaskImage:
          'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
      }}
    />
  )
}

// ── GlowOrb — soft top-canvas radial pulse ────────────────────────────────
//
// Soft glow via a large radial-gradient only (no `filter: blur`).
// Live blur forces large offscreen rasterization and is a major FPS
// source under GSAP scale/opacity pulses. Soft edges come from the
// gradient stop itself. `data-glow-orb` is the GSAP target —
// `useVisitorMotion` tweens scale 1.18 + opacity 0.65 on a 4.5s sine
// yoyo. Sits slightly above the section top edge.

export function GlowOrb() {
  return (
    <div
      data-glow-orb
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/3"
      style={{
        width: '720px',
        height: '720px',
        background:
          'radial-gradient(circle, color-mix(in oklab, var(--primary) 28%, transparent) 0%, color-mix(in oklab, var(--primary) 10%, transparent) 35%, transparent 68%)',
        opacity: 0.5,
        willChange: 'transform, opacity',
      }}
    />
  )
}

// ── CtaSpotlightGlow — focused radial centered on the CTA h2 ──────────────
//
// 1100×1100 radial gradient positioned at the section's vertical
// middle (NOT just the section's top — the section content is
// flex-centered). Carries `data-cta-glow` so the visitor motion
// hook pulses it (scale 1.08 + opacity 0.75, 2.8s sine yoyo) for
// layered depth.
//
// `mix-blend-mode: screen` lets the radial interact with the
// MeshGradient blobs behind it without producing a "double tint"
// compound where two primary-color layers stack. Screen mode is
// the photographic standard for additive light effects — reads as
// a natural spotlight, not a stacked gradient.

export function CtaSpotlightGlow() {
  return (
    <div
      data-cta-glow
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{
        width: '1200px',
        height: '1200px',
        // Soft edge via multi-stop radial — avoid filter:blur (FPS killer).
        background:
          'radial-gradient(circle, color-mix(in oklab, var(--primary) 26%, transparent) 0%, color-mix(in oklab, var(--primary) 12%, transparent) 32%, transparent 62%)',
        opacity: 0.6,
        mixBlendMode: 'screen',
        willChange: 'transform, opacity',
      }}
    />
  )
}
