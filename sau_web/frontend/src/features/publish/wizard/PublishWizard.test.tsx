import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { usePublishWizardStore } from '@/stores/publishWizardStore'
import { ROUTES } from '@/routes'
import { PublishWizard } from './PublishWizard'

// ── framework-level mocks (must precede under-test imports) ─────────────

// The wizard's step components all reach into backend APIs / file
// pickers / modal flows. Stubbing them keeps the test focused on the
// wizard's structural contract: GroupPublishSelector + StepIndicator +
// step content + WizardNav. Each stub carries a `data-testid` so
// accidental cross-talk with the real components is loud at render
// time, not silent at assertion time.
vi.mock('./UploadStep', () => ({
  UploadStep: () => <div data-testid="mocked-upload-step" />,
}))
vi.mock('./ContentStep', () => ({
  ContentStep: () => <div data-testid="mocked-content-step" />,
}))
vi.mock('./ReviewStep', () => ({
  ReviewStep: () => <div data-testid="mocked-review-step" />,
}))
vi.mock('./StepIndicator', () => ({
  StepIndicator: () => <div data-testid="mocked-step-indicator" />,
}))
vi.mock('./WizardNav', () => ({
  WizardNav: () => <div data-testid="mocked-wizard-nav" />,
}))
// GroupPublishSelector reads from usePublishWizardStore via the parent
// (no, actually it does NOT — it receives `value` + `onChange` as
// props). Stubbing it lets the test focus on the wizard's structural
// contract without exercising the full Checkbox + auth-list rendering.
vi.mock('../GroupPublishSelector', () => ({
  GroupPublishSelector: () => (
    <div data-testid="mocked-group-publish-selector" />
  ),
}))

// ── helpers ─────────────────────────────────────────────────────────────

// Reset Zustand singleton between tests so per-test `setState` doesn't
// leak into the next.
function resetWizardStore() {
  usePublishWizardStore.getState().reset()
}

function mountPublishWizard() {
  return render(
    <TestProviders
      client={makeQueryClient()}
      initialEntries={[ROUTES.dashboard.publish]}
    >
      <PublishWizard groups={[]} onSubmit={vi.fn()} />
    </TestProviders>,
  )
}

// Default-state render of every test. Resetting BEFORE the mount keeps
// each test's setState self-contained even when test ordering changes
// in CI reruns.
beforeEach(() => {
  resetWizardStore()
})

// ── tests ───────────────────────────────────────────────────────────────

describe('PublishWizard · structural render contract', () => {
  // ── 1. core components are rendered ──────────────────────────────

  // The wizard renders four structural components: GroupPublishSelector
  // (always visible), StepIndicator (progress rail), the current step's
  // content (UploadStep at step 0), and WizardNav (bottom navigation).
  // A regression that drops any of these would be caught here.
  it('renders GroupPublishSelector + StepIndicator + UploadStep + WizardNav at step 0', () => {
    mountPublishWizard()

    expect(
      screen.getByTestId('mocked-group-publish-selector'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('mocked-step-indicator'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('mocked-upload-step'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('mocked-wizard-nav'),
    ).toBeInTheDocument()
  })

  // ── 2. no redundant PlatformChipStrip rendered ───────────────────

  // The PlatformChipStrip was removed from PublishWizard because the
  // GroupPublishSelector already shows platform selection via
  // checkboxes. Locks the removal so a future regression that
  // re-adds the strip is caught here — the strip's testids
  // (`publish-wizard-platform-chips` / `inbox-platform-chip-strip`)
  // must NOT be present.
  it('does NOT render any PlatformChipStrip (redundant with GroupPublishSelector)', () => {
    mountPublishWizard()

    expect(
      screen.queryByTestId('publish-wizard-platform-chips'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('inbox-platform-chip-strip'),
    ).not.toBeInTheDocument()
  })

  // ── 3. step 0 renders UploadStep (not ContentStep or ReviewStep) ─

  // At step 0, only UploadStep should be mounted. ContentStep and
  // ReviewStep must NOT be rendered. Locks the step-content
  // conditional rendering so a regression that renders all three
  // steps at once is caught.
  it('renders only UploadStep at step 0 (not ContentStep or ReviewStep)', () => {
    mountPublishWizard()

    expect(screen.getByTestId('mocked-upload-step')).toBeInTheDocument()
    expect(screen.queryByTestId('mocked-content-step')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mocked-review-step')).not.toBeInTheDocument()
  })

  // ── 4. step 1 renders ContentStep ────────────────────────────────

  // After advancing to step 1, ContentStep should be mounted instead
  // of UploadStep.
  it('renders only ContentStep at step 1', async () => {
    mountPublishWizard()
    usePublishWizardStore.getState().setStep(1)

    await waitFor(() => {
      expect(screen.getByTestId('mocked-content-step')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('mocked-upload-step')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mocked-review-step')).not.toBeInTheDocument()
  })

  // ── 5. step 2 renders ReviewStep ────────────────────────────────

  // After advancing to step 2, ReviewStep should be mounted.
  it('renders only ReviewStep at step 2', async () => {
    mountPublishWizard()
    usePublishWizardStore.getState().setStep(2)

    await waitFor(() => {
      expect(screen.getByTestId('mocked-review-step')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('mocked-upload-step')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mocked-content-step')).not.toBeInTheDocument()
  })

  // ── 6. no mono dev metadata strip rendered ───────────────────────

  // The `sau@publish · step 01/03` mono metadata strip was removed
  // because the StepIndicator already shows step progress. Locks the
  // removal so a future regression that re-adds developer-facing
  // metadata text is caught.
  it('does NOT render the removed mono metadata strip (sau@publish)', () => {
    mountPublishWizard()

    // The removed strip contained "sau@publish" text — its absence
    // proves the strip was not re-added.
    expect(screen.queryByText(/sau@publish/)).not.toBeInTheDocument()
  })

  // ── 7. initial state — step 0, null groupSelection ───────────────

  // On initial mount with reset store, the wizard should be at step 0
  // with null groupSelection. Verifies the reset() actually brings
  // the store to its initial state.
  it('starts at step 0 with null groupSelection after store reset', () => {
    mountPublishWizard()

    expect(usePublishWizardStore.getState().currentStep).toBe(0)
    expect(usePublishWizardStore.getState().groupSelection).toBeNull()
  })

  // ── 8. onSubmit prop is wired ────────────────────────────────────

  // The wizard accepts an onSubmit callback. While the actual submit
  // logic lives in ReviewStep (mocked here), the prop should be
  // accepted without error. This is a smoke test that the wizard
  // renders without throwing when onSubmit is provided.
  it('renders without error when onSubmit prop is provided', () => {
    const onSubmit = vi.fn()
    render(
      <TestProviders client={makeQueryClient()} initialEntries={[ROUTES.dashboard.publish]}>
        <PublishWizard groups={[]} onSubmit={onSubmit} />
      </TestProviders>,
    )
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId('mocked-upload-step')).toBeInTheDocument()
  })
})
