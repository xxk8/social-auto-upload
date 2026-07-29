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
  Pagination,
  Progress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/index'
import { CalendarDays, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneTextClass, pctToTone } from '@/lib/tone'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'
import { formatDay } from './format'

/** shadcn Card + Table + Badge + Progress + Empty + Button */

type SortKey = 'date' | 'total' | 'success' | 'failed' | 'rate'
type SortDir = 'asc' | 'desc'

interface DailyBreakdownTableProps {
  data: AnalyticsSummary['by_day']
  loading: boolean
}

export const DailyBreakdownTable = memo(function DailyBreakdownTable({
  data,
  loading,
}: DailyBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const rows = useMemo(() => {
    return data.map((d) => {
      const success = d.success ?? 0
      const failed = d.failed ?? 0
      const total = success + failed
      return {
        date: d.date,
        dateLabel: formatDay(d.date),
        success,
        failed,
        total,
        rate: total > 0 ? (success / total) * 100 : 0,
      }
    })
  }, [data])

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'date') return a.date.localeCompare(b.date) * dir
      return ((a[sortKey] as number) - (b[sortKey] as number)) * dir
    })
    return arr
  }, [rows, sortKey, sortDir])

  const maxTotal = useMemo(() => Math.max(...rows.map((r) => r.total), 1), [rows])

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
        <CardTitle>每日明细</CardTitle>
        <CardDescription>
          {loading
            ? '加载中…'
            : rows.length > 0
              ? `${rows.length} 天有任务记录 · 点击表头排序`
              : '暂无数据'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty className="min-h-[200px]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyTitle>暂无每日数据</EmptyTitle>
              <EmptyDescription>在选定时间范围内没有任务记录</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortBtn column="date">日期</SortBtn>
                  </TableHead>
                  <TableHead className="min-w-[140px]">量级</TableHead>
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
                  <TableHead>
                    <SortBtn column="rate">成功率</SortBtn>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((row) => {
                  const tone = row.total > 0 ? pctToTone(row.rate) : null
                  return (
                    <TableRow key={row.date}>
                      <TableCell>
                        <Badge variant="outline" className="font-normal tabular-nums">
                          {row.dateLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Progress
                          value={(row.total / maxTotal) * 100}
                          className="h-2 max-w-[160px]"
                        />
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums">
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
                      <TableCell>
                        {row.total > 0 ? (
                          <Badge
                            variant="secondary"
                            className={cn('font-semibold tabular-nums', toneTextClass(tone))}
                          >
                            {row.rate.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
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
