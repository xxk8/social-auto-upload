import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select'
import { cn } from '@/lib/utils'

interface PaginationProps {
  /** 1-based current page. */
  page: number
  pageSize: number
  /** Total number of items across all pages. */
  total: number
  onPageChange: (page: number) => void
  /** When provided, renders a page-size <Select>. */
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  className?: string
}

/**
 * Windowed page-number list around the current page, with ellipses.
 * Always keeps the first + last page and the current page ±1.
 */
function buildPageWindow(current: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const pages = new Set<number>([1, totalPages, current])
  if (current - 1 >= 1) pages.add(current - 1)
  if (current + 1 <= totalPages) pages.add(current + 1)
  const sorted = [...pages].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const clampedPage = Math.min(Math.max(1, page), totalPages)
  const windowPages = buildPageWindow(clampedPage, totalPages)

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t border-border/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6',
        className,
      )}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
        <span>
          共 {total} 条 · 第 {clampedPage} / {totalPages} 页
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground/70">每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-7 w-[4.5rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((opt) => (
                  <SelectItem key={opt} value={String(opt)} className="text-xs">
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground/70">条</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2.5 text-[11.5px]"
          disabled={clampedPage <= 1}
          onClick={() => onPageChange(clampedPage - 1)}
        >
          <ChevronLeft className="h-3 w-3" />
          上一页
        </Button>
        {windowPages.map((p, i) =>
          p === '…' ? (
            <span
              key={`gap-${i}`}
              className="px-1 text-xs text-muted-foreground/60 select-none"
            >
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === clampedPage ? 'default' : 'outline'}
              size="sm"
              className="h-7 min-w-7 px-2 text-[11.5px] tabular-nums"
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          ),
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2.5 text-[11.5px]"
          disabled={clampedPage >= totalPages}
          onClick={() => onPageChange(clampedPage + 1)}
        >
          下一页
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
