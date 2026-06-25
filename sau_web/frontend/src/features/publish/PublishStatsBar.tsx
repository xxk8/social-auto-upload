import { memo } from 'react'
import { Card, Badge, Button } from '@/Components/ui/index'
import { Users, Layers, Flag, RefreshCw } from 'lucide-react'
import { PLATFORMS } from '@/api/client'
import { formatTaskId } from './shared'
import { toneBgClass, toneTextClass, type Tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

/**
 * Three-stat summary bar shown at the top of the Publish page.
 * Displays: available accounts, supported platforms, and recent task IDs.
 *
 * Token discipline (OPT-1B-1): icon chip backgrounds and icon text colors
 * are routed through `@/lib/tone` `toneBgClass` / `toneTextClass` so light +
 * dark theme palettes both derive from `--status-{tone}-{bg,fg}`. Previous
 * hex literals (`bg-emerald-500/10`, `text-emerald-600 dark:text-emerald-400`)
 * drifted here until 2026-06-25.
 *
 * OPT-V-2 (PR-OPT-3 piggy-back): the "最近提交" card's tone is wired to
 * the actual task status polled via `useTasks`. `lastTaskTone` is derived
 * upstream in `PublishPage` and passed in — the bar is a pure consumer.
 * The colour mapping:
 *   - `null`           (no last submit)        → muted grey
 *   - `'warning'`      (running / unknown)     → amber, pulse on dot
 *   - `'success'`      (all green)             → mint-green
 *   - `'error'`        (any failed terminal)   → red
 */
interface PublishStatsBarProps {
  accountCount: number
  lastTaskIds: string[]
  /** OPT-V-2: pre-derived tone from `useTasks` ∩ `lastTaskIds`. */
  lastTaskTone?: Tone | null
  onRefresh: () => void
}

export const PublishStatsBar = memo(function PublishStatsBar({
  accountCount,
  lastTaskIds,
  lastTaskTone = null,
  onRefresh,
}: PublishStatsBarProps) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {/* Accounts */}
      <Card className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-lg font-bold leading-none tabular-nums">{accountCount}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">可用账号</p>
        </div>
      </Card>

      {/* Platforms — token-driven (was emerald-500/10 + emerald-600/400) */}
      <Card className="flex items-center gap-3 px-4 py-3">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', toneBgClass('success'))}>
          <Layers className={cn('h-4 w-4', toneTextClass('success'))} />
        </div>
        <div>
          <p className="text-lg font-bold leading-none tabular-nums">{PLATFORMS.length}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">支持平台</p>
        </div>
      </Card>

      {/* Recent tasks + refresh — OPT-V-2 tone-aware (was hard-coded warning) */}
      <Card className="flex items-center gap-3 px-4 py-3">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', toneBgClass(lastTaskTone))}>
          <Flag className={cn('h-4 w-4', toneTextClass(lastTaskTone))} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-lg font-bold leading-none tabular-nums">
              {lastTaskIds.length > 0 ? lastTaskIds.length : '—'}
            </p>
            {lastTaskIds.length > 0 && (
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                {lastTaskIds.slice(0, 2).map((id) => (
                  <Badge key={id} variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                    {formatTaskId(id)}
                  </Badge>
                ))}
                {lastTaskIds.length > 2 && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    +{lastTaskIds.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">最近提交</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground shrink-0"
          onClick={onRefresh}
          aria-label="刷新账号列表"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </Card>
    </div>
  )
})
