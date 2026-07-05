import { memo, useEffect, useRef } from 'react'
import { Badge } from '@/Components/ui/badge'
import { Button } from '@/Components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/Components/ui/tooltip'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTemplatesStore, type PublishTemplate } from '@/stores/useTemplatesStore'

/**
 * §9.3 — TemplateChipRow: horizontal scrollable chip list of saved publish
 * templates. Clicking a chip applies its snapshot to the form. The trailing
 * "+" button opens SaveTemplateDialog (handled by the parent).
 *
 * The row fetches templates from `useTemplatesStore` on mount so it's
 * self-contained — the parent only needs to pass an `onApply` callback
 * that writes the template's snapshot into the form's local state.
 *
 * Each chip also has a hover-delete (×) button that calls
 * `useTemplatesStore.remove(id)`.
 */

interface TemplateChipRowProps {
  /** Called when the user clicks a template chip. Receives the template
   *  snapshot so the form can apply it to its local state. */
  onApply: (snapshot: Record<string, unknown>) => void
  /** Called when the "+" button is clicked — parent opens SaveTemplateDialog. */
  onSaveRequest: () => void
  /** Current form mode ('video' | 'note') — filters templates by mode. */
  mode: 'video' | 'note'
}

export const TemplateChipRow = memo(function TemplateChipRow({
  onApply,
  onSaveRequest,
  mode,
}: TemplateChipRowProps) {
  const { templates, fetchAll, remove, loading } = useTemplatesStore()
  const fetchedRef = useRef(false)

  // Fetch templates once on mount. The store's `fetchAll` is idempotent
  // and updates from cache first, so repeated mounts are cheap.
  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true
      void fetchAll()
    }
  }, [fetchAll])

  // Filter templates by the current mode (video/note).
  const modeTemplates = templates.filter((t) => t.mode === mode)

  if (modeTemplates.length === 0 && loading) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[11px] text-muted-foreground/50">模板加载中…</span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={onSaveRequest}
        >
          <Plus className="h-3 w-3" />
          存为模板
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-1.5 scrollbar-hide">
      {modeTemplates.length === 0 ? (
        <span className="text-[11px] text-muted-foreground/50 whitespace-nowrap">
          暂无模板
        </span>
      ) : (
        modeTemplates.map((tpl) => (
          <TemplateChip
            key={tpl.id}
            template={tpl}
            onApply={() => onApply(tpl.snapshot)}
            onRemove={() => void remove(tpl.id)}
          />
        ))
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 gap-1 px-2 text-[11px]"
        onClick={onSaveRequest}
      >
        <Plus className="h-3 w-3" />
        存为模板
      </Button>
    </div>
  )
})

/** Individual template chip with hover-delete. */
const TemplateChip = memo(function TemplateChip({
  template,
  onApply,
  onRemove,
}: {
  template: PublishTemplate
  onApply: () => void
  onRemove: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group/chip relative shrink-0">
          <Badge
            variant="secondary"
            className={cn(
              'h-6 cursor-pointer gap-1 px-2.5 text-[11px] font-normal transition-colors',
              'hover:border-primary hover:bg-primary/5',
            )}
            onClick={onApply}
          >
            {template.name}
          </Badge>
          <button
            type="button"
            className={cn(
              'absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full',
              'bg-destructive text-destructive-foreground opacity-0 transition-opacity',
              'group-hover/chip:opacity-100 hover:bg-destructive/80',
            )}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`删除模板「${template.name}」`}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        点击应用模板
      </TooltipContent>
    </Tooltip>
  )
})
