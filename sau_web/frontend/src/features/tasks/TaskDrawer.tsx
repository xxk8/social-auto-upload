import { memo, useEffect, useMemo, useRef } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Separator,
} from '@/components/ui/index'
import { FileText, Loader2, RotateCcw } from 'lucide-react'
import { CliCommandBlock } from '@/components/CliCommand'
import { escapeQuotes } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { api, type TaskItem } from '../../api/client'
import { useTaskLogs } from '../../hooks/useTasks'
import { formatDateTime, shortenId } from '@/lib/features'
import { STATUS_META } from './shared'
import { cn } from '@/lib/utils'
import { toneTextClass } from '@/lib/tone'
import { Drawer } from '@/components/motion/drawer'

import { PLATFORM_URLS, PLATFORMS } from '@/components/ui/platform-chip-strip.constants'

const PLATFORM_LABEL_MAP: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.key, p.name]),
)

const TASKS_QUERY_KEY = ['tasks'] as const

/**
 * Slide-over panel + memoized body. Self-fetches the `task: TaskItem` from
 * the TanStack Query cache using only `taskId` so polling-churn on the
 * parent doesn't bust <TaskDrawer>'s memo. The body listens to cache
 * invalidations and refreshes the read on each render, so live status
 * changes still appear.
 */
export const TaskDrawer = memo(function TaskDrawer({
  taskId,
  onClose,
  onRetry,
  retrying,
  /**
   * Optional seed from a non-tasks surface (e.g. content calendar).
   * Used when the global `['tasks']` list cache does not yet contain
   * this id (calendar window can exceed the default list limit of 100).
   */
  seedTask = null,
}: {
  taskId: string | null
  onClose: () => void
  onRetry: (task: TaskItem) => void
  /** task_id currently being retried — drives the spinner in the drawer's primary button */
  retrying: string | null
  seedTask?: TaskItem | null
}) {
  return (
    <Drawer
      open={taskId !== null}
      onOpenChange={(open) => !open && onClose()}
      className="w-[620px] sm:max-w-[620px] overflow-y-auto"
      ariaLabel="任务详情"
    >
      <div className="flex flex-col space-y-2 text-center sm:text-left">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          任务详情
          {taskId && <TaskStatusBadge taskId={taskId} seedTask={seedTask} />}
        </h2>
        <p className="text-sm text-muted-foreground">查看任务的详细信息和运行日志</p>
      </div>
      {taskId && (
        <div className="mt-6 space-y-5">
          <RetryButton
            taskId={taskId}
            onRetry={onRetry}
            retrying={retrying}
            seedTask={seedTask}
          />
          <TaskDrawerBody taskId={taskId} seedTask={seedTask} />
        </div>
      )}
    </Drawer>
  )
})

/**
 * Live badge that subscribes to cache updates. Re-rendering is local —
 * never busts the outer memo unless `taskId` truly changes.
 */
const TaskStatusBadge = memo(function TaskStatusBadge({
  taskId,
  seedTask,
}: {
  taskId: string
  seedTask?: TaskItem | null
}) {
  const task = useTaskFromCache(taskId, seedTask)
  const meta = STATUS_META[task?.status ?? 'pending'] ?? STATUS_META.pending
  return <Badge variant={meta.variant}>{meta.labelFallback}</Badge>
})

const RetryButton = memo(function RetryButton({
  taskId,
  onRetry,
  retrying,
  seedTask,
}: {
  taskId: string
  onRetry: (task: TaskItem) => void
  retrying: string | null
  seedTask?: TaskItem | null
}) {
  const task = useTaskFromCache(taskId, seedTask)
  const canRetry = task && (task.status === 'failed' || task.status === 'error')
  if (!canRetry) return null
  return (
    <Button
      className="w-full mb-4"
      onClick={() => {
        onRetry(task)
      }}
    >
      {retrying === taskId ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <RotateCcw className="h-4 w-4 mr-2" />
      )}
      重试此任务
    </Button>
  )
})

/**
 * Detail body — task metadata + collapsible log accordion. Memoized on
 * `taskId` only.
 */
const TaskDrawerBody = memo(function TaskDrawerBody({
  taskId,
  seedTask,
}: {
  taskId: string
  seedTask?: TaskItem | null
}) {
  const task = useTaskFromCache(taskId, seedTask)
  const { data: taskLogs = [], isLoading: logsLoading } = useTaskLogs(
    task?.task_id ?? null,
    task?.status,
  )
  const statusMeta = STATUS_META[task?.status ?? 'pending'] ?? STATUS_META.pending
  const logsEndRef = useRef<HTMLDivElement | null>(null)
  // Seed-only = calendar (or similar) provided a stub without argv/error payload.
  const fromSeedOnly = Boolean(
    task && seedTask?.task_id === taskId && task.argv == null && task.error == null,
  )

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [taskLogs])

  const command = useMemo(() => {
    if (!task) return null
    if (task.argv) {
      try {
        const argv = JSON.parse(task.argv) as string[]
        return argv.join(' ')
      } catch {
        return task.argv
      }
    }
    if (task.platform && task.action && task.account) {
      return `${escapeQuotes(task.platform)} ${escapeQuotes(task.action)} --account "${escapeQuotes(task.account)}"`
    }
    return null
  }, [task])

  if (!task) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        <p>未在任务列表缓存中找到该任务。</p>
        <p className="mt-1 text-xs">
          可在任务页搜索 ID：
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">{taskId}</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {fromSeedOnly ? (
        <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          当前展示来自内容日历的摘要信息；完整日志与 CLI 细节请在任务页打开。
        </div>
      ) : null}
      <div className="space-y-3">
        <Field label="任务 ID">
          <code className="text-xs bg-muted px-2 py-1 rounded max-w-[300px] truncate" title={task.task_id}>
            {task.task_id}
          </code>
        </Field>
        <Separator />
        <Field label="平台">
          {task.platform && PLATFORM_URLS[task.platform] ? (
            <a
              href={PLATFORM_URLS[task.platform]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
              title={`打开 ${PLATFORM_LABEL_MAP[task.platform] ?? task.platform} 官网`}
            >
              {PLATFORM_LABEL_MAP[task.platform] ?? task.platform}
            </a>
          ) : (
            <span className="text-sm">{task.platform}</span>
          )}
        </Field>
        <Separator />
        <Field label="动作" value={task.action} />
        <Separator />
        <Field label="账号" value={task.account} />
        <Separator />
        <Field label="状态" alignRight>
          <Badge variant={statusMeta.variant}>{statusMeta.labelFallback}</Badge>
        </Field>
        <Separator />
        <Field label="创建时间" value={formatDateTime(task.created)} />
        <Separator />
        <Field label="退出码" alignRight>
          {task.code !== undefined && task.code !== null ? (
            <Badge variant={task.code === 0 ? 'success' : 'error'}>{task.code}</Badge>
          ) : (
            <span className="text-sm">-</span>
          )}
        </Field>
        {task.error && (
          <>
            <Separator />
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">错误信息</span>
              <pre className="text-xs bg-muted p-2 rounded-lg overflow-auto max-h-[200px] whitespace-pre-wrap">
                {task.error}
              </pre>
            </div>
          </>
        )}
        <ResultSection result={task.result} />
        {command && (
          <>
            <Separator />
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">
                执行命令
              </span>
              <CliCommandBlock command={command} className="max-h-[200px]" />
              <p className="text-[10px] text-muted-foreground/60">
                参考命令格式
              </p>
            </div>
          </>
        )}
      </div>

      <Accordion
        type="single"
        collapsible
        defaultValue={
          task.status === 'running' || task.status === 'failed' || task.status === 'error' ? 'logs' : undefined
        }
      >
        <AccordionItem value="logs">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="font-medium">运行日志</span>
              <Badge variant="secondary">{taskLogs.length} 条</Badge>
              {(task.status === 'pending' || task.status === 'running') && (
                // Spinner color: --status-info-fg via `@/lib/tone`
                // (the "task in flight" cue used everywhere else).
                <Loader2 className={cn('h-4 w-4 animate-spin', toneTextClass('info'))} />
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed max-h-[400px] overflow-auto">
              {logsLoading ? (
                <p className="text-muted-foreground">加载中...</p>
              ) : taskLogs.length === 0 ? (
                <p className="text-muted-foreground">暂无日志</p>
              ) : (
                <>
                  {taskLogs.map((entry, idx) => (
                    <div key={idx} className="mb-0.5">
                      {/* Log-line timestamp uses --status-success-fg via
                          `@/lib/tone` to keep the running-log chrome aligned
                          with LogsPage's mint-green timestamp convention. */}
                      <span className={cn('mr-2', toneTextClass('success'))}>{entry.ts}</span>
                      <span className="text-foreground">{entry.message}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
})

/**
 * Key/value row helper used by the detail panel.
 */
const Field = memo(function Field({
  label,
  value,
  children,
  alignRight,
}: {
  label: string
  value?: string
  children?: React.ReactNode
  alignRight?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {alignRight ? children : <span className="text-sm">{value ?? children ?? '-'}</span>}
    </div>
  )
})

function ResultSection({ result }: { result?: string | null }) {
  if (!result) return null
  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(result)
  } catch {
    return null
  }
  const entries = Object.entries(parsed).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  if (entries.length === 0) return null
  return (
    <>
      {entries.map(([key, value]) => {
        let label = key
        if (key === 'video_url') label = '视频链接'
        else if (key === 'publish_status') label = '发布状态'
        else if (key === 'verified') label = '发布验证'
        return (
          <div key={key}>
            <Separator className="my-2" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{label}</span>
              {key === 'verified' ? (
                <Badge variant={value === 'true' ? 'success' : 'warning'}>
                  {value === 'true' ? '已验证' : '未验证'}
                </Badge>
              ) : key === 'video_url' && value ? (
                <a
                  href={value}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline max-w-[200px] truncate block"
                >
                  {value}
                </a>
              ) : (
                <span className="text-sm max-w-[200px] truncate">{String(value)}</span>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

/**
 * Reads a single task from the TanStack Query cache. Subscribes directly
 * to the parent `['tasks']` query (instead of a synthetic by-id subquery),
 * so the drawer's render naturally fires whenever the polling list is
 * invalidated. No secondary query, no error-retry loop on initial mount.
 *
 * `seedTask` covers calendar / other surfaces whose id may not be in the
 * default list window (limit 100). Live list data always wins over seed.
 */
function useTaskFromCache(
  taskId: string | null,
  seedTask?: TaskItem | null,
): TaskItem | undefined {
  const { data: tasks } = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.getTasks()
      return res.data ?? []
    },
    // Mirror the parent query's freshness so the drawer doesn't refetch on
    // its own; it stays a pure subscriber to list updates.
    staleTime: 1_000,
  })
  if (!taskId) return undefined
  const fromList = tasks?.find((t: TaskItem) => t.task_id === taskId)
  if (fromList) return fromList
  if (seedTask && seedTask.task_id === taskId) return seedTask
  return undefined
}

// silence unused-import warning for the LiveBadge short-circuit shape above
void shortenId
