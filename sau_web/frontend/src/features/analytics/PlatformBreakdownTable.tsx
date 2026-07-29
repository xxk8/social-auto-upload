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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/index'
import { PlatformIcon } from '@/components/ui/platform-icon'
import { Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneTextClass, toneBgClass, pctToTone } from '@/lib/tone'
import { PLATFORMS } from '@/api/client'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'

/** shadcn Card + Table + Badge + Progress + Empty */

interface PlatformBreakdownTableProps {
  data: AnalyticsSummary['by_platform']
  loading: boolean
}

export const PlatformBreakdownTable = memo(function PlatformBreakdownTable({
  data,
  loading,
}: PlatformBreakdownTableProps) {
  const platformLabel = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])),
    [],
  )

  const rows = useMemo(() => {
    return Object.entries(data)
      .map(([platform, stats]) => {
        const success = stats.success ?? 0
        const failed = stats.failed ?? 0
        const total = success + failed
        return {
          platform,
          success,
          failed,
          total,
          rate: total > 0 ? (success / total) * 100 : 0,
        }
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [data])

  const totals = useMemo(() => {
    const success = rows.reduce((s, r) => s + r.success, 0)
    const failed = rows.reduce((s, r) => s + r.failed, 0)
    const total = success + failed
    return {
      success,
      failed,
      total,
      rate: total > 0 ? (success / total) * 100 : 0,
    }
  }, [rows])

  return (
    <Card>
      <CardHeader>
        <CardTitle>平台明细</CardTitle>
        <CardDescription>
          {loading
            ? '加载中…'
            : rows.length > 0
              ? `${rows.length} 个平台 · 合计 ${totals.total} 次任务`
              : '暂无数据'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty className="min-h-[200px]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Layers />
              </EmptyMedia>
              <EmptyTitle>暂无平台数据</EmptyTitle>
              <EmptyDescription>在选定时间范围内没有任务记录</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>平台</TableHead>
                  <TableHead className="min-w-[120px]">占比</TableHead>
                  <TableHead className="text-right">总数</TableHead>
                  <TableHead className="text-right">成功</TableHead>
                  <TableHead className="text-right">失败</TableHead>
                  <TableHead className="min-w-[120px]">成功率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => {
                  const tone = pctToTone(row.rate)
                  const share =
                    totals.total > 0 ? (row.total / totals.total) * 100 : 0
                  return (
                    <TableRow key={row.platform}>
                      <TableCell className="text-center">
                        <Badge
                          variant={idx < 3 ? 'default' : 'secondary'}
                          className="size-6 justify-center rounded-md p-0 text-[10px] tabular-nums"
                        >
                          {idx + 1}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={row.platform} className="size-4" />
                          <div>
                            <p className="text-sm font-medium">
                              {platformLabel[row.platform] ?? row.platform}
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {share.toFixed(1)}% 流量
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={share} className="h-2 flex-1" />
                          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                            {share.toFixed(0)}%
                          </span>
                        </div>
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
                        <div className="space-y-1.5 min-w-[100px]">
                          <Badge
                            variant="secondary"
                            className={cn(
                              'font-semibold tabular-nums',
                              toneTextClass(tone),
                              toneBgClass(tone),
                            )}
                          >
                            {row.rate.toFixed(1)}%
                          </Badge>
                          <Progress value={row.rate} className="h-1.5" />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-medium">
                    合计
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {totals.total}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="success" className="font-normal tabular-nums">
                      {totals.success}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="error" className="font-normal tabular-nums">
                      {totals.failed}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'font-semibold tabular-nums',
                        toneTextClass(pctToTone(totals.rate)),
                      )}
                    >
                      {totals.rate.toFixed(1)}%
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
