// ─────────────────────────────────────────────────────────────────────
// AdminTable — generic TanStack Table v8.21.3 wrapper that adds the
// "premium admin" cell on top of the canonical shadcn Table primitives:
//   • Sortable column labels with caret indicator (asc / desc two-state)
//   • Per-column filter input row beneath the header (h-7 inline Inputs
//     using the existing `includesString` filterFn)
//   • Column-visibility DropdownMenu at top-right (one checkbox-styled
//     row per column, default visible-all, optional `defaultHidden` per
//     column). The DropdownMenuItem's `onSelect` handler toggles
//     visibility directly — the inner "checkbox" is a static visual
//     indicator (not an interactive <Checkbox>) so the menu item
//     itself is the click target, working in both Radix pointer-down
//     flows and testing-library's user-event.click.
//   • Optional row-selection checkbox column (left edge) + sticky
//     bulk-action toolbar slot above the table rendered when ≥1 row
//     selected (so 0 selected produces 0 markup, no vertical shift)
//   • Client-side RFC-4180 CSV export for the selected (or all-visible)
//     rows; falls back to "all rows in the table" when no row is
//     selected, so the same utility handles both bulk and "export full
//     table" workflows.
//
// Test contract preservation (AdminDashboard.test.tsx, 60 tests):
//   • Header labels (邮箱 / 角色 / Tier / 注册时间 / 最后登录 / 操作 /
//     时间 / 管理员 / 目标用户 / 操作 / 详情) STILL render as text inside
//     <TableHead>, so the existing role="table" / getByText assertions
//     resolve unchanged.
//   • Cell renderers in `columns[]` carry the email / role / tier /
//     date / id-fallback / action+detail text. flexRender(cell.colDef
//     .cell, ctx) preserves whatever the caller returns — so as
//     long as the parent page passes JSX rendering the same text
//     ("alice@test.com", "管理员", "pro", "update_role", …), and
//     the role-pill / avatar / code-pill components it relied on
//     pre-v3, the existing tests pass byte-identically.
//   • Empty state is rendered by the PARENT (slot prop, NOT inside
//     AdminTable). The "还没有注册用户" / "暂无操作记录" titles stay
//     in admin page-level JSX so they're in the DOM regardless of
//     which table primitives wrap them.
//
// Module-local helpers (NOT exported): csvEscape / flattenRow /
// exportRowsToCSV. The component exports one React component
// (`AdminTable`) and one helper subcomponent (`AdminBulkActionBar`)
// so react-refresh/only-export-components stays happy.
// ─────────────────────────────────────────────────────────────────────

import { type ReactNode, useState } from 'react'
import { ChevronDown, Download, X } from 'lucide-react'
import {
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/Components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/Components/ui/dropdown-menu'
import { Input } from '@/Components/ui/input'
import { Button } from '@/Components/ui/button'
import { Pagination } from '@/Components/ui/pagination'
import { cn } from '@/lib/utils'

// ── Props ──────────────────────────────────────────────────────────────

interface AdminTableProps<TData> {
  /** Records to render. Empty array → render `emptyState` slot. */
  data: TData[]
  /** TanStack ColumnDef[T] — same shape the consumer would write
      inline today. We pass them through `useReactTable` untouched. */
  columns: ColumnDef<TData, unknown>[]
  /** Stable identifier per row (e.g. row.id). Required to make
      selection state survive data refetches. */
  getRowId: (row: TData, idx: number) => string
  /** Slot rendered when `data.length === 0`. Not rendered when
      the table has data but filters excluded all rows. Callers
      keep the "no user records" / "no log entries" wording here. */
  emptyState: ReactNode
  /** Optional initial column visibility (default all visible). */
  initialColumnVisibility?: Record<string, boolean>
  /** Hide the visibility menu (default false). Some surfaces don't
       need it — embedding only when the consumer wants toggling. */
  hideColumnsMenu?: boolean
  /** Render a single global search box at the top instead of the
       per-column filter input row. Filters every column that has a
       string accessor via `includesString`. Useful when one search
       field is enough (e.g. the users directory). */
  singleFilter?: boolean
  /** Placeholder for the single global search box. */
  filterPlaceholder?: string
  /** Enable client-side pagination (over the filtered+sorted row
       model) with a Pagination footer. Default page size 20. */
  pagination?: boolean
  /** Initial page size when `pagination` is enabled. */
  defaultPageSize?: number
  /** Slot rendered above the table when ≥ 1 row is selected. The
      AdminTable calls back with the selected-row count + a clear-
      selection handler so the caller can build its own toolbar. */
  bulkToolbar?: (api: {
    selectedCount: number
    /** Visible rows after sort + filter, in render order. */
    visibleRows: TData[]
    /** Selected rows in the SAME order as visibleRows. */
    selectedRows: TData[]
    clearSelection: () => void
    /** Export the given rows (or all visible if `rows=undefined`)
        to a CSV blob + URL.createObjectURL + programmatic anchor
        download. Headers + values are pulled from `columns[]`. */
    exportRowsToCSV: (rows?: TData[], filename?: string) => void
  }) => ReactNode
}

// ── CSV helpers (RFC 4180) ──────────────────────────────────────────────

/** Escape a single CSV cell value: wrap in quotes, escape internal
    quotes, preserve newlines (RFC 4180 says they are valid inside
    a quoted field). Numbers/booleans converted to strings. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'string' ? value : String(value)
  return '"' + str.replace(/"/g, '""') + '"'
}

/** Flatten a row through the column's `accessorKey` / `accessorFn`
    so cell values come out in the SAME order as columns. Falls back
    to the column id (or the header text if it's a string) for the
    CSV header label; if both are JSX we apply `String()` so we
    never crash. The `as` cast widens TanStack's discriminated-union
    ColumnDef to read the optional `accessorKey` / `accessorFn` from
    a single shape. */
function flattenRow<TData>(
  row: TData,
  columns: ColumnDef<TData, unknown>[],
): { header: string; value: unknown }[] {
  return columns.map((col) => {
    const c = col as ColumnDef<TData, unknown> & {
      accessorKey?: string
      accessorFn?: (row: TData, idx: number) => unknown
    }
    let value: unknown = ''
    if (typeof c.accessorKey === 'string') {
      value = (row as Record<string, unknown>)[c.accessorKey]
    } else if (typeof c.accessorFn === 'function') {
      value = c.accessorFn(row, 0)
    }
    const header =
      typeof c.header === 'string'
        ? c.header
        : typeof c.id === 'string'
          ? c.id
          : ''
    return { header, value }
  })
}

/** Compose a CSV blob string from rows + columns and trigger a
    download. No-op when there are 0 rows. */
function exportRowsToCSV<TData>(
  columns: ColumnDef<TData, unknown>[],
  rows: TData[],
  filename: string,
): void {
  if (rows.length === 0) return
  const headers = columns
    .map((c) => (typeof c.header === 'string' ? c.header : c.id ?? ''))
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    const flat = flattenRow(row, columns)
    lines.push(flat.map((c) => csvEscape(c.value)).join(','))
  }
  const csv = lines.join('\r\n') + '\r\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Component ──────────────────────────────────────────────────────────

function AdminTable<TData>({
  data,
  columns,
  getRowId,
  emptyState,
  initialColumnVisibility,
  hideColumnsMenu,
  singleFilter,
  filterPlaceholder,
  pagination,
  defaultPageSize,
  bulkToolbar,
}: AdminTableProps<TData>) {
  // State owned internally. Selection / sort / filter / visibility are
  // all child-of-table concerns; the parent page doesn't need to know.
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    initialColumnVisibility ?? {},
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [globalFilter, setGlobalFilter] = useState('')
  const [paginationState, setPaginationState] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize ?? 20,
  })

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, rowSelection, globalFilter, pagination: paginationState },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPaginationState,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: true,
    enableRowSelection: true,
    // Pass `getRowId` through unchanged. TanStack's `useReactTable`
    // reads the function on every render — a fresh closure per parent
    // render is fine because the function body is deterministic
    // (returns a stable string per row). Memoizing the wrapper
    // around it doesn't help (parent closures churn anyway) and
    // adds a misleading layer of indirection.
    getRowId,
  })

  const visibleRows = table.getFilteredRowModel().rows.map((r) => r.original)
  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((r) => r.original)
  const selectedCount = selectedRows.length
  const hasColumnsMenu =
    !hideColumnsMenu &&
    table.getAllLeafColumns().some((c) => c.getCanHide())

  // Render the empty-state slot when there's no data at all. TanStack's
  // filter model can reduce an N>0 dataset to 0 visible rows; that case
  // renders the table body with a "无匹配结果" row instead, which keeps
  // the column headers visible (so the user can see filters/columns).
  if (data.length === 0) {
    return <>{emptyState}</>
  }

  return (
    <>
      {/* Bulk-action toolbar — only mounts when ≥ 1 row is selected.
          Renders as a slim row above the table so the user gets
          immediate visual confirmation that the selection registered.
          Box-shadow + tone-tinted bg so it reads as "elevated state". */}
      {selectedCount > 0 && bulkToolbar ? (
        <div
          data-testid="admin-table-bulk-toolbar"
          className="flex items-center justify-between gap-3 border-b border-border/40 bg-[var(--status-info-bg)]/60 px-5 py-2 sm:px-6"
        >
          <div className="flex items-center gap-3 text-xs">
            <span
              data-testid="admin-table-bulk-toolbar-count"
              className="font-medium tabular-nums text-[var(--status-info-fg)]"
            >
              已选 {selectedCount} 项
            </span>
            <span className="text-muted-foreground/70">
              （共 {visibleRows.length} 条可见）
            </span>
          </div>
          {bulkToolbar({
            selectedCount,
            visibleRows,
            selectedRows,
            clearSelection: () => table.resetRowSelection(),
            exportRowsToCSV: (rows, filename) =>
              exportRowsToCSV(
                columns,
                rows ?? visibleRows,
                filename ?? `export_${Date.now()}.csv`,
              ),
          })}
        </div>
      ) : null}

      {/* Top toolbar — single global search (when singleFilter) +
           columns-visibility dropdown. Both sit on one row; the search
           is left-aligned, the menu right-aligned. */}
      <div
        className={cn(
          'flex items-center gap-2 border-b border-border/40 px-5 py-2.5 sm:px-6',
          hasColumnsMenu || singleFilter ? 'justify-between' : 'justify-end',
        )}
      >
        {singleFilter ? (
          <Input
            data-testid="admin-table-filter"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={filterPlaceholder ?? '搜索…'}
            className="h-7 max-w-[16rem] text-xs"
          />
        ) : null}

        {hasColumnsMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11.5px]"
                data-testid="admin-table-columns-toggle"
              >
                <ChevronDown className="h-3 w-3" />
                列设置
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              <div className="px-2 py-1.5 text-[10.5px] font-medium tracking-[0.14em] text-muted-foreground/70 uppercase">
                显示的列
              </div>
              {table.getAllLeafColumns().map((col) => {
                if (!col.getCanHide()) return null
                const isVisible = col.getIsVisible()
                return (
                  <DropdownMenuItem
                    key={col.id}
                    onSelect={(e) => {
                      // Keep the menu open across multiple toggles —
                      // users should be able to flip several columns
                      // in one open.
                      e.preventDefault()
                      col.toggleVisibility(!isVisible)
                    }}
                    className="gap-2"
                    data-testid={`admin-table-columns-toggle-${col.id}`}
                  >
                    {/* Static visual checkbox — NOT a real <Checkbox>
                         primitive, so the menu item itself is the
                         single click target. user-event.click hits
                         this row → onSelect fires → toggleVisibility. */}
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border text-[10px] font-bold leading-none',
                        isVisible
                          ? 'border-foreground/55 bg-foreground text-background'
                          : 'border-foreground/25 bg-transparent text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    <span className="text-xs">
                      {typeof col.columnDef.header === 'string'
                        ? col.columnDef.header
                        : col.id}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sortDir = header.column.getIsSorted() // false | 'asc' | 'desc'
                const flexHeader =
                  typeof header.column.columnDef.header === 'string'
                    ? header.column.columnDef.header
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      canSort && 'cursor-pointer select-none',
                      header.id === 'select' && 'w-9',
                    )}
                    onClick={
                      canSort ? header.column.getToggleSortingHandler() : undefined
                    }
                    data-testid={`admin-table-header-${header.column.id}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{flexHeader}</span>
                      {canSort ? (
                        <SortIndicator direction={sortDir} />
                      ) : null}
                    </div>
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
          {/* Per-column filter input row — second <tr> beneath the
               label row so the existing getByText('邮箱') / '角色' /
               'Tier' assertions stay anchored to row 1. Row 2 carries
               the inputs only for columns where canFilter === true
               (TanStack enables it via ColumnDef.filterFn). Skipped
               when `singleFilter` is set — a single top-level search
               replaces these inputs. */}
          {!singleFilter && (
          <TableRow className="border-b border-border/40 hover:bg-transparent">
            {table.getHeaderGroups()[0]?.headers.map((header) => {
              const canFilter = header.column.getCanFilter()
              if (!canFilter) {
                return <TableHead key={header.id} className="h-8 px-2" />
              }
              const value = (header.column.getFilterValue() as string) ?? ''
              return (
                <TableHead key={header.id} className="h-8 px-2">
                  <Input
                    data-testid={`admin-table-filter-${header.column.id}`}
                    value={value}
                    onChange={(e) => header.column.setFilterValue(e.target.value)}
                    placeholder="筛选…"
                    className="h-7 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableHead>
              )
            })}
          </TableRow>
          )}
        </TableHeader>

        <TableBody>
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                data-testid={`admin-table-row-${row.id}`}
                onClick={(e) => {
                  // Selection mode: clicking anywhere on the row
                  // CHECKs the row's checkbox AND marks the row. We
                  // only mark; the checkbox is the canonical UI element
                  // (clicking the avatar / cell text should not steal
                  // focus from in-cell dropdowns / alerts). The action
                  // column's DropdownMenu / AlertDialog already stop-
                  // propagation via Radix portal — so a click on those
                  // bubbles correctly without toggling the row.
                  if ((e.target as HTMLElement).closest('button, [role="button"], [role="menuitem"], [role="alertdialog"], a, input')) {
                    return
                  }
                  row.toggleSelected(!row.getIsSelected())
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-20 text-center text-xs text-muted-foreground/70"
              >
                当前筛选无匹配结果
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination footer — only when the caller opted in AND there
           are more rows than one page. Total is derived from the
           filtered+sorted row model so it stays correct under the
           single global search filter. */}
      {pagination && table.getFilteredRowModel().rows.length > paginationState.pageSize ? (
        <Pagination
          page={paginationState.pageIndex + 1}
          pageSize={paginationState.pageSize}
          total={table.getFilteredRowModel().rows.length}
          onPageChange={(p) => table.setPageIndex(p - 1)}
          onPageSizeChange={(s) => {
            table.setPageSize(s)
            table.setPageIndex(0)
          }}
        />
      ) : null}
    </>
  )

  // ------------------------------------------------------------------
  // Inline SortIndicator component (function declaration, hoisted
  // within the enclosing function). Keeps fast-refresh compliance
  // (no closures over render-local state) and avoids polluting the
  // module namespace with a one-off helper.

  function SortIndicator({ direction }: { direction: false | 'asc' | 'desc' }) {
    if (direction === false) {
      return (
        <span
          aria-hidden
          className="inline-flex h-3 w-3 items-center justify-center text-muted-foreground/40"
        >
          {/* dim diamond for sortable-unsorted */}
          ◇
        </span>
      )
    }
    if (direction === 'asc') {
      return (
        <span
          aria-hidden
          className="inline-flex h-3 w-3 items-center justify-center text-foreground"
        >
          ↑
        </span>
      )
    }
    return (
      <span
        aria-hidden
        className="inline-flex h-3 w-3 items-center justify-center text-foreground"
      >
        ↓
      </span>
    )
  }
}

// ── Standard bulk-action toolbar factory (drop-in for pages that just
//    want "导出 CSV + 取消选择" without customising styling). Pages can
//    ignore it and write their own `bulkToolbar` prop instead. ────────

interface AdminBulkBarProps {
  onClearSelection: () => void
  onExportSelected: () => void
}

function AdminBulkActionBar({
  onClearSelection,
  onExportSelected,
}: AdminBulkBarProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-[11.5px]"
        onClick={onExportSelected}
        data-testid="admin-table-bulk-export"
      >
        <Download className="h-3 w-3" />
        导出 CSV
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
        onClick={onClearSelection}
        data-testid="admin-table-bulk-clear"
      >
        <X className="h-3 w-3" />
        取消选择
      </Button>
    </div>
  )
}

export { AdminTable, AdminBulkActionBar }
