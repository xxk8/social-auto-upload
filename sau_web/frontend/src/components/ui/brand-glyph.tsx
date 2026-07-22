import { cn } from '@/lib/utils'

// ── BrandMark — `>_` glyph in a fg-filled square ────────────────────────
//
// Canonical brand mark for the visitor-facing surfaces
// (LandingPage / PricingPage / AboutPage / LoginPage) and the
// `/login/auth` mark. Sized via the `size` prop with three presets
// matching the historical inlined `BrandMark` shape so every
// existing call site (TopBar / PageFooter / Hero) ports over
// without touching className plumbing. A `className` pass-through
// is provided so a one-off page can override the box geometry
// without rebuilding the component.
//
// The trailing `_` blinks via the `.brand-cursor` keyframe already
// defined in `src/index.css` (1.1s `steps(2, end)` cadence,
// reduced-motion respected). Don't duplicate the keyframe here —
// it stays as the single source of truth.
//
// Round-8 motion grammar source: `DESIGN.md` → `chrome-patterns` →
// `brand-cursor`. Reserved ONLY for the brand mark, never
// arbitrary text. Canonical terminal-prompt metadata, distinct
// from the deleted `.status-running::after halo`.
type BrandMarkSize = 'sm' | 'md' | 'lg'

const BRAND_MARK_DIM: Record<BrandMarkSize, string> = {
  sm: 'h-7 w-7 text-[13px]',
  md: 'h-9 w-9 text-[17px]',
  lg: 'h-12 w-12 text-[22px]',
}

export function BrandMark({
  size = 'md',
  className,
}: {
  size?: BrandMarkSize
  className?: string
}) {
  return (
    <div
      data-testid="marketing-brand-mark"
      className={cn(
        'flex items-center justify-center rounded-[4px] bg-foreground text-background font-mono font-medium leading-none tracking-tight',
        BRAND_MARK_DIM[size],
        className,
      )}
    >
      <span aria-hidden>
        {'>'}
        <span className="brand-cursor">_</span>
      </span>
    </div>
  )
}

// ── BrandGlyph — bare `>_` text ─────────────────────────────────────────
//
//  Variant for contexts where the brand mark sits INSIDE another
//  container that already provides the chrome (e.g. a PageHeader
//  info-bg chip). No own bg-foreground / text-background — uses
//  `text-foreground` so it inherits its parent's color and reads as
//  the canonical brand glyph without an extra box. Same `.brand-
//  cursor` blink cadence as BrandMark.
//
//  Used by `/dashboard/inbox`'s URL auto-detect strip (locked, NOT URL-
//  driven — pair of `<BrandGlyph>` + platform name + mono engine
//  label). See `Pages/InboxPage.tsx::BrandGlyph call site` for
//  the rationale comment.
//
//  `blink` (default `true`) controls whether the trailing `_` is
//  rendered with the `.brand-cursor` keyframe applied. When
//  `false`, only the static `>` prefix is emitted — no trailing
//  cursor span, no blink. Reserved for surfaces where N > 1
//  glyphs render in close proximity (e.g. the `/dashboard/inbox`
//  "支持下载" chip strip's 15 chips), where in-sync blinking reads
//  as visual repetition noise rather than brand identity. Count==1
//  surfaces (PageHeader title slug / per-row leading slot / URL
//  auto-detect strip) keep `blink` / default `true` implicit so the
//  brand mark still carries its terminal-prompt rhythm. Per
//  `DESIGN.md` → `chrome-patterns` → `brand-cursor`, the blink
//  cadence is "Reserved ONLY for the brand mark, never arbitrary
//  text" — and on a count==15 strip the visual reads as the
//  latter. The polarity is direct (the *default* is to blink);
//  passing `blink={false}` at a callsite is an explicit opt-out
//  rather than an opt-in — makes the off-switch grep-able.
export function BrandGlyph({
  className,
  blink = true,
}: {
  className?: string
  blink?: boolean
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex items-center justify-center font-mono font-semibold leading-none tracking-tight text-foreground',
        className,
      )}
    >
      {'>'}
      {blink ? <span className="brand-cursor">_</span> : null}
    </span>
  )
}
