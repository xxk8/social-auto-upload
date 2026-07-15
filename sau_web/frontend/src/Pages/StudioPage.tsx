import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Clapperboard } from 'lucide-react'
import { Button } from '@/Components/ui/button'
import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
import { ProjectList } from '@/Components/Studio/ProjectList'
import {
  ProjectCreateDialog,
  type ProjectCreateInput,
} from '@/Components/Studio/ProjectCreateDialog'
import { studioApi } from '@/api/studio'
import { useStudioStore } from '@/stores/useStudioStore'
import { ROUTES } from '@/routes'

const QUERY_KEY = ['studio-projects'] as const

/**
 * Studio (Script Studio) page — Phase 1 surface.
 *
 * Layout (top-to-bottom):
 *   1. Page header with title + 「新建剧本题材」 action button
 *   2. List area (loading / empty / grid of cards)
 *   3. Create dialog (state-controlled)
 *
 * Project list is fetched via TanStack Query; the project's
 * ``useStudioStore`` is updated as a side effect so the command
 * palette (planned for v0.4+) gets a synchronous snapshot
 * without rehydrating from React Query on every keystroke.
 *
 * No data is loaded beyond the project list in Phase 1 — clicking
 * a card will route to ``/dashboard/studio/{id}`` once the Phase 2
 * detail route lands (falls back to ``alert`` so the empty route
 * surfaces loudly until then).
 */
export default function StudioPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { t } = useTranslation()
  const setProjects = useStudioStore((s) => s.setProjects)

  const [createOpen, setCreateOpen] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: studioApi.listProjects,
  })

  // Mirror the fetched list into the store so command palette /
  // sidebar counts (Phase 2) read from a synchronous source.
  useEffect(() => {
    if (data?.success && Array.isArray(data.data)) {
      setProjects(data.data)
    }
  }, [data, setProjects])

  const projects = data?.success && Array.isArray(data.data) ? data.data : []

  // ──────────────────────────────────────────────────────────────────
  // round-OPT-list-realtime-v1 — file-wide rule for ALL useMutation on
  // this page:
  //
  //   `api/studio.ts::*` helpers already do `.then((r) => r.data)` on the
  //   axios response, so they return the **envelope**
  //   `{ success, data, message? }`. Inside `useMutation`, the `mutationFn`
  //   MUST return `studioApi.X(...)` as-is. Adding a second
  //   `.then((r) => r.data)` would unwrap to the inner `StudioProject`
  //   whose `?.success` is undefined → the mutation always bails out at
  //   the error branch → `qc.invalidateQueries` never fires → the list
  //   looks stale until a manual page refresh (round-OPT-list-realtime-v1).
  //
  //     Allowed:    mutationFn: (input) => studioApi.createProject(input)
  //     Forbidden: mutationFn: (input) => studioApi.createProject(input).then((r) => r.data)
  // ──────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (input: ProjectCreateInput) => studioApi.createProject(input),
    onSuccess: (created) => {
      if (!created?.success) {
        setErrorBanner(created?.message ?? t('studio.page.error_create_failed', '创建失败,稍后重试'))
        return
      }
      setErrorBanner(null)
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      setCreateOpen(false)
    },
    onError: (err: Error) => {
      // Network/transport failure path (request threw) — distinct from
      // the create-failed (server-returned success:false) path. The
      // pre-i18n code had two separate strings: 「网络错误,稍后重试」
      // (network) vs. 「创建失败,稍后重试」 (server). Collapsing them
      // would silently regress the user-facing UX for anyone hitting
      // a transient network blip, so keep them split here.
      setErrorBanner(err?.message ?? t('studio.page.error_network', '网络错误,稍后重试'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioApi.deleteProject(id),
    onSuccess: (deleted) => {
      if (!deleted?.success) return
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  const handleOpen = (id: number) => {
    // Phase 2 will land `/dashboard/studio/:id` with ScriptViewer tree;
    // for now we surface the empty-route signal loudly so QA can
    // catch stale "click to nothing" UX before the detail page ships.
    navigate(ROUTES.dashboard.studioDetail(id))
  }

  return (
    <PageWrapper data-testid="studio-page-root">
      <PageHeader
        title={t('studio.page.title', '剧本工坊')}
        description={t('studio.page.description', '把一句话灵感变成多集剧本。先建项目,再让 AI 围绕 synopsis 持续生成候选分集,挑出值得拍的那几集一键导出 Seedance 2.0 分镜。')}
        icon={<Clapperboard className="h-5 w-5 text-muted-foreground" />}
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
            data-testid="studio-create-button"
          >
            <Plus className="h-4 w-4" />
            {t('studio.page.cta_create', '新建剧本题材')}
          </Button>
        }
      />

      {errorBanner && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] text-destructive"
          role="alert"
        >
          {errorBanner}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {t('studio.page.error_load_failed', '加载失败:{{message}}', {
            message: error instanceof Error ? error.message : '未知错误',
          })}
        </div>
      )}

      <ProjectList
        projects={projects}
        isLoading={isLoading}
        onOpen={handleOpen}
        onDelete={(id) => deleteMutation.mutate(id)}
      />

      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setErrorBanner(null)
        }}
        onSubmit={(input) => createMutation.mutate(input)}
        isPending={createMutation.isPending}
        errorMessage={
          createMutation.isError
            ? createMutation.error instanceof Error
              ? createMutation.error.message
              : '创建失败'
            : null
        }
      />
    </PageWrapper>
  )
}
