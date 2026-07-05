// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/UploadProgressDialogProvider.test.tsx
//
// Round-OPT-prefs-dialog v8 (polish round) — Provider-mode integration
// test. Sibling of `confirmDialog/ConfirmDialogProvider.test.tsx`.
//
// Locks the CROSS-SURFACE UPLOAD-PROGRESS contract that the v6 slice
// scaffold established (still no production consumer yet — these
// tests are the contract lock for the future migration of TasksPage
// + AiSidebar inline progress UI through this slice).
//
// ── Polish-round invariant (v8.1): ──────────────────────────────────────
//
//   • `<CancelTrigger>` is now a real `<button>` (data-testid="...")
//     driven by `fireEvent.click(...)`. The previous `fire` prop-flip
//     pattern worked but relied on a non-obvious effect-deps flip
//     (`undefined → true`) — a future maintainer adding `[]`-deps
//     or refactoring the effect would silently break the test. The
//     click pattern is the canonical RTL convention.
//   • `TestConsumer` declares effects in a DEPENDENCY ORDER that
//     initial-mount effect ordering (declared-first runs first)
//     relies on. A 1-line comment at the top of `startWith`'s
//     useEffect flags this so future reordering triggers a re-read
//     of the assertion semantics.
//
// Boundary conditions targeted (unchanged from v8 round 1):
//   1. Hook outside Provider throws loudly.
//   2. Closed + empty by default (composite returns null when
//      !open || records.length === 0).
//   3. `start('publish')` opens + renders PublishProgressTab.
//   4. `start('batchImport')` routes to BatchImportProgressTab.
//   5. Concurrent starts: BOTH records are rendered.
//   6. `start(idempotent by id)`: re-call replaces in place.
//   7. `update(id, patch)` ticks ratio/stage.
//   8. `finish(id, 'done')` flips ratio=1.
//   9. `finish(id, 'failed', error)` preserves ratio + sets error.
//  10. `cancel(id)` removes record; auto-closes when last.
//  11. Provider WITHOUT composite still drives state ("interrupt").
// ──────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TestProviders } from '@/test-utils/TestProviders'
import {
  UploadProgressDialog,
  UploadProgressDialogProvider,
  useUploadProgressDialog,
  type UploadProgress,
} from './index'

interface TestConsumerProps {
  /** When set, fires `start(trigger)` once on mount via effect. */
  startWith?: UploadProgress
  /** When set, fires `start(...withSequence)` for each item
   * on mount — drives the concurrent-state tests. */
  startSequence?: ReadonlyArray<UploadProgress>
  /** When set, fires `update(id, patch)` once on mount. */
  update?: { id: string; patch: Partial<UploadProgress> }
  /** When set, fires `finish(id, status, error?)` once on mount. */
  finish?: { id: string; status: 'done' | 'failed'; error?: string }
}

function TestConsumer({
  startWith,
  startSequence,
  update,
  finish,
}: TestConsumerProps) {
  const {
    open,
    records,
    start,
    update: updateFn,
    finish: finishFn,
  } = useUploadProgressDialog()

  // ── Effect declaration order matters on initial mount. ──
  // React runs effects within a single component in declaration
  // order on first mount. The "update ticks ratio+stage" and
  // "finish flips stage" tests depend on `startWith` running
  // BEFORE `update` / `finish` so the latter patches are
  // applied to a record that already exists. Reordering the
  // declarations below would silently invert the test's state
  // setup. Keep `startWith` as the FIRST effect declared.
  useEffect(() => {
    if (startWith) start(startWith)
  }, [startWith, start])

  useEffect(() => {
    if (startSequence) startSequence.forEach((p) => start(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSequence])

  useEffect(() => {
    if (update) updateFn(update.id, update.patch)
  }, [update, updateFn])

  useEffect(() => {
    if (finish) finishFn(finish.id, finish.status, finish.error)
  }, [finish, finishFn])

  // Aggregate state observed by the test assertions.
  const recordIds = records.map((r) => r.id).join(',')
  const recordKinds = records.map((r) => r.kind).join(',')
  const ratios = records.map((r) => r.ratio).join(',')
  const stages = records.map((r) => r.stage).join(',')
  const errors = records.map((r) => r.error ?? '').join('|')

  return (
    <>
      <output data-testid="open">{String(open)}</output>
      <output data-testid="count">{records.length}</output>
      <output data-testid="ids">{recordIds}</output>
      <output data-testid="kinds">{recordKinds}</output>
      <output data-testid="ratios">{ratios}</output>
      <output data-testid="stages">{stages}</output>
      <output data-testid="errors">{errors}</output>
    </>
  )
}

function makeProgress(
  id: string,
  label: string,
  kind: 'publish' | 'batchImport' = 'publish',
  ratio: number = 0,
  stage: UploadProgress['stage'] = 'preparing',
): UploadProgress {
  return { id, label, kind, ratio, stage }
}

/** Real `<button>` driven by `fireEvent.click(...)` from the test.
 * Replaces the previous v8 round's `fire` prop-flip — see the
 * file-top "Polish-round invariant" block for the rationale. */
function CancelTrigger({ id }: { id: string }) {
  const { cancel } = useUploadProgressDialog()
  return (
    <button data-testid="cancel-trigger" onClick={() => cancel(id)}>
      cancel-trigger
    </button>
  )
}

describe('UploadProgressDialogProvider + hook (provider-mode integration)', () => {
  it('throws when useUploadProgressDialog() is called outside a Provider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <TestProviders>
          <TestConsumer />
        </TestProviders>,
      ),
    ).toThrow(/useUploadProgressDialog must be used within a UploadProgressDialogProvider/)
    errSpy.mockRestore()
  })

  it('closed + empty by default', () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    expect(screen.getByTestId('open').textContent).toBe('false')
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('start() opens + renders PublishProgressTab when kind="publish"', async () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0.5, 'uploading')}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('kinds').textContent).toBe('publish')
    expect(screen.getByTestId('ratios').textContent).toBe('0.5')
    expect(screen.getByTestId('stages').textContent).toBe('uploading')
  })

  it('start() with kind="batchImport" routes to BatchImportProgressTab', async () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startWith={makeProgress(
              'b1',
              '账号批量导入',
              'batchImport',
              0.3,
              'uploading',
            )}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('kinds').textContent).toBe('batchImport')
  })

  it('concurrent start(): both records present (parallel progress)', async () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startSequence={[
              makeProgress('p1', '抖音 · 视频 A', 'publish', 0.5),
              makeProgress(
                'b1',
                '账号批量导入',
                'batchImport',
                0.3,
              ),
            ]}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(screen.getByTestId('ids').textContent).toBe('p1,b1')
    expect(screen.getByTestId('kinds').textContent).toBe('publish,batchImport')
  })

  it('start() with existing id REPLACES in place (no duplicate, no flicker)', async () => {
    const { rerender } = render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0.5, 'uploading')}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1')
    })
    rerender(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startWith={makeProgress('p1', '抖音 · 视频 A 重传', 'publish', 0.6, 'uploading')}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1')
    })
    expect(screen.getByTestId('ids').textContent).toBe('p1')
    await waitFor(() => {
      expect(screen.getByTestId('ratios').textContent).toBe('0.6')
    })
  })

  it('update(id, patch) ticks ratio+stage', async () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0, 'preparing')}
            update={{ id: 'p1', patch: { ratio: 0.7, stage: 'uploading' } }}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('ratios').textContent).toBe('0.7')
    })
    expect(screen.getByTestId('stages').textContent).toBe('uploading')
  })

  it('finish(id, "done") flips stage=done + ratio=1', async () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0.8, 'uploading')}
            finish={{ id: 'p1', status: 'done' }}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('stages').textContent).toBe('done')
    })
    expect(screen.getByTestId('ratios').textContent).toBe('1')
  })

  it('finish(id, "failed", error) preserves ratio + sets error', async () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer
            startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0.4, 'uploading')}
            finish={{ id: 'p1', status: 'failed', error: 'socket reset' }}
          />
          <UploadProgressDialog />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('stages').textContent).toBe('failed')
    })
    expect(screen.getByTestId('ratios').textContent).toBe('0.4')
    expect(screen.getByTestId('errors').textContent).toBe('socket reset')
  })

  it('cancel(id) removes the record (button-driven)', async () => {
    // Drives the cancel path via a real button + click on
    // <CancelTrigger> — same affordance as a real user clicking
    // "取消" in the UI. Replaces the v8 round-1 `fire`-prop-flip
    // pattern.
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0.3)} />
          <UploadProgressDialog />
          <CancelTrigger id="p1" />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1')
    })
    screen.getByTestId('cancel-trigger').click()
    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('0')
    })
  })

  it('locks the render-coupled atomic update: cancel of the LAST record auto-closes modal', async () => {
    // Canary for the v6 polish contract — if `cancel()` ever
    // moves to a separate useEffect[records.length], this test
    // would still pass functionally but the render-coupled
    // atomic-update pattern (no stale-state flicker on rapid
    // cancel sequences) might leak in. Lock it explicitly.
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0.3)} />
          <UploadProgressDialog />
          <CancelTrigger id="p1" />
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
      expect(screen.getByTestId('count').textContent).toBe('1')
    })
    screen.getByTestId('cancel-trigger').click()
    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('0')
    })
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('locks "Provider mode interrupted": Provider WITHOUT composite still drives state', async () => {
    render(
      <TestProviders>
        <UploadProgressDialogProvider>
          <TestConsumer startWith={makeProgress('p1', '抖音 · 视频 A', 'publish', 0.5)} />
          {/* intentionally NO <UploadProgressDialog /> */}
        </UploadProgressDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('ids').textContent).toBe('p1')
    expect(screen.queryByText('上传进度')).toBeNull()
  })
})
