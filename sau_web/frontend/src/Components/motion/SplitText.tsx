// ── SplitText — wrap text units in animatable spans ────────────────────
//
// The LandingPage headline is a 3-piece composite in the JSX
// (headline_1 / headline_2 / headline_3, with the middle piece
// carrying the gradient class). `useLandingMotion` targets the
// existing pieces via `data-hero-title-segment` directly — no
// SplitText wrapping needed there.
//
// This component is the generic primitive for OTHER places where
// animated-text entrance reveals are wanted (future PricingPage
// headline, future AboutPage hero). Splits the children string
// into per-word (default) or per-character spans, each tagged
// with `data-split-word` / `data-split-char` for GSAP targeting.
//
// Accessibility:
//   • Outer span has no `aria-hidden` — screen readers read the
//     children textContent verbatim (the inner spans have NO
//     `aria-hidden` either, but their textContent concatenates
//     to the full string because there's no separating
//     whitespace markup between the inner spans).
//   • Whitespace is preserved via `\u00A0` (nbsp) inside the
//     split units + literal space text between the unit spans.
//     A naive `children.split(' ').map(...)` would collapse
//     double-spaces and lose the original word gap.
//
// Token contract with `useLandingMotion`:
//   duration: 0.8s  ·  stagger: 0.06–0.10s  ·  ease: 'power3.out'
//   Mirror the values in `use-landing-motion.ts` step (1) so
//   the two paths animate identically.

import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

type SplitMode = 'word' | 'char'

interface SplitTextProps {
  children: string
  className?: string
  /** Class applied to each split unit (word / char). */
  unitClassName?: string
  /** "word" splits on whitespace; "char" splits on codepoints. */
  mode?: SplitMode
  /** data-* attribute name on each unit span — defaults to
   *  `data-split-word` / `data-split-char` based on `mode`. */
  dataAttr?: string
}

export function SplitText({
  children,
  className,
  unitClassName,
  mode = 'word',
  dataAttr,
}: SplitTextProps) {
  const attrName = dataAttr ?? (mode === 'word' ? 'data-split-word' : 'data-split-char')

  if (mode === 'char') {
    // Array.from splits on codepoints, not UTF-16 code units —
    // emoji / surrogate-pair characters stay as a single unit.
    const chars = Array.from(children)
    return (
      <span className={cn('inline-block', className)}>
        {chars.map((char, i) => (
          <span
            key={i}
            {...{ [attrName]: '' }}
            className={cn('inline-block', unitClassName)}
            style={
              char === ' '
                ? ({ whiteSpace: 'pre' } as CSSProperties)
                : undefined
            }
          >
            {char}
          </span>
        ))}
      </span>
    )
  }

  // word mode — keep the whitespace tokens so the rendered output
  // matches `children` exactly. The regex split captures
  // whitespace runs as separate tokens.
  const tokens = children.split(/(\s+)/)
  return (
    <span className={cn('inline-block', className)}>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token)) {
          // Whitespace token — render as a raw text node so it
          // contributes the same gap the original string had.
          return <span key={i}>{token}</span>
        }
        return (
          <span
            key={i}
            {...{ [attrName]: '' }}
            className={cn('inline-block', unitClassName)}
          >
            {token}
          </span>
        )
      })}
    </span>
  )
}
