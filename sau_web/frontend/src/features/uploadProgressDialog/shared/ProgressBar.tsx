// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/shared/ProgressBar.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): shared presentational
// ProgressBar primitive. Lives in `shared/` because both publish and
// batch-import progress flows need the same visual treatment
// (bottom-fill hairline, sodium-amber hue matching the visitor
// surface's primary accent, status row underneath).
//
// Pure component — no Provider / no hook reads. Trigger flow
// installs the value via CSS `style.width` based on the normalized
// 0..1 ratio; status row colors swap on `stage === 'failed'`.
// ──────────────────────────────────────────────────────────────────────────

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProgressBarProps {
  /** 0..1 — ratio of completed work. Saturates to 1.0 visually. */
  ratio: number
  /** Stage name copy rendered underneath the bar. */
  stageLabel: string
  /** Optional cancelled / failed styling flag. */
  state?: 'running' | 'done' | 'failed'
  /** Optional aria-label override; default composes from stageLabel. */
  ariaLabel?: string
}

export function ProgressBar({
  ratio,
  stageLabel,
  state = 'running',
  ariaLabel,
}: ProgressBarProps) {
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const widthPct = `${(clampedRatio * 100).toFixed(1)}%`

  return (
    <div className="space-y-1.5" aria-label={ariaLabel ?? stageLabel}>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(clampedRatio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out',
            state === 'failed'
              ? 'bg-destructive'
              : state === 'done'
                ? 'bg-primary/80'
                : 'bg-primary',
          )}
          style={{ width: widthPct }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span
          className={cn(
            'font-mono tabular-nums',
            state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {stageLabel}
        </span>
        {state === 'done' ? (
          <Check className="h-3 w-3 text-primary" aria-label="completed" />
        ) : (
          <span className="font-mono tabular-nums text-muted-foreground/80">
            {Math.round(clampedRatio * 100)}%
          </span>
        )}
      </div>
    </div>
  )
}
