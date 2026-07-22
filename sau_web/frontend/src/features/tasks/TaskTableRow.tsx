import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import {
  Badge,
  Button,
  Checkbox,
  Skeleton,
  TableCell,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/index'
import { Loader2, RotateCcw, Repeat, Trash2 } from 'lucide-react'
import type { TaskItem } from '../../api/client'
import { formatDateTime, shortenId } from '@/lib/features'
import { STATUS_META, type StatusType } from './shared'

import { ROUTES } from '@/routes'
/**
 * Single table row. Memoized because table polls every 3s — without memo,
 * every row would re-render even when only one status badge changed. TanStack
 * Query stabilizes the `task` reference for unchanged items, so React.memo's
 * shallow-equal check skips re-rendering the other 49 rows.
 *
 * The actions don't memoize further: hover tooltips / Radix dialogs are cheap.
 */
export const TaskTableRow = memo(function TaskTableRow({
  task,
  selected,
  onToggle: _onToggle,
  onOpenDrawer,
  onRetry,
  onDelete,
  onStatusFilter,
  retrying,
}: {
  task: TaskItem
  selected: boolean
  onToggle: (taskId: string, checked: boolean) => void
  onOpenDrawer: (task: TaskItem) => void
  onRetry: (task: TaskItem) => void
  onDelete: (taskId: string) => void
  onStatusFilter: (status: StatusType) => void
  retrying: string | null
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const meta = STATUS_META[task.status ?? 'pending'] ?? STATUS_META.pending
  // Resolve the status label at render time — STATUS_META is a
  // module-level manifest with `labelKey + labelFallback` (no React
  // coupling), so the per-row t() call is the resolution site. Mirrors
  // the DASHBOARD_NAV_DEFS pattern in AppShell.tsx.
  const statusLabel = t(meta.labelKey, meta.labelFallback)
  const canDelete =
    task.status === 'success' ||
    task.status === 'failed' ||
    task.status === 'error' ||
    task.status === 'scheduled'
  const canRetry = task.status === 'failed' || task.status === 'error'

  return (
    <TableRow className="table-row-refined">
      <TableCell className="px-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => _onToggle(task.task_id, checked === true)}
          aria-label={t('tasks.row.select_aria', '选择任务 {{id}}', { id: shortenId(task.task_id) })}
        />
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-pointer hover:text-primary hover:underline transition-colors"
              aria-label={t('tasks.row.view_detail_aria', '查看任务详情')}
              onClick={() => onOpenDrawer(task)}
            >
              <code className="text-xs bg-muted px-2 py-1 rounded">{shortenId(task.task_id)}</code>
            </button>
          </TooltipTrigger>
          <TooltipContent>{task.task_id}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>{task.platform || '-'}</TableCell>
      <TableCell>{task.action || '-'}</TableCell>
      <TableCell>{task.account || '-'}</TableCell>
      <TableCell>
        <Badge
          variant={meta.variant}
          className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => {
            const nextStatus = (task.status ?? 'pending') as StatusType
            onStatusFilter(nextStatus)
          }}
          title={t('tasks.table.filter_title', '筛选「{{status}}」任务', { status: statusLabel })}
        >
          {meta.icon ?? statusLabel}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatDateTime(task.created)}</TableCell>
      <TableCell className="border-l">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onOpenDrawer(task)}>
            {t('tasks.row.detail_button', '详情')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canRetry}
                onClick={() => onRetry(task)}
                aria-label={t('tasks.row.retry_aria', '重新执行此任务')}
              >
                {retrying === task.task_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('tasks.row.retry_tooltip', '重新执行此任务')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ to: `${ROUTES.dashboard.publish}?from_task=${task.task_id}` as never })}
                aria-label={t('tasks.row.republish_aria', '用此任务参数重新发布')}
              >
                <Repeat className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('tasks.row.republish_tooltip', '用此任务参数重新发布')}</TooltipContent>
          </Tooltip>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  aria-label={t('tasks.row.delete_aria', '删除任务')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('tasks.row.delete_dialog.title', '确认删除')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('tasks.row.delete_dialog.description', '确认删除此任务?')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('tasks.row.delete_dialog.cancel', '取消')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(task.task_id)}>{t('tasks.row.delete_dialog.confirm', '删除')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
})

/**
 * Skeleton placeholder row — used by TaskTable during the initial fetch.
 */
export const TaskTableRowSkeleton = memo(function TaskTableRowSkeleton() {
  return (
    <TableRow>
      <TableCell className="px-2">
        <Skeleton className="h-4 w-4 rounded-sm" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-[120px] rounded" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-[60px] rounded" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-[80px] rounded" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-[80px] rounded" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-[50px] rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-[130px] rounded" />
      </TableCell>
      <TableCell className="border-l">
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-10 rounded" />
          <Skeleton className="h-7 w-8 rounded" />
          <Skeleton className="h-7 w-8 rounded" />
        </div>
      </TableCell>
    </TableRow>
  )
})
