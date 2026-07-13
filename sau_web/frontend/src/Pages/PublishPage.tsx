import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/Components/ui/page-header'
import { useAccounts, useTasks } from '../hooks/useTasks'
import { useAccountGroups } from '../hooks/useAccountGroups'
import { usePublishStore } from '../stores/publishStore'
import {
  usePublishWizardStore,
  type WizardContent,
} from '../stores/publishWizardStore'
import { Send, Sparkles } from 'lucide-react'
import { Button } from '@/Components/ui/button'
import { cn } from '@/lib/utils'
import { effectiveMaxTags } from '@/features/publish/shared.helpers'
import { PublishSuccessBanner } from '../features/publish/PublishSuccessBanner'
import { PublishStatsBar } from '../features/publish/PublishStatsBar'
import { PublishWizard } from '../features/publish/wizard/PublishWizard'
import { PublishAiSidebar } from '../Components/AiRightPanel/PublishAiSidebar'
import { MobileAiDrawer } from '../Components/AiRightPanel/MobileAiDrawer'
import { useMobileDrawer } from '../hooks/useMobileDrawer'
import type { TaskItem } from '@/api/client'
import type { Tone } from '@/lib/tone'
import type { FormHandle, FormSnapshot } from '@/lib/chat/chatFormBridge'

import { ROUTES } from '@/routes'
/**
 * OPT-3F: shared storage key with AppShell's sidebar collapsed state. The
 * keys live alongside each other so an operator who toggles both panels
 * closed sees consistent behaviour across `/publish` and the rest of the
 * shell. The two keys are independent (`sau-publish-ai-collapsed` vs.
 * `sau-sidebar-collapsed`); keeping them separate means clearing one
 * leaves the other intact.
 */
const PUBLISH_AI_COLLAPSED_KEY = 'sau-publish-ai-collapsed'

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
 * OPT-3F: bridge the wizard store to the chat pipeline's `FormHandle`
 * contract. The wizard owns form state via `usePublishWizardStore`, but
 * AiSidebar's chat pipeline speaks the same `applyAiResult` /
 * `getFormSnapshot` API that the (now-orphaned) VideoForm/NoteForm used
 * to expose via `useImperativeHandle`. Rather than wire the wizard
 * through `useImperativeHandle` (which would only fire when ContentStep
 * is mounted — wrong binding for stream-time `getFormSnapshot`), we
 * expose a single ref whose `current` lazily initialises to a thin
 * adapter that always reads the freshest store snapshot via
 * `usePublishWizardStore.getState()`.
 *
 * The lazy-init pattern (`if (!formRef.current) formRef.current = ...`)
 * runs once per mount. Subsequent renders no-op the assignment so the
 * adapter identity is stable for `useChatActions`'s dep array.
 *
 * **Mode-aware `desc` routing**: in video mode the AI's `desc` lands in
 * `wizard.content.desc`; in note mode it lands in `content.note`. The
 * router reads `store.mode` at apply time, so a mid-stream mode
 * toggle routes the apply-side correctly to whichever field the user
 * is currently editing.
 *
 * **Truthy-only writes** (`if (result.title)` etc.) match the contract
 * VideoForm/NoteForm established: an empty string is treated as "no
 * change" rather than "clear this field". A user-facing "clear title"
 * affordance, if ever added, would call `setContent({title: ''})`
 * directly — it should not leak through this bridge.
 */
function useWizardFormHandle(): RefObject<FormHandle | null> {
  const formRef = useRef<FormHandle | null>(null)
  if (!formRef.current) {
    formRef.current = {
      applyAiResult(result) {
        const state = usePublishWizardStore.getState()
        const patch: Partial<WizardContent> = {}
        if (result.title) patch.title = result.title
        if (result.tags && result.tags.length > 0) {
          // Symmetric truncation point with handleApplyVariant:
          // clamp incoming AI tags to the platform's max so the form
          // never ends up holding tags a downstream platform will
          // reject (e.g. 11 tags from chat into a 5-tag platform).
          const max = effectiveMaxTags(state.groupSelection?.platforms ?? [])
          patch.tags = max !== undefined ? result.tags.slice(0, max) : result.tags
        }
        if (result.desc) {
          if (state.mode === 'video') patch.desc = result.desc
          else patch.note = result.desc
        }
        if (Object.keys(patch).length > 0) state.setContent(patch)
      },
      getFormSnapshot(): FormSnapshot {
        const state = usePublishWizardStore.getState()
        return {
          title: state.content.title,
          desc: state.mode === 'video' ? state.content.desc : state.content.note,
          // Path C: native string[] — bridge consumers see array form.
          tags: state.content.tags,
        }
      },
    }
  }
  return formRef
}

/**
 * Two-column publish-center layout.
 *
 * `<lg` (default 1024px): the wizard spans full width, and the AI
 * assistant is surfaced via a fixed floating action button (FAB) at
 * the bottom-right → the FAB opens a `MobileAiDrawer` bottom-sheet
 * hosting the same `PublishAiSidebar`. We use lg here (not md=768) so
 * the wizard keeps enough horizontal room for its multi-select
 * platform picker, dropzone, and schedule picker.
 *
 * `lg+`: CSS Grid `[2fr_3fr]` — wizard left 40% / AI sidebar right 60%.
 * OPT-3F adds a collapse toggle: when collapsed, the right column shrinks
 * to a 60px-wide rail (mirroring the main AppShell sidebar's
 * collapsed-rail pattern) and the form stretches to `[1fr_60px]` (left
 * takes the remaining space). The
 * `collapsed` state persists to `localStorage['sau-publish-ai-collapsed']`
 * so a refresh keeps the user's choice.
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
  const wizardMode = usePublishWizardStore((s) => s.mode)
  const activePlatform = usePublishWizardStore((s) => s.groupSelection?.platforms[0])

  // OPT-V-2: real-time tone for the "最近提交" stats card.
  const lastTaskTone = useMemo(() => deriveLastTaskTone(tasks, lastTaskIds), [tasks, lastTaskIds])

  // OPT-3F: imperative handles.
  const formRef = useWizardFormHandle()
  const { isMobile, isOpen, open, close } = useMobileDrawer()

  // ── ?group_id= deep-link (NT-22: AccountsPage "去发布此分组") ──────
  // AccountsPage's <SortableGroup>/<GroupListItem> render an always-
  // visible Send icon button on the group's title bar. Clicking it
  // navigates to `?group_id=<id>` so this page can pre-select the
  // group in the wizard. Validates on first effect pass:
  //   • group_id is a positive integer                 → else clear + bail
  //   • group EXISTS in `useAccountGroups().data`      → else clear + bail
  //   • group has ≥1 authorization                    → else clear + bail
  //     (an empty-selection wizard is useless + blocks step 0)
  // After the seed OR clear, the param is stripped via setSearchParams(
  // {}, { replace: true }) so a refresh doesn't re-apply the deep-link.
  // `appliedRef` guards against re-runs: groups may arrive async but
  // must only seed once. The dep array omits `appliedRef` on purpose —
  // it's a closure-only sentinel, never a render trigger.
  const [searchParams, setSearchParams] = useSearchParams()
  const appliedDeepLinkRef = useRef(false)
  useEffect(() => {
    if (appliedDeepLinkRef.current) return
    const raw = searchParams.get('group_id')
    if (raw === null) return
    const groupId = Number(raw)
    const group =
      Number.isInteger(groupId) && groupId > 0
        ? groups.find((g) => g.id === groupId)
        : undefined
    if (group && group.authorizations.length > 0) {
      const platforms = group.authorizations.map((a) => a.platform)
      const mappings = group.authorizations.map((a) => ({
        platform: a.platform,
        cookieFile: a.cookie_file,
        authId: a.id,
      }))
      const wizardStore = usePublishWizardStore.getState()
      wizardStore.setGroupSelection({
        groupId: group.id,
        groupName: group.name,
        platforms,
        mappings,
      })
      // Reset wizard pointer to step 0 so a user landing mid-session
      // (e.g. via /dashboard → /publish?group_id=N with a stale
      // currentStep from a prior use) doesn't face a wizard pointing
      // at a step whose content was filled FOR A DIFFERENT group.
      // Files / content / advanced are intentionally preserved —
      // only the navigation pointer moves. `reset()` would be
      // destructive (wipes files); `setStep(0)` is the lower-risk
      // middle ground that's also exercised by the test contract
      // (see PublishPage.test.tsx → "currentStep === 0 after seed").
      wizardStore.setStep(0)
    }
    appliedDeepLinkRef.current = true
    setSearchParams({}, { replace: true })
    // intentionally narrow deps: only re-run when groups arrive. The
    // `appliedDeepLinkRef` guard makes further re-runs no-ops.
  }, [groups, searchParams, setSearchParams])

  // OPT-3F: AI-sidebar collapsed state with localStorage persistence.
  // Initialised lazily so SSR environments (and the first responsive
  // tick before `window` is available) default to `false`. Subsequent
  // renders re-write `localStorage[...] = 'true' | 'false'` whenever
  // the user toggles, so reload restores their last choice exactly.
  const [aiCollapsed, setAiCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    try {
      // Default collapsed for first-time visitors (no saved preference).
      // Once the user toggles, the explicit bool is persisted so reload
      // restores their choice exactly.
      const saved = window.localStorage.getItem(PUBLISH_AI_COLLAPSED_KEY)
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const want = String(aiCollapsed)
      if (window.localStorage.getItem(PUBLISH_AI_COLLAPSED_KEY) !== want) {
        window.localStorage.setItem(PUBLISH_AI_COLLAPSED_KEY, want)
      }
    } catch {
      /* private mode / quota — ignore, in-memory state still consistent */
    }
  }, [aiCollapsed])

  const handleToggleAiCollapsed = useCallback(() => {
    setAiCollapsed((v) => !v)
  }, [])

  // OPT-3I: cancellable auto-navigate countdown (preserved from before
  // the AI sidebar was dropped). Reset intervals + cleanup on unmount.
  const [navigateCountdown, setNavigateCountdown] = useState<number | null>(null)
  const navigateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const NAVIGATE_AFTER_MS = 4000
  const NAVIGATE_TICK_MS = 1000

  const stopAutoNavigate = useCallback(() => {
    if (navigateIntervalRef.current) {
      clearInterval(navigateIntervalRef.current)
      navigateIntervalRef.current = null
    }
    setNavigateCountdown(null)
  }, [])

  useEffect(() => {
    if (navigateCountdown === 0) {
      stopAutoNavigate()
      navigate(ROUTES.dashboard.tasks)
    }
  }, [navigateCountdown, navigate, stopAutoNavigate])

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

  return (
    <div className="flex flex-col h-full p-3 sm:p-6 overflow-x-hidden min-w-0 max-w-[1600px] mx-auto w-full">
      {/* ── Fixed header section (flex-shrink-0) ──────────────────── */}
      <div className="flex-shrink-0">
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
      </div>

      {/* ── Two-column layout: wizard + AI sidebar on lg+ ──────────
          `flex-1 min-h-0` lets this area fill remaining height and
          scroll independently — the page no longer scrolls as a whole. */}
      <div
        data-testid="publish-grid-container"
        className={cn(
          // Default `items-stretch` (no override) so the wizard column
          // and the AI aside both fill the grid's row track height —
          // their visible cards (wizard's Card chrome on the left, the
          // AI sidebar's `rounded-xl border bg-card/50 shadow-sm` on
          // the right) end at the same y-coordinate. Previously
          // `items-start` left each item at its natural content height,
          // which made the wizard card visibly shorter than the AI
          // sidebar once the latter got explicitly `h-full` from the
          // OPT-3F rewire.
          'mt-4 sm:mt-6 flex-1 min-h-0 grid gap-4 sm:gap-6 overflow-y-auto',
          aiCollapsed
            ? 'lg:grid-cols-[1fr_60px]'
            : 'lg:grid-cols-[2fr_3fr]',
        )}
      >
        <div className="flex h-full flex-col gap-4 min-w-0 min-h-0">
          <PublishWizard
            groups={groups}
            onSubmit={handleSubmitSuccess}
          />
        </div>

        <aside
          className="hidden lg:block sticky top-0 self-start h-full min-w-0"
          aria-label="AI 助手"
        >
          <PublishAiSidebar
            mode={wizardMode}
            platform={activePlatform}
            formRef={formRef}
            collapsed={aiCollapsed}
            onToggleCollapsed={handleToggleAiCollapsed}
          />
        </aside>
      </div>

      {/* ── Mobile (<lg): floating action button + bottom-sheet drawer ──
          Conditional on `isMobile` rather than relying on `lg:hidden` CSS
          alone — testing-library doesn't simulate viewport widths, so a
          `data-testid="mobile-ai-trigger"` element must be a true
          semantic signal of "FAB exists", not a CSS-hidden ghost node.
          Above lg the right-column PublishAiSidebar takes over and the
          drawer is dormant; useMobileDrawer auto-collapses `isOpen`
          if the user resizes from mobile into desktop so no two panels
          fight. */}
      {isMobile && (
        <Button
          data-testid="mobile-ai-trigger"
          onClick={open}
          aria-label="打开 AI 助手"
          className="fixed bottom-20 right-6 z-30 h-14 w-14 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Sparkles className="h-6 w-6" />
        </Button>
      )}

      <MobileAiDrawer open={isOpen} onClose={close}>
        <PublishAiSidebar
          mode={wizardMode}
          platform={activePlatform}
          formRef={formRef}
        />
      </MobileAiDrawer>
    </div>
  )
}
