import type { ReactNode } from 'react'

// ── SectionHeading ─────────────────────────────────────────────────────
//
// Shared primitive for visitor-facing (`variant="landing"`) and
// operator (`variant="dashboard"`) surfaces. Drives the eyebrow
// typography + title + description vertical rhythm across Hero,
// Platforms, Features, and CommonCapabilities sections in
// LandingPage and PricingPage.
//
// Per DESIGN.md round 4 — the visitor-facing surface bans mono
// eyebrow typography (which used to leak the engineering-tool meta
// cadence into paying-customer copy). The `variant` prop is REQUIRED
// (no `?`, no default), so a future marketing page cannot omit it
// and silently fall back to the pre-polish mono eyebrow style. TS
// will reject `<SectionHeading eyebrow=… />` at the call site. The
// `dashboard` variant preserves the legacy mono flavor for operator
// chrome.
//
// Convention from DESIGN.md `Adding a new component` (Iteration
// guide step 3): only React components are exported — no cva()
// recipe or helper const exported alongside, so Fast Refresh /
// `react-refresh/only-export-components` stays satisfied. The two
// visual states are class-string-mapped inline rather than via cva()
// because there are only two branches and the eyebrow class set is
// small.

export interface SectionHeadingProps {
  eyebrow: string
  title: ReactNode
  description: ReactNode
  /**
   * Visual variant. `'landing'` for visitor surfaces; `'dashboard'`
   * for operator chrome. REQUIRED — the round-4 ship-blocker is
   * locked in CODE (not just in DESIGN.md doc). A future marketing
   * page can't write `<SectionHeading eyebrow=… />` and silently pick
   * up the mono fallback; TS will reject it.
   */
  variant: 'landing' | 'dashboard'
}

function SectionHeading({
  eyebrow,
  title,
  description,
  variant, // 'landing' | 'dashboard' — required so the round-4 sans-eyebrow invariant is explicit at the type level (no silent default).
}: SectionHeadingProps) {
  // `landing` = sans eyebrow, open tracking, muted ink — paying-customer
  //   calibration. Locks the round-4 ship-blocker decision in CODE
  //   (not just in DESIGN.md doc) so a future contributor copy-pasting
  //   the old `font-mono` flavor will get a TS error or a no-candy
  //   default if they forget to specify `variant`.
  // `dashboard` = mono eyebrow, dense tracking, slightly stronger muted
  //   ink — engineering-tool calibration, matches the pre-polish meta
  //   cadence in AppShell breadcrumbs.
  const eyebrowClass =
    variant === 'landing'
      ? 'text-[11px] font-medium tracking-[0.18em] text-muted-foreground/70 uppercase'
      : 'text-[11px] font-mono tracking-widest text-muted-foreground/70 uppercase'
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className={eyebrowClass}>{eyebrow}</div>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
        {description}
      </p>
    </div>
  )
}

export { SectionHeading }
