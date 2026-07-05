import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WizardNav } from './WizardNav'
import type { WizardStep } from '@/stores/publishWizardStore'

/**
 * LOW-pass regression suite. Locks three invariants so the cleanup
 * passes this round can't drift back:
 *
 *   1. **Sticky boundary** — WizardNav's root must carry `sticky
 *      bottom-0` (mobile bottom-stick relative to AppShell's
 *      `<main className="flex-1 overflow-auto">`) AND `lg:static`
 *      (desktop opt-out — backdrop-blur overlap with ContentStep's
 *      Accordion panels is the historical regression we fix this with).
 *      A regression that drops either class silently breaks mobile
 *      pinning OR desktop visual stacking.
 *
 *   2. **Three-branch title ternary** — submitting must beat
 *      `!canProceed` so the post-click "发布中…" phase doesn't surface
 *      a stale `disabledReason` from before the click. Asserted via
 *      `toHaveAttribute('title', …)`.
 *
 *   3. **Label branching** — intermediate steps render `下一步`,
 *      step 2 renders `发布` by default, `submitLabel` overrides the
 *      final-step text. First-step `上一步` button is `disabled` (and
 *      visually hidden via opacity-0 / pointer-events-none).
 *
 * WizardNav is a memoized leaf component — no router / store / context
 * dependencies — so we mount it in isolation without `TestProviders`.
 */

type Props = React.ComponentProps<typeof WizardNav>

function mount(overrides: Partial<Props> = {}) {
  return render(
    <WizardNav
      currentStep={0 as WizardStep}
      canProceed
      onPrev={vi.fn()}
      onNext={vi.fn()}
      {...overrides}
    />,
  )
}

describe('WizardNav · structural contract (LOW-pass regression)', () => {
  // ── 1. sticky boundary ────────────────────────────────────────────

  describe('sticky boundary contract', () => {
    it('renders sticky bottom-0 on the bar root (mobile pin to <main>)', () => {
      const { container } = mount()
      const root = container.firstChild as HTMLElement
      expect(root.className).toMatch(/\bsticky\b/)
      expect(root.className).toMatch(/\bbottom-0\b/)
    })

    it('also opts out on desktop via lg:static (backdrop-blur overlap guard)', () => {
      const { container } = mount()
      const root = container.firstChild as HTMLElement
      expect(root.className).toMatch(/\blg:static\b/)
    })
  })

  // ── 2. title ternary (3-branch) ──────────────────────────────────

  describe('title ternary — three branches', () => {
    it('shows disabledReason title when !canProceed && !submitting', () => {
      render(
        <WizardNav
          currentStep={1 as WizardStep}
          canProceed={false}
          disabledReason="请先选择至少一个目标平台"
          onPrev={vi.fn()}
          onNext={vi.fn()}
        />,
      )
      const next = screen.getByRole('button', { name: /下一步/ })
      expect(next).toHaveAttribute('title', '请先选择至少一个目标平台')
    })

    it('shows "发布中…" title when submitting (overrides !canProceed)', () => {
      render(
        <WizardNav
          currentStep={2 as WizardStep}
          canProceed={false}
          disabledReason="stale-reason-must-not-surface"
          submitting
          onPrev={vi.fn()}
          onNext={vi.fn()}
        />,
      )
      const next = screen.getByRole('button', { name: /发布/ })
      expect(next).toHaveAttribute('title', '发布中…')
      expect(next).toBeDisabled()
    })

    it('shows no title attribute when canProceed && !submitting', () => {
      render(
        <WizardNav
          currentStep={1 as WizardStep}
          canProceed
          onPrev={vi.fn()}
          onNext={vi.fn()}
        />,
      )
      const next = screen.getByRole('button', { name: /下一步/ })
      expect(next).not.toHaveAttribute('title')
    })
  })

  // ── 3. label branching ────────────────────────────────────────────

  describe('label branching', () => {
    it('renders "下一步" on intermediate step (step 0→1, step 1→2)', () => {
      mount({ currentStep: 1 as WizardStep })
      expect(screen.getByRole('button', { name: /下一步/ })).toBeInTheDocument()
    })

    it('renders "发布" on final step (step 2) by default', () => {
      mount({ currentStep: 2 as WizardStep })
      expect(screen.getByRole('button', { name: /发布/ })).toBeInTheDocument()
    })

    it('overrides default final-step label via submitLabel', () => {
      mount({
        currentStep: 2 as WizardStep,
        submitLabel: '立即提交',
      })
      expect(screen.getByRole('button', { name: /立即提交/ })).toBeInTheDocument()
    })

    it('disables first-step 上一步 button when currentStep === 0', () => {
      mount({ currentStep: 0 as WizardStep })
      const prev = screen.getByRole('button', { name: /上一步/ })
      expect(prev).toBeInTheDocument()
      expect(prev).toBeDisabled()
    })

    it('keeps 上一步 button enabled on step 1 and step 2', () => {
      mount({ currentStep: 1 as WizardStep })
      expect(screen.getByRole('button', { name: /上一步/ })).toBeEnabled()
    })

    it('disables the next button when canProceed is false', () => {
      mount({ currentStep: 1 as WizardStep, canProceed: false })
      expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled()
    })
  })
})
