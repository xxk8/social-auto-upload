import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/Components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/Components/ui/tabs'
import { PageHeader } from '@/Components/ui/page-header'
import { useAccounts, useTasks } from '../hooks/useTasks'
import { useAccountGroups } from '../hooks/useAccountGroups'
import { usePublishStore } from '../stores/publishStore'
import { PublishAiSidebar, MobileAiDrawer } from '@/Components/AiRightPanel'
import { useMobileDrawer } from '@/hooks/useMobileDrawer'
import { Image as ImageIcon, Send, Video, Sparkles } from 'lucide-react'
import { VideoForm, type VideoFormHandle } from '../features/publish/VideoForm'
import { NoteForm, type NoteFormHandle } from '../features/publish/NoteForm'
import { PublishSuccessBanner } from '../features/publish/PublishSuccessBanner'
import { PublishStatsBar } from '../features/publish/PublishStatsBar'
import { GroupPublishSelector, type GroupSelection } from '../features/publish/GroupPublishSelector'
import type { FormPreviewData } from '../features/publish/PublishPreview'
import type { TaskItem } from '@/api/client'
import type { Tone } from '@/lib/tone'

/**
 * OPT-3F: shared storage key with AppShell's sidebar collapsed state. The
 * keys live alongside each other so an operator who toggles both panels
 * closed sees consistent behaviour across `/publish` and the rest of the
 * shell. The two keys are independent (`sau-publish-ai-collapsed` vs.
 * `sau-sidebar-collapsed`); keeping them separate means clearing one
 * leaves the other intact.
 */
const AI_COLLAPSED_STORAGE_KEY = 'sau-publish-ai-collapsed'

/**
 * OPT-3F: lazy initializer that reads LS once on mount. Wrapped in
 * `typeof window` so SSR / Nitro prerender doesn't throw (the module
 * might also be touched in non-DOM test environments that lack
 * `window`).
 */
function readAiCollapsedFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(AI_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * OPT-V-2: derive a single Tone from intersection of `lastTaskIds` and
 * the polled `tasks` list. Returns null (muted) when there's nothing to
 * report — i.e. `lastTaskIds` empty.
 *
 * Mapping:
 *   - no last-submit yet                              → `null` (muted)
 *   - any task with `status ∈ {'pending','running'}` → `'warning'` (in-flight, pulse)
 *   - all last tasks resolved with `code === 0`     → `'success'` (green)
 *   - any last task failed (`code != 0`) and none
 *     still pending/running                           → `'error'`   (red)
 *   - some last IDs not yet visible in polled data
 *     (data still loading)                            → `'warning'` (best guess)
 *
 * The lookup tolerates missing / undefined fields because the server
 * side `TaskItem` type marks everything optional (`status?: string`,
 * `code?: number | null`). An unknown-shape task is treated as warning
 * rather than null so the chip stays informative while we wait for
 * the polling cycle to settle.
 */
function deriveLastTaskTone(tasks: TaskItem[], lastTaskIds: string[]): Tone | null {
  if (lastTaskIds.length === 0) return null
  const looked = lastTaskIds
    .map((id) => tasks.find((task) => task.task_id === id))
    .filter((task): task is TaskItem => Boolean(task))
  if (looked.length === 0) return 'warning'
  if (looked.some((task) => task.status === 'pending' || task.status === 'running')) {
    return 'warning'
  }
  const hasFailure = looked.some((task) => task.code !== undefined && task.code !== null && task.code !== 0)
  if (hasFailure) return 'error'
  return 'success'
}

/**
 * Two-column publish-center layout.
 *
 * Below lg (default 1024px): form spans full width, AI assistant is hidden
 * and surfaced via a floating action button → bottom-sheet drawer. We use
 * lg (not md=768) so the form keeps enough horizontal room for its
 * multi-select platform picker, dropzone, and schedule picker.
 *
 * lg and up: form takes the left 60%, AI assistant takes the right 40%
 * (resolves to `grid-cols-[3fr_2fr]`). OPT-3F adds `PanelRightClose` →
 * `PanelRightClose` toggle: when collapsed, the AI sidebar becomes a
 * 60px-wide rail (mirroring the main AppShell sidebar's collapsed-rail
 * pattern) and the form stretches to `[1fr_60px]`. State persists to
 * `localStorage['sau-publish-ai-collapsed']` so refresh keeps the
 * user's choice. The preview that used to live in its own aside is
 * now integrated into the AI sidebar as a collapsible section at the
 * bottom of the panel.
 */
export default function PublishPage() {
  const navigate = useNavigate()
  const { data: accountOptions = [], refetch: refetchAccounts } = useAccounts()
  const { data: groups = [] } = useAccountGroups()
  const { data: tasks = [] } = useTasks()
  const lastTaskIds = usePublishStore((s) => s.lastTaskIds)
  const submitSuccess = usePublishStore((s) => s.submitSuccess)
  const setLastTaskIds = usePublishStore((s) => s.setLastTaskIds)
  const setSubmitSuccess = usePublishStore((s) => s.setSubmitSuccess)

  // OPT-3F: ai-collapsed state on PublishPage (single source of truth).
  // Lazy init reads LS once; the syncing useEffect below is the only
  // writer — it covers both the user-triggered toggle path AND any
  // out-of-band mutations (devtools "set state", HMR edge cases).
  // Mobile drawer mirror path stays unaffected (no `collapsed` prop
  // passed there).
  const [aiCollapsed, setAiCollapsed] = useState<boolean>(readAiCollapsedFromStorage)
  const handleToggleAiCollapsed = useCallback(() => {
    setAiCollapsed((prev) => !prev)
  }, [])
  // Single source of LS writes: when `aiCollapsed` flips, mirror it to
  // LS. Comparing before write avoids unnecessary LS churn.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AI_COLLAPSED_STORAGE_KEY)
      const want = String(aiCollapsed)
      if (stored !== want) window.localStorage.setItem(AI_COLLAPSED_STORAGE_KEY, want)
    } catch {
      // Storage may be denied (private mode, quota); fail silent —
      // toggling still works for the current session and LS catches up
      // on the next page load if it succeeds then.
    }
  }, [aiCollapsed])

  // OPT-V-2: real-time tone for the "最近提交" stats card.
  const lastTaskTone = useMemo(() => deriveLastTaskTone(tasks, lastTaskIds), [tasks, lastTaskIds])

  const [mode, setMode] = useState<'video' | 'note'>('video')
  const [previewData, setPreviewData] = useState<FormPreviewData>({ title: '', desc: '', tags: '', fileUrls: [], fileType: null })
  const [groupSelection, setGroupSelection] = useState<GroupSelection | null>(null)

  const videoFormRef = useRef<VideoFormHandle>(null)
  const noteFormRef = useRef<NoteFormHandle>(null)
  // OPT-3I: cancellable auto-navigate. Replaces the previous 1500 ms
  // one-shot `setTimeout` with a per-second tick so the banner can
  // surface a countdown ("Xs 后跳转") and a user-clickable 取消
  // escape hatch. The interval is held in a ref because unmount
  // cleanup must reach the live setInterval handle; state alone
  // can't reliably reach into a stale interval.
  const [navigateCountdown, setNavigateCountdown] = useState<number | null>(null)
  const navigateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const NAVIGATE_AFTER_MS = 4000
  const NAVIGATE_TICK_MS = 1000

  // Mobile bottom-drawer toggle. Above the md breakpoint the inline
  // PublishAiSidebar takes over and the hook auto-closes the drawer.
  const { isMobile, isOpen, open, close } = useMobileDrawer()

  /**
   * Stop the auto-navigate countdown — clear interval, drop the ref,
   * reset visible countdown to null. Called by the manual-navigate
   * path AND the cancel button; the navigation itself (when countdown
   * reaches 0) is handled by a separate useEffect so the setState
   * updater stays pure.
   */
  const stopAutoNavigate = useCallback(() => {
    if (navigateIntervalRef.current) {
      clearInterval(navigateIntervalRef.current)
      navigateIntervalRef.current = null
    }
    setNavigateCountdown(null)
  }, [])

  // OPT-3I: when the countdown reaches zero, fire the navigation.
  // Lives in a useEffect (rather than inside the interval callback)
  // so the setState updater stays pure and there's exactly one place
  // that decides "jump to /tasks now". Cancel + manual-navigate both
  // short-circuit by setting `navigateCountdown` to null first, so
  // this branch only fires on natural expiry.
  useEffect(() => {
    if (navigateCountdown === 0) {
      stopAutoNavigate()
      navigate('/tasks')
    }
  }, [navigateCountdown, navigate, stopAutoNavigate])

  // Clear pending interval on unmount.
  useEffect(() => {
    return () => {
      if (navigateIntervalRef.current) clearInterval(navigateIntervalRef.current)
    }
  }, [])

  const handleGoToTasks = useCallback(() => {
    stopAutoNavigate()
    navigate('/tasks')
  }, [navigate, stopAutoNavigate])

  const scheduleNavigateAfterSubmit = useCallback(() => {
    stopAutoNavigate()
    const initialCountdown = Math.round(NAVIGATE_AFTER_MS / NAVIGATE_TICK_MS) // 4
    setNavigateCountdown(initialCountdown)
    navigateIntervalRef.current = setInterval(() => {
      setNavigateCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))
    }, NAVIGATE_TICK_MS)
  }, [stopAutoNavigate])

  /**
   * OPT-3I: 取消 button handler. Clears the interval + drops
   * `navigateCountdown` to null, which causes the banner pill to
   * disappear (`cancelCountdown === null` ⇒ pill hidden). Banner
   * itself stays because `submitSuccess` is untouched — the user
   * can still click "查看任务状态" to navigate manually.
   */
  const handleCancelAutoNavigate = useCallback(() => {
    stopAutoNavigate()
  }, [stopAutoNavigate])

  const handleSubmitSuccess = useCallback(
    (info: { count: number; taskIds: string[]; failedCount: number; mode: '视频' | '图文' }) => {
      setLastTaskIds(info.taskIds)
      setSubmitSuccess({ count: info.count, mode: info.mode, taskIds: info.taskIds })
      scheduleNavigateAfterSubmit()
    },
    [setLastTaskIds, setSubmitSuccess, scheduleNavigateAfterSubmit],
  )

  const noopError = useCallback(() => { /* form already toasted */ }, [])

  const handleAiGenerated = useCallback(
    (result: { title: string; desc: string; tags: string }) => {
      if (mode === 'video') videoFormRef.current?.applyAiResult(result)
      else noteFormRef.current?.applyAiResult(result)
    },
    [mode],
  )

  const handleFormChange = useCallback((data: FormPreviewData) => {
    setPreviewData(data)
  }, [])

  return (
    <div className="p-6">
      <PageHeader
        title="发布中心"
        description="发布视频或图文到多个平台"
        icon={<Send className="h-5 w-5 text-muted-foreground" />}
      />

      <PublishSuccessBanner
        info={submitSuccess}
        onGoToTasks={handleGoToTasks}
        cancelCountdown={navigateCountdown}
        onCancelAutoNavigate={handleCancelAutoNavigate}
      />

      <PublishStatsBar
        accountCount={accountOptions.length}
        lastTaskIds={lastTaskIds}
        lastTaskTone={lastTaskTone}
        onRefresh={() => void refetchAccounts()}
      />

      {/* ── Main content: form + AI sidebar (60/40 split at lg+) ──
       *
       * OPT-3F: `lg:grid-cols-[3fr_2fr]` when expanded; flips to
       * `lg:grid-cols-[1fr_60px]` when collapsed so the form
       * stretches and the AI panel becomes the 60px rail. Under lg
       * (mobile), both classes collapse to single-column via the
       * already-existing `grid-cols-1` base; the rail is desktop-only
       * (MobileAiDrawer path doesn't receive `collapsed`). */}
      <div
        className={cn(
          'mt-6 grid gap-6 grid-cols-1',
          aiCollapsed ? 'lg:grid-cols-[1fr_60px]' : 'lg:grid-cols-[3fr_2fr]',
        )}
      >
        {/* Left: form */}
        <div className="min-w-0">
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as 'video' | 'note')
              setGroupSelection(null)
            }}
          >
            <TabsList className="w-full grid grid-cols-2 mb-4">
              <TabsTrigger value="video" className="gap-2 transition-colors duration-150 data-[state=active]:bg-card/80 data-[state=active]:shadow-sm">
                <Video className="h-4 w-4" />
                发布视频
              </TabsTrigger>
              <TabsTrigger value="note" className="gap-2 transition-colors duration-150 data-[state=active]:bg-card/80 data-[state=active]:shadow-sm">
                <ImageIcon className="h-4 w-4" />
                发布图文
              </TabsTrigger>
            </TabsList>

            {/* ── Group selector ──── */}
            <GroupPublishSelector
              groups={groups}
              mode={mode}
              value={groupSelection}
              onChange={setGroupSelection}
            />

            <div className="mt-4">
              <TabsContent value="video" className="mt-0 data-[state=inactive]:hidden">
                <VideoForm
                  ref={videoFormRef}
                  groupSelection={groupSelection}
                  onSuccess={handleSubmitSuccess}
                  onError={noopError}
                  onFormChange={handleFormChange}
                />
              </TabsContent>
              <TabsContent value="note" className="mt-0 data-[state=inactive]:hidden">
                <NoteForm
                  ref={noteFormRef}
                  groupSelection={groupSelection}
                  onSuccess={handleSubmitSuccess}
                  onError={noopError}
                  onFormChange={handleFormChange}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Right (lg+): sticky AI sidebar with collapsible preview.
         * OPT-3F: when `aiCollapsed`, the PublishAiSidebar renders its
         * own rail UI (the 60px-wide vertical strip) — no extra Card
         * wrap needed here. */}
        <div className="hidden lg:block lg:sticky lg:top-6 lg:self-start">
          <div className="h-[calc(100vh-9rem)] min-h-[480px] flex flex-col">
            <PublishAiSidebar
              mode={mode}
              platform={groupSelection?.platforms[0] ?? ''}
              onGenerated={handleAiGenerated}
              previewMode={mode}
              previewData={previewData}
              formRef={mode === 'video' ? videoFormRef : noteFormRef}
              collapsed={aiCollapsed}
              onToggleCollapsed={handleToggleAiCollapsed}
            />
          </div>
        </div>
      </div>

      {/* ── Mobile (<lg): floating action button + drawer ─────────────
       *
       * Mobile drawer path deliberately does NOT pass `collapsed` /
       * `onToggleCollapsed` because:
       *   1. The bottom-drawer already gives a mobile-native "expand"
       *      affordance — a 60px rail inside a drawer would be UX noise.
       *   2. The state lives on PublishPage (so it survives a
       *      desktop↔mobile viewport switch), but only the desktop
       *      grid branch consumes it. */}
      {isMobile && (
        <Button
          onClick={open}
          size="lg"
          className="fixed bottom-4 right-4 z-40 h-11 rounded-full px-4 shadow-lg shadow-primary/25"
          data-testid="mobile-ai-trigger"
          aria-label="打开 AI 助手"
        >
          <Sparkles className="h-4 w-4 mr-1.5" />
          AI 助手
        </Button>
      )}
      <MobileAiDrawer open={isMobile && isOpen} onClose={close}>
        <PublishAiSidebar
          mode={mode}
          platform={groupSelection?.platforms[0] ?? ''}
          onGenerated={handleAiGenerated}
          previewMode={mode}
          previewData={previewData}
          formRef={mode === 'video' ? videoFormRef : noteFormRef}
        />
      </MobileAiDrawer>
    </div>
  )
}
