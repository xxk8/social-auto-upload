import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CheckCircle,
  CheckSquare,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Square,
  Trash,
  X,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneDotStyle, toneTextClass, type Tone } from '@/lib/tone'
import type { LucideIcon } from 'lucide-react'
import { useAccountsDispatch, useAccountsState } from './AccountsProvider'

const VALIDITY_OPTIONS: ReadonlyArray<{
  value: 'all' | 'valid' | 'invalid'
  label: string
  icon: LucideIcon | null
  tone: Tone | null
}> = [
  { value: 'all', label: '全部', icon: null, tone: null },
  { value: 'valid', label: '有效', icon: CheckCircle, tone: 'success' },
  { value: 'invalid', label: '失效', icon: XCircle, tone: 'error' },
] as const

/**
 * Slim filter bar: search + validity + batch + view toggle.
 * Local debounced search keeps dispatch identity stable while typing.
 */
function GroupToolbarImpl() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()

  const [localSearch, setLocalSearch] = useState(state.searchQuery)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const handle = setTimeout(() => {
      if (localSearch !== state.searchQuery) {
        dispatch.setSearchQuery(localSearch)
      }
    }, 120)
    return () => clearTimeout(handle)
  }, [localSearch, state.searchQuery, dispatch])

  useEffect(() => {
    setLocalSearch(state.searchQuery)
  }, [state.searchQuery])

  const allSelected =
    state.selectedIds.size === state.filteredGroups.length &&
    state.filteredGroups.length > 0

  const renderValidityIcon = (opt: (typeof VALIDITY_OPTIONS)[number]) => {
    if (opt.icon) {
      const Icon = opt.icon
      return <Icon className={cn('mr-1 h-3 w-3', toneTextClass(opt.tone))} />
    }
    if (opt.tone) {
      return (
        <span
          className="mr-1.5 h-1.5 w-1.5 rounded-full"
          style={toneDotStyle(opt.tone)}
        />
      )
    }
    return null
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-[10px] p-1 sm:gap-2 sm:p-1.5',
        'border border-border/40 bg-muted/20',
        'shadow-[inset_0_1px_0_oklch(1_0_0_/_0.04)]',
      )}
    >
      {/* Search */}
      <div className="relative min-w-[140px] max-w-md flex-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/45" />
        <Input
          id="accounts-group-search"
          name="search"
          placeholder="搜索分组名称、平台..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className={cn(
            'h-8 border-border/35 bg-background/70 pl-8 pr-11 text-[12px] shadow-none',
            'placeholder:text-muted-foreground/45 focus-visible:border-primary/30 focus-visible:ring-primary/15',
            'sm:text-[13px]',
          )}
          autoComplete="off"
          data-search-input
        />
        {!localSearch && (
          <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
            <kbd className="kbd-hint opacity-70">/</kbd>
          </div>
        )}
        {localSearch && (
          <button
            type="button"
            onClick={() => {
              setLocalSearch('')
              dispatch.handleClearSearch()
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Validity filter */}
      <div className="flex items-center rounded-lg border border-border/40 bg-background/50 p-0.5 shadow-[inset_0_1px_0_oklch(1_0_0_/_0.03)]">
        {VALIDITY_OPTIONS.map((opt) => {
          const active = state.validityFilter === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => dispatch.setValidityFilter(opt.value)}
              className={cn(
                'flex h-7 items-center justify-center rounded-md px-2 text-[11px] font-medium transition-all duration-200 sm:px-2.5',
                active
                  ? 'bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0_/_0.06)] ring-1 ring-border/50'
                  : 'text-muted-foreground/55 hover:text-muted-foreground',
              )}
              aria-pressed={active}
              aria-label={`筛选：${opt.label}`}
            >
              {renderValidityIcon(opt)}
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Batch actions */}
      {state.selectedIds.size > 0 && (
        <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 sm:gap-2">
          <span className="rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">
            已选 {state.selectedIds.size}
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => dispatch.setBatchDeleteOpen(true)}
          >
            <Trash className="mr-1 h-3 w-3" />
            删除
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-muted-foreground"
            onClick={() => dispatch.setSelectedIds(new Set())}
          >
            取消
          </Button>
        </div>
      )}

      {/* Select-all + view toggle */}
      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <Button
          variant={allSelected ? 'secondary' : 'ghost'}
          size="sm"
          onClick={dispatch.handleSelectAll}
          className="h-7 px-2 text-[11px] text-muted-foreground"
        >
          {allSelected ? (
            <CheckSquare className="mr-1 h-3.5 w-3.5" />
          ) : (
            <Square className="mr-1 h-3.5 w-3.5" />
          )}
          全选
        </Button>

        <div className="flex items-center rounded-lg border border-border/40 bg-background/50 p-0.5 shadow-[inset_0_1px_0_oklch(1_0_0_/_0.03)]">
          <button
            type="button"
            onClick={() => dispatch.setViewMode('grid')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200',
              state.viewMode === 'grid'
                ? 'bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0_/_0.06)] ring-1 ring-border/50'
                : 'text-muted-foreground/45 hover:text-muted-foreground',
            )}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => dispatch.setViewMode('list')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200',
              state.viewMode === 'list'
                ? 'bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0_/_0.06)] ring-1 ring-border/50'
                : 'text-muted-foreground/45 hover:text-muted-foreground',
            )}
            aria-label="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>

        {state.isReorderInFlight && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-1.5 rounded-md border border-border/30 bg-background/60 px-2 py-1 animate-in fade-in slide-in-from-left-2 duration-200"
          >
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
              保存顺序中…
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export const GroupToolbar = memo(GroupToolbarImpl)
