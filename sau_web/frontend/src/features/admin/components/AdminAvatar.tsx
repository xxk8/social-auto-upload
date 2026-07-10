// ─────────────────────────────────────────────────────────────────────
// AdminAvatar — initials-based avatar circle with deterministic color.
//
// Replaces the bare email text cells in admin tables with a small
// visual identity anchor (Linear / Stripe / GitHub convention).
//
// Color picker: deterministic 8-band palette keyed off a hash of the
// input string, so the same email ALWAYS gets the same color across
// pages and renders. Bg = 18% tinted desaturated hue, fg = foreground
// at higher chroma for AA contrast.
//
// Stack discipline: each variant is a flat literal string (not a
// template literal over a runtime lookup) so Tailwind v4's JIT
// scanner picks up every bg/text class.
//
// Module exports ONLY the component + the type.
// ─────────────────────────────────────────────────────────────────────

import { cn } from '@/lib/utils'
import { stableStringHash } from '@/lib/hash'

type Size = 'sm' | 'md'

interface AdminAvatarProps {
  /** Identity string (email, name, ID). Falls back to '?' on empty. */
  identifier?: string | null
  size?: Size
  className?: string
  /** Optional tooltip override (default = identifier). */
  title?: string
}

// Flat literal palette — Tailwind v4's JIT scanner needs to see every
// classname as a static substring. Eight hue families × 3 tints each
// = 24 total combos; we keep the palette in this module-local const
// so the consumer-side class reference remains grep-able.
const PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: 'bg-[oklch(0.93_0.04_255)]', fg: 'text-[oklch(0.42_0.13_255)]' },  // sapphire
  { bg: 'bg-[oklch(0.93_0.05_330)]', fg: 'text-[oklch(0.42_0.16_330)]' },  // magenta
  { bg: 'bg-[oklch(0.93_0.05_15)]',  fg: 'text-[oklch(0.45_0.18_15)]'  },  // coral
  { bg: 'bg-[oklch(0.93_0.05_60)]',  fg: 'text-[oklch(0.45_0.15_60)]'  },  // amber
  { bg: 'bg-[oklch(0.93_0.05_115)]', fg: 'text-[oklch(0.45_0.14_115)]' },  // olive
  { bg: 'bg-[oklch(0.93_0.04_165)]', fg: 'text-[oklch(0.42_0.13_165)]' },  // teal
  { bg: 'bg-[oklch(0.93_0.05_265)]', fg: 'text-[oklch(0.42_0.16_265)]' },  // violet
  { bg: 'bg-[oklch(0.93_0.04_195)]', fg: 'text-[oklch(0.42_0.14_195)]' },  // cyan
]

const SIZE_CLASSES: Record<Size, { box: string; text: string }> = {
  sm: { box: 'h-6 w-6 text-[10px]', text: 'text-[10px]' },
  md: { box: 'h-7 w-7 text-[11px]', text: 'text-[11px]' },
}

function _initials(identifier: string | null | undefined): string {
  if (!identifier) return '?'
  const trimmed = identifier.trim()
  if (!trimmed) return '?'
  // For emails, take the local-part (before '@').
  const local = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed
  // Split on common separators to find the "first letter of each token".
  const tokens = local.split(/[._\-+ ]+/).filter(Boolean)
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[1][0]).toUpperCase()
  }
  if (tokens.length === 1) {
    const t = tokens[0]
    return (t.length >= 2 ? t[0] + t[1] : t[0]).toUpperCase()
  }
  return '?'
}

function AdminAvatar({ identifier, size = 'sm', className, title }: AdminAvatarProps) {
  const safe = identifier ?? '?'
  const idx = stableStringHash(safe) % PALETTE.length
  const palette = PALETTE[idx]
  const sizeCls = SIZE_CLASSES[size]
  const initials = _initials(safe)
  return (
    <span
      title={title ?? safe}
      aria-label={safe}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        'ring-1 ring-inset ring-black/[0.04]',
        palette.bg,
        palette.fg,
        sizeCls.box,
        className,
      )}
    >
      <span className={cn('tracking-tight', sizeCls.text)}>{initials}</span>
    </span>
  )
}

export { AdminAvatar }
