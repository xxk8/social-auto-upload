import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Progress,
} from '@/components/ui/index'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react'
import type { BatchProgress } from './shared'
import { shortenId } from '@/lib/features'
import { cn } from '@/lib/utils'
import { toneTextClass } from '@/lib/tone'

/**
 * Selection / batch-action toolbar + batch progress panel. Memoized so
 * keystroke-driven re-renders of the search input don't trigger work here.
 *
 * Two visible states:
 *   1. Nothing selected → render `null`
 *   2. Nothing selected but a batchProgress is in flight → show progress
 *   3. Selected + no in-flight batch → show selection toolbar
 *   4. Selected + in-flight batch → prefer the progress panel (selection
 *      state is preserved in parent)
 */
export const TaskBatchActions = memo(function TaskBatchActions({
  selectedCount,
  onClearSelection,
  onBatchRetry,
  onBatchDelete,
  batchProgress,
  onDismissProgress,
  batchDetailOpen,
  onToggleBatchDetail,
}: {
  selectedCount: number
  onClearSelection: () => void
  onBatchRetry: () => void
  onBatchDelete: () => void
  batchProgress: BatchProgress
  onDismissProgress: () => void
  batchDetailOpen: boolean
  onToggleBatchDetail: () => void
}) {
  const { t } = useTranslation()
  if (!batchProgress && selectedCount === 0) return null

  if (batchProgress) {
    return (
      <div className="mb-4 p-4 rounded-lg border bg-muted/40 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium">
              {batchProgress.type === 'retry'
                ? t('tasks.batch.batch_retrying', '批量重试中')
                : t('tasks.batch.batch_deleting', '批量删除中')}
            </span>
            <Badge variant="secondary" className="text-xs">
              {batchProgress.current} / {batchProgress.total}
            </Badge>
          </div>
          {batchProgress.current === batchProgress.total ? (
            <Button variant="ghost" size="sm" onClick={onDismissProgress}>
              {t('tasks.batch.batch_close', '关闭')}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {Math.round((batchProgress.current / batchProgress.total) * 100)}%
            </span>
          )}
        </div>
        <Progress value={batchProgress.current} max={batchProgress.total} />
        {batchProgress.current === batchProgress.total && (
          <div className="flex items-center gap-3 text-sm">
            {/* Counter labels + the batch-detail row icons share the
                success/error vocabulary — routed through `@/lib/tone` for
                the chip color; the count text uses plain toneTextClass. */}
            <span className={cn('flex items-center gap-1', toneTextClass('success'))}>
              <CheckCircle2 className="h-4 w-4" />
              {t('tasks.batch.batch_success_count', '{{count}} 成功', {
                count: batchProgress.results.filter((r) => r.success).length,
              })}
            </span>
            <span className={cn('flex items-center gap-1', toneTextClass('error'))}>
              <XCircle className="h-4 w-4" />
              {t('tasks.batch.batch_failed_count', '{{count}} 失败', {
                count: batchProgress.results.filter((r) => !r.success).length,
              })}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleBatchDetail}
          aria-expanded={batchDetailOpen}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {batchDetailOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {batchDetailOpen
            ? t('tasks.batch.batch_collapse_detail', '收起详情')
            : t('tasks.batch.batch_expand_detail', '查看逐条状态')}
        </button>
        {batchDetailOpen && (
          <div className="max-h-[200px] overflow-auto rounded border bg-background space-y-1 p-2">
            {batchProgress.results.map((r) => (
              <div
                key={r.taskId}
                className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded hover:bg-muted/60"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {r.success ? (
                    <CheckCircle2
                      className={cn(
                        'h-3.5 w-3.5 flex-shrink-0',
                        toneTextClass('success'),
                      )}
                    />
                  ) : (
                    <XCircle
                      className={cn(
                        'h-3.5 w-3.5 flex-shrink-0',
                        toneTextClass('error'),
                      )}
                    />
                  )}
                  <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded truncate">
                    {shortenId(r.taskId)}
                  </code>
                </div>
                {r.message && (
                  <span
                    className="text-muted-foreground truncate max-w-[200px]"
                    title={r.message}
                  >
                    {r.message}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Selected, no in-flight batch — show selection toolbar.
  return (
    <div className="flex items-center justify-between gap-4 mb-4 p-3 rounded-lg border bg-muted/40">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">
          {t('tasks.batch.selected_count', '已选 {{count}} 项', { count: selectedCount })}
        </Badge>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          {t('tasks.batch.clear_selection', '取消选择')}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBatchRetry}>
          <RotateCcw className="h-4 w-4 mr-1" />
          {t('tasks.batch.batch_retry', '批量重试')}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-1" />
              {t('tasks.batch.batch_delete', '批量删除')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('tasks.batch.batch_delete_dialog.title', '确认批量删除')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  'tasks.batch.batch_delete_dialog.description',
                  '确认删除选中的 {{count}} 个任务?此操作不可恢复。',
                  { count: selectedCount },
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('tasks.batch.batch_delete_dialog.cancel', '取消')}</AlertDialogCancel>
              <AlertDialogAction onClick={onBatchDelete}>{t('tasks.batch.batch_delete_dialog.confirm', '删除')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
})
