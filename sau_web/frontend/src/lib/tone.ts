import type { CSSProperties } from 'react'

/**
 * Status / semantic tone helpers for chips, dots, and page-header accents.
 * Tailwind v4 scans this file for class strings used via these helpers.
 *
 * Note: `error` is an alias of `danger` for historical call-sites (task status,
 * syslog levels). Prefer `danger` in new code.
 */

export type Tone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'error'
  | 'primary'

type ToneStyle = {
  bg: string
  fg: string
  border: string
  fill: string
  chip: string
  ring: string
  text: string
  dot: string
}

const dangerStyle: ToneStyle = {
  bg: 'bg-[var(--status-danger-bg)]',
  fg: 'text-[var(--status-danger-fg)]',
  border: 'border-[var(--status-danger-fg)]/20',
  fill: 'bg-[var(--status-danger-fg)]',
  chip: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
  ring: 'ring-[var(--status-danger-fg)]/30',
  text: 'text-[var(--status-danger-fg)]',
  dot: 'bg-[var(--status-danger-fg)]',
}

export const toneStyleClasses: Record<Tone, ToneStyle> = {
  neutral: {
    bg: 'bg-[var(--status-neutral-bg)]',
    fg: 'text-[var(--status-neutral-fg)]',
    border: 'border-[var(--status-neutral-fg)]/20',
    fill: 'bg-[var(--status-neutral-fg)]',
    chip: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
    ring: 'ring-[var(--status-neutral-fg)]/30',
    text: 'text-[var(--status-neutral-fg)]',
    dot: 'bg-[var(--status-neutral-fg)]',
  },
  info: {
    bg: 'bg-[var(--status-info-bg)]',
    fg: 'text-[var(--status-info-fg)]',
    border: 'border-[var(--status-info-fg)]/20',
    fill: 'bg-[var(--status-info-fg)]',
    chip: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
    ring: 'ring-[var(--status-info-fg)]/30',
    text: 'text-[var(--status-info-fg)]',
    dot: 'bg-[var(--status-info-fg)]',
  },
  success: {
    bg: 'bg-[var(--status-success-bg)]',
    fg: 'text-[var(--status-success-fg)]',
    border: 'border-[var(--status-success-fg)]/20',
    fill: 'bg-[var(--status-success-fg)]',
    chip: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
    ring: 'ring-[var(--status-success-fg)]/30',
    text: 'text-[var(--status-success-fg)]',
    dot: 'bg-[var(--status-success-fg)]',
  },
  warning: {
    bg: 'bg-[var(--status-warning-bg)]',
    fg: 'text-[var(--status-warning-fg)]',
    border: 'border-[var(--status-warning-fg)]/20',
    fill: 'bg-[var(--status-warning-fg)]',
    chip: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
    ring: 'ring-[var(--status-warning-fg)]/30',
    text: 'text-[var(--status-warning-fg)]',
    dot: 'bg-[var(--status-warning-fg)]',
  },
  danger: dangerStyle,
  error: dangerStyle,
  primary: {
    bg: 'bg-primary/10',
    fg: 'text-primary',
    border: 'border-primary/20',
    fill: 'bg-primary',
    chip: 'bg-primary/10 text-primary',
    ring: 'ring-primary/30',
    text: 'text-primary',
    dot: 'bg-primary',
  },
}

function resolve(tone: Tone | string | null | undefined): Tone {
  if (!tone) return 'neutral'
  return (tone in toneStyleClasses ? tone : 'neutral') as Tone
}

type ToneArg = Tone | string | null | undefined

export const toneTextClass = (t: ToneArg): string => toneStyleClasses[resolve(t)].text
export const toneFgVar = (t: ToneArg): string => toneStyleClasses[resolve(t)].fg
export const toneChipClasses = (t: ToneArg): string => toneStyleClasses[resolve(t)].chip
export const toneFillBgClass = (t: ToneArg): string => toneStyleClasses[resolve(t)].fill
export const toneBorderClass = (t: ToneArg): string => toneStyleClasses[resolve(t)].border
export const toneBgClass = (t: ToneArg): string => toneStyleClasses[resolve(t)].bg
export const toneRingClass = (t: ToneArg): string => toneStyleClasses[resolve(t)].ring
export const toneDotClasses = (t: ToneArg): string => toneStyleClasses[resolve(t)].dot

/** Inline style for lucide icons / small dots (status-fg + soft halo). */
export const toneDotStyle = (t: ToneArg): CSSProperties => {
  // Use CSS variables when available; fall back to currentColor.
  const tone = resolve(t)
  const varName =
    tone === 'error' || tone === 'danger'
      ? '--status-danger-fg'
      : tone === 'primary'
        ? '--primary'
        : `--status-${tone}-fg`
  return {
    color: `var(${varName}, currentColor)`,
  }
}

export const pctToTone = (pct: number): Tone => {
  if (pct >= 80) return 'success'
  if (pct >= 50) return 'warning'
  if (pct > 0) return 'error'
  return 'neutral'
}

export const rateToTone = (rate: number, total?: number): Tone => {
  if (total !== undefined && total <= 0) return 'neutral'
  return pctToTone(rate * 100)
}

export const validityTone = (valid: number, total: number): Tone => {
  if (total <= 0) return 'neutral'
  return pctToTone((valid / total) * 100)
}
