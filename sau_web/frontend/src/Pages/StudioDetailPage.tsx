import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Copy,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/Components/ui/button'
import { Card, CardContent } from '@/Components/ui/card'
import { Badge } from '@/Components/ui/badge'
import { Skeleton } from '@/Components/ui/skeleton'
import { Separator } from '@/Components/ui/separator'
import { EmptyState } from '@/Components/ui/empty-state'
import { Textarea } from '@/Components/ui/textarea'
import { Input } from '@/Components/ui/input'
import {
  studioApi,
  type StudioProject,
  type StudioEpisode,
  type StudioEpisodeCreateInput,
} from '@/api/studio'
import { EpisodeAppendDialog } from '@/Components/Studio/EpisodeAppendDialog'
import { StudioRenderQuotaPill } from '@/Components/Studio/StudioRenderQuotaPill'
import { StudioUpsellModal } from '@/Components/Studio/StudioUpsellModal'
import { ROUTES } from '@/routes'
import { PRESETS, getPresetById } from '../../remotion_studio/presets'
import type { VisualPreset } from '../../remotion_studio/presets'

const STATUS_LABEL: Record<StudioProject['status'], string> = {
  draft: '草稿',
  generating: '生成中',
  ready: '已完成',
  exported: '已导出',
}

const STATUS_TONE: Record<StudioProject['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  generating: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  exported: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
}

const ACT_LABEL: Record<string, string> = {
  起: '起',
  承: '承',
  转: '转',
  合: '合',
}

/**
 * Hook: derive the project row's effective Visual Style Preset id.
 *
 * Mirrors the resolver chain inside `remotion_studio/Root.tsx::resolv
 * eRenderPresetId`. Pulled here so the picker dropdown mirrors the
 * bridge's render-time resolve without a round-trip to the bundle.
 *
 * Resolution chain (delegated to `getPresetById`):
 *   1. ``render_config?.preset`` if set + known
 *   2. ``null`` if set + UNKNOWN (``getPresetById`` falls to Classic
 *      silently — picker shows the field with a "Unknown — falling
 *      back to Classic" hint via the toast surface below)
 *   3. ``null`` if unset entirely (legacy row)
 */
function useResolvedPresetId(project: StudioProject | undefined): string | null {
  const raw = project?.render_config?.preset
  if (typeof raw !== 'string' || !raw) return null
  // Validate against catalog without throwing (unknown ids are
  // preserved verbatim server-side per option B3, so we surface
  // the orphan state to the operator here rather than silently
  // switching classes).
  const known = PRESETS.some((p) => p.id === raw)
  return known ? raw : null
}

/**
 * Studio project detail page (mounted at ``/dashboard/studio/:id``).
 *
 * Replaces the previous "navigate to a non-existent route → blank
 * screen" behaviour. Pulls the full project record (project +
 * episodes + assets) from ``GET /api/studio/projects/{id}``. Episodes
 * and assets are empty in Phase 1, so they render an EmptyState that
 * points at the Phase 2 generation surface instead of an empty void.
 *
 * round-OPT-presets-v1 — added PresetPicker dropdown beside the
 * "渲染成片" button. Changes auto-PATCH
 * ``/api/studio/projects/{id}`` with the chosen preset id, and the
 * existing query invalidation refreshes ``project.render_config``
 * so the next render uses the new palette.
 */
export default function StudioDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const projectId = id ? Number(id) : NaN

  const { data, isLoading, error } = useQuery({
    queryKey: ['studio-project', projectId],
    queryFn: () => studioApi.getProject(projectId),
    enabled: Number.isFinite(projectId),
  })

  // TTS engine availability — surfaces a warning pill beside the
  // "渲染成片" button AND beside the rendered <video> element so
  // the operator can see WHY their MP4 is silent in BOTH the
  // pre-render state AND the post-render state (when the upstream
  // complaint is exactly: "I rendered and got a silent MP4 with
  // no UI feedback" — hiding the pill behind a successful render
  // would defeat the point of the surface).
  // Cost: one `shutil.which` syscall; cache for 5 min since
  // ``SAU_STUDIO_TTS_VOICE`` only changes across process restart.
  // `refetchOnWindowFocus: true` lets the operator install edge-tts
  // and have the pill auto-clear as soon as they return to the tab.
  const { data: ttsHealth } = useQuery({
    queryKey: ['studio-tts-health'],
    queryFn: () => studioApi.ttsHealth(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: true,
  })

  // Round-OPT-MONETIZE-v1 — daily per-action quota envelope so the
  // top-of-page pill can render "今日已渲染 N / M 次" without waiting
  // for a render-mutation round-trip. The /api/usage/quota route
  // serves all quota rows for the current user at one round-trip;
  // the StudioDetailPage only consumes quotas.studio_render but
  // future surfaces (e.g. publish/inbox AI) can read the same
  // envelope without a second fetch. staleTime 60 s matches the
  // screenshot-style "live enough for the eye, not every render".
  // refetchOnWindowFocus=true so a UTC-midnight rollover doesn't
  // strand an exhausted user on the wrong pill.
  const { data: quota } = useQuery({
    queryKey: ['studio-usage-quota'],
    queryFn: () => studioApi.getQuota().then((d) => d?.data),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })

  // Upsell modal lifecycle. We pre-flight the free-tier user who's
  // already at-limit BEFORE the render-mutation fires — opening the
  // modal here is the canonical fast-path (no wasted Remotion
  // bundle / Pexels / TTS, no 429 round-trip). The render-mutation's
  // onError handler still opens the modal as a defensive backstop
  // (e.g. quota switched to at-limit between the pill render and
  // the click — sub-second race). Reset on close so re-opening the
  // modal for a different blocked action works.
  const [upsellOpen, setUpsellOpen] = useState(false)

  // Memoised "should show upsell at click time" flag — combines
  // tier==free (cannot DIY upgrade) AND used >= limit (no quota left).
  const isFreeAtQuota =
    quota?.tier === 'free' &&
    (quota?.quotas.studio_render?.can_upgrade ?? false)

  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', synopsis: '', style: '' })
  const [saveError, setSaveError] = useState<string | null>(null)
  // Optimistic UI for the picker — set on `onChange`, retained until
  // the server round-trip resolves + query invalidation refreshes
  // ``project.render_config.preset``. Without this the picker would
  // flicker back to the previous value during the ~100ms POST.
  const [optimisticPresetId, setOptimisticPresetId] = useState<string | null>(null)
  // round-OPT-T2-follow-up activation-funnel fix — the
  // 「还没有分集」 empty state used to be a dead-end until the user
  // typed a node_modules patch and re-curl'd the now-shipped
  // ``POST /api/studio/projects/{id}/episodes``. ``episodeDialogOpen``
  // toggles the new ``EpisodeAppendDialog`` (title + act dropdown +
  // scenes/dialogues textareas) inline; the mutation below closes it
  // once the server round-trip succeeds and ``qc.invalidateQueries``
  // re-fetches the project so the new episode shows up immediately.
  const [episodeDialogOpen, setEpisodeDialogOpen] = useState(false)
  const [episodeError, setEpisodeError] = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: (patch: {
      title?: string
      synopsis?: string
      style?: string | null
      render_config?: { preset: string; version: 1 } | null
    }) => studioApi.updateProject(projectId, patch),
    onSuccess: (res) => {
      if (!res?.success) {
        setSaveError(res?.message ?? '保存失败,稍后重试')
        return
      }
      setSaveError(null)
      setEditing(false)
      // CRITICAL — clear the optimistic picker override once the
      // server round-trip completes + the invalidated query
      // refetches. Without this, `optimisticPresetId` would
      // retain the user's last-picked id for the lifetime of the
      // page, masking any subsequent server-side drift (e.g. an
      // admin revert of the row's `render_config.preset`, or a
      // follow-up mutation that resets the field). After the next
      // render the picker reads from the freshly-refetched
      // `project.render_config?.preset` via
      // `resolveStoredPresetId` instead of the stale local value.
      setOptimisticPresetId(null)
      qc.invalidateQueries({ queryKey: ['studio-project', projectId] })
      qc.invalidateQueries({ queryKey: ['studio-projects'] })
    },
    onError: (err: Error) => {
      setSaveError(err?.message ?? '网络错误,稍后重试')
    },
  })

  const startEdit = () => {
    setDraft({
      title: project?.title ?? '',
      synopsis: project?.synopsis ?? '',
      style: project?.style ?? '',
    })
    setSaveError(null)
    setEditing(true)
  }

  // round-OPT-T2-follow-up — wires the ``POST /api/studio/projects/
  // {id}/episodes`` surface (shipped in this round) into the
  // StudioDetailPage. Accepts a single ``StudioEpisodeCreateInput``
  // and forwards to ``studioApi.appendEpisodes`` which auto-marshals
  // the single-vs-batch dispatch server-side (the batch path is
  // reserved for a future "添加 4 幕" mass-insert UI). On success
  // the dialog closes + the project query refetches so the new
  // ``episode_no`` slots into the cards list immediately. Errors are
  // surfaced inline under the episodes section so the SAME pill
  // shows both server 400s ("act 必须是 ... 之一") and transport
  // failures ("网络错误…"). Re-entrancy is handled by the dialog's
  // own ``submittingRef`` — the mutation hook only sees ONE
  // ``mutate()`` call per submit.
  const appendEpisodeMutation = useMutation({
    mutationFn: (input: StudioEpisodeCreateInput) =>
      studioApi.appendEpisodes(projectId, input),
    onSuccess: (res) => {
      if (!res?.success) {
        setEpisodeError(res?.message ?? '添加分集失败,稍后重试')
        return
      }
      setEpisodeError(null)
      qc.invalidateQueries({ queryKey: ['studio-project', projectId] })
      setEpisodeDialogOpen(false)
    },
    onError: (err: Error) => {
      setEpisodeError(err?.message ?? '网络错误,稍后重试')
    },
  })

  const renderMutation = useMutation({
    mutationFn: () => studioApi.renderProject(projectId),
    onError: (err) => {
      // Round-OPT-MONETIZE-v1 — when the backend rejects with a
      // 429 + can_upgrade=true, open the upsell modal instead of
      // the inline <p> alert. Axios surfaces the 429 body via
      // ``error.response.data`` (NOT a custom ``__envelope``
      // property), so we read the canonical path. Legacy inline
      // alert (``renderMutation.error.message``) still renders as
      // a TOAST-surface fallback for non-upsell errors (network,
      // 500, unknown).
      const body = (
        err as Error & {
          response?: { data?: { can_upgrade?: boolean } }
        }
      )?.response?.data
      if (body?.can_upgrade) {
        setUpsellOpen(true)
      }
    },
  })

  const goBack = () => navigate(ROUTES.dashboard.studio)

  // ── round-OPT-seedance-export — 3-button markdown export ───────────
  // The mutation hooks below share the same Blob/anchor-click pattern
  // already proven in `Pages/LogsPage.tsx`, `Pages/AnalyticsPage.tsx`,
  // and `features/admin/AdminOverviewPage.tsx` — axios surfaces
  // binary downloads as a Blob, we wrap it in a Blob URL, and
  // trigger a programmatic anchor click since browsers won't auto-
  // save a blob response natively. Copy-to-clipboard uses the
  // navigator.clipboard API with a `document.execCommand` fallback
  // for non-HTTPS (e.g. dev mode over plain http).
  // Only the project-wide zip needs an observable in-flight state
  // (single button shows the spinner); per-episode downloads fire
  // and forget via `studioApi.exportEpisode` directly inside
  // `handleDownloadEpisode` so each card can render immediately
  // without serializing on a shared mutation queue.
  const { t } = useTranslation()
  const [exportError, setExportError] = useState<string | null>(null)
  // The mutation's `onError` fires in addition to the outer
  // try/catch in `handleDownloadAll` — both paths surface this
  // state so the inline banner renders regardless of how the
  // caller invoked the mutation (fire-and-forget button click
  // vs. direct mutateAsync()). As Axios shape, the server
  // envelope is at `err.response.data.message`; fall back to
  // the raw JS Error message, then to the i18n template.
  const exportProjectMutation = useMutation({
    mutationFn: () => studioApi.exportProject(projectId),
    onError: (
      err: Error & { response?: { data?: { message?: string } } },
    ) => {
      // react-i18next's 2-arg form treats an OBJECT 2nd arg as
      // interpolation variables — NOT a default value. Pass
      // `defaultValue` alongside so a future locale without
      // `studio.export.error_zip_failed` falls back to a
      // Chinese template rather than displaying the raw key,
      // AND so an empty server message doesn't yield the
      // trailing-colon cosmetic wart `"导出失败:"`.
      const msg =
        String(
          err?.response?.data?.message ?? (err as Error)?.message ?? "",
        ) || "请重试"
      setExportError(
        t('studio.export.error_zip_failed', {
          message: msg,
          defaultValue: `导出失败:${msg}`,
        }),
      )
    },
    onSuccess: () => {
      setExportError(null)
    },
  })
  const [copiedEp, setCopiedEp] = useState<number | null>(null)
  // Mirror of `copiedEp` for the FAILURE side per-episode — lets
  // the pill briefly show "复制失败" when both navigator.clipboard
  // AND the textarea + execCommand fallback couldn't land the
  // copy. Same UX role as `exportError` for the project zip.
  const [copyError, setCopyError] = useState<number | null>(null)

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 60s revoke window — `setTimeout(0)` historically races
    // Chrome's in-flight download completion (the anchor's
    // `click()` resolves microtasks while the browser's
    // "save as" dialog is still binding the URL). 60s is the
    // conventional Mozilla-recommended minimum to avoid the race.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const handleCopyEpisode = async (ep: StudioEpisode) => {
    try {
      const text = await studioApi.exportEpisodeText(projectId, ep.episode_no)
      try {
        // Primary path: modern Clipboard API. Rejects (note: NOT
        // throws synchronously — `writeText` returns a Promise)
        // when the tab is not focused, when the user hasn't
        // interacted with the page in a while, or when
        // permissions are denied (e.g. cross-origin iframe).
        await navigator.clipboard.writeText(text)
        setCopiedEp(ep.episode_no)
        setTimeout(() => setCopiedEp((cur) => (cur === ep.episode_no ? null : cur)), 2000)
        return
      } catch {
        // Fallback path: legacy `document.execCommand('copy')`.
        // Returns `false` when the browser blocked the copy
        // (no clipboard write permission, no transient user
        // activation, etc.). We MUST NOT claim success when it
        // returns `false` — the prior shape silently flipped
        // the pill to "已复制 ✓" even when the user's clipboard
        // was untouched. On `false` fall through to the outer
        // `catch (err)` so the failure gets logged.
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) {
          setCopiedEp(ep.episode_no)
          setTimeout(() => setCopiedEp((cur) => (cur === ep.episode_no ? null : cur)), 2000)
          return
        }
        throw new Error('clipboard copy blocked')
      }
    } catch (err) {
      // Both `navigator.clipboard.writeText` reject AND the
      // execCommand fallback returning `false` end up here —
      // surface to the per-episode pill so the user can fall
      // back to "下载 .md" without confusion. Mirrors the
      // `exportError` state shipping on the project zip side.
      console.error('copy episode failed', err)
      setCopyError(ep.episode_no)
      setTimeout(
        () =>
          setCopyError((cur) => (cur === ep.episode_no ? null : cur)),
        2000,
      )
    }
  }

  const handleDownloadEpisode = async (ep: StudioEpisode) => {
    try {
      const blob = await studioApi.exportEpisode(projectId, ep.episode_no)
      const safeTitle = (ep.title || `episode_${ep.episode_no}`).replace(/[\\/:*?"<>|]/g, '_')
      downloadBlob(blob, `E${String(ep.episode_no).padStart(2, '0')}_${safeTitle}_分镜.md`)
    } catch (err) {
      console.error('download episode failed', err)
    }
  }

  const handleDownloadAll = async () => {
    try {
      // Snapshot the project title BEFORE awaiting so a mid-flight
      // useQuery invalidation / page unmount doesn't race the
      // closure read (data?.data?.title) → fallback `<id>_全剧.zip`
      // instead of the user's editorial title.
      const projectTitle = (
        data?.data?.title ?? `project_${projectId}`
      ).replace(/[\\/:*?"<>|]/g, '_')
      const blob = await exportProjectMutation.mutateAsync()
      downloadBlob(blob, `${projectTitle}_全剧.zip`)
    } catch (err) {
      console.error('download project zip failed', err)
    }
  }

  if (!Number.isFinite(projectId)) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 sm:p-8" data-testid="studio-detail-root">
        <EmptyState
          icon={<Clapperboard className="h-6 w-6 text-muted-foreground/50" />}
          title="无效的项目 ID"
          description="URL 中的项目标识无法识别。"
          action={
            <Button variant="outline" onClick={goBack}>
              返回剧本工坊
            </Button>
          }
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 sm:p-8 space-y-4" data-testid="studio-detail-root">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-6 w-24" />
        <Separator />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error || !data?.success || !data.data) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 sm:p-8" data-testid="studio-detail-root">
        <EmptyState
          icon={<Clapperboard className="h-6 w-6 text-muted-foreground/50" />}
          title="项目不存在"
          description={
            error instanceof Error
              ? error.message
              : '该项目可能已被删除,或不属于当前账号。'
          }
          action={
            <Button variant="outline" onClick={goBack}>
              返回剧本工坊
            </Button>
          }
        />
      </div>
    )
  }

  const project = data.data
  const episodes = project.episodes ?? []
  const assets = project.assets ?? []
  const resolvedPresetId = useResolvedPresetId(project)

  // The effective display value: optimistic override (during PATCH)
  // > server value. When both are null, fall back to the catalog's
  // first entry (Classic) so the picker is never empty.
  const effectivePresetId: string =
    optimisticPresetId ?? resolvedPresetId ?? PRESETS[0].id
  const pickedPreset: VisualPreset = getPresetById(effectivePresetId)

  // True iff the server has stored an id that the TS catalog does not
  // know about — surfaces the orphan-state hint without breaking
  // renders. Backend option B3 keeps the row renderable; the catalog
  // drift display is for editorial hygiene only.
  const hasUnknownPreset =
    typeof project?.render_config?.preset === 'string' &&
    project.render_config.preset.length > 0 &&
    resolvedPresetId === null &&
    optimisticPresetId === null

  const isDirty =
    draft.title !== project.title ||
    draft.synopsis !== project.synopsis ||
    (draft.style ?? '') !== (project.style ?? '')

  const handleSave = () => {
    if (!isDirty) {
      setEditing(false)
      return
    }
    const patch: {
      title?: string
      synopsis?: string
      style?: string | null
    } = {}
    if (draft.title !== project.title) patch.title = draft.title.trim()
    if (draft.synopsis !== project.synopsis) patch.synopsis = draft.synopsis.trim()
    if ((draft.style ?? '') !== (project.style ?? '')) {
      patch.style = draft.style.trim() || null
    }
    updateMutation.mutate(patch)
  }

  const handlePresetChange = (nextId: string) => {
    setOptimisticPresetId(nextId)
    updateMutation.mutate({
      render_config: { preset: nextId, version: 1 },
    })
  }

  return (
    <div
      className="mx-auto w-full max-w-3xl p-6 sm:p-8 space-y-6"
      data-testid="studio-detail-root"
    >
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 -ml-2 text-muted-foreground"
        onClick={goBack}
      >
        <ArrowLeft className="h-4 w-4" />
        返回剧本工坊
      </Button>

      {/* Round-OPT-MONETIZE-v1 — Studio render quota chip.
          Rendered at the TOP of the page so the operator sees
          "今日已渲染 1 / 3 次" before clicking "渲染成片" rather
          than learning about their quota via a 429-after-the-fact
          surface. The chip itself carries the at-limit
          "升级专业版" CTA (via `<StudioRenderQuotaPill>` canUpgradeCta
          default), so the modal is only opened via the
          render-mutation pre-flight + onError backstop. */}
      <div className="flex justify-end -mt-2">
        <StudioRenderQuotaPill quota={quota} />
      </div>

      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          {editing ? (
            <Input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="text-[24px] font-semibold tracking-tight h-auto py-1"
              aria-label="标题"
            />
          ) : (
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
              {project.title}
            </h1>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={() => setEditing(false)}
                  disabled={updateMutation.isPending}
                  aria-label="取消编辑"
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleSave}
                  disabled={updateMutation.isPending || !isDirty}
                  aria-label="保存"
                >
                  <Check className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground"
                onClick={startEdit}
                aria-label="编辑"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${STATUS_TONE[project.status]}`}
            >
              {STATUS_LABEL[project.status]}
            </span>
          </div>
        </div>

        {editing ? (
          <Input
            value={draft.style}
            onChange={(e) => setDraft((d) => ({ ...d, style: e.target.value }))}
            placeholder="风格(可选)"
            className="text-[12px] font-mono h-auto py-1"
            aria-label="风格"
          />
        ) : project.style ? (
          <p className="text-[12px] font-mono text-muted-foreground/70">{project.style}</p>
        ) : null}

        <Separator />
      </header>

      <section className="space-y-2">
        <h2 className="text-[13px] font-medium text-muted-foreground">一句话灵感 / 梗概</h2>
        {editing ? (
          <Textarea
            value={draft.synopsis}
            onChange={(e) => setDraft((d) => ({ ...d, synopsis: e.target.value }))}
            rows={14}
            className="text-[14px] leading-relaxed font-mono"
            aria-label="梗概"
          />
        ) : (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">
            {project.synopsis}
          </p>
        )}
        {saveError && (
          <p className="text-[12px] text-destructive" role="alert">
            {saveError}
          </p>
        )}
        {editing && (
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending || !isDirty}>
              {updateMutation.isPending ? '保存中…' : '保存'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={updateMutation.isPending}
            >
              取消
            </Button>
            <span className="text-[11px] text-muted-foreground/70 tabular-nums">
              {draft.synopsis.length}/500
            </span>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-foreground">成片</h2>
        </div>

        {/* round-Video-Backgrounds-v1 — TTS health warning pill.
            Surfaced ABOVE the render-result conditional so the
            operator can see WHY their MP4 is silent in BOTH the
            pre-render state AND the post-render state. The
            upstream complaint was "I rendered and got a silent
            MP4 with no UI feedback" — hiding the pill behind a
            successful render would defeat the whole point of
            this surface.

            The amber tone matches STATUS_TONE['generating'] so
            visual vocabulary stays consistent with other
            "non-blocking degradation" surfaces in the app. Does
            NOT block render — the MP4 still ships, just silent.
            To dismiss: install edge-tts (see ``install_hint``)
            then return to the tab (the useQuery refetches on
            window focus via ``refetchOnWindowFocus: true``).

            The ``reason`` field is non-nullable on the TS type
            (mirrors the backend's "always populated when
            available=false" contract). Reading it directly
            without ``??`` would surface a contract regression
            loudly via ``TypeError`` at render time — preferred
            over silently substituting a stale fallback. */}
        {ttsHealth?.success && !ttsHealth.data.available && (
          <div
            data-testid="tts-health-warning"
            role="status"
            aria-live="polite"
            className="rounded-md bg-amber-500/15 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300"
          >
            <span className="font-mono" aria-hidden>
              ！
            </span>{' '}
            配音暂不可用:{ttsHealth.data.reason}。{ttsHealth.data.install_hint}
          </div>
        )}

        {renderMutation.data?.success && renderMutation.data.data ? (
          <div className="space-y-3">
            <video
              src={renderMutation.data.data.url}
              controls
              className="w-full rounded-lg border border-border/50 bg-black"
              data-testid="studio-render-video"
            />
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <a
                href={renderMutation.data.data.captions_srt}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                下载字幕 (.srt)
              </a>
              <a
                href={renderMutation.data.data.captions_ass}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                下载字幕 (.ass)
              </a>
              <span className="text-muted-foreground/70 tabular-nums">
                {renderMutation.data.data.width}×{renderMutation.data.data.height} ·{' '}
                {renderMutation.data.data.duration.toFixed(1)}s
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border/60 bg-muted/30 p-4">
            <p className="text-[12px] text-muted-foreground">
              把当前梗概/分镜渲染成 9:16 竖屏成片(Remotion React → MP4)。
            </p>

            {/* round-OPT-presets-v1 — PresetPicker dropdown. Inline
                beside the render button. Persists choice via the
                existing PATCH /api/studio/projects/{id} endpoint
                (`_validate_update_payload` already accepts the new
                `render_config` key). The `<select>` is locked
                while the PATCH is in-flight to prevent flicker
                between the optimistic value and the snap-back to
                the server value. */}
            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="preset-picker"
            >
              <label
                htmlFor="render-preset-select"
                className="text-[11px] text-muted-foreground whitespace-nowrap"
              >
                渲染样式
              </label>
              <select
                id="render-preset-select"
                value={effectivePresetId}
                onChange={(e) => handlePresetChange(e.target.value)}
                disabled={updateMutation.isPending}
                aria-label="Visual Style Preset 选择"
                title={pickedPreset.description}
                className="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {updateMutation.isPending && (
                <span
                  className="text-[10px] text-muted-foreground tabular-nums"
                  aria-live="polite"
                >
                  保存中…
                </span>
              )}
              {hasUnknownPreset && !updateMutation.isPending && (
                <span
                  className="text-[10px] text-amber-700 dark:text-amber-300"
                  role="status"
                  title={`服务端持久化了 ${String(project?.render_config?.preset)},但前端目录里查无此 id — 渲染时回退到 Classic。`}
                >
                  未识别 · 回退到 Classic
                </span>
              )}
            </div>

            <Button
              size="sm"
              onClick={() => {
                // Round-OPT-MONETIZE-v1 — pre-flight the free-tier
                // at-quota case BEFORE firing the doomed POST so we
                // don't waste a round-trip on the 429 path. The
                // render-mutation's onError handler remains the
                // backstop for the sub-second race where quota
                // flips to at-limit between this render and the
                // user's click (the pill is stale by 60 s).
                if (isFreeAtQuota) {
                  setUpsellOpen(true)
                  return
                }
                renderMutation.mutate()
              }}
              disabled={renderMutation.isPending || updateMutation.isPending}
            >
              <Film className="h-4 w-4" />
              {renderMutation.isPending ? '渲染中…' : '渲染成片'}
            </Button>
            {renderMutation.error && (
              <p className="text-[12px] text-destructive" role="alert">
                {renderMutation.error instanceof Error ? renderMutation.error.message : '渲染失败'}
              </p>
            )}
            {renderMutation.data && !renderMutation.data.success && (
              <p className="text-[12px] text-destructive" role="alert">
                {renderMutation.data.message}
              </p>
            )}
          </div>
        )}
      </section>

      {exportError && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
          role="alert"
          data-testid="storyboard-export-error"
        >
          {exportError}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-foreground">分集</h2>
          <Badge variant="secondary" className="tabular-nums">
            {episodes.length}
          </Badge>
          {episodes.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto gap-1.5"
              onClick={handleDownloadAll}
              disabled={exportProjectMutation.isPending}
              data-testid="storyboard-export-zip"
            >
              {exportProjectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exportProjectMutation.isPending
                ? t('studio.export.bulk_zip_pending', '正在打包…')
                : t('studio.export.bulk_zip', '一键导出全剧 .zip')}
            </Button>
          )}
        </div>
        {episodes.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-6 w-6 text-muted-foreground/50" />}
            title="还没有分集"
            description="先手动添加 1 集,挑出值得拍的那几集后点「渲染成片」。后续会有 「AI 自动生成 4 幕」 (Phase 2),在此之前先手动试试看。"
            action={
              <Button
                onClick={() => setEpisodeDialogOpen(true)}
                className="gap-1.5"
                data-testid="episode-append-button"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                添加 1 集
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {episodes.map((ep) => (
              <Card key={ep.id}>
                <CardContent className="flex items-start gap-3 pt-5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[12px] font-semibold text-muted-foreground">
                    {ACT_LABEL[ep.act] ?? ep.act}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="truncate text-[14px] font-medium text-foreground">
                        第 {ep.episode_no} 集 · {ep.title}
                      </h3>
                      <span className="shrink-0 text-[11px] text-muted-foreground/70">
                        {STATUS_LABEL[ep.status as keyof typeof STATUS_LABEL] ?? ep.status}
                      </span>
                    </div>
                    {(ep.scenes?.length || ep.dialogues?.length) && (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {ep.scenes?.length ?? 0} 个场景 · {ep.dialogues?.length ?? 0} 条台词
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                        onClick={() => handleCopyEpisode(ep)}
                        data-testid={`storyboard-copy-${ep.episode_no}`}
                      >
                        <Copy className="h-3 w-3" />
                        {copyError === ep.episode_no
                          ? t('studio.export.copy_failed', '复制失败,请改用下载')
                          : copiedEp === ep.episode_no
                            ? t('studio.export.copied', '已复制')
                            : t('studio.export.copy', '复制 Markdown')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                        onClick={() => handleDownloadEpisode(ep)}
                        data-testid={`storyboard-md-${ep.episode_no}`}
                      >
                        <Download className="h-3 w-3" />
                        {t('studio.export.download', '下载 .md')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-foreground">素材</h2>
          <Badge variant="secondary" className="tabular-nums">
            {assets.length}
          </Badge>
        </div>
        {assets.length === 0 ? (
          <EmptyState
            icon={<ImageIcon className="h-6 w-6 text-muted-foreground/50" />}
            title="还没有素材"
            description="角色、场景、道具等素材会在生成分集后自动归档到这里。"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {assets.map((asset) => (
              <Card key={asset.id}>
                <CardContent className="flex items-start gap-3 pt-5">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[13px] font-medium text-foreground">
                        {asset.name}
                      </h3>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {asset.kind}
                      </span>
                    </div>
                    {asset.prompt && (
                      <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
                        {asset.prompt}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground/60 font-mono tabular-nums">
        创建于 {new Date(project.created_at).toLocaleString('zh-CN')} · 更新于{' '}
        {new Date(project.updated_at).toLocaleString('zh-CN')}
      </p>

      <EpisodeAppendDialog
        open={episodeDialogOpen}
        onOpenChange={(open) => {
          setEpisodeDialogOpen(open)
          if (!open) setEpisodeError(null)
        }}
        onSubmit={(input) => appendEpisodeMutation.mutate(input)}
        isPending={appendEpisodeMutation.isPending}
        errorMessage={
          appendEpisodeMutation.isError
            ? appendEpisodeMutation.error instanceof Error
              ? appendEpisodeMutation.error.message
              : '添加分集失败'
            : episodeError
        }
      />

      {/* Round-OPT-MONETIZE-v1 — studio upsell modal. Triggered
          either by the render-mutation onError (429 + can_upgrade)
          OR pre-flight (free-tier user clicks "渲染成片" while the
          quota chip already shows 3/3 — we open the modal instead
          of issuing a doomed POST). Render order is deterministic;
          Radix handles focus / Esc; the dialog's onOpenChange
          flips local state. */}
      <StudioUpsellModal
        open={upsellOpen}
        onOpenChange={setUpsellOpen}
      />
    </div>
  )
}
