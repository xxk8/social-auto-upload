/**
 * `useAiChat` — shared-controller contract test.
 *
 * The whole point of consolidating the panel's `sendToChat` +
 * `runEnhanceStream` into `useAiChat` is so `/fullflow` runs
 * enhance → chat-stream UNDER ONE AbortController. Cancelling during
 * phase 1 must short-circuit phase 2 before it fires.
 *
 * This file locks that contract in. We mock `api.enhancePrompt` and
 * `api.generateMessagesStream` with controllable async functions,
 * drive phase 1 long enough to be in-flight, then call `cancel()`
 * and assert phase 2 never schedules. If a future refactor splits
 * the controller across two pipelines, this test fails immediately.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatStore } from '@/stores/useChatStore'

// Mock the API client. We use `vi.hoisted` so the mock variables
// can be referenced inside the factory closure.
const enhancePromptMock = vi.hoisted(() => vi.fn())
const generateMessagesStreamMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  api: {
    enhancePrompt: (...args: unknown[]) => enhancePromptMock(...args),
    generateMessagesStream: (...args: unknown[]) => generateMessagesStreamMock(...args),
  },
}))

import { useAiChat } from './useAiChat'

/**
 * Helper: build a controllable enhance-promise that yields chunks
 * when the test calls `simulateEnhanceChunk(text)`. It never
 * resolves on its own — the test must explicitly invoke `onDone`
 * by calling the returned `simulateEnhanceDone(text)`.
 *
 * Holding the promise open is THE test scenario: it gives the
 * caller a deterministic window to fire `cancel()` mid-phase-1.
 */
function controllableEnhance() {
  let onChunk: ((c: string) => void) | undefined
  let onDone: ((s: string) => void) | undefined
  let onError: ((e: string) => void) | undefined
  // Pending Promise — stays unresolved until the test calls one
  // of the simulate* helpers. We deliberately do NOT reject early
  // because that would surface as an unhandled rejection and mask
  // whether the actual promise-handling code is buggy.
  let resolver!: () => void
  const promise = new Promise<void>((r) => {
    resolver = r
  })
  enhancePromptMock.mockImplementation((_payload, chunkCb, doneCb, errCb) => {
    onChunk = chunkCb
    onDone = doneCb
    onError = errCb
    return promise
  })
  return {
    promise,
    /**
     * Drive a chunk delivery. Mirrors the SSE `data` event the real
     * `readSSEStream` would emit.
     */
    simulateEnhanceChunk: (chunk: string) => onChunk?.(chunk),
    /**
     * Drive the SSE `done` event, then settle the underlying Promise
     * so `api.enhancePrompt` resolves.
     */
    simulateEnhanceDone: (text: string) => {
      onDone?.(text)
      resolver()
    },
    /**
     * Drive the SSE `error` event, then reject so callers see the
     * error path.
     */
    simulateEnhanceError: (msg: string) => {
      onError?.(msg)
      resolver()
    },
  }
}

function controllableChatStream() {
  generateMessagesStreamMock.mockImplementation(() => new Promise<void>(() => {}))
}

describe('useAiChat — /fullflow cancel-mid-phase-1 contract', () => {
  beforeEach(() => {
    enhancePromptMock.mockReset()
    generateMessagesStreamMock.mockReset()
    useChatStore.getState().reset()
  })

  it('phase 2 (chat-stream) NEVER fires when we cancel mid-phase-1', async () => {
    const enhance = controllableEnhance()
    controllableChatStream()

    const formRef = { current: null } as unknown as React.MutableRefObject<unknown>

    const { result } = renderHook(() =>
      useAiChat({
        formRef: formRef as React.MutableRefObject<Parameters<typeof useAiChat>[0]['formRef']['current']>,
        mode: 'video',
        model: 'test-model',
      }),
    )

    // Fire the runFullflow without awaiting — phase 1 is in-flight.
    let phase2Promise: Promise<unknown> | undefined
    await act(async () => {
      const p = result.current.runFullflow('first topic')
      // Drive a few chunks to make sure we're definitely mid-phase-1.
      enhance.simulateEnhanceChunk('请')
      enhance.simulateEnhanceChunk('生成')
      // Now fire 取消 BEFORE phase 1 completes.
      result.current.cancel()
      // Capture the outstanding promise; we'll await it shortly to
      // confirm it resolves cleanly without throwing.
      phase2Promise = p
    })

    // Critical contract: phase 2 NEVER fires.
    expect(generateMessagesStreamMock).not.toHaveBeenCalled()

    // Phase 1 still completes its `done` callback path silently
    // (the chunk/done callbacks are gated by `ctrlRef.current !== ctrl`
    // and short-circuit). Drive one more chunk + done AFTER cancel
    // to confirm dropping, then resolve the underlying Promise so
    // `runFullflow`'s await can finally settle.
    await act(async () => {
      enhance.simulateEnhanceChunk('post-cancel chunk — should be dropped')
      enhance.simulateEnhanceDone('请生成美食探店文案')
      // runFullflow should now resolve (abort listener settles phase 1
      // BEFORE the gated phase 2 ever runs).
      await phase2Promise
    })

    // Streaming draft should be cleared post-cancel.
    expect(useChatStore.getState().streamingDraft).toBe('')

    // Even though we drove `onDone` after cancel, the gate
    // (`ctrlRef.current !== ctrl`) prevented any chat-stream call.
    expect(generateMessagesStreamMock).not.toHaveBeenCalled()
  })

  it('an independent send() while /fullflow is mid-flight acquires a new controller and aborts phase 1', async () => {
    const enhance = controllableEnhance()
    controllableChatStream()

    const formRef = { current: null } as unknown as React.MutableRefObject<unknown>

    const { result } = renderHook(() =>
      useAiChat({
        formRef: formRef as React.MutableRefObject<Parameters<typeof useAiChat>[0]['formRef']['current']>,
        mode: 'video',
        model: 'test-model',
      }),
    )

    await act(async () => {
      // Start phase 1 — never completes.
      const fullflow = result.current.runFullflow('topic a')
      enhance.simulateEnhanceChunk('wait')
      // Independent send() while /fullflow is mid-flight. send()
      // calls acquire() which aborts the prior controller AND
      // schedules a new chat fetch.
      result.current.send('fresh chat turn')
      // Drive the independent sendi's stream to "complete" with a
      // tiny wait so acquire() has registered.
      await new Promise((r) => setTimeout(r, 0))
      // Drain /fullflow's hung promise. Acquire aborted the shared
      // ctrl mid-phase-1, so the abort listener settles with whatever
      // was streamed. Drive a chunk to populate `full`, then settle.
      enhance.simulateEnhanceChunk('late')
      enhance.simulateEnhanceDone('topic a enhanced')
      await fullflow
    })

    // generateMessagesStream should be called exactly once — by the
    // independent send(), NOT by /fullflow.
    expect(generateMessagesStreamMock).toHaveBeenCalledTimes(1)
  })

  it('explicit cancel() during phase 1 short-circuits before phase 2 schedules', async () => {
    const enhance = controllableEnhance()
    controllableChatStream()

    const formRef = { current: null } as unknown as React.MutableRefObject<unknown>

    const { result } = renderHook(() =>
      useAiChat({
        formRef: formRef as React.MutableRefObject<Parameters<typeof useAiChat>[0]['formRef']['current']>,
        mode: 'video',
        model: 'test-model',
      }),
    )

    let fullflow: Promise<unknown> | undefined
    await act(async () => {
      fullflow = result.current.runFullflow('topic only')
    })
    // At this point phase 1 is scheduled inside `enhancePromise`
    // (mock returns pending promise).
    expect(enhancePromptMock).toHaveBeenCalledTimes(1)
    expect(generateMessagesStreamMock).not.toHaveBeenCalled()

    // Cancel + drive phase 1 to settle.
    enhance.simulateEnhanceChunk('cancelled-mid-stream')
    await act(async () => {
      result.current.cancel()
      // Now drive phase 1's done + resolve the underlying promise.
      // The abort listener should have been called FIRST (settling
      // `fullflow`), so done's resolve falls into the `settled=true`
      // guard and is a no-op.
      enhance.simulateEnhanceDone('cancelled result')
      await fullflow
    })

    // Phase 2 still never fires.
    expect(generateMessagesStreamMock).not.toHaveBeenCalled()

    // Job status should be back to 'idle' after cancelStream.
    expect(useChatStore.getState().jobStatus).toBe('idle')

    // Streaming draft cleared.
    expect(useChatStore.getState().streamingDraft).toBe('')
  })
})
