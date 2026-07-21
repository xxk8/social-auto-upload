import { useTranslation } from 'react-i18next'

import { useTasks } from '../hooks/useTasks'
import { useTaskTableState } from '../hooks/useTaskTableState'
import { useTaskMutations } from '../hooks/useTaskMutations'
import { useTaskHotkeys } from '../hooks/useTaskHotkeys'

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
} from '@/Components/ui/alert-dialog'
import { Badge } from '@/Components/ui/badge'
import { Button } from '@/Components/ui/button'
import { Input } from '@/Components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/Components/ui/tooltip'
import { StatusTabs } from '../features/tasks/StatusTabs'
import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
import {
  BarChart3,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { TaskTable, TaskTableCard } from '../features/tasks/TaskTable'
import { TaskDrawer } from '../features/tasks/TaskDrawer'
import { TaskBatchActions } from '../features/tasks/TaskBatchActions'
import { AddTaskDialog } from '../features/tasks/AddTaskDialog'
import type { StatusType } from '../features/tasks/shared'
import { TaskProgressBar } from '../features/tasks/TaskProgressBar'
import { Pagination } from '@/Components/ui/pagination'

/**
 * TasksPage — `/dashboard/tasks` route.
 *
 * Composes three custom hooks that split the page's state machine
 * along its natural seams:
 *
 *   - `useTaskTableState(tasks)`  — table read-model: keyword +
 *     debounce, status filter, selection, drawer/retrying flags,
 *     batch progress, add-modal state, URL `?focus=` deep-link,
 *     selection-cleanup-on-filter-change effect.
 *   - `useTaskMutations(input)`   — todo/server actions: refresh,
 *     single-row retry/delete, bulk clear, batch retry/delete with
 *     runWithConcurrency, add-modal open/change/confirm, selection
 *     toggles, status chip click.
 *   - `useTaskHotkeys(opts)`      — global keydown handler for
 *     R / N / `/` shortcuts.
 *
 * Why a thin composer here: the bulk of the page used to be a
 * single 500-line component mixing read-model, write-model, and
 * effect-orchestration. Splitting it lets each hook be reasoned
 * about independently (and individually tested) while the page
 * just renders chrome.
 */
export default function TasksPage() {
  const { t } = useTranslation()
  const { data: tasks = [], isLoading, refetch } = useTasks()

  // ── read-model ──
  const table = useTaskTableState(tasks)

  // ── write-model ──
  const m = useTaskMutations({
    filtered: table.pagedFiltered,
    selectedIds: table.selectedIds,
    drawerTaskId: table.drawerTaskId,
    addForm: table.addForm,
    setSelectedIds: table.setSelectedIds,
    setBatchProgress: table.setBatchProgress,
    setBatchDetailOpen: table.setBatchDetailOpen,
    setDrawerTaskId: table.setDrawerTaskId,
    setRetrying: table.setRetrying,
    setManualRefreshing: table.setManualRefreshing,
    setAddModalOpen: table.setAddModalOpen,
    setAddForm: table.setAddForm,
    setStatus: table.setStatus,
    refetchTasks: refetch,
  })

  // ── keyboard shortcuts ──
  useTaskHotkeys({
    refresh: m.refresh,
    drawerTaskId: table.drawerTaskId,
    addModalOpen: table.addModalOpen,
    handleOpenAddModal: m.handleOpenAddModal,
    searchInputRef: table.searchInputRef,
  })

  // Local re-aliased references for JSX readability. Each name
  // reuses state owned by `table` or actions owned by `m` —
  // no shadow copies.
  const {
    keyword,
    status,
    selectedIds,
    batchProgress,
    batchDetailOpen,
    drawerTaskId,
    retrying,
    manualRefreshing,
    addModalOpen,
    addForm,
    searchInputRef,
    counts,
    chipOptions,
    pagedFiltered,
    totalFiltered,
    page,
    pageSize,
    setPage,
    setPageSize,
    setBatchProgress,
    setBatchDetailOpen,
    setStatus,
  } = table

  return (
    <PageWrapper>
      <PageHeader
        title={t('tasks.page.title', '任务列表')}
        description={t('tasks.page.description', '查看和管理所有上传任务')}
        icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
        actions={
          <Button variant="outline" size="sm" onClick={m.handleOpenAddModal}>
            <Plus className="h-4 w-4 mr-1" />
            {t('tasks.page.new_task_button', '新建任务')}
          </Button>
        }
      />
      <StatusTabs
        options={chipOptions.map(({ value, labelKey, labelFallback, icon, count, variant }) => ({
          value,
          label: t(labelKey, labelFallback),
          icon,
          count,
          variant,
        }))}
        value={status}
        onChange={(v) => setStatus(v as StatusType)}
        className="mb-2"
      />
      {tasks.length > 0 && (
        <TaskProgressBar total={tasks.length} counts={counts} />
      )}
      <TaskTableCard>
        <TaskBatchActions
          selectedCount={selectedIds.size}
          onClearSelection={m.handleClearSelection}
          onBatchRetry={m.handleBatchRetry}
          onBatchDelete={m.handleBatchDelete}
          batchProgress={batchProgress}
          onDismissProgress={() => setBatchProgress(null)}
          batchDetailOpen={batchDetailOpen}
          onToggleBatchDetail={() => setBatchDetailOpen((v) => !v)}
        />
        {/* Toolbar: search (primary) + grouped secondary actions.
            Layout rhythm:
              · row 1 — search input fills remaining width; on the
                right sit the state indicators (polling badge +
                shortcut hint) which read as ambient meta, NOT
                actions.
              · row 2 — batch actions already rendered above; the
                primary write-actions (新建任务 / 清理 / 刷新) live
                here as a tight group so the eye finds them at the
                same y-coordinate across every visit. */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex-1 min-w-[220px] max-w-md">
            <Input
              id="tasks-search-keyword"
              name="search"
              ref={searchInputRef}
              placeholder={t('tasks.page.search_placeholder', '搜索任务 ID、平台、账号（按 / 聚焦）')}
              value={keyword}
              onChange={(e) => table.setKeyword(e.target.value)}
              autoComplete="off"
              data-search-input
            />
          </div>
          {/* Ambient meta — polling status + keyboard hint. Kept
              visually quiet (outline / secondary) so they don't
              compete with the write-actions below. */}
          <div className="flex items-center gap-2 ml-auto">
            <Badge
              variant="secondary"
              className="text-xs gap-1 border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-900/20 dark:text-green-400"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              {t('tasks.page.live_chip', '实时')}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] cursor-help hidden sm:inline-flex font-mono tabular-nums">
                  R·N·/
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1 text-xs">
                  <div>
                    <kbd className="px-1 py-0.5 rounded bg-muted border">R</kbd> {t('tasks.page.shortcuts.r', '刷新列表')}
                  </div>
                  <div>
                    <kbd className="px-1 py-0.5 rounded bg-muted border">N</kbd> {t('tasks.page.shortcuts.n', '新建任务')}
                  </div>
                  <div>
                    <kbd className="px-1 py-0.5 rounded bg-muted border">/</kbd> {t('tasks.page.shortcuts.slash', '聚焦搜索')}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        {/* Write-actions — tight row, primary CTA first. */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Button onClick={m.handleOpenAddModal} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {t('tasks.page.new_task_button', '新建任务')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={m.refresh}
            aria-label={t('tasks.page.refresh_aria', '刷新任务列表')}
          >
            {manualRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('tasks.page.refresh_button', '刷新')}
          </Button>
          <ClearTasksButton onConfirm={m.handleClear} />
        </div>
        <TaskTable
          isLoading={isLoading}
          filtered={pagedFiltered}
          selectedIds={selectedIds}
          onToggle={m.handleToggleSelect}
          onToggleAll={m.handleToggleAll}
          onOpenDrawer={m.handleOpenDrawer}
          onRetry={m.handleRetry}
          onDelete={m.handleDelete}
          onStatusFilter={m.handleStatusBadgeClick}
          retrying={retrying}
          manualRefreshing={manualRefreshing}
          onRefresh={m.refresh}
          onAddTask={m.handleOpenAddModal}
        />
        {!isLoading && totalFiltered > pageSize && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={totalFiltered}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s)
              setPage(1)
            }}
          />
        )}
      </TaskTableCard>
      <TaskDrawer
        taskId={drawerTaskId}
        onClose={m.handleCloseDrawer}
        onRetry={m.handleRetry}
        retrying={retrying}
      />
      <AddTaskDialog
        open={addModalOpen}
        values={addForm}
        onChange={m.handleAddTaskChange}
        onConfirm={m.handleAddTaskConfirm}
        onCancel={m.handleCloseAddModal}
      />
    </PageWrapper>
  )
}

// ClearTasksButton — inline sub-component. Calls useTranslation()
// directly (not prop-drilled) to match the AppShell pattern where
// every localized component owns its own t() binding. Keeping the
// hook here (vs. passing t as a prop) means a future refactor that
// extracts ClearTasksButton to a separate file won't have to thread
// t through a new import boundary.
const ClearTasksButton = ({ onConfirm }: { onConfirm: () => void }) => {
  const { t } = useTranslation()
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 className="h-4 w-4 mr-1" />
          {t('tasks.page.clear_button', '清理')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('tasks.page.clear_dialog.title', '确认清理')}</AlertDialogTitle>
          <AlertDialogDescription>{t('tasks.page.clear_dialog.description', '清理所有已完成、失败、异常的任务?')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('tasks.page.clear_dialog.cancel', '取消')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('tasks.page.clear_dialog.confirm', '清理')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
