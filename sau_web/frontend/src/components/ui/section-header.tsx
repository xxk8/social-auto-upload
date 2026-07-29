import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  icon: ReactNode
  title: string
  className?: string
}

/**
 * SectionHeader — card section header with gradient icon container + title.
 *
 * Originally defined in `features/publish/shared.tsx`, now promoted to the
 * shared UI component library so any dashboard page can use the same
 * visual vocabulary without duplicating the gradient + ring pattern.
 *
 * Use `<SectionIcon>` standalone when the icon container is needed
 * inside a CardHeader / DialogTitle / AccordionTrigger (places where
 * the full header layout with border-bottom is not appropriate).
 */
export function SectionHeader({ icon, title, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center gap-3 mb-5 pb-3 border-b border-border/40', className)}>
      <SectionIcon size="md">{icon}</SectionIcon>
      <span className="text-sm font-semibold tracking-tight">{title}</span>
    </div>
  )
}

interface SectionIconProps {
  children: ReactNode
  /** Default `md` (h-8 w-8 rounded-xl). Use `sm` for compact (h-7 w-7 rounded-lg) or `lg` for hero (h-10 w-10 rounded-xl). */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * SectionIcon — gradient icon container used in page/card headers.
 *
 * Sizing reference:
 *   - `sm` → h-7 w-7 rounded-lg (DialogTitle / AccordionTrigger)
 *   - `md` → h-8 w-8 rounded-xl (SectionHeader / CardTitle)  ← default
 *   - `lg` → h-10 w-10 rounded-xl (hero / empty-state)
 *
 * Always uses `from-primary/15 to-primary/5` gradient with
 * `ring-1 ring-primary/10` border, which is the canonical icon
 * container pattern across all dashboard pages.
 *
 * The inner icon is rendered via `children` — pass the desired
 * lucide-react icon directly (e.g. `<Sparkles className="h-4 w-4" />`).
 */
export function SectionIcon({ children, size = 'md', className }: SectionIconProps) {
  const sizeClass =
    size === 'sm' ? 'h-7 w-7 rounded-lg' :
    size === 'lg' ? 'h-10 w-10 rounded-xl' :
    'h-8 w-8 rounded-xl'

  return (
    <div
      className={cn(
        `flex ${sizeClass} items-center justify-center shrink-0`,
        'bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/10',
        className,
      )}
    >
      {children}
    </div>
  )
}
