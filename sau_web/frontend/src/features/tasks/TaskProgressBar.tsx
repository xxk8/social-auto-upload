import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/Components/ui/card'
import { cn } from '@/lib/utils'
import { toneFillBgClass, toneFgVar } from '@/lib/tone'
import { StackedBarChart } from '@/lib/StackedBarChart'
import { formatTaskTooltip } from './tooltipFormatter'

type TaskCounts = Record<string, number>

type ProgressSegment = {
  key: string
  label: string
  count: number
  /** Tailwind bg class for the legend dot. */
  barClass: string
  /** CSS var string for recharts Cell fill. */
  color: string
}

type TaskProgressBarProps = {
  total: number
  counts: TaskCounts
}

const completedKeys = ['success']
const activeKeys = ['running', 'pending', 'scheduled']
const failedKeys = ['failed', 'error']

function sum(keys: string[], counts: TaskCounts) {
  return keys.reduce((s, k) => s + (counts[k] ?? 0), 0)
}

function segments(total: number, counts: TaskCounts): ProgressSegment[] {
  const done = sum(completedKeys, counts)
  const active = sum(activeKeys, counts)
  const failed = sum(failedKeys, counts)

  if (total === 0) return [{ key: 'empty', label: '暂无任务', count: 0, barClass: 'bg-muted', color: 'var(--muted)' }]

  return [
    { key: 'done', label: '成功', count: done, barClass: toneFillBgClass('success'), color: toneFgVar('success') },
    { key: 'active', label: '进行中', count: active, barClass: toneFillBgClass('info'), color: toneFgVar('info') },
    { key: 'failed', label: '失败/异常', count: failed, barClass: toneFillBgClass('error'), color: toneFgVar('error') },
  ].filter((s) => s.count > 0)
}

/**
 * Stacked progress bar summarising task status distribution.
 * Now powered by recharts BarChart with Tooltip — hover any segment
 * to see the status name, count, and percentage.
 *
 * Pure presentational — reads from pre-computed counts.
 */
export const TaskProgressBar = memo(function TaskProgressBar({
  total,
  counts,
}: TaskProgressBarProps) {
  const { t } = useTranslation()
  const segLabels: Record<string, string> = {
    done: t('tasks.progress.done', '成功'),
    active: t('tasks.progress.active', '进行中'),
    failed: t('tasks.progress.failed_combined', '失败/异常'),
    empty: t('tasks.progress.empty', '暂无任务'),
  }
  const totalLabel = t('tasks.progress.total', '总计')
  const segs = segments(total, counts).map((s) => ({
    ...s,
    label: segLabels[s.key] ?? s.label,
  }))

  return (
    <Card className="border card-outline shadow-none">
      <CardContent className="flex items-center gap-4 p-4">
        {/* Stacked bar chart — recharts BarChart, no axes, just
            stacked segments with Tooltip. Replaces the hand-written
            div + inline width bar. */}
        <div className="h-2.5 flex-1 min-w-[100px]">
          {total === 0 ? (
            <div className="h-full w-full rounded-full bg-muted" />
          ) : (
            <StackedBarChart
              segments={segs.map((s) => ({ key: s.key, count: s.count, color: s.color }))}
              name="tasks"
              tooltipFormatter={(value, key) => formatTaskTooltip(value, key, segs, total)}
            />
          )}
        </div>

        {/* Stats — same layout as before, kept as plain HTML */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground whitespace-nowrap">
          {segs.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', s.barClass)} />
              <span>{s.label}</span>
              <span className="font-medium tabular-nums">{s.count}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 border-l border-border pl-4">
            <span>{totalLabel}</span>
            <span className="font-medium tabular-nums">{total}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
