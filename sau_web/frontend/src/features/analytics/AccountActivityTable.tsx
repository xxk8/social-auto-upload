import { memo, useMemo, useState, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Pagination,
  Progress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/index'
import { PlatformIcon } from '@/components/ui/platform-icon'
import {
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneTextClass, toneBgClass, pctToTone } from '@/lib/tone'
import { relativeTimeFromNow } from '@/lib/relativeTime'
import { PLATFORMS } from '@/api/client'
import type { AccountActivity } from '@/hooks/useAnalytics'

/**
 * shadcn Card + Table + Badge + Progress + Empty + Input + Button
 * @see https://ui.shadcn.com/docs/components/table
 * @see https://ui.shadcn.com/docs/components/card
 */

type SortKey =
  | 'account'
  | 'platform'
  | 'total'
  | 'success'
  | 'failed'
  | 'pending'
  | 'success_rate'
  | 'last_active'
type SortDir = 'asc' | 'desc'

interface AccountActivityTableProps {
  data: AccountActivity[]
  loading: boolean
}

function rateAsPct(rate: number): number {
  if (!Number.isFinite(rate)) return 0
  return rate <= 1 && rate > 0 ? rate * 100 : rate
}

export const AccountActivityTable = memo(function AccountActivityTable({
  data,
  loading,
}: AccountActivityTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const platformLabel = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])),
    [],
  )

  const enriched = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        pending: Math.max(0, row.total - row.success - row.failed),
        rate_pct: rateAsPct(row.success_rate),
      })),
    [data],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return enriched
    return enriched.filter((row) => {
      const label = platformLabel[row.platform] ?? row.platform
      return (
        row.account.toLowerCase().includes(q) ||
        row.platform.toLowerCase().includes(q) ||
        label.toLowerCase().includes(q)
      )
    })
  }, [enriched, query, platformLabel])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      const key = sortKey === 'success_rate' ? 'rate_pct' : sortKey
      const av = a[key as keyof typeof a]
      const bv = b[key as keyof typeof b]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((p) => (p === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageItems = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  )

  const summary = useMemo(() => {
    const total = enriched.reduce((s, r) => s + r.total, 0)
    const success = enriched.reduce((s, r) => s + r.success, 0)
    const failed = enriched.reduce((s, r) => s + r.failed, 0)
    const pending = enriched.reduce((s, r) => s + r.pending, 0)
    return {
      total,
      success,
      failed,
      pending,
      accounts: enriched.length,
      avgRate: total > 0 ? (success / total) * 100 : 0,
    }
  }, [enriched])

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="size-3 opacity-40" />
    return sortDir === 'asc' ? (
      <ArrowUp className="size-3" />
    ) : (
      <ArrowDown className="size-3" />
    )
  }

  const SortBtn = ({
    column,
    children,
    className,
  }: {
    column: SortKey
    children: ReactNode
    className?: string
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('-ml-2 h-8 gap-1 px-2 text-xs font-medium', className)}
      onClick={() => handleSort(column)}
    >
      {children}
      <SortIcon column={column} />
    </Button>
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>账号活跃度</CardTitle>
            <CardDescription>
              {loading
                ? '加载中…'
                : `共 ${summary.accounts} 个账号 · 任务 ${summary.total} · 均成功率 ${summary.avgRate.toFixed(1)}%`}
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="搜索账号 / 平台"
              className="h-8 pl-8"
            />
          </div>
        </div>
        {!loading && enriched.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="info" className="font-normal tabular-nums">
              任务 {summary.total}
            </Badge>
            <Badge variant="success" className="font-normal tabular-nums">
              成功 {summary.success}
            </Badge>
            <Badge variant="error" className="font-normal tabular-nums">
              失败 {summary.failed}
            </Badge>
            {summary.pending > 0 ? (
              <Badge variant="warning" className="font-normal tabular-nums">
                进行中 {summary.pending}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <Empty className="min-h-[200px]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>{query ? '无匹配账号' : '暂无账号数据'}</EmptyTitle>
              <EmptyDescription>
                {query ? '试试其他关键词' : '在选定时间范围内没有账号活动'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>
                    <SortBtn column="account">账号</SortBtn>
                  </TableHead>
                  <TableHead>
                    <SortBtn column="platform">平台</SortBtn>
                  </TableHead>
                  <TableHead className="text-right">
                    <SortBtn column="total" className="ml-auto">
                      总数
                    </SortBtn>
                  </TableHead>
                  <TableHead className="text-right">
                    <SortBtn column="success" className="ml-auto">
                      成功
                    </SortBtn>
                  </TableHead>
                  <TableHead className="text-right">
                    <SortBtn column="failed" className="ml-auto">
                      失败
                    </SortBtn>
                  </TableHead>
                  <TableHead className="text-right">
                    <SortBtn column="pending" className="ml-auto">
                      进行中
                    </SortBtn>
                  </TableHead>
                  <TableHead className="min-w-[140px]">
                    <SortBtn column="success_rate">成功率</SortBtn>
                  </TableHead>
                  <TableHead>
                    <SortBtn column="last_active">最后活跃</SortBtn>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((row, idx) => {
                  const rank = (safePage - 1) * pageSize + idx + 1
                  const tone = row.total > 0 ? pctToTone(row.rate_pct) : null
                  const rel = relativeTimeFromNow(row.last_active) || '—'
                  return (
                    <TableRow key={`${row.platform}-${row.account}`}>
                      <TableCell className="text-center">
                        <Badge
                          variant={rank <= 3 ? 'default' : 'secondary'}
                          className="size-6 justify-center rounded-md p-0 text-[10px] tabular-nums"
                        >
                          {rank}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[160px] truncate">
                        {row.account || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={row.platform} className="size-4" />
                          <span className="text-sm">
                            {platformLabel[row.platform] ?? row.platform}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {row.total}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="success" className="font-normal tabular-nums">
                          {row.success}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="error" className="font-normal tabular-nums">
                          {row.failed}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.pending > 0 ? (
                          <Badge variant="warning" className="font-normal tabular-nums">
                            {row.pending}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1.5 min-w-[120px]">
                          <Badge
                            variant="secondary"
                            className={cn(
                              'font-semibold tabular-nums',
                              toneTextClass(tone),
                              tone && toneBgClass(tone),
                            )}
                          >
                            {row.rate_pct.toFixed(1)}%
                          </Badge>
                          <Progress value={row.rate_pct} className="h-1.5" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default text-xs text-muted-foreground whitespace-nowrap">
                              {rel}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{row.last_active || '无记录'}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {sorted.length > pageSize ? (
              <Pagination
                className="border-t"
                page={safePage}
                pageSize={pageSize}
                total={sorted.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s)
                  setPage(1)
                }}
              />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
})
