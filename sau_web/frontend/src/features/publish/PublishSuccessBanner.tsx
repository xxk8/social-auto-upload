import { memo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
} from '@/Components/ui/index'
import { CheckCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SubmitSuccessInfo } from '@/stores/publishStore'

const springTransition = { type: 'spring' as const, stiffness: 400, damping: 30 }

type PublishSuccessBannerProps = {
  info: SubmitSuccessInfo | null
  onGoToTasks: () => void
  /**
   * OPT-3I: seconds remaining before auto-navigate fires. When `null`
   * the countdown pill is hidden — the banner falls back to the
   * pre-OPT-3I "submitted, view tasks" reading once the user has
   * dismissed / cancelled the auto-navigate timer.
   */
  cancelCountdown?: number | null
  /**
   * OPT-3I: handler invoked by the "取消" pill. Clears the pending
   * auto-navigate interval WITHOUT dismissing the banner itself, so
   * the user can still click "查看任务状态" to navigate manually.
   */
  onCancelAutoNavigate?: () => void
}

/**
 * Top-of-page success alert with a spring entrance. Memoized so that mode
 * toggles inside PublishPage's tabs (which trigger parent re-renders
 * unrelated to a recent submission) don't re-trigger the alert's animation.
 */
export const PublishSuccessBanner = memo(function PublishSuccessBanner({
  info,
  onGoToTasks,
  cancelCountdown = null,
  onCancelAutoNavigate,
}: PublishSuccessBannerProps) {
  // ponytail: fire confetti once when info appears. ref gate prevents
  // re-trigger on remount (e.g. navigating away and back).
  const firedRef = useRef(false)
  useEffect(() => {
    if (!info || firedRef.current) return
    firedRef.current = true
    const duration = 1500
    const end = Date.now() + duration
    import('canvas-confetti').then(({ default: confetti }) => {
      const frame = () => {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.6 } })
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.6 } })
        if (Date.now() < end) requestAnimationFrame(frame)
      }
      frame()
    })
  }, [info])

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          initial={{ opacity: 0, y: -24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.97 }}
          transition={springTransition}
        >
          <Alert variant="success">
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>提交成功</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2 flex-wrap">
              <span>
                <strong>{info.count}</strong> 个{info.mode}上传任务已提交！
              </span>
              <div className="flex items-center gap-2">
                {/*
                  OPT-3I: cancellable auto-navigate pill.
                  - Same visual chrome as the prior chip pattern used
                    by the 失效 row (OPT-3H) so affordances are
                    consistent across the publish surface.
                  - `cancelCountdown === null` ⇒ hidden (timer is
                    inactive, cancelled, or already fired).
                  - `tabular-nums` keeps the digit width stable so the
                    pill doesn't jitter as the number shrinks.
                  - aria-label spells out "Xs 后跳转到任务列表 · 取消"
                    for screen readers (sr-only spans avoided so we
                    don't add noise to the AT outline).
                */}
                {cancelCountdown !== null && cancelCountdown > 0 && onCancelAutoNavigate && (
                  <button
                    type="button"
                    onClick={onCancelAutoNavigate}
                    aria-label={`剩 ${cancelCountdown} 秒自动跳转到任务列表，点击取消`}
                    title={`取消自动跳转（剩 ${cancelCountdown} 秒）`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shrink-0 cursor-pointer',
                      'bg-muted/70 text-muted-foreground border border-border/60',
                      'hover:bg-muted hover:text-foreground active:scale-[0.97] transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                    )}
                  >
                    <span className="tabular-nums">{cancelCountdown}s</span>
                    <span>后跳转任务列表</span>
                    <span aria-hidden className="opacity-60">·</span>
                    <span className="font-medium">取消</span>
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                )}
                <Button size="sm" onClick={onGoToTasks}>
                  查看任务状态 →
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
