import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from '@/lib/router/useSearchParams'
import { motion, AnimatePresence } from 'motion/react'
import { GroupPublishSelector } from '../GroupPublishSelector'
import { StepIndicator } from './StepIndicator'
import { WizardNav } from './WizardNav'
import { UploadStep } from './UploadStep'
import { ContentStep } from './ContentStep'
import { ReviewStep } from './ReviewStep'
import { usePublishWizardStore, type WizardStep } from '@/stores/publishWizardStore'
import type { AccountGroup } from '@/api/client'
import type { PlatformSpecificSection } from '../GroupPublishSelector'
import { parseScheduleParam } from '../schedulePresets'

/**
 * §11.1 + §11.7 — PublishWizard: the main container that orchestrates
 * the 3-step publish flow (Upload → Content → Review).
 *
 * Replaces the previous single-form layout in PublishPage. The wizard:
 *   - Renders StepIndicator at the top
 *   - Shows the current step's component with AnimatePresence transitions
 *   - Renders WizardNav at the bottom (sticky on mobile)
 *   - Syncs `?step=N` to the URL so browser back/forward navigates steps
 *   - Tracks `maxVisitedStep` so the StepIndicator allows click-back
 *
 * The GroupPublishSelector sits above the step content so the user can
 * change their target platforms at any point in the flow.
 */

interface PublishWizardProps {
  groups: AccountGroup[]
  onSubmit: (info: { count: number; taskIds: string[]; failedCount: number; mode: '视频' | '图文' }) => void
}

export const PublishWizard = memo(function PublishWizard({
  groups,
  onSubmit,
}: PublishWizardProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentStep = usePublishWizardStore((s) => s.currentStep)
  const setStep = usePublishWizardStore((s) => s.setStep)
  const nextStep = usePublishWizardStore((s) => s.nextStep)
  const prevStep = usePublishWizardStore((s) => s.prevStep)
  const canProceed = usePublishWizardStore((s) => s.canProceed())
  const proceedReason = usePublishWizardStore((s) => s.proceedReason())
  const reset = usePublishWizardStore((s) => s.reset)
  const mode = usePublishWizardStore((s) => s.mode)

  const groupSelection = usePublishWizardStore((s) => s.groupSelection)
  const setGroupSelection = usePublishWizardStore((s) => s.setGroupSelection)
  const [maxVisitedStep, setMaxVisitedStep] = useState<WizardStep>(0)
  const [submitting, setSubmitting] = useState(false)

  // Preview data for the ReviewStep
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [previewFileType, setPreviewFileType] = useState<'video' | 'image' | null>(null)
  // Ref that ReviewStep populates with its submit handler, so
  // WizardNav's final-step button can trigger it imperatively.
  const submitRef = useRef<(() => Promise<void>) | null>(null)

  // ── OPT-3G (wizard port) — controlled advanced Accordion state ───────
  // GroupPublishSelector's "N 项平台专属待配置" chip calls
  // `handleExpandAdvanced` (single-shot: opens Accordion + sets the
  // ring highlight on the matching platform section in ContentStep).
  // The accordion itself stays controlled so future affordances
  // (a sidebar quick-jump, a hotkey, an AI sidebar overlay) can
  // drive the same surface without re-rendering ContentStep.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [highlightedSection, setHighlightedSection] =
    useState<PlatformSpecificSection | null>(null)

  const handleExpandAdvanced = useCallback(
    (platform: PlatformSpecificSection) => {
      setAdvancedOpen(true)
      setHighlightedSection(platform)
    },
    [],
  )

  // ── §11.7: URL state sync — `?step=N` ──────────────────────────────
  // On mount, read the step from the URL. On step change, write it back.
  // Browser back/forward triggers the searchParams effect which calls
  // setStep — so the wizard naturally responds to history navigation.
  useEffect(() => {
    const urlStep = Number(searchParams.get('step'))
    if (!Number.isNaN(urlStep) && urlStep >= 0 && urlStep <= 2) {
      setStep(urlStep as WizardStep)
    }
    // Calendar deep-link: seed schedule once from `?schedule=`.
    const schedule = parseScheduleParam(searchParams.get('schedule'))
    if (schedule) {
      const current = usePublishWizardStore.getState().content.schedule
      if (!current.trim()) {
        usePublishWizardStore.getState().setSchedule(schedule)
      }
      // Jump to content step so schedule field is reachable.
      if (usePublishWizardStore.getState().currentStep < 1) {
        setStep(1)
      }
      const next = new URLSearchParams(searchParams)
      next.delete('schedule')
      if (!next.has('step')) next.set('step', '1')
      setSearchParams(next, { replace: true })
    }
    // Only run on mount — we don't want this to fight with our own writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    const current = String(currentStep)
    if (next.get('step') !== current) {
      next.set('step', current)
      setSearchParams(next, { replace: true })
    }
    // Track the furthest step the user has reached.
    setMaxVisitedStep((prev) => (currentStep > prev ? currentStep : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep])

  // ── Navigation handlers ────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (currentStep === 2) {
      // Final step — trigger the ReviewStep's submit via the ref.
      if (submitRef.current) {
        setSubmitting(true)
        void submitRef.current().finally(() => setSubmitting(false))
      }
      return
    }
    nextStep()
  }, [currentStep, nextStep])

  const handlePrev = useCallback(() => {
    prevStep()
  }, [prevStep])

  const handleStepClick = useCallback(
    (step: WizardStep) => {
      if (step <= maxVisitedStep) setStep(step)
    },
    [maxVisitedStep, setStep],
  )

  // ── Submit handler ─────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (info: { count: number; taskIds: string[]; failedCount: number; mode: '视频' | '图文' }) => {
      setSubmitting(false)
      // Reset the wizard to step 0 after a successful submit.
      reset()
      setMaxVisitedStep(0)
      // Clear the URL step param.
      const next = new URLSearchParams(searchParams)
      next.delete('step')
      setSearchParams(next, { replace: true })
      onSubmit(info)
    },
    [reset, searchParams, setSearchParams, onSubmit],
  )

  // ── Preview data callbacks from steps ──────────────────────────────
  const handleUploadFormChange = useCallback(
    (urls: string[], fileType: 'video' | 'image' | null) => {
      setPreviewUrls(urls)
      setPreviewFileType(fileType)
    },
    [],
  )

  // Reset `groupSelection` only on actual mode flips between
  // video ↔ note. The original PublishPage effect fired on every
  // first mount (`mode='video'` was already in deps), wiping any
  // pre-existing pick — so a user who picked accounts and was then
  // routed back to /dashboard/publish lost their pick silently.
  // `modeHasMounted` ref gate skips the first commit, leaving the
  // reset to fire only on real mode transitions.
  const modeHasMounted = useRef(false)
  useEffect(() => {
    if (!modeHasMounted.current) {
      modeHasMounted.current = true
      return
    }
    setGroupSelection(null)
  }, [mode, setGroupSelection])

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* ── Group selector (always visible) ───────────────────── */}
      <GroupPublishSelector
        groups={groups}
        mode={mode}
        value={groupSelection}
        onChange={setGroupSelection}
        onExpandAdvanced={handleExpandAdvanced}
      />

      {/* ── Step indicator ────────────────────────────────────── */}
      <StepIndicator
        currentStep={currentStep}
        onStepClick={handleStepClick}
        maxVisitedStep={maxVisitedStep}
        stepReady={canProceed}
      />

      {/* ── Step content (animated transitions) ───────────────── */}
      {/* `y` 而不是 `x`：wizard 是垂直堆叠的子组件树，左右滑动
          在单列布局里不留任何上下文线索；上下淡入 + 8px 限移
          才能读出“上一歩退出 下一歩进入”的语义。 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {currentStep === 0 && (
            <UploadStep
              groupSelection={groupSelection}
              onFormChange={handleUploadFormChange}
            />
          )}
          {currentStep === 1 && (
            <ContentStep
              groupSelection={groupSelection}
              advancedOpen={advancedOpen}
              onAdvancedChange={setAdvancedOpen}
              highlightedSection={highlightedSection}
            />
          )}
          {currentStep === 2 && (
            <ReviewStep
              groupSelection={groupSelection}
              previewUrls={previewUrls}
              previewFileType={previewFileType}
              onSubmit={handleSubmit}
              submitRef={submitRef}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Bottom navigation ─────────────────────────────────── */}
      <WizardNav
        currentStep={currentStep}
        canProceed={canProceed}
        disabledReason={proceedReason ?? undefined}
        onPrev={handlePrev}
        onNext={handleNext}
        submitting={submitting}
      />
    </div>
  )
})
