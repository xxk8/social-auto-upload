import { memo, useMemo, useState } from 'react'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/index'
import { EmptyState } from '@/components/ui/empty-state'
import {PlatformIcon} from '@/components/ui/platform-icon';import { Users, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneTextClass, pctToTone } from '@/lib/tone'
import { formatDateTime } from '@/lib/features'
import { PLATFORMS } from '@/api/client'
import type { AccountActivity } from '@/hooks/useAnalytics'

/**
 * §12.6 — AccountActivityTable: sortable table showing per-account
 * stats (total, success, failed, success rate, last active). Success
 * rate cells get tone-based coloring (green ≥100%, amber ≥50%, red <50%).
 */

type SortKey = 'account' | 'platform' | 'total' | 'success' | 'failed' | 'success_rate' | 'last_active'
type SortDir = 'asc' | 'desc'

interface AccountActivityTableProps {
  data: AccountActivity[]
  loading: boolean
}

export const AccountActivityTable = memo(function AccountActivityTable({
  data,
  loading,
}: AccountActivityTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const platformLabel = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])),
    [],
  )

  const sorted = useMemo(() => {
    const arr = [...data]
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return arr
  }, [data, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // ── pagination ──
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageItems = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  )

  const renderSortIcon = (column: SortKey) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 opacity-40" />
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-primary" />
    ) : (
      <ArrowDown className="h-3 w-3 text-primary" />
    )
  }

  const hasData = sorted.length > 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" />
          账号活跃度
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded" />
            ))}
          </div>
        ) : !hasData ? (
          <EmptyState
            className="h-[200px]"
            title="暂无账号数据"
            description="在选定时间范围内没有账号活动"
          />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort('account')}
                    >
                      账号 {renderSortIcon('account')}
                    </button>
                  </TableHead>
                  <TableHead className="w-[90px]">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort('platform')}
                    >
                      平台 {renderSortIcon('platform')}
                    </button>
                  </TableHead>
                  <TableHead className="w-[60px] text-right">
                    <button
                      type="button"
                      className="flex items-center justify-end gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort('total')}
                    >
                      总数 {renderSortIcon('total')}
                    </button>
                  </TableHead>
                  <TableHead className="w-[60px] text-right">
                    <button
                      type="button"
                      className="flex items-center justify-end gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort('success')}
                    >
                      成功 {renderSortIcon('success')}
                    </button>
                  </TableHead>
                  <TableHead className="w-[60px] text-right">
                    <button
                      type="button"
                      className="flex items-center justify-end gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort('failed')}
                    >
                      失败 {renderSortIcon('failed')}
                    </button>
                  </TableHead>
                  <TableHead className="w-[80px] text-right">
                    <button
                      type="button"
                      className="flex items-center justify-end gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort('success_rate')}
                    >
                      成功率 {renderSortIcon('success_rate')}
                    </button>
                  </TableHead>
                  <TableHead className="w-[150px]">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort('last_active')}
                    >
                      最后活跃 {renderSortIcon('last_active')}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((row) => {
                  const tone = row.total > 0 ? pctToTone(row.success_rate * 100) : null
                  return (
                    <TableRow key={`${row.platform}-${row.account}`}>
                      <TableCell className="text-xs font-medium truncate max-w-[140px]">
                        {row.account}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <PlatformIcon platform={row.platform} className="h-3.5 w-3.5" />
                          <span className="text-xs">
                            {platformLabel[row.platform] ?? row.platform}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{row.total}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-emerald-500">
                        {row.success}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-destructive">
                        {row.failed}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="secondary"
                          className={cn('text-[11px] font-medium tabular-nums', toneTextClass(tone))}
                        >
                          {(row.success_rate * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(row.last_active)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {sorted.length > pageSize && (
              <Pagination
                className="border-t-0"
                page={safePage}
                pageSize={pageSize}
                total={sorted.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s)
                  setPage(1)
                }}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
})
