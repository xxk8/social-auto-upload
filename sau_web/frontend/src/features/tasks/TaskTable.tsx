import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  EmptyState,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/index'
import { BarChart3, Loader2, Plus, RefreshCw } from 'lucide-react'
import type { TaskItem } from '../../api/client'
import { TaskTableRow, TaskTableRowSkeleton } from './TaskTableRow'
import type { StatusType } from './shared'

/**
 * Table renderer for the **current page** of tasks (caller paginates).
 *
 * Scroll is confined to a max-height region so the dashboard page itself
 * does not grow with thousands of rows; header stays sticky while the
 * body scrolls.
 */
export const TaskTable = memo(function TaskTable({
  isLoading,
  filtered,
  selectedIds,
  onToggle,
  onToggleAll,
  onOpenDrawer,
  onRetry,
  onDelete,
  onStatusFilter,
  retrying,
  manualRefreshing,
  onRefresh,
  onAddTask,
}: {
  isLoading: boolean
  /** Rows for the *current page only* (already sliced by TasksPage). */
  filtered: TaskItem[]
  selectedIds: Set<string>
  onToggle: (taskId: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  onOpenDrawer: (task: TaskItem) => void
  onRetry: (task: TaskItem) => void
  onDelete: (taskId: string) => void
  onStatusFilter: (s: StatusType) => void
  retrying: string | null
  manualRefreshing: boolean
  onRefresh: () => void
  onAddTask: () => void
}) {
  const { t } = useTranslation()
  const allVisibleSelected = useMemo(
    () => filtered.length > 0 && filtered.every((t) => selectedIds.has(t.task_id)),
    [filtered, selectedIds],
  )
  const someVisibleSelected = useMemo(
    () => filtered.some((t) => selectedIds.has(t.task_id)),
    [filtered, selectedIds],
  )
  const headerChecked: boolean | 'indeterminate' = allVisibleSelected
    ? true
    : someVisibleSelected
      ? 'indeterminate'
      : false

  // Avoid the Table wrapper's nested overflow (breaks sticky thead).
  // Outer: border; inner: capped height + scroll; thead sticky.
  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <div
        className="max-h-[min(56vh,520px)] overflow-auto overscroll-contain"
        data-tasks-table-scroll
      >
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 border-b bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/90">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40px] px-2">
                <Checkbox
                  checked={headerChecked}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                  aria-label={t('tasks.table.header_select_all', '全选本页')}
                />
              </TableHead>
              <TableHead className="w-[220px]">{t('tasks.table.header_task_id', '任务 ID')}</TableHead>
              <TableHead className="w-[110px]">{t('tasks.table.header_platform', '平台')}</TableHead>
              <TableHead className="w-[140px]">{t('tasks.table.header_action', '动作')}</TableHead>
              <TableHead className="w-[140px]">{t('tasks.table.header_account', '账号')}</TableHead>
              <TableHead className="w-[110px]">{t('tasks.table.header_status', '状态')}</TableHead>
              <TableHead className="w-[180px]">{t('tasks.table.header_created', '创建时间')}</TableHead>
              <TableHead className="w-[240px] border-l">{t('tasks.table.header_operations', '操作')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => <TaskTableRowSkeleton key={i} />)}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState
                    icon={<BarChart3 className="h-6 w-6" />}
                    title={t('tasks.table.empty_title', '暂无任务')}
                    description={t('tasks.table.empty_description', '创建任务后会在这里显示')}
                    action={
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={onAddTask}>
                          <Plus className="h-4 w-4 mr-1" />
                          {t('tasks.page.new_task_button', '新建任务')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={onRefresh}>
                          {manualRefreshing ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4 mr-1" />
                          )}
                          {t('tasks.table.empty_refresh_button', '刷新列表')}
                        </Button>
                      </div>
                    }
                  />
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              filtered.map((record) => (
                <TaskTableRow
                  key={record.task_id}
                  task={record}
                  selected={selectedIds.has(record.task_id)}
                  onToggle={onToggle}
                  onOpenDrawer={onOpenDrawer}
                  onRetry={onRetry}
                  onDelete={onDelete}
                  onStatusFilter={onStatusFilter}
                  retrying={retrying}
                />
              ))}
          </TableBody>
        </table>
      </div>
    </div>
  )
})

/** Compact Card wrapper used by TasksPage to host the table and batch panel. */
export function TaskTableCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="card-refined">
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  )
}

