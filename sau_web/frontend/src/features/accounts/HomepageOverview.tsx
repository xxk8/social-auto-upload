import { memo, useMemo, type ReactNode } from 'react'
import { ArrowUpRight, Folders, Loader2, Plus, Send, ShieldCheck } from 'lucide-react'
import { PLATFORMS, type TaskItem } from '@/api/client'
import { useAccountGroups } from '@/hooks/useAccountGroups'
import { useTasks } from '@/hooks/useTasks'
import { cn } from '@/lib/utils'
import {
  rateToTone,
  toneChipClasses,
  type Tone,
} from '@/lib/tone'

/* ── Public overview props ──────────────────────────────────────────── */

interface HomepageOverviewProps {
  onCreateGroup?: () => void
  onCheckAllStatus?: () => void
  onOpenTasks?: () => void
  onOpenPublish?: () => void
}

/* ── Tone mappers ───────────────────────────────────────────────────── */

function taskStatusDisplay(status?: string): { label: string; tone: Tone | null } {
  if (!status) return { label: '未知', tone: null }
  switch (status) {
    case 'success':
      return { label: '成功', tone: 'success' }
    case 'failed':
      return { label: '失败', tone: 'error' }
    case 'error':
      return { label: '异常', tone: 'error' }
    case 'pending':
      return { label: '等待', tone: 'warning' }
    case 'running':
      return { label: '运行中', tone: 'warning' }
    case 'scheduled':
      return { label: '已计划', tone: 'info' }
    default:
      return { label: status, tone: null }
  }
}

function platformLabel(value?: string): string {
  if (!value) return ''
  return PLATFORMS.find((p) => p.value === value)?.label ?? value
}

function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (diffSec < 60) return '刚刚'
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `${String(mins)} 分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${String(hrs)} 小时前`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${String(days)} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

/* ── Single-line metric chip ────────────────────────────────────────── */

interface ChipProps {
  icon: ReactNode
  label: string
  value: ReactNode
  title?: string
  accent: Tone | null
  onClick?: () => void
  muted?: boolean
}

function MetricChip({ icon, label, value, title, accent, onClick, muted }: ChipProps) {
  const interactive = Boolean(onClick)
  return (
    <div
      className={cn(
        'group/chip relative flex min-w-0 items-center gap-2 overflow-hidden rounded-[10px]',
        'border border-border/40 bg-background/55 px-2.5 py-1.5 sm:gap-2.5 sm:px-3 sm:py-[7px]',
        'shadow-[inset_0_1px_0_oklch(1_0_0_/_0.05)]',
        'transition-[background-color,border-color,box-shadow,transform] duration-200',
        interactive &&
          'cursor-pointer hover:border-primary/25 hover:bg-background/85 hover:shadow-[0_1px_2px_oklch(0_0_0_/_0.04),inset_0_1px_0_oklch(1_0_0_/_0.06)] motion-safe:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      )}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={title}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      aria-label={
        interactive
          ? `${label}: ${typeof value === 'string' || typeof value === 'number' ? value : label}`
          : undefined
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent dark:via-white/[0.08]"
      />
      <div
        className={cn(
          'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          'shadow-[inset_0_1px_0_oklch(1_0_0_/_0.1),0_1px_1px_oklch(0_0_0_/_0.04)]',
          toneChipClasses(accent),
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60 leading-none">
          {label}
        </div>
        <div
          className={cn(
            'mt-[3px] truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums sm:text-[16px]',
            muted ? 'text-muted-foreground/65' : 'text-foreground',
          )}
        >
          {value}
        </div>
      </div>
      {interactive && (
        <ArrowUpRight
          aria-hidden
          className="h-3 w-3 shrink-0 text-muted-foreground/30 transition-colors duration-200 group-hover/chip:text-primary/70 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover/chip:translate-x-0.5 motion-safe:group-hover/chip:-translate-y-0.5"
        />
      )}
    </div>
  )
}

/* ── Public overview ────────────────────────────────────────────────── */

function HomepageOverviewImpl({
  onCreateGroup,
  onCheckAllStatus,
  onOpenTasks,
  onOpenPublish,
}: HomepageOverviewProps) {
  const { data: groups = [], isLoading: isGroupsLoading } = useAccountGroups()
  const { data: tasks = [] } = useTasks()

  const metrics = useMemo(() => {
    const totalGroups = groups.length
    const auths = groups.flatMap((g) => g.authorizations)
    const authTotal = auths.length
    const authValid = auths.filter((a) => a.valid).length
    const authStale = auths.filter((a) => a.stale).length
    const authHealthy = authValid - authStale
    const authRate = authTotal > 0 ? authHealthy / authTotal : 0

    const inFlightCount = tasks.filter(
      (t) => t.status === 'pending' || t.status === 'running',
    ).length

    const lastTask: TaskItem | undefined =
      tasks.length > 0
        ? tasks.reduce<TaskItem>((latest, t) => {
            const a = latest.created ?? ''
            const b = t.created ?? ''
            return b.localeCompare(a) > 0 ? t : latest
          }, tasks[0])
        : undefined

    return {
      totalGroups,
      authTotal,
      authValid,
      authHealthy,
      authRate,
      inFlightCount,
      lastTask,
      taskCount: tasks.length,
    }
  }, [groups, tasks])

  if (!isGroupsLoading && metrics.totalGroups === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-border/55 bg-muted/15 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              toneChipClasses('info'),
            )}
          >
            <Folders className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-foreground">尚未创建分组</div>
            <div className="text-[11px] text-muted-foreground/75">
              建一个分组，再开始给各平台添加授权
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCreateGroup}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 self-start rounded-md px-3 py-1.5',
            'bg-primary text-[12px] font-medium text-primary-foreground',
            'shadow-[0_1px_2px_oklch(0.45_0.16_264_/_0.2)] transition-all duration-150 active:scale-[0.985] hover:opacity-90 sm:self-auto',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          新建分组
        </button>
      </div>
    )
  }

  if (isGroupsLoading) {
    return (
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-[10px] border border-border/35 bg-muted/25 sm:h-11"
          />
        ))}
      </div>
    )
  }

  const lastStatus = taskStatusDisplay(metrics.lastTask?.status)
  const lastValue = metrics.lastTask
    ? platformLabel(metrics.lastTask.platform) || metrics.lastTask.action || '—'
    : metrics.taskCount > 0
      ? '—'
      : '暂无'
  const lastHint = metrics.lastTask
    ? `${lastStatus.label} · ${metrics.lastTask.account ?? '—'} · ${timeAgo(metrics.lastTask.created)}`
    : metrics.taskCount > 0
      ? '查看任务记录'
      : '去发布中心提交任务'

  const validityHint =
    metrics.authTotal > 0
      ? metrics.authHealthy < metrics.authValid
        ? `${metrics.authHealthy}/${metrics.authTotal} 正常 · ${metrics.authValid - metrics.authHealthy} 过期`
        : `${metrics.authValid}/${metrics.authTotal} 个授权正常`
      : '暂无授权可检测'

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4">
      <MetricChip
        icon={<Folders className="h-3.5 w-3.5" />}
        label="账号分组"
        value={metrics.totalGroups}
        title={
          metrics.authTotal > 0
            ? `${metrics.authTotal} 个平台授权`
            : '尚无平台授权'
        }
        accent="info"
      />
      <MetricChip
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        label="有效率"
        value={metrics.authTotal > 0 ? `${Math.round(metrics.authRate * 100)}%` : '—'}
        title={validityHint}
        accent={rateToTone(metrics.authRate, metrics.authTotal)}
        onClick={metrics.authTotal > 0 ? onCheckAllStatus : undefined}
        muted={metrics.authTotal === 0}
      />
      <MetricChip
        icon={<Send className="h-3.5 w-3.5" />}
        label="最近发布"
        value={<span className="block max-w-full truncate">{lastValue}</span>}
        title={lastHint}
        accent={lastStatus.tone}
        onClick={
          metrics.lastTask
            ? onOpenTasks
            : metrics.taskCount > 0
              ? onOpenTasks
              : onOpenPublish
        }
        muted={!metrics.lastTask}
      />
      <MetricChip
        icon={
          <Loader2
            className={cn(
              'h-3.5 w-3.5',
              metrics.inFlightCount > 0 && 'animate-spin',
            )}
          />
        }
        label="正在运行"
        value={metrics.inFlightCount}
        title={
          metrics.inFlightCount > 0
            ? `${metrics.inFlightCount} 个任务进行中`
            : metrics.taskCount > 0
              ? '当前没有运行中的任务'
              : '尚无历史任务'
        }
        accent={metrics.inFlightCount > 0 ? 'warning' : null}
        onClick={metrics.taskCount > 0 ? onOpenTasks : undefined}
        muted={metrics.inFlightCount === 0}
      />
    </div>
  )
}

export const HomepageOverview = memo(HomepageOverviewImpl)
