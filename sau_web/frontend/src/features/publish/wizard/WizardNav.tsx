import { memo } from 'react'
import { Button } from '@/Components/ui/button'
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WizardStep } from '@/stores/publishWizardStore'

/**
 * §11.6 — WizardNav: bottom navigation bar with "上一步" / "下一步"
 * buttons. The next button is disabled when `canProceed` is false.
 * On the final step (Review), the next button becomes the submit button.
 *
 * Mobile: the bar is sticky at the bottom of the viewport so it's
 * always reachable without scrolling.
 */interface WizardNavProps {
  currentStep: WizardStep
  canProceed: boolean
  /**
   * Human-readable reason the wizard can't advance right now.
   * `undefined` once `canProceed` is true. Surfaced as
   * `title` on the disabled next/submit button so users see
   * WHY 「下一步」 / 「发布」 is muted, instead of guessing.
   */
  disabledReason?: string
  onPrev: () => void
  onNext: () => void
  /** Label for the next/submit button on the final step. */
  submitLabel?: string
  /** When true, the submit button shows a spinner and is disabled. */
  submitting?: boolean
}

// 末步文案从「提交」改为「发布」 — 用户预期的是“把内容推到
// 平台”而不是“提交表单”，与 ReviewStep 的跳转成功 banner 语义一致。
const STEP_LABELS = ['下一步', '下一步', '发布'] as const

export const WizardNav = memo(function WizardNav({
  currentStep,
  canProceed,
  disabledReason,
  onPrev,
  onNext,
  submitLabel,
  submitting = false,
}: WizardNavProps) {
  const isFirst = currentStep === 0
  const isLast = currentStep === 2
  const buttonLabel = isLast ? (submitLabel ?? STEP_LABELS[currentStep]) : STEP_LABELS[currentStep]  

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 sm:gap-3 pt-3 sm:pt-4 pb-2 mt-4 sm:mt-6',
        // Sticky 只在移动端启用 — 桌面端 step-card 是垂直堆叠，粘性
        // 底栏会和表格 outline / 下拉 select 面板产生渐变叠层。
        // `lg:static` 走纯静态布局，移除了 backdrop-blur 与 hairline
        // 顶边以避免与上方 `<ContentVariantsPanel>` 视觉交错。
        'sticky bottom-0 lg:static',
        'bg-background/95 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none',
        'border-t border-border/40 lg:border-t-0',
      )}
    >
      <Button
        variant="outline"
        onClick={onPrev}
        disabled={isFirst}
        className={cn(
          'gap-2 transition-opacity',
          isFirst && 'opacity-0 pointer-events-none',
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        上一步
      </Button>

      <div className="text-xs text-muted-foreground tabular-nums">
        {currentStep + 1} / 3
      </div>

      <Button
        onClick={onNext}
        disabled={!canProceed || submitting}
        // 3-branch title — submitting wins over !canProceed so a brief
        // 「发布中…」phase does not surface the stale `disabledReason`
        // from before the click. !canProceed & !submitting → disable
        // tooltip; canProceed & !submitting → no title (default hover
        // affordance stays clean for the happy path).
        title={
          submitting
            ? '发布中…'
            : !canProceed
              ? disabledReason
              : undefined
        }
        className="btn-elegant gap-2"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {isLast ? (
          <Check className="h-4 w-4" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        {buttonLabel}
      </Button>
    </div>
  )
})
