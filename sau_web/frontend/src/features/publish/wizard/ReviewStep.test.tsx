import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { usePublishWizardStore } from '@/stores/publishWizardStore'
import { ReviewStep } from './ReviewStep'
import type { GroupSelection } from '../GroupPublishSelector'

/**
 * LOW-pass regression — locks ReviewStep's target-platform rendering
 * branches:
 *
 *   A. **0-platform fallback banner** — when `groupSelection` is
 *      non-null AND `platforms.length === 0`, render the warning
 *      banner (`未选择发布平台` / 提示返回第 1 步). This is the
 *      defense-in-depth signal: the wizard's `canProceed` gate
 *      normally blocks reaching step 2 with 0 platforms, but races
 *      between GroupPublishSelector toggles and store propagation
 *      can land the user here. The banner replaces the
 *      `将发布到 0 个平台` panel so the UI reads as "diagnostic" not
 *      "all green".
 *
 *   B. **null groupSelection → muted "0 platforms" inner panel** —
 *      `groupSelection` is null reads as "no group bound yet" rather
 *      than diagnostic. The wizard's `canProceed` blocks submission
 *      in this state, so the muted panel correctly signals "nothing
 *      selected" without alarm.
 *
 *   C. **≥1 platform → chip cluster renders** — the inner panel shows
 *      `将发布到 N 个平台` plus per-platform chips with their
 *      Chinese labels via `PlatformIcon` + `PLATFORMS` lookup.
 *
 * Mock contract:
 *   - `usePublishWizardStore` left real so `beforeEach(reset())` and
 *     direct `.getState().setContent(...)` writes drive the store
 *     (same mixer pattern the PublishSuite uses).
 *   - `@/api/client` is stubbed so `import { api, PLATFORMS }` from
 *     ReviewStep's module-level import resolves without touching the
 *     network / cookies. PLATFORMS gets a 3-row fixture mirroring the
 *     real one for label lookup in case (C).
 *   - `motion/react` left real — `vite.config.ts` inlines motion for
 *     fast tests, and the DOM after layout-clean-up equals a
 *     div + child block render.
 */

vi.mock('@/api/client', () => ({
  api: {
    uploadVideo: vi.fn().mockResolvedValue({
      success: true,
      data: { task_id: 'mock-video-task-id' },
    }),
    uploadNoteMultipart: vi.fn().mockResolvedValue({
      success: true,
      data: { task_id: 'mock-note-task-id' },
    }),
    generateMessagesStream: vi.fn(),
  },
  PLATFORMS: [
    { value: 'douyin', label: '抖音' },
    { value: 'bilibili', label: 'B站' },
    { value: 'tencent', label: '视频号' },
  ],
}))

function reset() {
  usePublishWizardStore.getState().reset()
}

function mountReviewStep(
  props: Partial<React.ComponentProps<typeof ReviewStep>> = {},
) {
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={['/app/publish']}>
      <ReviewStep
        groupSelection={null}
        previewUrls={[]}
        previewFileType={null}
        onSubmit={vi.fn()}
        submitRef={{ current: null }}
        {...props}
      />
    </TestProviders>,
  )
}

beforeEach(() => {
  reset()
})

describe('ReviewStep · target-platform rendering branches (LOW-pass regression)', () => {
  // ── A. 0-platform fallback banner ────────────────────────────────

  it('renders the defensive warning banner when groupSelection has 0 platforms', () => {
    const groupSelection: GroupSelection = {
      platforms: [],
      mappings: [],
    }
    mountReviewStep({ groupSelection })

    expect(screen.getByText('未选择发布平台')).toBeInTheDocument()
    expect(
      screen.queryByText(/将发布到 \d+ 个平台/),
    ).not.toBeInTheDocument()
  })

  // ── B. null groupSelection → muted inner panel ───────────────────

  it('renders the muted "0 个平台" inner panel when groupSelection is null', () => {
    mountReviewStep({ groupSelection: null })

    // No banner (banner requires non-null groupSelection).
    expect(screen.queryByText('未选择发布平台')).not.toBeInTheDocument()

    // Inner panel renders with 0 platforms — NOT a diagnostic banner.
    expect(screen.getByText('将发布到 0 个平台')).toBeInTheDocument()
  })

  // ── C. ≥1 platform → chip cluster ────────────────────────────────

  it('renders the chip cluster when at least one platform is selected', () => {
    const groupSelection: GroupSelection = {
      platforms: ['douyin', 'bilibili'],
      mappings: [
        { platform: 'douyin', cookieFile: 'a' },
        { platform: 'bilibili', cookieFile: 'b' },
      ],
    }
    mountReviewStep({ groupSelection })

    expect(screen.getByText('将发布到 2 个平台')).toBeInTheDocument()
    // Per-platform chips via PLATFORMS lookup.
    expect(screen.getByText('抖音')).toBeInTheDocument()
    expect(screen.getByText('B站')).toBeInTheDocument()
    // Banner must NOT show.
    expect(screen.queryByText('未选择发布平台')).not.toBeInTheDocument()
  })

  // ── Bonus · content fields render (sanity) ───────────────────────

  it('renders title (未填写 fallback) + body label per mode', () => {
    // Default store mode is 'video' — body label is "视频简介" with
    // fallback placeholder. Both the title field AND the body field
    // render the same `（未填写）` fallback when their content is
    // empty; the assertion uses `getAllByText` so the dual render
    // surfaces as `.toHaveLength(2)` rather than throwing on
    // `Found multiple elements`.
    mountReviewStep({ groupSelection: null })

    expect(screen.getByText('标题')).toBeInTheDocument()
    expect(screen.getByText('视频简介')).toBeInTheDocument()
    expect(screen.getAllByText('（未填写）')).toHaveLength(2)
  })
})
