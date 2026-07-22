import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageWrapperProps {
  children: ReactNode
  /** Optional element rendered above the spaced content (e.g. AdminNavTabs). */
  topNav?: ReactNode
  /** Controls the outer width constraint. */
  variant?: 'default' | 'flush' | 'publish'
  /** Controls the vertical gap between children. */
  spacing?: 'sm' | 'md'
  className?: string
  contentClassName?: string
  'data-testid'?: string
}

/**
 * Shared page layout wrapper for dashboard routes.
 *
 * Replaces the repetitive `div className="space-y-6 p-6 max-w-[1600px] mx-auto w-full"`
 * pattern and handles the few layout variants across the app:
 *
 *   - default: block-level page with max-width 1600px
 *   - flush:   same padding/spacing but no max-width constraint
 *   - publish: full-height flex layout used by the publish wizard
 */
export function PageWrapper({
  children,
  topNav,
  variant = 'default',
  spacing = 'md',
  className,
  contentClassName,
  'data-testid': dataTestId,
}: PageWrapperProps) {
  if (variant === 'publish') {
    return (
      <div
        className={cn(
          'flex h-full min-w-0 w-full max-w-[1600px] mx-auto flex-col gap-6 overflow-x-hidden p-3 sm:p-6',
          className,
        )}
        data-testid={dataTestId}
      >
        {topNav}
        {children}
      </div>
    )
  }

  const spaceClass = spacing === 'sm' ? 'space-y-4' : 'space-y-6'
  const widthClass = variant === 'flush' ? '' : 'max-w-[1600px] mx-auto w-full'

  return (
    <div className={cn('p-6', widthClass, className)} data-testid={dataTestId}>
      {topNav}
      <div className={cn(spaceClass, contentClassName)}>
        {children}
      </div>
    </div>
  )
}
