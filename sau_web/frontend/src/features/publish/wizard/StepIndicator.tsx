import { memo } from 'react'
import { Check, Eye, FileText, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WizardStep } from '@/stores/publishWizardStore'

/**
 * §11.2 — StepIndicator: horizontal stepper showing the 3-step wizard
 * progress.
 *
 * Engineering-tool polish (replaces the prior motion.spring scale
 * animation):
 *   - Each step is now a mono-numbered slim rail node (`01 / 02 / 03`).
 *     The mono number is the breadcrumb-style identifier; the Lucide
 *     icon + label sit to its right.
 *   - Connectors are flat hairline lines, no `scaleX` motion (mirrors
 *     the canonical "no spring physics / no overshoot" discipline from
 *     DESIGN.md motion-grammar; the operator dashboard previously
 *     tolerated spring, but a continuous-state bounce on a control
 *     rail reads as decorative, not engineering).
 *   - Active state is a 2px sodium-amber BOTTOM strip + bolder ink —
 *     NOT a circle background fill. Consistent with the publish page
 *     mode-card pattern: "selection cue is amber strip + ink shift,
 *     never a block-fill".
 *   - Completed steps render with a small check glyph in sodium-amber
 *     and a quieter mono step number so the rail reads as a
 *     trial/scan-line. (Previously rendered the latin `OK`, which read
 *     as dev output against Chinese labels.)
 */

const STEPS = [
  { step: 0 as WizardStep, label: '上传', icon: Upload, slug: 'upload' },
  { step: 1 as WizardStep, label: '内容', icon: FileText, slug: 'content' },
  { step: 2 as WizardStep, label: '确认', icon: Eye, slug: 'review' },
] as const

interface StepIndicatorProps {
  currentStep: WizardStep
  /** Jump directly to a step (only allowed for completed steps). */
  onStepClick?: (step: WizardStep) => void
  /** Steps the user has already visited (enables click-back). */
  maxVisitedStep: WizardStep
}

export const StepIndicator = memo(function StepIndicator({
  currentStep,
  onStepClick,
  maxVisitedStep,
}: StepIndicatorProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-center w-full py-1 sm:py-1.5 font-mono tabular-nums"
      role="list"
      aria-label="发布向导步骤"
    >
      {STEPS.map((s, i) => {
        const isCompleted = currentStep > s.step
        const isCurrent = currentStep === s.step
        const isClickable = Boolean(onStepClick) && s.step <= maxVisitedStep
        const Icon = s.icon
        const stepLabel = String(s.step + 1).padStart(2, '0')

        return (
          <div key={s.step} className="flex items-center">
            <button
              type="button"
              role="listitem"
              disabled={!isClickable}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => isClickable && onStepClick?.(s.step)}
              className={cn(
                'group relative flex items-center gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2 py-0.5 sm:py-1 transition-colors duration-200 outline-none',
                'focus-visible:ring-1 focus-visible:ring-ring',
                isClickable && 'cursor-pointer hover:bg-muted/40',
                !isClickable && !isCurrent && 'cursor-default',
              )}
            >
              {/* Active bottom-strip — 2px amber, mirrors SidebarRow */}
              {isCurrent && (
                <span
                  aria-hidden="true"
                  className="absolute left-2 right-2 bottom-0 h-[2px] rounded-t-full bg-primary"
                />
              )}

              {/* Wrapper is `aria-hidden=true` for completed steps
                  (completed != current), so any `aria-label` on the
                  `<Check />` glyph would be ignored per ARIA spec.
                  The listitem's accessible name is already provided
                  by the sibling `<span>{s.label}</span>` below which
                  keeps the rail announced cleanly. */}
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[14px] text-[11px] tracking-tight tabular-nums',
                  isCurrent && 'text-primary',
                  isCompleted && 'text-primary/80',
                  !isCurrent && !isCompleted && 'text-muted-foreground/40',
                )}
                aria-hidden={isCurrent ? undefined : 'true'}
              >
                {isCompleted ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : (
                  stepLabel
                )}
              </span>

              <Icon
                className={cn(
                  'h-3 w-3 shrink-0 transition-colors duration-200',
                  isCurrent && 'text-primary',
                  isCompleted && 'text-foreground/80',
                  !isCurrent && !isCompleted && 'text-muted-foreground/40',
                )}
                aria-hidden
              />

              <span
                className={cn(
                  'text-[11px] tracking-tight transition-colors duration-200',
                  isCurrent && 'text-foreground font-semibold',
                  isCompleted && 'text-foreground/80',
                  !isCurrent && !isCompleted && 'text-muted-foreground/55',
                )}
              >
                {s.label}
              </span>
            </button>

            {/* Connector — flat hairline, no scaleX motion */}
            {i < STEPS.length - 1 && (
              <div className="relative h-[1px] w-6 sm:w-10 -mt-1" aria-hidden>
                <div className="absolute inset-0 bg-border" />
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 ease-out',
                    isCompleted ? 'w-full' : 'w-0',
                  )}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})
