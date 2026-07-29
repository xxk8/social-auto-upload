import { memo, useMemo } from 'react'
import {
  Badge,
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
import { AlertTriangle } from 'lucide-react'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'

/** shadcn Card + Table + Badge + Progress + Empty + Tooltip */

interface FailureReasonListProps {
  data: AnalyticsSummary['failure_reasons']
  loading: boolean
  limit?: number
}

export const FailureReasonList = memo(function FailureReasonList({
  data,
  loading,
  limit = 10,
}: FailureReasonListProps) {
  const rows = useMemo(() => data.slice(0, limit), [data, limit])
  const totalFails = useMemo(
    () => data.reduce((s, d) => s + d.count, 0),
    [data],
  )
  const maxCount = rows[0]?.count ?? 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>失败原因明细</CardTitle>
        <CardDescription>
          {loading
            ? '加载中…'
            : totalFails > 0
              ? `共 ${totalFails} 次失败 · 展示 Top ${rows.length}`
              : '无失败记录'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty className="min-h-[200px]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertTriangle />
              </EmptyMedia>
              <EmptyTitle>无失败记录</EmptyTitle>
              <EmptyDescription>在选定时间范围内没有失败任务</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead className="min-w-[120px]">占比</TableHead>
                  <TableHead className="w-24 text-right">次数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => {
                  const share =
                    totalFails > 0 ? (row.count / totalFails) * 100 : 0
                  return (
                    <TableRow key={`${row.reason}-${idx}`}>
                      <TableCell className="text-center">
                        <Badge
                          variant={idx < 3 ? 'error' : 'secondary'}
                          className="size-6 justify-center rounded-md p-0 text-[10px] tabular-nums"
                        >
                          {idx + 1}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="line-clamp-2 cursor-default text-sm">
                              {row.reason}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            {row.reason}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={row.count}
                            max={maxCount}
                            className="h-2 flex-1"
                          />
                          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="error" className="font-normal tabular-nums">
                          {row.count}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
