import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 sm:gap-4", className)}>
      <div className="flex items-start gap-3">
        {icon && (
          <div
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 mt-0.5',
              'bg-muted/50 text-muted-foreground',
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div
          className="flex items-center gap-2 flex-shrink-0"
          data-testid="page-header-actions"
        >
          {/* data-testid is referenced by AccountsPage.test.tsx via
            within(page-header-actions).getByRole('button', ...). If you
            rename this testid, grep AccountsPage.test.tsx and update both
            sides in the same PR — keeping the testid in sync is part of
            the spec contract. */}
          {actions}
        </div>
      )}
    </div>
  )
}
