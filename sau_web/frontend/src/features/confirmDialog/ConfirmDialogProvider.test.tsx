// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/ConfirmDialogProvider.test.tsx
//
// Round-OPT-prefs-dialog v8 — Provider-mode integration test.
//
// Locks the CROSS-SURFACE TRIGGER contract that the v6 slice
// replication established. The unit tests on `DeleteApiKeyConfirm`
// covered the controlled-component mode; THIS file locks the
// Provider-mode half — operators who wire the imperative API
// from sibling dashboards (sidebar, command palette, keyboard
// shortcut, etc.) into a single AppShell-level Provider +
// composite.
//
// Boundary conditions targeted:
//   1. Hook outside Provider throws loudly (NOT silent
//      undefined-return). Dropping the Provider wrapper must
//      fail at the first `request({...})` call site.
//   2. Provider + composite renders the right tab body per kind.
//   3. `confirm()` and `cancel()` resolve state back to
//      `open=false` + `currentRequest=null` — locks the
//      "modal stays open after a successful confirm" trap.
//   4. `onConfirmExternal` ref-capture: the LATEST callback is
//      always invoked, NOT the one captured at request time.
//      This locks the cross-surface callback trap — a sidebar
//      trigger that swaps its onConfirm handler on next render
//      must reach the new handler, not the stale one.
//   5. Concurrent requests last-wins: `request(A)` then
//      `request(B)` mid-modal keeps B, drops A.
//   6. Provider WITHOUT composite: trigger registers a state
//      transition but no UI shows. This locks the "Provider
//      mode interrupted" trap — a future shell that drops the
//      `<ConfirmDialog />` mount sees state-machine changes
//      but no visual feedback.
//   7. Nested Providers: each subtree reads its own Provider.
//   8. Multiple consumers in same subtree read the SAME state.
//      Locks cross-surface READ consistency — the modal is
//      driven by ONE provider but observed from many siblings.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TestProviders } from '@/test-utils/TestProviders'
import {
  ConfirmDialog,
  ConfirmDialogProvider,
  useConfirmDialog,
  type ConfirmRequest,
} from './index'

interface TestConsumerProps {
  /** When set (and contains a `kind`), the consumer calls
   * `request(trigger)` once on mount via effect. */
  trigger?: ConfirmRequest
  /** When true, the consumer additionally exposes confirm +
   * cancel callback buttons (data-testid="confirm-btn" /
   * "cancel-btn") so the parent test can drive confirm/cancel
   * paths imperatively. */
  withControls?: boolean
}

function TestConsumer({ trigger, withControls }: TestConsumerProps) {
  const { open, currentRequest, request, confirm, cancel } = useConfirmDialog()

  useEffect(() => {
    if (trigger) request(trigger)
  }, [trigger, request])

  // Discriminator for the `deleteApiKey` sub-kind — exposed to
  // test assertions so they can verify the right kind branch
  // rendered via CONFIRM_COPY.
  const targetType =
    currentRequest && currentRequest.kind === 'deleteApiKey'
      ? currentRequest.target.type
      : 'null'

  return (
    <>
      <output data-testid="open">{String(open)}</output>
      <output data-testid="kind">{currentRequest?.kind ?? 'null'}</output>
      <output data-testid="target-type">{targetType}</output>
      {withControls && (
        <>
          <button
            data-testid="confirm-btn"
            onClick={() => void confirm()}
          >
            confirm-stub
          </button>
          <button data-testid="cancel-btn" onClick={cancel}>
            cancel-stub
          </button>
        </>
      )}
    </>
  )
}

describe('ConfirmDialogProvider + hook (provider-mode integration)', () => {
  it('throws when useConfirmDialog() is called outside a Provider', () => {
    // The provider-mode hook contract: silently returning
    // undefined would let a future shell mount a Sidebar
    // trigger site that fails mid-flow at the first
    // `request(...)` call. Loud throw at hook-read time
    // shifts the failure to the first render instead.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <TestProviders>
          <TestConsumer />
        </TestProviders>,
      ),
    ).toThrow(/useConfirmDialog must be used within a ConfirmDialogProvider/)
    errSpy.mockRestore()
  })

  it('renders closed (open=false, currentRequest=null) when no request fires', () => {
    render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    expect(screen.getByTestId('open').textContent).toBe('false')
    expect(screen.getByTestId('kind').textContent).toBe('null')
  })

  it('transitions opened (open=true, currentRequest set) after request()', async () => {
    render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 7 },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    expect(screen.getByTestId('kind').textContent).toBe('deleteApiKey')
    expect(screen.getByTestId('target-type').textContent).toBe('single')
  })

  it('renders the right tab body via CONFIRM_COPY based on kind', async () => {
    // Switching the trigger kind flips the title rendered by
    // the composite (it reads from CONFIRM_COPY). The test
    // asserts the right `确认删除` / `确认删除历史记录` title
    // shows up in each branch.
    const { rerender } = render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 1 },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByText('确认删除')).toBeInTheDocument()
    })

    // Switch to the other kind → title should be different.
    rerender(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            trigger={{ kind: 'deleteHistoryEntry', entryId: 'h-1' }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByText('确认删除历史记录')).toBeInTheDocument()
    })
  })

  it('confirm() resolves: open=false + currentRequest=null post-click', async () => {
    render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            withControls
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 1 },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    screen.getByTestId('confirm-btn').click()
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('false')
    })
    expect(screen.getByTestId('kind').textContent).toBe('null')
  })

  it('cancel() resolves symmetric path (open=false + currentRequest=null)', async () => {
    render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            withControls
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 1 },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    screen.getByTestId('cancel-btn').click()
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('false')
    })
    expect(screen.getByTestId('kind').textContent).toBe('null')
  })

  it('cross-surface prop ref-sync: latest onConfirmExternal wins across re-renders', async () => {
    // The Provider stores `onConfirmExternal` in a useRef-updated
    // pattern via `useEffect[onConfirmExternal]` — when the prop
    // REFERENCES change (a new function instance at the same prop
    // site), the ref points at the LATEST function on every confirm.
    // This locks down the cross-surface callback trap: a sidebar
    // trigger that swaps its onConfirm handler between renders still
    // reaches the new handler, NOT the stale closure from the first
    // request.
    //
    // DISTINCT REFERENCE: this test uses two different handler
    // instances (handlerA vs handlerB) directly — simpler than the
    // previous mutable-ref-through-closure indirection and exercises
    // the Provider's useEffect[onConfirmExternal] prop-sync path
    // explicitly.
    const handlerA = vi.fn()
    const handlerB = vi.fn()
    const { rerender } = render(
      <TestProviders>
        <ConfirmDialogProvider onConfirmExternal={handlerA}>
          <TestConsumer
            withControls
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 1 },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    screen.getByTestId('confirm-btn').click()
    await waitFor(() => {
      expect(handlerA).toHaveBeenCalledTimes(1)
    })

    // Re-render Provider with handlerB (DISTINCT REFERENCE). The
    // Provider's useEffect[onConfirmExternal] ref-sync path picks
    // up the new reference; the next confirm fires handlerB.
    rerender(
      <TestProviders>
        <ConfirmDialogProvider onConfirmExternal={handlerB}>
          <TestConsumer
            withControls
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'all' },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    screen.getByTestId('confirm-btn').click()
    await waitFor(() => {
      expect(handlerB).toHaveBeenCalledTimes(1)
    })
    // handlerA is NOT called a second time — proves ref-capture
    // is working (not stale closure).
    expect(handlerA).toHaveBeenCalledTimes(1)
  })

  it('concurrent request: last-write-wins (prior request is dropped)', async () => {
    // Two requests fire in quick succession. The Provider's
    // `setRequest(req)` is a plain replacement, so the SECOND
    // wins and the first is lost. This is the correct dialog
    // semantics — an alert modal can only show one body, and
    // a duplicate trigger should NOT queue. Locks the
    // "request queueing trap" boundary a future maintainer
    // might accidentally introduce.
    const { rerender } = render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 1 },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('target-type').textContent).toBe('single')
    })
    rerender(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'all' },
            }}
          />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('target-type').textContent).toBe('all')
    })
  })

  it('locks "Provider mode interrupted": Provider WITHOUT composite still drives state', async () => {
    // Locks the boundary: if a future shell stops rendering
    // `<ConfirmDialog />` (route change, dashboard composer
    // refactor, intentional split), the Provider still
    // accepts `request(...). The trigger fires a state
    // transition but no UI visible — calling out the
    // boundary condition explicitly so a future PR adding
    // back the composite can verify state-bridge integrity.
    render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer
            trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 1 },
            }}
          />
          {/* intentionally NO <ConfirmDialog /> */}
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    // State changes (open=true, kind=deleteApiKey), but no
    // dialog UI surfaces.
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    expect(screen.getByTestId('kind').textContent).toBe('deleteApiKey')
    // Body rendering is absent — `queryByText` returns null.
    expect(screen.queryByText('确认删除')).toBeNull()
  })

  it('two consumers in the same subtree read the SAME state (cross-surface read consistency)', async () => {
    // Locks the boundary: a sidebar SidebarPanel + a CommandPalette
    // both consume the same Provider and both see the same
    // modal state — neither sees a stale snapshot from the
    // other trigger site.
    render(
      <TestProviders>
        <ConfirmDialogProvider>
          <TestConsumer trigger={{ kind: 'deleteApiKey', target: { type: 'all' } }} />
          <ConsumerProbe />
          <ConfirmDialog />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    // Both probes show open=true (same Provider, same state).
    expect(screen.getByTestId('probe-open').textContent).toBe('true')
    expect(screen.getByTestId('probe-kind').textContent).toBe('deleteApiKey')
  })

  it('nested Providers: inner subtree reads inner-Provider state, outer trigger is invisible there', async () => {
    // Locks the boundary: a global `<ConfirmDialogProvider>` at
    // AppShell + a localized nested Provider at a sub-component.
    // Inner calls hit INNER provider only — outer state is
    // unchanged. This is the canonical "provider fan-out"
    // that a future scoped slice (e.g. AccountGroupDialog
    // local confirm) might need.
    render(
      <TestProviders>
        {/* Outer provider */}
        <ConfirmDialogProvider>
          <ConfirmDialog />
          {/* Inner provider with a separate consumer that
              triggers via inner. The outer-side TestConsumer
              should still see no request. */}
          <ConfirmDialogProvider>
            <TestConsumer trigger={{
              kind: 'deleteApiKey',
              target: { type: 'single', id: 1 },
            }} />
          </ConfirmDialogProvider>
          {/* Outer-side probe: should be open=false + kind=null
              because the inner consumer's request goes to the
              inner Provider, not the outer one. */}
          <ConsumerProbe />
        </ConfirmDialogProvider>
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
    })
    expect(screen.getByTestId('kind').textContent).toBe('deleteApiKey')
    // Outer probe is unaffected.
    expect(screen.getByTestId('probe-open').textContent).toBe('false')
    expect(screen.getByTestId('probe-kind').textContent).toBe('null')
  })
})

/** Second consumer used to verify cross-subtree state readability.
 * Same hook, different component identity. */
function ConsumerProbe() {
  const { open, currentRequest } = useConfirmDialog()
  return (
    <>
      <output data-testid="probe-open">{String(open)}</output>
      <output data-testid="probe-kind">
        {currentRequest?.kind ?? 'null'}
      </output>
    </>
  )
}
