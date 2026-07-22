// ─────────────────────────────────────────────────────────────────────
// PremiumEmptyState — richer empty state with decorative gradient orbs
// and stronger typography hierarchy compared to the default
// EmptyState. Used on admin "no data" surfaces.
//
// We do NOT replace EmptyState on the admin pages — we MIGRATE the
// admin-page empty call sites to this premium primitive. Other
// surfaces in the app that use the default `h-12 w-12 muted chip`
// are out of scope here.
//
// Visual contract:
//   • Two soft gradient orbs in opposite corners — provides non-flat
//     visual interest on an empty card.
//   • Icon: 56px circle with tone-tinted bg + 24px icon stroke.
//   • Title + description typography stack: eyebrow uppercase +
//     16px semibold + 13px muted caption.
//
// Module exports ONLY the component.
// ─────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { toneStyleClasses, type Tone } from '@/lib/tone'

interface PremiumEmptyStateProps {
  /** Decorative icon — placed in the central circle. */
  icon: ReactNode
  /** Title wording — required. */
  title: string
  description?: string
  /** Eyebrow tagline above the icon. Default "EMPTY". */
  eyebrow?: string
  /** Accent tone for the icon ring + orb tints. */
  tone?: Tone
  /** Optional CTA — placed below the description. */
  action?: ReactNode
  className?: string
}

const ORB_TINT: Record<Tone, string> = {
  // Flat literal class strings so Tailwind v4's JIT scanner picks
  // them up. Each orb is rendered as a `bg-{color}/20` disc that
  // gets blurred to produce its soft halo.
  neutral: 'bg-muted',
  info: 'bg-[var(--status-info-fg)]/20',
  success: 'bg-[var(--status-success-fg)]/20',
  warning: 'bg-[var(--status-warning-fg)]/20',
  danger: 'bg-[var(--status-danger-fg)]/20',
  error: 'bg-[var(--status-error-fg,var(--status-danger-fg))]/20',
  primary: 'bg-primary/20',
}

function PremiumEmptyState({
  icon,
  title,
  description,
  eyebrow = 'NO DATA',
  tone = 'info',
  action,
  className,
}: PremiumEmptyStateProps) {
  return (
    <div
      className={cn(
        'relative isolate flex flex-col items-center justify-center px-4 py-14 sm:py-20',
        'overflow-hidden rounded-xl',
        className,
      )}
      data-tone={tone}
    >
      {/* Decorative gradient orbs — top-left + bottom-right. Each is
          a blur-3xl disc tinted by the chosen tone. set to absolute
          with translate so they bleed past the rounded border but
          stay clipped via overflow-hidden + isolate on the parent. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -left-12 -top-12 h-40 w-40 rounded-full blur-3xl',
          ORB_TINT[tone],
        )}
      />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-16 -bottom-20 h-56 w-56 rounded-full blur-3xl',
          ORB_TINT[tone],
          'opacity-60',
        )}
      />

      {/* Faint film grain via radial fallback — adds depth without
          needing extra deps. Sits behind the icon stack. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(at_center_top,color-mix(in_oklab,var(--foreground)_3%,transparent),transparent_60%)]"
      />

      {/* Eyebrow */}
      <div className="relative text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground/70 uppercase">
        {eyebrow}
      </div>

      {/* Icon medallion */}
      <div
        className={cn(
          'relative mt-3 flex h-14 w-14 items-center justify-center rounded-2xl',
          'ring-1 ring-inset ring-border/60 shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--foreground)_8%,transparent)]',
          toneStyleClasses[tone].bg,
        )}
      >
        <span className={cn('h-6 w-6 [&>svg]:h-6 [&>svg]:w-6', toneStyleClasses[tone].fg)}>
          {icon}
        </span>
      </div>

      {/* Title + description */}
      <h3 className="relative mt-5 text-[15px] sm:text-base font-semibold text-foreground tracking-tight">
        {title}
      </h3>
      {description && (
        <p className="relative mt-1.5 max-w-[320px] text-[12.5px] sm:text-[13px] leading-relaxed text-muted-foreground/80 text-center">
          {description}
        </p>
      )}

      {action && <div className="relative mt-5">{action}</div>}
    </div>
  )
}

export { PremiumEmptyState }
