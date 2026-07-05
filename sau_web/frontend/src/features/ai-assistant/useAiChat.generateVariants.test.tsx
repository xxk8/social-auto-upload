/**
 * `useAiChat.generateVariants` — `/variants` dedicated SSE consumer.
 *
 * This spec locks the data-layer contract for the round where `/variants`
 * stopped being "send a chat prompt that asks the LLM to emit JSON
 * arrays" and became a real per-platform SSE consumer. The hook
 * pre-pends a single synthetic user bubble, then for each
 * `variant_result` event commits ONE assistant message as a sibling
 * of that user turn.
 *
 * Key contracts under test:
 *
 *   1. **Synchronous empty-platforms guard** — passing `platforms: []`
 *      or empty topic throws BEFORE any side-effects (no session
 *      promotion, no user bubble, no SSE call).
 *   2. **User bubble contract** — exactly ONE user bubble is appended
 *      with the topic in its content; the bubble id becomes the
 *      parentId for every platform bubble.
 *   3. **Sibling contract** — each platform event becomes ONE
 *      assistant message with `parentId === userBubbleId` and a
 *      `platform` tag matching the event. Two events ⇄ two bubbles.
 *   4. **Head stability** — `appendDirectAssistantMessage` is
 *      DELIBERATELY head-stable: headId must remain on the synthetic
 *      user bubble after every platform commit. The next regular
 *      `chat.send` would branch from the user turn, not from any
 *      individual platform.
 *   5. **Error routing** — `variant_error` events still produce a
 *      bubble (so the user sees which platform failed) but with
 *      `parseError: true` and the raw error text.
 *   6. **Jobstatus flow** — flips to `'generating'` on enter, back
 *      to `'idle'` on `done`. `streamingDraft` STAYS empty
 *      throughout (multi-platform flow owns no single-scalar draft).
 *   7. **Abort propagation** — a 取消 click during the variants
 *      stream drops subsequent callbacks via `ctrlRef.current !== ctrl`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatStore } from '@/stores/useChatStore'

// ── Mock the API client surface that generateVariants touches ──
// `generatePlatformVariantsStream` is the dedicated per-platform SSE
// consumer. We expose a controllable factory so each test can drive
// chips of platform_result / platform_error / done events.
const generatePlatformVariantsStreamMock = vi.hoisted(() => vi.fn())
// HOISTED alongside the variants factory so the live-flow race
// spec (`/variants → /chat.send` microtask sequence) can drive
// `api.generateMessagesStream` with a controllable factory of
// its own. Mirrors the variants hoisted pattern.
const generateMessagesStreamMock = vi.hoisted(() => vi.fn())
// HOISTED so the belt-and-suspenders enhance-phase spec
// (`enhanceInternal`'s chunk-write defensive clear) can drive
// `api.enhancePrompt` with a controllable factory of its own.
const enhancePromptMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  api: {
    enhancePrompt: (...args: unknown[]) => enhancePromptMock(...args),
    generateMessagesStream: (...args: unknown[]) =>
      generateMessagesStreamMock(...args),
    generatePlatformVariantsStream: (...args: unknown[]) =>
      generatePlatformVariantsStreamMock(...args),
  },
}))

import { useAiChat } from './useAiChat'

interface ControllableVariants {
  promise: Promise<void>
  /**
   * The AbortSignal the hook forwarded to the API client. Lazy
   * getter — populated only AFTER `generateVariants` calls into
   * the mocked `api.generatePlatformVariantsStream` factory (so
   * reads BEFORE that return `undefined`). Used by the live-flow
   * race spec to assert `signal.aborted === true` after
   * `chat.send`'s `acquire()` abort.
   */
  readonly signal: AbortSignal | undefined
  /** Drive a single per-platform success event for the variants loop. */
  simulateVariantResult: (v: {
    platform: string
    platformLabel: string
    title: string
    description: string
    tags: string[]
  }) => void
  /** Drive a single per-platform error event for the variants loop. */
  simulateVariantError: (e: {
    platform: string
    platformLabel: string
    title: string
    description: string
    tags: string[]
    error: string
  }) => void
  /** Final SSE `done` event + resolve the underlying promise. */
  simulateDone: () => void
  /** Drive the SSE `error` event + resolve. */
  simulateError: (msg: string) => void
  /**
   * Reject the underlying SSE promise with
   * `DOMException('Aborted', 'AbortError')` — mirrors fetch's
   * real-world rejection shape on signal abort. NOT auto-fired by
   * `signal.aborted`, so the live-flow race spec sequences it
   * explicitly to drive the variants hook's catch microtask in a
   * controlled, observable order.
   */
  simulateAbort: () => void
}

function controllableVariants(): ControllableVariants {
  let resolveOuter!: () => void
  let rejectOuter!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolveOuter = res
    rejectOuter = rej
  })
  let onResult: ((v: unknown) => void) | undefined
  let onError: ((e: unknown) => void) | undefined
  let onDone: ((results: unknown) => void) | undefined
  let onErrCb: ((msg: string) => void) | undefined
  let lastSignal: AbortSignal | undefined
  generatePlatformVariantsStreamMock.mockImplementation(
    (_payload, resultCb, errCb, doneCb, errorCb, signal?: AbortSignal) => {
      onResult = resultCb
      onError = errCb
      onDone = doneCb
      onErrCb = errorCb
      lastSignal = signal
      return promise
    },
  )
  // Lazy getter — each read returns the most-recent signal the
  // mock captured. For specs with a single `generateVariants`
  // call, this is the only signal the hook ever forwarded.
  return {
    promise,
    get signal() {
      return lastSignal
    },
    simulateVariantResult: (v) => onResult?.(v),
    simulateVariantError: (e) => onError?.(e),
    simulateDone: () => {
      onDone?.({})
      resolveOuter()
    },
    simulateError: (msg) => {
      onErrCb?.(msg)
      resolveOuter()
    },
    simulateAbort: () => {
      // Mirror fetch's AbortError shape so the variants catch
      // handler's `e.name === 'AbortError'` check resolves true.
      // Setting `name` explicitly keeps the test portable across
      // Node 18 / 20 / 22 (some runtimes auto-set `name` on
      // DOMException, others don't).
      rejectOuter(new DOMException('Aborted', 'AbortError'))
    },
  }
}

/** chat-stream surface for `api.generateMessagesStream`. */
interface ControllableChatStream {
  promise: Promise<void>
  /** Drive a streamed chunk via the API client's onChunk callback. */
  simulateChunk: (chunk: string) => void
  /** Final SSE `done` event + resolve the underlying promise. */
  simulateDone: () => void
  /** Drive the SSE `error` event + resolve. */
  simulateError: (msg: string) => void
}

function controllableChatStream(): ControllableChatStream {
  let resolveOuter!: () => void
  const promise = new Promise<void>((r) => {
    resolveOuter = r
  })
  let onChunkCb: ((c: string) => void) | undefined
  let onDoneCb: (() => void) | undefined
  let onErrCb: ((m: string) => void) | undefined
  // The hook calls
  //   api.generateMessagesStream(payload, onChunk, onDone, onError, undefined, ctrl.signal)
  // The 5th arg is explicitly `undefined` per the hook (a
  // placeholder); the 6th is `ctrl.signal`. Our factory captures
  // only the first four callbacks. The 6th (signal) is ignored
  // here — the chat-stream abort path is gated on
  // `ctrlRef.current !== ctrl` and its cancellation contract is
  // already locked in `useAiChat.test.tsx`, out of scope for
  // this spec.
  generateMessagesStreamMock.mockImplementation(
    (_payload, chunkCb, doneCb, errCb) => {
      onChunkCb = chunkCb
      onDoneCb = doneCb
      onErrCb = errCb
      return promise
    },
  )
  return {
    promise,
    simulateChunk: (c) => onChunkCb?.(c),
    simulateDone: () => {
      onDoneCb?.()
      resolveOuter()
    },
    simulateError: (m) => {
      onErrCb?.(m)
      resolveOuter()
    },
  }
}

const baseHookParams = () => ({
  formRef: { current: null } as unknown as React.MutableRefObject<unknown>,
  mode: 'video' as const,
  model: 'test-model',
})

/** enhance-stream surface for `api.enhancePrompt`. */
interface ControllableEnhance {
  promise: Promise<void>
  /** Drive a streamed chunk via the API client's onChunk callback. */
  simulateChunk: (chunk: string) => void
  /** Final onDone event; resolve the underlying promise. */
  simulateDone: (final?: string) => void
  /** Drive onError callback + resolve. */
  simulateError: (msg: string) => void
}

function controllableEnhance(): ControllableEnhance {
  let resolveOuter!: () => void
  const promise = new Promise<void>((r) => {
    resolveOuter = r
  })
  let onChunkCb: ((c: string) => void) | undefined
  let onDoneCb: ((final?: string) => void) | undefined
  let onErrCb: ((m: string) => void) | undefined
  // The hook calls `api.enhancePrompt(payload, onChunk, onDone,
  // onError)`. There is no signal arg in this surface — the hook
  // uses `ctrl.signal.addEventListener('abort', ...)` separately
  // to detect cancellation. We capture only the four callbacks.
  enhancePromptMock.mockImplementation(
    (_payload, chunkCb, doneCb, errCb) => {
      onChunkCb = chunkCb
      onDoneCb = doneCb
      onErrCb = errCb
      return promise
    },
  )
  return {
    promise,
    simulateChunk: (c) => onChunkCb?.(c),
    simulateDone: (final?: string) => {
      onDoneCb?.(final)
      resolveOuter()
    },
    simulateError: (m) => {
      onErrCb?.(m)
      resolveOuter()
    },
  }
}

describe('useAiChat.generateVariants — /variants dedicated SSE consumer', () => {
  beforeEach(() => {
    generatePlatformVariantsStreamMock.mockReset()
    // Reset the chat-stream mock too so any leftover
    // mockImplementation from a previous test's live-flow spec
    // doesn't leak into a generateVariants-only test in this
    // describe block.
    generateMessagesStreamMock.mockReset()
    // Reset the enhance-phase mock too so leftover
    // mockImplementation from the belt-and-suspenders spec
    // doesn't leak into a /variants-only test.
    enhancePromptMock.mockReset()
    useChatStore.getState().reset()
  })

  it('throws synchronously on empty platforms (no side-effects)', async () => {
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      await expect(result.current.generateVariants('topic', [])).rejects.toThrow()
      await expect(
        result.current.generateVariants('   ', ['douyin']),
      ).rejects.toThrow()
    })

    // No session promoted, no user bubble, no SSE call.
    expect(useChatStore.getState().activeSessionId).toBe(null)
    expect(generatePlatformVariantsStreamMock).not.toHaveBeenCalled()
  })

  it('pre-appends a user bubble + commits one direct-assistant sibling per platform event', async () => {
    const sim = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      const p = result.current.generateVariants('美食探店', ['douyin', 'xiaohongshu'])
      // Drive 2 success events.
      sim.simulateVariantResult({
        platform: 'douyin',
        platformLabel: '抖音',
        title: 't-dy',
        description: 'd-dy',
        tags: ['a', 'b'],
      })
      sim.simulateVariantResult({
        platform: 'xiaohongshu',
        platformLabel: '小红书',
        title: 't-xhs',
        description: 'd-xhs',
        tags: ['c'],
      })
      sim.simulateDone()
      await p
    })

    // 1 user bubble + 2 platform bubbles appended.
    const sid = useChatStore.getState().activeSessionId!
    const msgs = useChatStore.getState().sessions[sid].messages
    expect(msgs).toHaveLength(3)
    // Bubble 0 — synthetic user message about the topic.
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toContain('美食探店')
    const userMsgId = msgs[0].id
    // Bubble 1 + 2 — platform siblings.
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].parentId).toBe(userMsgId)
    expect(msgs[1].platform).toBe('douyin')
    expect(msgs[1].content).toContain('t-dy')
    expect(msgs[2].role).toBe('assistant')
    expect(msgs[2].parentId).toBe(userMsgId)
    expect(msgs[2].platform).toBe('xiaohongshu')
    expect(msgs[2].content).toContain('t-xhs')
    // Head stays at user bubble (appendDirectAssistantMessage is
    // DELIBERATELY head-stable so the next user turn branches from
    // the synthetic /variants user bubble, not from any individual
    // platform bubble).
    expect(useChatStore.getState().sessions[sid].headId).toBe(userMsgId)
  })

  it('routes variant_error events into parseError bubbles (still visible to user)', async () => {
    const sim = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      const p = result.current.generateVariants('foodcaster', ['bilibili'])
      sim.simulateVariantError({
        platform: 'bilibili',
        platformLabel: 'Bilibili',
        title: '',
        description: '',
        tags: [],
        error: 'openrouter 503',
      })
      sim.simulateDone()
      await p
    })

    const sid = useChatStore.getState().activeSessionId!
    const msgs = useChatStore.getState().sessions[sid].messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].platform).toBe('bilibili')
    expect(msgs[1].parseError).toBe(true)
    expect(msgs[1].content).toContain('openrouter 503')
  })

  it('flips jobStatus to `generating` on enter and back to `idle` on done; streamingDraft stays empty', async () => {
    const sim = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      const p = result.current.generateVariants('topic', ['douyin'])
      // Mid-stream: should be `generating`, draft empty.
      expect(useChatStore.getState().jobStatus).toBe('generating')
      expect(useChatStore.getState().streamingDraft).toBe('')
      sim.simulateVariantResult({
        platform: 'douyin',
        platformLabel: '抖音',
        title: 't',
        description: 'd',
        tags: [],
      })
      sim.simulateDone()
      await p
    })

    expect(useChatStore.getState().jobStatus).toBe('idle')
    expect(useChatStore.getState().streamingDraft).toBe('')
  })

  // ── ⚠️C breadcrumb differentiator ──
  // While the `/variants` stream is in flight, the chat-state's
  // `streamingVariantsCount` should mirror `platforms.length` — the
  // breadcrumb reads this to surface `streaming N platforms`
  // (vs the legacy `generating` chip used by single chat).
  it('flips streamingVariantsCount to platforms.length on enter; clears on done', async () => {
    const sim = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      const p = result.current.generateVariants('foodcaster', [
        'douyin',
        'xiaohongshu',
        'bilibili',
      ])
      // Mid-stream: variants count = 3 (the platforms we asked for).
      expect(useChatStore.getState().jobStatus).toBe('generating')
      expect(useChatStore.getState().streamingVariantsCount).toBe(3)
      sim.simulateVariantResult({
        platform: 'douyin',
        platformLabel: '抖音',
        title: 't',
        description: 'd',
        tags: [],
      })
      sim.simulateDone()
      await p
    })

    // Done → count cleared, status back to idle.
    expect(useChatStore.getState().jobStatus).toBe('idle')
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
  })

  it('clears streamingVariantsCount when the variants loop errors out', async () => {
    const sim = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      const p = result.current.generateVariants('foodcaster', ['douyin', 'kuaishou'])
      // Mid-stream: count is set.
      expect(useChatStore.getState().streamingVariantsCount).toBe(2)
      // Drive an SSE error → jobStatus flips to 'error', and the
      // consolidated cleanup in setJobStatus must clear the count.
      sim.simulateError('openrouter 429')
      await p
    })

    expect(useChatStore.getState().jobStatus).toBe('error')
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
  })

  it('cancel() mid-stream drops subsequent variant_result events (ctrlRef gate)', async () => {
    // Cancelling flips ctrlRef.current to null. The hook's
    // `if (ctrlRef.current !== ctrl) return` gate then drops every
    // late-delivery event that lands on the now-stale controller.
    // This is the determinism contract for `cancel`-driven aborts
    // within the variants stream; the cross-pipeline acquire-replace
    // contract is locked separately by
    // `useAiChat.test.tsx::an independent send() while /fullflow is
    // mid-flight acquires a new controller` (out of scope to
    // duplicate here).
    const sim = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      const p = result.current.generateVariants('topic', ['douyin', 'xiaohongshu'])
      // First event: admitted to the store.
      sim.simulateVariantResult({
        platform: 'douyin',
        platformLabel: '抖音',
        title: 'kept',
        description: 'd',
        tags: [],
      })
      // 取消 — flips ctrlRef.current to null. From this point
      // the hook gate drops every late delivery.
      result.current.cancel()
      // Late delivery AFTER cancel — should be dropped.
      sim.simulateVariantResult({
        platform: 'xiaohongshu',
        platformLabel: '小红书',
        title: 'should-be-dropped',
        description: 'd',
        tags: [],
      })
      // Settle the stream so `generateVariants` resolves cleanly
      // (we never observe the dropped callback firing again).
      sim.simulateDone()
      await p
    })

    const sid = useChatStore.getState().activeSessionId!
    const platformBubbles = useChatStore
      .getState()
      .sessions[sid].messages.filter((m) => m.role === 'assistant' && m.platform)
    // Only the FIRST event survived; the second was dropped by the
    // ctrlRef gate.
    expect(platformBubbles).toHaveLength(1)
    expect(platformBubbles[0]!.platform).toBe('douyin')
    expect(platformBubbles.some((b) => b.content.includes('should-be-dropped'))).toBe(
      false,
    )
  })

  it('forwarded SSE AbortSignal matches the shared controller (cancel() propagates)', async () => {
    const sim = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      const p = result.current.generateVariants('topic', ['douyin'])
      // generatePlatformVariantsStream should have been invoked with
      // a 6th `signal` argument matching the hook's ctrl.signal.
      expect(generatePlatformVariantsStreamMock).toHaveBeenCalledTimes(1)
      const callSig = generatePlatformVariantsStreamMock.mock
        .calls[0]![5] as AbortSignal
      expect(callSig).toBeInstanceOf(AbortSignal)
      expect(callSig.aborted).toBe(false)
      // Cancel — should flip callSig to aborted. SimulateDone so
      // the variants promise resolves.
      result.current.cancel()
      expect(callSig.aborted).toBe(true)
      sim.simulateDone()
      await p
    })

    expect(useChatStore.getState().jobStatus).not.toBe('error')
  })

  // ── ⚠️C live-flow regression: R2-gated no-op + R4 inline clear ──
  //
  // Drives the EXACT microtask sequence that fires when a user
  // types `/variants 美食探店` and submits 5 platforms, then
  // mid-flight hits `chat.send('text')` from the composer panel.
  // The reviewer asked us to lock R2 + R4 under REAL microtask
  // ordering — not just unit-level direct setState calls.
  //
  // Timeline:
  //
  //   1. `generateVariants('foodcaster', [...5 platforms])` kicks
  //      off. `streamingVariantsCount === 5`,
  //      `jobStatus === 'generating'`, variant ctrlA flows the
  //      signal into the API client.
  //
  //   2. `chat.send('chat text followup')` — `acquire()` aborts
  //      ctrlA AND assigns a fresh ctrlB. `appendUserMessage` runs
  //      synchronously, then `await sendInternal(...)` suspends
  //      on the chat stream's pending SSE promise.
  //
  //   3. `variants.simulateAbort()` — reject the SSE promise with
  //      `DOMException('Aborted', 'AbortError')` (the real-world
  //      fetch rejection shape). Sequencing it explicitly models
  //      what fetch does on signal abort (reject via microtask),
  //      AND keeps the spec's timing deterministic.
  //
  //   4. `await variantsP` drains microtask 1 (the variants hook's
  //      catch). R2 gate: `ctrlRef.current === ctrlB` ≠ closure
  //      `ctrlA` → no-op. Count is STILL 5 — the gated-no-op
  //      contract holds under real microtask ordering.
  //
  //   5. `chatStream.simulateChunk('hi ')` fires the chat-cb →
  //      `appendStreamingChunk('hi ')` (R4 inline-clear). Count
  //      flips 5 → undefined in lockstep with the chunk byte.
  //
  //   6. Subsequent chunks keep the cleared state and accumulate
  //      the draft verbatim.
  //
  //   7. `chatStream.simulateDone()` → onDoneCb fires
  //      `commitAssistantMessage(sid, chatUserId)` →
  //      `streamingDraft: ''`, `jobStatus: 'idle'`. Count is
  //      still undefined (commitAssistantMessage does NOT touch
  //      it; relies on R4 having cleared earlier).
  //
  // Final post-condition: `streamingVariantsCount === undefined`.
  // Without R4, the count would stay at 5 (R2 no-op + no inline
  // clear in appendStreamingChunk) and the breadcrumb would lie
  // about a single chat stream being a `streaming 5 platforms` run.
  it('live-flow: chat.send mid-/variants lands streamingVariantsCount === undefined (R2-gated no-op + R4 inline clear)', async () => {
    const chatStream = controllableChatStream()
    const variants = controllableVariants()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      // 1. /variants with 5 platforms — kicks off, count = 5.
      const variantsP = result.current.generateVariants('foodcaster', [
        'douyin',
        'xiaohongshu',
        'bilibili',
        'kuaishou',
        'tencent',
      ])
      expect(useChatStore.getState().streamingVariantsCount).toBe(5)
      expect(useChatStore.getState().jobStatus).toBe('generating')
      expect(variants.signal?.aborted).toBe(false)

      // 2. chat.send mid-flight — `acquire()` aborts ctrlA AND
      //    assigns ctrlB. `appendUserMessage` ran synchronously;
      //    `await sendInternal` is now suspended on the chat
      //    stream's pending SSE promise.
      const chatP = result.current.send('chat text followup')
      expect(variants.signal?.aborted).toBe(true)

      // 3. Variants SSE promise rejects with the real-world
      //    AbortError shape. Sequencing it explicitly (rather than
      //    auto-firing on signal abort) mirrors how fetch surfaces
      //    the rejection in production and lets the spec observe
      //    microtask boundaries between R2 (variants catch) and
      //    R4 (chat-stream chunk).
      variants.simulateAbort()

      // 4. `await variantsP` drains microtask 1 — the variants
      //    hook's catch handler. R2 gate checks ctrlB !== ctrlA
      //    → no-op. Count stays at 5. The gated-no-op contract
      //    holds under real microtask ordering (not just direct
      //    setState calls).
      await variantsP
      expect(useChatStore.getState().streamingVariantsCount).toBe(5)

      // 5. Chat-stream's first chunk fires → appendStreamingChunk
      //    (R4 inline-clear) defensively nulls the variants count.
      chatStream.simulateChunk('hi ')
      expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
      expect(useChatStore.getState().streamingDraft).toBe('hi ')
      expect(useChatStore.getState().jobStatus).toBe('generating')

      // 6. Subsequent chunks keep the cleared count + accumulate
      //    the draft verbatim.
      chatStream.simulateChunk('world')
      expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
      expect(useChatStore.getState().streamingDraft).toBe('hi world')

      // 7. Chat-stream done → onDoneCb fires
      //    commitAssistantMessage(sid, chatUserId) →
      //    streamingDraft: '', jobStatus: 'idle'.
      chatStream.simulateDone()
      await chatP
    })

    // Final post-condition.
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
    expect(useChatStore.getState().jobStatus).toBe('idle')
    expect(useChatStore.getState().streamingDraft).toBe('')

    // And the chat send did commit ONE assistant sibling under
    // its own user bubble (NOT under the variants' user bubble,
    // which would orphan the head-stable graph contract).
    const sid = useChatStore.getState().activeSessionId!
    const msgs = useChatStore.getState().sessions[sid].messages
    const chatUserMsgs = msgs.filter(
      (m) => m.role === 'user' && m.content === 'chat text followup',
    )
    expect(chatUserMsgs).toHaveLength(1)
    const chatUserId = chatUserMsgs[0]!.id
    const chatAssistantMsgs = msgs.filter(
      (m) => m.role === 'assistant' && m.parentId === chatUserId,
    )
    expect(chatAssistantMsgs).toHaveLength(1)
    expect(chatAssistantMsgs[0]!.content).toBe('hi world')
    // Head moved to the chat assistant (commit moves headId).
    expect(useChatStore.getState().sessions[sid].headId).toBe(
      chatAssistantMsgs[0]!.id,
    )
  })
})

/**
 * Companion spec: the data-layer guard inside
 * `appendDirectAssistantMessage` that refuses orphan parent ids.
 *
 * Without this check, a stale parentId (e.g. from a session switch
 * mid-`send` or a switched head) would silently corrupt the branch
 * graph for all subsequent reads. We lock the guard explicitly here
 * because `message-graph.test.tsx` covers the read path only.
 */
describe('useChatStore.appendDirectAssistantMessage — orphan-parent guard', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
  })

  it('refuses to append when parentId does not exist in the session', () => {
    const sid = useChatStore.getState().newSession('video')
    // Re-read a fresh snapshot AFTER `newSession` mutated state —
    // zustand snapshots taken before mutations are stale.
    const result = useChatStore
      .getState()
      .appendDirectAssistantMessage(sid, '__nonexistent__', 'help text')
    expect(result).toBe(null)
    expect(useChatStore.getState().sessions[sid].messages).toEqual([])
  })

  it('appends when parentId IS a real message in the session', () => {
    const sid = useChatStore.getState().newSession('video')
    useChatStore.getState().appendUserMessage(sid, { content: 'topic' })
    // Fresh snapshot — `newSession` + `appendUserMessage` both
    // mutated the store; the snapshot we took first is stale.
    const fresh = useChatStore.getState()
    const userMsgId = fresh.sessions[sid].messages[0]!.id
    const newId = fresh.appendDirectAssistantMessage(sid, userMsgId, 'c', {
      platform: 'douyin',
    })
    expect(newId).toBeTruthy()
    const msgs = useChatStore.getState().sessions[sid].messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1]!.parentId).toBe(userMsgId)
    expect(msgs[1]!.platform).toBe('douyin')
    // Head stays at the user bubble (appendDirectAssistantMessage
    // is head-stable for variants flow).
    expect(useChatStore.getState().sessions[sid].headId).toBe(userMsgId)
  })

  it('appendDirectAssistantMessage refuses on stale session id', () => {
    useChatStore.getState().newSession('video')
    const result = useChatStore
      .getState()
      .appendDirectAssistantMessage('__missing__', 'p', 'c')
    expect(result).toBe(null)
  })
})

/**
 * `useChatStore.setStreamingVariantsCount` + `setJobStatus`
 * consolidated cleanup — locks the breadcrumb-flip invariants for
 * the `streaming N platforms` differentiator. See ⚠️C in the
 * data-layer invariant log.
 *
 *   - `setStreamingVariantsCount(N)` flips the count to N.
 *   - `setStreamingVariantsCount(null)` clears to undefined
 *     (NOT 0 — undefined is the bucket the breadcrumb treats as
 *     "single chat stream").
 *   - `setStreamingVariantsCount(0)` is a VALID count (conserved)
 *     — N=0 means "no platforms", should NOT collapse to undefined.
 *   - `setJobStatus(non-'generating')` clears the count regardless
 *     of prior value — consolidate done / error / cancel cleanup.
 *   - `setJobStatus('generating')` preserves the count (so the
 *     breadcrumb stays `streaming N platforms` even if some other
 *     code path re-flips `generating`).
 */
describe('useChatStore — streaming window lifecycle ⚠️C breadcrumb support', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
  })

  it('setStreamingVariantsCount(N) flips the count', () => {
    useChatStore.getState().setStreamingVariantsCount(7)
    expect(useChatStore.getState().streamingVariantsCount).toBe(7)
  })

  it('setStreamingVariantsCount(null) clears to undefined', () => {
    useChatStore.getState().setStreamingVariantsCount(7)
    useChatStore.getState().setStreamingVariantsCount(null)
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
  })

  it('setStreamingVariantsCount(0) is preserved (NOT cleared)', () => {
    // Zero is a valid count (per-platform guarantee, not "single
    // chat" fallback). Critical NOT to short-circuit on falsy.
    useChatStore.getState().setStreamingVariantsCount(0)
    expect(useChatStore.getState().streamingVariantsCount).toBe(0)
  })

  it('setJobStatus(error) clears the variants count (consolidated cleanup)', () => {
    useChatStore.getState().setStreamingVariantsCount(7)
    useChatStore.getState().setJobStatus('error', 'something broke')
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
    expect(useChatStore.getState().error).toBe('something broke')
  })

  it('setJobStatus(idle) clears the variants count (consolidated cleanup)', () => {
    useChatStore.getState().setStreamingVariantsCount(7)
    useChatStore.getState().setJobStatus('idle')
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
  })

  it('setJobStatus(generating) preserves the variants count', () => {
    useChatStore.getState().setStreamingVariantsCount(7)
    useChatStore.getState().setJobStatus('generating')
    // Re-flipping status to 'generating' must NOT clear the count
    // — variants flow owns 'generating' while it streams.
    expect(useChatStore.getState().streamingVariantsCount).toBe(7)
  })

  it('reset() clears the variants count', () => {
    useChatStore.getState().setStreamingVariantsCount(7)
    useChatStore.getState().reset()
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
  })

  // R4 — chat-stream first chunk must defensively null the
  // variants count. When user types text + sends via composer
  // mid-`/variants`, `acquire()` aborts the variants ctrl; the
  // variants' AbortError catch is gated (R2), and won't clobber
  // the count — so we MUST reset at the chat-stream entry point
  // so the breadcrumb doesn't lie about a single chat stream being
  // a `streaming N platforms` run.
  it('appendStreamingChunk clears the variants count (reviewer ⚠️C R4)', () => {
    // Set up a stale variants count (as if the variants loop had
    // just been aborted and the R2 gate skipped the clear path).
    useChatStore.getState().setStreamingVariantsCount(7)
    useChatStore.getState().setJobStatus('generating')
    expect(useChatStore.getState().streamingVariantsCount).toBe(7)

    // First chat chunk lands — must clear count.
    useChatStore.getState().appendStreamingChunk('hi')
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
    expect(useChatStore.getState().streamingDraft).toBe('hi')
    expect(useChatStore.getState().jobStatus).toBe('generating')

    // Subsequent chunks preserve the cleared state.
    useChatStore.getState().appendStreamingChunk(' again')
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
    expect(useChatStore.getState().streamingDraft).toBe('hi again')
  })

  // R4 enhance side — enhance-after-variants must also yield
  // `undefined` count. enhance enters via `setJobStatus('enhancing')`
  // which routes through the consolidated cleanup branch (any
  // non-'generating' status clears count) — so by the time chunks
  // arrive, count is already undefined. Lock that contract so
  // future refactors don't accidentally bypass it.
  it('enhancing path lands count === undefined (consolidated setJobStatus cleanup)', () => {
    useChatStore.getState().setStreamingVariantsCount(7)
    useChatStore.getState().setJobStatus('generating')
    expect(useChatStore.getState().streamingVariantsCount).toBe(7)
    // The very first line of `enhanceInternal` calls
    // `useChatStore.getState().setJobStatus('enhancing')` — under
    // our consolidated cleanup rule, that flips count to undefined.
    useChatStore.getState().setJobStatus('enhancing')
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
    expect(useChatStore.getState().jobStatus).toBe('enhancing')
  })
})

/**
 * `useAiChat.enhance` belt-and-suspenders — locks the
 * enhanceInternal chunk-write's inline
 * `streamingVariantsCount: undefined` clear. This is the
 * enhance-phase twin of the chat-stream ⚠️C review R4 fix in
 * `appendStreamingChunk`. The lead `setJobStatus('enhancing')`
 * already clears count via the consolidated cleanup branch — this
 * spec additionally locks the chunk-write's defensive null so a
 * future refactor that bypasses the lead
 * `setJobStatus('enhancing')` cannot reintroduce the
 * breadcrumb-lie on the enhance path.
 */
describe('useAiChat.enhance — belt-and-suspenders chunk-write clear (R4-twin for enhance-phase)', () => {
  beforeEach(() => {
    enhancePromptMock.mockReset()
    useChatStore.getState().reset()
  })

  // Scenario: a future refactor accidentally (or intentionally)
  // bypasses the lead `setJobStatus('enhancing')` path AND lets
  // some upstream code leave a stale count on the slice. The
  // chunk-write's defensive null must still flip count to
  // undefined. We simulate by:
  //   (a) staging a stale count BEFORE `result.current.enhance()`
  //       runs (the lead `setJobStatus('enhancing')` will then
  //       clear it via consolidated cleanup — that's the EXISTING
  //       behavior we already lock elsewhere); then
  //   (b) re-arming count=7 AFTER `enhance()` has returned (a
  //       stand-in for a future-refactor's regression: code that
  //       sets count AFTER the lead setJobStatus).
  // The chunk-write then sees count=7 at chunk-arrival time and
  // must clear it inline. Without ⚠️C review R4-twin in the
  // chunk-write, count would stay 7 during the enhance stream
  // and the breadcrumb would read `streaming 7 platforms`.
  it('chunk-write defensively nulls variants count (R4-twin for enhance-phase)', async () => {
    const enhance = controllableEnhance()
    const { result } = renderHook(() => useAiChat(baseHookParams()))

    await act(async () => {
      // (a) Stage stale count BEFORE enhance begins.
      useChatStore.getState().setStreamingVariantsCount(7)

      // The first synchronous step inside `enhanceInternal` is
      // `useChatStore.getState().setJobStatus('enhancing')` which
      // routes through the consolidated cleanup branch and clears
      // count → undefined. This is the EXISTING behavior already
      // locked elsewhere.
      const enhanceP = result.current.enhance('主题')
      expect(useChatStore.getState().jobStatus).toBe('enhancing')
      expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()

      // (b) Re-arm count AFTER the lead clears it — simulating a
      // future-refactor regression where code somewhere along the
      // chain re-asserts count post-lead. The chunk-write's
      // defensive null is what saves us here.
      useChatStore.getState().setStreamingVariantsCount(7)

      // First enhance chunk lands → chunk-write's belt-and-suspenders
      // `streamingVariantsCount: undefined` flips count back to
      // undefined in lockstep with the chunk byte.
      enhance.simulateChunk('优化版 ')
      expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
      expect(useChatStore.getState().streamingDraft).toBe('优化版 ')
      expect(useChatStore.getState().jobStatus).toBe('enhancing')

      // Subsequent chunks keep the cleared count + accumulate draft.
      enhance.simulateChunk('副标题')
      expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
      expect(useChatStore.getState().streamingDraft).toBe('优化版 副标题')

      // Settle enhance phase → status flips to 'idle'.
      enhance.simulateDone('优化版 副标题')
      await enhanceP
    })

    // Final post-condition.
    expect(useChatStore.getState().streamingVariantsCount).toBeUndefined()
    expect(useChatStore.getState().jobStatus).toBe('idle')
    expect(useChatStore.getState().streamingDraft).toBe('')
  })
})
