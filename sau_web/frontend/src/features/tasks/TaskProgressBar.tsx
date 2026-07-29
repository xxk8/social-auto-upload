import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  CheckCircle2,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { toneFillBgClass, toneFgVar, toneBgClass, toneTextClass } from '@/lib/tone'

type TaskCounts = Record<string, number>

type ProgressSegment = {
  key: string
  label: string
  count: number
  pct: number
  barClass: string
  chipBg: string
  textClass: string
  color: string
  Icon: LucideIcon
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

function buildSegments(total: number, counts: TaskCounts): ProgressSegment[] {
  if (total <= 0) {
    return [
      {
        key: 'empty',
        label: '暂无任务',
        count: 0,
        pct: 0,
        barClass: 'bg-muted-foreground/20',
        chipBg: 'bg-muted/60',
        textClass: 'text-muted-foreground',
        color: 'var(--muted-foreground)',
        Icon: Activity,
      },
    ]
  }

  const defs: Array<{
    key: string
    label: string
    count: number
    tone: 'success' | 'info' | 'error'
    Icon: LucideIcon
  }> = [
    {
      key: 'done',
      label: '成功',
      count: sum(completedKeys, counts),
      tone: 'success',
      Icon: CheckCircle2,
    },
    {
      key: 'active',
      label: '进行中',
      count: sum(activeKeys, counts),
      tone: 'info',
      Icon: Loader2,
    },
    {
      key: 'failed',
      label: '失败/异常',
      count: sum(failedKeys, counts),
      tone: 'error',
      Icon: XCircle,
    },
  ]

  return defs
    .filter((d) => d.count > 0)
    .map((d) => ({
      key: d.key,
      label: d.label,
      count: d.count,
      pct: (d.count / total) * 100,
      barClass: toneFillBgClass(d.tone),
      chipBg: toneBgClass(d.tone),
      textClass: toneTextClass(d.tone),
      color: toneFgVar(d.tone),
      Icon: d.Icon,
    }))
}

/**
 * Task status distribution — pure CSS stacked bar + mini metric tiles.
 */
export const TaskProgressBar = memo(function TaskProgressBar({
  total,
  counts,
}: TaskProgressBarProps) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    done: t('tasks.progress.done', '成功'),
    active: t('tasks.progress.active', '进行中'),
    failed: t('tasks.progress.failed_combined', '失败/异常'),
    empty: t('tasks.progress.empty', '暂无任务'),
  }
  const totalLabel = t('tasks.progress.total', '总计')
  const title = t('tasks.progress.title', '任务状态')
  const rateLabel = t('tasks.progress.success_rate', '成功率')

  const segs = useMemo(() => {
    return buildSegments(total, counts).map((s) => ({
      ...s,
      label: labels[s.key] ?? s.label,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, counts, t])

  const successCount = counts.success ?? 0
  const successPct = total > 0 ? (successCount / total) * 100 : 0

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-border/40 shadow-none',
        'bg-gradient-to-br from-card via-card to-muted/20',
      )}
    >
      {/* Soft brand wash in the corner */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-[0.12]"
        style={{
          background:
            'radial-gradient(circle, var(--status-info-fg) 0%, transparent 70%)',
        }}
      />

      <CardContent className="relative space-y-4 p-4 sm:p-5">
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-xl',
                'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
                'ring-1 ring-[var(--status-info-fg)]/15',
              )}
            >
              <Activity className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-foreground">
                {title}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t('tasks.progress.subtitle', '按状态汇总当前列表')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Success rate pill */}
            {total > 0 && (
              <div
                className={cn(
                  'hidden items-center gap-1.5 rounded-full px-2.5 py-1 sm:inline-flex',
                  'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
                  'ring-1 ring-[var(--status-success-fg)]/12',
                )}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">
                  {rateLabel}
                </span>
                <span className="text-sm font-semibold tabular-nums leading-none">
                  {successPct.toFixed(0)}%
                </span>
              </div>
            )}
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                {totalLabel}
              </div>
              <div className="text-xl font-semibold tabular-nums leading-none tracking-tight text-foreground">
                {total}
              </div>
            </div>
          </div>
        </div>

        {/* ── Track ────────────────────────────────────────────── */}
        <div
          className={cn(
            'relative flex h-3 w-full items-stretch overflow-hidden rounded-full',
            'bg-muted/50 shadow-inner ring-1 ring-inset ring-border/50',
          )}
          role="img"
          aria-label={segs.map((s) => `${s.label} ${s.count}`).join('，')}
        >
          {/* subtle top highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/10"
          />

          {total === 0 ? (
            <div className="h-full w-full rounded-full bg-muted-foreground/15" />
          ) : (
            segs.map((s, i) => (
              <div
                key={s.key}
                title={`${s.label} · ${s.count}（${s.pct.toFixed(0)}%）`}
                className={cn(
                  'relative h-full min-w-[6px] transition-[width] duration-700 ease-out',
                  s.barClass,
                  // Soft gloss
                  'after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-1/2',
                  'after:bg-gradient-to-b after:from-white/25 after:to-transparent',
                  i === 0 && 'rounded-l-full',
                  i === segs.length - 1 && 'rounded-r-full',
                  i > 0 && 'ml-px',
                )}
                style={{
                  width: `${Math.max(s.pct, 1.2)}%`,
                  boxShadow: `0 0 12px -2px color-mix(in oklab, ${s.color} 45%, transparent)`,
                }}
              />
            ))
          )}
        </div>

        {/* ── Metric tiles ─────────────────────────────────────── */}
        <div
          className={cn(
            'grid gap-2',
            segs.length >= 3
              ? 'grid-cols-1 sm:grid-cols-3'
              : segs.length === 2
                ? 'grid-cols-1 sm:grid-cols-2'
                : 'grid-cols-1',
          )}
        >
          {segs.map((s) => {
            const Icon = s.Icon
            return (
              <div
                key={s.key}
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5',
                  'ring-1 ring-inset transition-colors',
                  s.chipBg,
                  s.key === 'empty'
                    ? 'ring-border/40'
                    : 'ring-transparent hover:ring-black/5 dark:hover:ring-white/10',
                )}
                style={
                  s.key !== 'empty'
                    ? {
                        // tinted ring using the segment color
                        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${s.color} 18%, transparent)`,
                      }
                    : undefined
                }
                title={
                  total > 0
                    ? `${s.label} · ${s.count}（${s.pct.toFixed(0)}%）`
                    : s.label
                }
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    'bg-background/70 shadow-sm ring-1 ring-black/5 dark:ring-white/10',
                    s.textClass,
                  )}
                >
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5',
                      s.key === 'active' && total > 0 && 'animate-spin',
                    )}
                    style={
                      s.key === 'active' && total > 0
                        ? { animationDuration: '2.4s' }
                        : undefined
                    }
                    aria-hidden
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-[11px] font-medium', s.textClass)}>
                    {s.label}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-base font-semibold tabular-nums tracking-tight text-foreground">
                      {s.count}
                    </span>
                    {total > 0 && s.key !== 'empty' && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {s.pct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
                {/* Mini spark proportion */}
                {total > 0 && s.key !== 'empty' && (
                  <div className="hidden h-8 w-1.5 overflow-hidden rounded-full bg-background/50 sm:block">
                    <div
                      className={cn('w-full rounded-full', s.barClass)}
                      style={{
                        height: `${Math.min(100, Math.max(8, s.pct))}%`,
                        marginTop: `${100 - Math.min(100, Math.max(8, s.pct))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
})
