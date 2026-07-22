import * as React from 'react'
import { cn } from '@/lib/utils'

interface DemoProps {
  heading?: string
  caption?: string
  children: React.ReactNode
  className?: string
}

export function Demo({ heading, caption, children, className }: DemoProps) {
  return (
    <section className={cn('not-prose my-6 rounded-lg border bg-card p-6 shadow-sm', className)}>
      {heading && (
        <header className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {heading}
          </span>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground/40">live</span>
        </header>
      )}
      {caption && <p className="mb-4 text-sm text-muted-foreground">{caption}</p>}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  )
}
