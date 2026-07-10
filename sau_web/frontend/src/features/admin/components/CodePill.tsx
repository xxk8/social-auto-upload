// ─────────────────────────────────────────────────────────────────────
// CodePill — monospace subtle pill for technical codes (audit action
// strings, IDs, classnames). Lighter visual weight than the default
// shadcn Badge so a row of mixed content (avatar + email + CodePill +
// timestamp) reads cleanly.
//
// `children` is always rendered as text (we don't escape HTML). For
// audit action strings like "update_role" / "system_restart" the
// consumer passes the string directly and tests assert it via
// `screen.getByText('update_role')` — preserved.
//
// Module exports ONLY the component.
// ─────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CodePillProps {
  children: ReactNode
  className?: string
  /** Optional leading dot/chip — used to add tone-color. */
  tone?: 'info' | 'success' | 'warning' | 'error' | null
  /** Plain flat style without rounded corners. */
  variant?: 'pill' | 'flat'
}

const TONE_DOT: Record<NonNullable<CodePillProps['tone']>, string> = {
  // Flat literals so Tailwind v4 JIT picks up the substring.
  info: 'bg-[var(--status-info-fg)]',
  success: 'bg-[var(--status-success-fg)]',
  warning: 'bg-[var(--status-warning-fg)]',
  error: 'bg-[var(--status-error-fg)]',
}

function CodePill({
  children,
  className,
  tone,
  variant = 'pill',
}: CodePillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono tabular-nums',
        'text-[10.5px] font-medium leading-none',
        'border border-border/60 bg-muted/30 text-foreground/80',
        variant === 'pill' ? 'rounded-md px-1.5 py-1' : 'rounded-none px-0 py-0 border-0 bg-transparent',
        className,
      )}
    >
      {tone && (
        <span
          aria-hidden
          className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', TONE_DOT[tone])}
        />
      )}
      <span className="truncate">{children}</span>
    </span>
  )
}

export { CodePill }
