import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { StudioProject } from '@/api/studio'

// Module-level manifest pattern (AppShell / STATUS_META exemplar):
// `labelKey + labelFallback` keeps the manifest React-free so a
// future i18n audit can grep for hardcoded strings without
// importing the component. The `t(key, fallback)` call at render
// time is what surfaces the translated label, with the fallback
// keeping `tsc -b` clean even if the i18n bundle hasn't loaded.
const STATUS_LABEL_META: Record<
  StudioProject['status'],
  { labelKey: string; labelFallback: string }
> = {
  draft: { labelKey: 'studio.card.status_draft', labelFallback: '草稿' },
  generating: { labelKey: 'studio.card.status_generating', labelFallback: '生成中' },
  ready: { labelKey: 'studio.card.status_ready', labelFallback: '已完成' },
  exported: { labelKey: 'studio.card.status_exported', labelFallback: '已导出' },
}

const STATUS_TONE: Record<StudioProject['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  generating: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  exported: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
}

interface ProjectCardProps {
  project: StudioProject
  onOpen: (id: number) => void
  onDelete: (id: number) => void
}

/**
 * Card surface for a single project in the project grid.
 *
 * The original ``openspec/changes/script-studio/proposal.md``
 * described this as ``ProjectCard``; the earlier draft used
 * ``TableOfContents`` but the OpenSpec review settled on
 * ``ProjectCard`` (matches design.md §6 / tasks.md §1.4.3).
 */
export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps) {
  const { t } = useTranslation()
  return (
    <Card
      className="group flex flex-col gap-3 cursor-pointer card-refined transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
      onClick={() => onOpen(project.id)}
      data-testid="studio-project-card"
    >
      <CardContent className="pt-5 px-5 flex-1 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground line-clamp-2">
            {project.title}
          </h3>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
              STATUS_TONE[project.status] ?? STATUS_TONE.draft,
            )}
          >
            {(() => {
              const meta =
                STATUS_LABEL_META[project.status] ?? STATUS_LABEL_META.draft
              return t(meta.labelKey, meta.labelFallback)
            })()}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground line-clamp-3 leading-relaxed">
          {project.synopsis}
        </p>
        {project.style && (
          <p className="text-[11px] text-muted-foreground/70 line-clamp-1 font-mono">
            {project.style}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-border/40 bg-transparent pt-3 text-[11px] text-muted-foreground/70">
        <span className="font-mono tabular-nums">
          {new Date(project.updated_at).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
          aria-label={t('studio.card.delete_aria', '删除项目 {{title}}', { title: project.title })}
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(t('studio.card.delete_confirm', '确定删除项目「{{title}}」吗？此操作不可撤销。', { title: project.title }))) {
              onDelete(project.id)
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardFooter>
    </Card>
  )
}

export function ProjectCardSkeleton() {
  return (
    <Card className="flex flex-col gap-3 card-refined">
      <CardContent className="pt-5 px-5 flex-1 flex flex-col gap-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </CardContent>
      <CardFooter className="border-t border-border/40 bg-transparent pt-3">
        <Skeleton className="h-3 w-20" />
      </CardFooter>
    </Card>
  )
}
