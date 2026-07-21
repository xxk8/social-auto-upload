import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/Components/ui/input'
import { StatusTabs, type StatusTabOption } from '@/features/tasks/StatusTabs'
import type { StudioProject } from '@/api/studio'

/** Status filter value — `'all'` plus the four project statuses. */
export type StudioStatusFilter = 'all' | StudioProject['status']

/** Sort key for the project grid (all client-side over the fetched list). */
export type StudioSort = 'updated' | 'created' | 'title'

interface StudioToolbarProps {
  query: string
  onQueryChange: (v: string) => void
  status: StudioStatusFilter
  onStatusChange: (v: StudioStatusFilter) => void
  sort: StudioSort
  onSortChange: (v: StudioSort) => void
  /** Per-status counts (over the full list, pre-search) for the tab badges. */
  counts: Record<StudioStatusFilter, number>
}

// Tone mapping mirrors ProjectCard's STATUS_TONE intent so the filter
// chips read as the same visual language as the card badges.
const STATUS_TABS: { value: StudioStatusFilter; labelKey: string; fallback: string; variant?: string }[] = [
  { value: 'all', labelKey: 'studio.toolbar.filter_all', fallback: '全部' },
  { value: 'draft', labelKey: 'studio.card.status_draft', fallback: '草稿' },
  { value: 'generating', labelKey: 'studio.card.status_generating', fallback: '生成中', variant: 'warning' },
  { value: 'ready', labelKey: 'studio.card.status_ready', fallback: '已完成', variant: 'success' },
  { value: 'exported', labelKey: 'studio.card.status_exported', fallback: '已导出', variant: 'info' },
]

/**
 * Search + status-filter + sort row above the project grid.
 *
 * All three controls are pure UI: filtering and sorting happen
 * client-side in StudioPage over the TanStack-Query-cached list, so
 * this component stays network-free and testable in isolation.
 */
export function StudioToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  counts,
}: StudioToolbarProps) {
  const { t } = useTranslation()

  const statusOptions: StatusTabOption[] = STATUS_TABS.map((tab) => ({
    value: tab.value,
    label: t(tab.labelKey, tab.fallback),
    count: counts[tab.value],
    variant: tab.variant,
  }))

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="studio-toolbar"
    >
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('studio.toolbar.search_placeholder', '搜索标题或灵感…')}
          className="h-9 pl-8 pr-8 text-[13px]"
          data-testid="studio-toolbar-search"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('common.clear', '清除')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <StatusTabs
        options={statusOptions}
        value={status}
        onChange={(v) => onStatusChange(v as StudioStatusFilter)}
      />

      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as StudioSort)}
        aria-label={t('studio.toolbar.sort_label', '排序方式')}
        className="h-9 rounded-md border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
        data-testid="studio-toolbar-sort"
      >
        <option value="updated">{t('studio.toolbar.sort_updated', '最近更新')}</option>
        <option value="created">{t('studio.toolbar.sort_created', '最近创建')}</option>
        <option value="title">{t('studio.toolbar.sort_title', '标题 A→Z')}</option>
      </select>
    </div>
  )
}
