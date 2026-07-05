import { motion, MotionConfig, useReducedMotion, type Transition } from 'motion/react'
import { createContext, useContext, useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { toneStyleClasses, type Tone } from '@/lib/tone'

const VALID_TONES: Tone[] = ['info', 'success', 'warning', 'error']

function variantClasses(variant?: string) {
  if (!variant || !VALID_TONES.includes(variant as Tone)) return null
  return toneStyleClasses[variant as Tone]
}

export type StatusTabOption = {
  value: string
  label: string
  icon?: ReactNode
  count?: number
  variant?: string
}

const TabsCtx = createContext<{
  value: string
  setValue: (v: string) => void
  layoutId: string
} | null>(null)

function useTabs() {
  const ctx = useContext(TabsCtx)
  if (!ctx) throw new Error('StatusTabs must be used inside <StatusTabs>')
  return ctx
}

const SPRING: Transition = {
  type: 'spring',
  stiffness: 170,
  damping: 24,
  mass: 1.2,
}

export function StatusTabs({
  options,
  value,
  onChange,
  className,
}: {
  options: StatusTabOption[]
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const layoutId = useId()
  const reduce = useReducedMotion()
  return (
    <MotionConfig transition={reduce ? { duration: 0 } : SPRING}>
      <TabsCtx.Provider value={{ value, setValue: onChange, layoutId }}>
        <div role="tablist" className={cn('inline-flex items-center gap-1 rounded-full bg-card p-1 max-w-full overflow-x-auto', className)}>
          {options.map((opt) => (
            <StatusTabTrigger key={opt.value} tone={variantClasses(opt.variant)} option={opt} value={opt.value} />
          ))}
        </div>
      </TabsCtx.Provider>
    </MotionConfig>
  )
}

function StatusTabTrigger({
  value,
  option,
  tone,
}: {
  value: string
  option: StatusTabOption
  tone: { bg: string; fg: string } | null
}) {
  const { value: current, setValue, layoutId } = useTabs()
  const active = current === value

  // Active button gets full background+foreground coloring (like ChipBar)
  // The layoutId span provides a sliding indicator for motion
  return (
    <div className="relative">
      {active && (
        <motion.span layoutId={layoutId} className="absolute inset-0 rounded-full bg-primary" />
      )}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setValue(value)}
        className={cn(
          'relative z-10 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium outline-none transition-colors',
          active
            ? tone
              ? cn(tone.bg, tone.fg, 'ring-1', tone.ring ? `${tone.ring}/30` : '', 'shadow-sm')
              : 'bg-foreground text-background ring-1 ring-foreground/20 shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {option.icon && (
          <span className="flex h-3.5 w-3.5 items-center justify-center">
            {option.icon}
          </span>
        )}
        <span className="truncate">{option.label}</span>
        {option.count !== undefined && (
          <span
            className={cn(
              'tabular-nums text-[10px] font-semibold',
              active ? 'opacity-80' : 'opacity-50',
            )}
          >
            {option.count}
          </span>
        )}
      </button>
    </div>
  )
}
