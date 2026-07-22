// ─────────────────────────────────────────────────────────────────────
// AdminAuditPage v3-table — TanStack Table v8.21.3 integration.
//
// v3-table delta vs v2:
//   • Inline <Table> replaced by <AdminTable>. 6 columns now
//     (selection + time + admin + target + action + detail). The
//     selection column is leftmost, non-sortable, non-hidable.
//   • Server pagination footer kept OUTSIDE <AdminTable> so the
//     "第 X / Y 页 · 共 N 条" + "上一页" / "下一页" + "清除筛选"
//     buttons / text assertions in the v2 test contract resolve
//     unchanged (the page owns pagination state + URL params).
//
// Locked test contract (AdminDashboard.test.tsx, Audit tests):
//   • 'admin@test.com' / 'user@test.com' cell text in admin/target
//     columns (preserved by AdminAvatar + adminId / targetId render).
//   • 'update_role' CodePill text + 'role: user → admin' detail
//     text — preserved by 1:1 cell renderers.
//   • '2026-07-05 10:30' time text — preserved (slice(0,16).
//     replace('T',' ') identical to v2).
//   • 'ID:5' fallback for null admin/target — preserved.
//   • Time range tabs (全部 / 今天 / 本周 / 本月 / 自定义) keep
//     role="tab" semantics (SegmentedTimeRange unchanged).
//   • '共 N 条' + '第 X / Y 页' + '上一页'/'下一页' — page-level
//     JSX unchanged.
//   • '清除筛选' button preserved.
//   • Empty state rendered via `emptyState` slot shows title
//     '暂无操作记录'.
//
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useMemo } from 'react'
import { useSearchParams } from '@/lib/router/useSearchParams'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { adminApi, type AuditLogItem } from './adminApi'
import { useTimeRangeFilter, TIME_RANGE_OPTIONS, type PresetRange } from './useTimeRangeFilter'
import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
import { AdminNavTabs } from './components/AdminNavTabs'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react'
import { AdminAvatar } from './components/AdminAvatar'
import { CodePill } from './components/CodePill'
import { SegmentedTimeRange } from './components/SegmentedTimeRange'
import { PremiumEmptyState } from './components/PremiumEmptyState'
import { AdminTable, AdminBulkActionBar } from './components/AdminTable'
import { relativeTimeFromNow } from '@/lib/relativeTime'

const TIME_RANGE_TABS = [
  ...TIME_RANGE_OPTIONS,
  { value: 'custom', label: '自定义' },
] as const

/**
 * Best-effort mapping from action code → tone. Module-local helper so
 * the Audit cell renderer's tone decision is one lookup call.
 */
function _toneForAction(action: string): 'info' | 'success' | 'warning' | 'error' {
  const lower = action.toLowerCase()
  if (lower.includes('delete') || lower.includes('revoke') || lower.includes('purge')) return 'error'
  if (lower.includes('fail') || lower.includes('error')) return 'error'
  if (lower.includes('login')) return 'info'
  if (lower.includes('grant') || lower.includes('promote') || lower.includes('upgrade')) return 'success'
  if (lower.includes('suspend') || lower.includes('warn') || lower.includes('restrict')) return 'warning'
  if (lower.includes('create') || lower.includes('register')) return 'success'
  if (lower.includes('update') || lower.includes('change') || lower.includes('assign')) return 'info'
  return 'info'
}

export default function AdminAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page') ?? '1', 10)
    return Number.isNaN(p) || p < 1 ? 1 : p
  }, [searchParams])

  const setPage = (next: number | ((prev: number) => number)) => {
    const resolved = typeof next === 'function' ? next(page) : next
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        params.set('page', String(resolved))
        return params
      },
      { replace: true },
    )
  }

  const queryClient = useQueryClient()

  const {
    timeRange,
    customStart,
    customEnd,
    updateTimeRangeAndPage,
    updateCustomStartAndPage,
    updateCustomEndAndPage,
    clearFilters,
  } = useTimeRangeFilter()

  useEffect(() => {
    let cancelled = false
    adminApi.acknowledgeAuditLogs()
      .then(() => {
        if (!cancelled) {
          queryClient.invalidateQueries({ queryKey: ['admin', 'audit', 'unacknowledged-count'] })
        }
      })
      .catch(() => {
        // Silently ignore — the badge will simply not reset on this visit.
      })
    return () => {
      cancelled = true
    }
  }, [queryClient])

  const filtersActive = timeRange !== 'all' || page !== 1

  const perPage = 50

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit', page, timeRange, customStart, customEnd],
    queryFn: () =>
      adminApi.getAuditLogs(
        page,
        perPage,
        timeRange,
        timeRange === 'custom' ? customStart : undefined,
        timeRange === 'custom' ? customEnd : undefined,
      ),
    staleTime: 30_000,
  })

  const auditData = data?.data
  const logs = auditData?.logs ?? []
  const total = auditData?.total ?? 0
  const totalPages = Math.ceil(total / perPage)

  // ── TanStack ColumnDef ──
  // Cell renderers are 1:1 with v2 inline-rendering so visible text
  // ('admin@test.com', 'update_role', 'role: user → admin', 'ID:5',
  // '—', etc.) keeps byte-identical DOM emissions.
  const columns = useMemo<ColumnDef<AuditLogItem>[]>(() => [
    {
      id: 'select',
      enableHiding: false,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllRowsSelected()
              ? true
              : table.getIsSomeRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={(v) => table.toggleAllRowsSelected(Boolean(v))}
          aria-label="全选"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
          aria-label={`选择日志 ${row.original.id}`}
        />
      ),
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: '时间',
      // Custom filterFn: lets the user type a string and we substring-
      // match the absolute formatted time (`YYYY-MM-DD HH:mm`). Default
      // includesString also works since accessor returns ISO; we keep
      // includesString (probe both forms would be wasteful).
      filterFn: 'includesString',
      cell: ({ row }) => {
        const log = row.original
        const absTime = log.created_at?.slice(0, 16).replace('T', ' ') ?? '—'
        const relTime = relativeTimeFromNow(log.created_at)
        return (
          <div className="flex flex-col leading-tight">
            <span className="font-mono tabular-nums text-foreground/80" title={absTime}>
              {absTime}
            </span>
            {relTime && (
              <span className="text-[11px] text-muted-foreground/70">{relTime}</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'admin',
      accessorFn: (log) => log.admin_email ?? `ID:${log.admin_user_id}`,
      header: '管理员',
      filterFn: 'includesString',
      cell: ({ row }) => {
        const log = row.original
        const adminId = log.admin_email ?? `ID:${log.admin_user_id}`
        return (
          <div className="flex items-center gap-2.5 min-w-0">
            <AdminAvatar identifier={log.admin_email ?? `id:${log.admin_user_id}`} size="sm" />
            <span className="truncate">{adminId}</span>
          </div>
        )
      },
    },
    {
      id: 'target',
      accessorFn: (log) => log.target_email ?? (log.target_user_id ? `ID:${log.target_user_id}` : '—'),
      header: '目标用户',
      filterFn: 'includesString',
      cell: ({ row }) => {
        const log = row.original
        const targetId =
          log.target_email ?? (log.target_user_id ? `ID:${log.target_user_id}` : '—')
        if (!log.target_email && !log.target_user_id) {
          return <span className="text-muted-foreground/60">—</span>
        }
        return (
          <div className="flex items-center gap-2.5 min-w-0">
            <AdminAvatar identifier={log.target_email ?? `id:${log.target_user_id}`} size="sm" />
            <span className="truncate">{targetId}</span>
          </div>
        )
      },
    },
    {
      id: 'action',
      accessorKey: 'action',
      header: '操作',
      filterFn: 'includesString',
      cell: ({ row }) => (
        <CodePill tone={_toneForAction(row.original.action)}>{row.original.action}</CodePill>
      ),
    },
    {
      id: 'detail',
      accessorFn: (log) => log.detail ?? '—',
      header: '详情',
      filterFn: 'includesString',
      cell: ({ row }) => {
        const detail = row.original.detail
        if (!detail) {
          return <span className="text-muted-foreground/60">—</span>
        }
        return (
          <span
            className="block truncate font-mono text-[11px] text-foreground/85 max-w-[280px]"
            title={detail}
          >
            {detail}
          </span>
        )
      },
    },
  ], [])

  return (
    <PageWrapper topNav={<AdminNavTabs />}>
      <PageHeader
          title="操作日志"
          description="管理员操作审计记录"
          icon={<FileText className="h-5 w-5 text-[var(--status-info-fg)]" />}
        />
        <Card className="border-border/60 bg-card/60 shadow-[0_1px_0_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
          <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <SegmentedTimeRange
                value={timeRange}
                onValueChange={(v) => updateTimeRangeAndPage(v as PresetRange, 1)}
                options={TIME_RANGE_TABS}
                ariaLabel="审计时间范围筛选"
              />
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={clearFilters}
                >
                  <X className="h-3 w-3" />
                  清除筛选
                </Button>
              )}
            </div>

            {timeRange === 'custom' && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="audit-start" className="text-xs text-muted-foreground">
                    开始日期
                  </Label>
                  <Input
                    id="audit-start"
                    type="date"
                    value={customStart}
                    onChange={(e) => updateCustomStartAndPage(e.target.value, 1)}
                    className="h-8 w-36 text-xs"
                  />
                </div>
                <span className="text-xs text-muted-foreground">—</span>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="audit-end" className="text-xs text-muted-foreground">
                    结束日期
                  </Label>
                  <Input
                    id="audit-end"
                    type="date"
                    value={customEnd}
                    onChange={(e) => updateCustomEndAndPage(e.target.value, 1)}
                    className="h-8 w-36 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-1 px-3 py-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <AdminTable
                data={logs}
                columns={columns}
                getRowId={(log) => String(log.id)}
                emptyState={
                  <PremiumEmptyState
                    tone="info"
                    eyebrow="EMPTY LOG"
                    icon={<FileText className="h-6 w-6" strokeWidth={1.5} />}
                    title="暂无操作记录"
                    description="管理员操作（如角色变更）会记录在这里"
                  />
                }
                bulkToolbar={({ selectedRows, clearSelection, exportRowsToCSV }) => (
                  <AdminBulkActionBar
                    onClearSelection={clearSelection}
                    onExportSelected={() =>
                      // Audit page: selected rows only. Single-page
                      // scope; v3-mini would add an "export all
                      // matching filter" toggle if needed.
                      exportRowsToCSV(selectedRows, `audit_${Date.now()}.csv`)
                    }
                  />
                )}
              />

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border/40 px-5 py-3 sm:px-6">
                  <div className="text-xs text-muted-foreground tabular-nums">
                    第 {page} / {totalPages} 页 · 共 {total} 条
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2.5 text-[11.5px]"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-3 w-3" />
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2.5 text-[11.5px]"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      下一页
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          </CardContent>
        </Card>
    </PageWrapper>
  )
}
