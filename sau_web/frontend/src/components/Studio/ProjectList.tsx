import { Clapperboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ProjectCard, ProjectCardSkeleton } from './ProjectCard'
import type { StudioProject } from '@/api/studio'

interface ProjectListProps {
  projects: StudioProject[]
  isLoading: boolean
  onOpen: (id: number) => void
  onDelete: (id: number) => void
}

/**
 * Responsive grid of ``ProjectCard`` tiles.
 *
 * Phase 1 rows are fetched via TanStack Query in StudioPage; this
 * component is presentation-only and stays free of network
 * concerns. Empty-state and loading-skeleton handling lives here
 * (rather than in the page) so the empty card stays a single
 * source of truth for the "no projects yet" branch that the
 * tasks.md §1.6.1 verification step asserts.
 */
export function ProjectList({
  projects,
  isLoading,
  onOpen,
  onDelete,
}: ProjectListProps) {
  const { t } = useTranslation()
  if (isLoading) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        data-testid="studio-project-list-loading"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-muted/30 px-6 py-16 text-center"
        data-testid="studio-project-list-empty"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 text-primary ring-1 ring-primary/15 shadow-sm">
          <Clapperboard className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-medium text-foreground">{t('studio.list.empty_title', '还没有项目')}</h3>
          <p className="text-[13px] text-muted-foreground max-w-sm leading-relaxed">
            {t('studio.list.empty_description', '创建第一个剧本项目,围绕一句话灵感搭建四幕结构,把生成分镜的时间从「想」变成「跑」。')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      data-testid="studio-project-list"
    >
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} onOpen={onOpen} onDelete={onDelete} />
      ))}
    </div>
  )
}
