import {
  Activity,
  AlertOctagon,
  BarChart3,
  CheckCircle2,
  Clock,
  FlaskConical,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { ChipBarVariant } from '@/components/ui/chip-bar'

/**
 * Task-domain types, status meta, and the chip definitions for the status
 * bar.
 *
 * Cross-page helpers (formatDateTime, shortenId, runWithConcurrency,
 * BATCH_CONCURRENCY) have moved to `@/lib/features` so non-task pages can
 * reuse them.
 */

export type StatusType =
  | 'all'
  | 'pending'
  | 'running'
  | 'scheduled'
  | 'success'
  | 'failed'
  | 'error'

export type TaskStatusVariant =
  | 'secondary'
  | 'info'
  | 'warning'
  | 'success'
  | 'error'

/**
 * Status meta — same shape as the AppShell manifest pattern. The
 * module-level constant holds the i18n key + a hardcoded fallback
 * string so the meta can live in a non-React module (no
 * useTranslation coupling). The consumer component resolves the
 * label at render time via `t(meta.labelKey, meta.labelFallback)`.
 *
 * Why not just call `t()` at module load? `useTranslation` is a
 * React hook — it can only be called from a component, not from
 * module evaluation. Keeping the `key + fallback` pair at module
 * scope + resolving at render time is the canonical i18next idiom
 * for static manifests (mirrors `DASHBOARD_NAV_DEFS` in AppShell
 * per docs/dev/adr-i18n-invariant.md §2).
 */
export const STATUS_META: Record<
  string,
  {
    variant: TaskStatusVariant
    labelKey: string
    labelFallback: string
    icon?: ReactNode
  }
> = {
  pending: { variant: 'secondary', labelKey: 'tasks.statuses.pending', labelFallback: '等待中' },
  running: { variant: 'info', labelKey: 'tasks.statuses.running', labelFallback: '执行中' },
  scheduled: { variant: 'warning', labelKey: 'tasks.statuses.scheduled', labelFallback: '定时中' },
  success: { variant: 'success', labelKey: 'tasks.statuses.success', labelFallback: '成功', icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> },
  failed: { variant: 'error', labelKey: 'tasks.statuses.failed', labelFallback: '失败', icon: <AlertOctagon className="h-3.5 w-3.5 text-red-500" /> },
  error: { variant: 'error', labelKey: 'tasks.statuses.error', labelFallback: '异常' },
}

/**
 * Status chip definitions shown above the table. Same key +
 * fallback pattern as STATUS_META. Resolved at render time in
 * TasksPage (the consumer) before being passed down to the
 * generic <StatusTabs> component — StatusTabs stays locale-agnostic
 * and the manifest stays React-free.
 */
export const STATUS_CHIPS: ReadonlyArray<{
  value: StatusType
  labelKey: string
  labelFallback: string
  icon: ReactNode
  variant: ChipBarVariant
}> = [
  { value: 'all', labelKey: 'tasks.statuses.all', labelFallback: '全部', icon: <BarChart3 className="h-3.5 w-3.5" />, variant: 'neutral' },
  { value: 'pending', labelKey: 'tasks.statuses.pending', labelFallback: '等待中', icon: <Clock className="h-3.5 w-3.5" />, variant: 'neutral' },
  { value: 'running', labelKey: 'tasks.statuses.running', labelFallback: '执行中', icon: <Activity className="h-3.5 w-3.5" />, variant: 'info' },
  { value: 'scheduled', labelKey: 'tasks.statuses.scheduled', labelFallback: '定时中', icon: <FlaskConical className="h-3.5 w-3.5" />, variant: 'warning' },
  { value: 'success', labelKey: 'tasks.statuses.success', labelFallback: '成功', icon: <CheckCircle2 className="h-3.5 w-3.5" />, variant: 'success' },
  { value: 'failed', labelKey: 'tasks.statuses.failed', labelFallback: '失败', icon: <AlertOctagon className="h-3.5 w-3.5" />, variant: 'error' },
  { value: 'error', labelKey: 'tasks.statuses.error', labelFallback: '异常', icon: <AlertOctagon className="h-3.5 w-3.5" />, variant: 'error' },
]

export type BatchResultItem = {
  taskId: string
  success: boolean
  message?: string
  status?: string
}

export type BatchProgress = {
  type: 'retry' | 'delete'
  total: number
  current: number
  results: BatchResultItem[]
} | null

