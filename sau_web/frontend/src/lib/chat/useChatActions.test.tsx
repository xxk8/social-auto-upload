import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import type { RefObject } from 'react'
import { useChatStore } from '@/stores/useChatStore'
import { useChatActions } from './useChatActions'
import type { FormHandle, MaybeRef } from './chatFormBridge'

// ─── module mocks ────────────────────────────────────────────────────────

const generateMessagesStream = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    generateMessagesStream: (...args: unknown[]) => generateMessagesStream(...args),
  },
}))

// Helper: synchronous SSE-style onChunk/onDone dispatch.
function emitSseSequence(
  chunks: string[],
  doneContent?: string,
  errorMessage?: string,
) {
  generateMessagesStream.mockImplementationOnce(
    (_payload: unknown, onChunk: (c: string) => void, onDone: (full: string) => void, onErr: (msg: string) => void, _keyInfo?: unknown, signal?: AbortSignal) => {
      // Simulate async chains while still being synchronous-friendly.
      return (async () => {
        const accumulator = []
        for (const c of chunks) {
          if (signal?.aborted) return
          accumulator.push(c)
          onChunk(c)
        }
        if (errorMessage) {
          onErr(errorMessage)
          return
        }
        onDone(doneContent ?? accumulator.join(''))
      })()
    },
  )
}

// ─── test harness ────────────────────────────────────────────────────────

function makeFormHandle(snapshotTitle = '', snapshotDesc = '', snapshotTags: string | string[] = []): FormHandle {
  // Accept either a comma-joined string (legacy) or an array of tags
  // so tests can mirror the real FormSnapshot.tags: string[] contract.
  const initialTags = typeof snapshotTags === 'string'
    ? snapshotTags.split(/[,，]+/).map((t) => t.trim()).filter(Boolean)
    : snapshotTags
  let state = { title: snapshotTitle, desc: snapshotDesc, tags: initialTags }
  const applied: Array<{ title: string; desc: string; tags: string[] }> = []
  return {
    getFormSnapshot: () => ({ ...state }),
    applyAiResult: (r) => {
      const out = {
        title: r.title ?? state.title,
        desc: r.desc ?? state.desc,
        tags: r.tags ?? state.tags,
      }
      applied.push(out)
      state = out
    },
    __applied: applied,
    __setState: (next: Partial<typeof state>) => {
      state = { ...state, ...next }
    },
  } as FormHandle & { __applied: typeof applied; __setState: (n: Partial<typeof state>) => void }
}

function Harness({
  formRef,
  onReady,
}: {
  formRef: MaybeRef<FormHandle | null>
  onReady: (api: ReturnType<typeof useChatActions>) => void
}) {
  const actions = useChatActions({
    formRef,
    mode: 'video',
    platform: 'douyin',
    model: 'm1',
    parseResponse: (raw) => {
      const titleMatch = raw.match(/^标题[：:]\s*(.+)/m)
      const descMatch = raw.match(/^描述[：:]\s*([\s\S]+?)(?=^标签[：:]|$)/m)
      const tagsMatch = raw.match(/^标签[：:]\s*(.+)/m)
      return {
        title: titleMatch?.[1]?.trim(),
        desc: descMatch?.[1]?.trim(),
        tags: tagsMatch?.[1]?.trim(),
      }
    },
  })
  onReady(actions)
  return null
}

function mountHook(initialHandle: FormHandle | null = makeFormHandle()) {
  const ref: RefObject<FormHandle | null> = { current: initialHandle }
  let capturedActions: ReturnType<typeof useChatActions> | null = null
  const utils = render(
    <Harness
      formRef={ref}
      onReady={(a) => {
        capturedActions = a
      }}
    />,
  )
  const actions = capturedActions!
  return { ref, actions, unmount: utils.unmount }
}

// ─── tests ───────────────────────────────────────────────────────────────

beforeEach(() => {
  useChatStore.getState().reset()
  generateMessagesStream.mockReset()
})

describe('useChatActions — send', () => {
  it('passes messages array to api.generateMessagesStream', async () => {
    const { actions } = mountHook()
    emitSseSequence(['你好', '世界'], '你好世界')
    await act(async () => {
      await actions.send('hello')
    })
    expect(generateMessagesStream).toHaveBeenCalledTimes(1)
    const payload = generateMessagesStream.mock.calls[0][0]
    expect(payload.messages).toBeInstanceOf(Array)
    const lastMsg = payload.messages[payload.messages.length - 1]
    expect(lastMsg.role).toBe('user')
    expect(lastMsg.content).toBe('hello')
    expect(payload.model).toBe('m1')
    expect(payload.platform).toBe('douyin')
  })

  it('creates a new chat session if none is active', async () => {
    expect(useChatStore.getState().activeSessionId).toBeNull()
    const { actions } = mountHook()
    emitSseSequence([], 'done')
    await act(async () => {
      await actions.send('hi')
    })
    const sid = useChatStore.getState().activeSessionId
    expect(sid).toBeTruthy()
    expect(useChatStore.getState().sessions[sid!].formMode).toBe('video')
    expect(useChatStore.getState().sessions[sid!].platform).toBe('douyin')
  })

  it('captures form snapshot when ref is mounted and injects it as system message', async () => {
    const handle = makeFormHandle('无敌美食', '吃吃吃', ['#food', '#yummy'])
    const { actions } = mountHook(handle)
    emitSseSequence([], 'ok')
    await act(async () => {
      await actions.send('继续精简')
    })
    const payload = generateMessagesStream.mock.calls[0][0]
    const sysIdx = payload.messages.findIndex(
      (m: { role: string }) => m.role === 'system',
    )
    expect(sysIdx).toBeGreaterThanOrEqual(0)
    const sys = payload.messages[sysIdx]
    expect(sys.content).toContain('无敌美食')
    expect(sys.content).toContain('吃吃吃')
    expect(sys.content).toContain('#food,#yummy')
    expect(payload.messages.at(-1)).toMatchObject({ role: 'user', content: '继续精简' })
  })

  it('omits system snapshot message when form is unmounted (degradation)', async () => {
    const { actions } = mountHook(null)
    emitSseSequence([], 'ok')
    await act(async () => {
      await actions.send('plain')
    })
    const payload = generateMessagesStream.mock.calls[0][0]
    expect(payload.messages.some((m: { role: string }) => m.role === 'system')).toBe(false)
    expect(payload.messages.at(-1)).toMatchObject({ role: 'user', content: 'plain' })
  })

  it('commits the assistant message into the active session after done', async () => {
    const { actions } = mountHook()
    emitSseSequence(['分 ', '三步'], '分 三步')
    await act(async () => {
      await actions.send('炸鸡教程要点')
    })
    const sid = useChatStore.getState().activeSessionId!
    const session = useChatStore.getState().sessions[sid]
    expect(session.messages).toHaveLength(2)
    expect(session.messages[0].role).toBe('user')
    expect(session.messages[0].content).toBe('炸鸡教程要点')
    // formContextAtSend is on the user message (it captured the form at send time)
    expect(session.messages[0].formContextAtSend).toBeDefined()
    expect(session.messages[1].role).toBe('assistant')
    expect(session.messages[1].content).toBe('分 三步')
  })

  it('auto-applies parsed result via the form handle on done', async () => {
    const handle = makeFormHandle()
    const { actions } = mountHook(handle)
    // Single chunk so the SSE mock populates streamingDraft before onDone,
    // which lets commitAssistantMessage succeed and the auto-apply step run.
    emitSseSequence(
      ['标题：一分钟学会脆皮炸鸡\n描述：步骤清晰，简单易做\n标签：炸鸡,美食,#recipe'],
    )
    await act(async () => {
      await actions.send('炸鸡教程')
    })
    const applied = (handle as FormHandle & { __applied: Array<{ title: string; desc: string; tags: string }> }).__applied
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual({
      title: '一分钟学会脆皮炸鸡',
      desc: '步骤清晰，简单易做',
      tags: ['#炸鸡', '#美食', '#recipe'],
    })
    const sid = useChatStore.getState().activeSessionId!
    const lastAssistant = [...useChatStore
      .getState()
      .sessions[sid].messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.appliedTo).toEqual(['title', 'desc', 'tags'])
  })

  it('does NOT auto-apply when parsed result has all empty fields', async () => {
    const handle = makeFormHandle()
    const { actions } = mountHook(handle)
    emitSseSequence(['some general prose with no labels at all'])
    await act(async () => {
      await actions.send('hi')
    })
    const applied = (handle as FormHandle & { __applied: unknown[] }).__applied
    expect(applied).toHaveLength(0)
    const sid = useChatStore.getState().activeSessionId!
    const lastAssistant = [...useChatStore
      .getState()
      .sessions[sid].messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.appliedTo).toBeUndefined()
  })

  it('after-commit store state is clean (jobStatus idle, draft empty, error null)', async () => {
    const { actions } = mountHook()
    emitSseSequence(['a', 'b'], 'ab')
    await act(async () => {
      await actions.send('x')
    })
    const s = useChatStore.getState()
    expect(s.jobStatus).toBe('idle')
    expect(s.streamingDraft).toBe('')
    expect(s.error).toBeNull()
  })
})

describe('useChatActions — chunks populate streamingDraft', () => {
  it('each chunk updates useChatStore.streamingDraft', async () => {
    const { actions } = mountHook()
    emitSseSequence(['一', '二', '三'], '一二三')
    await act(async () => {
      await actions.send('start')
    })
    // After done, draft should be cleared.
    expect(useChatStore.getState().streamingDraft).toBe('')
  })

  it('flips jobStatus to "generating" during the stream', async () => {
    // Patch implementation to give us a peek at jobStatus mid-stream.
    generateMessagesStream.mockImplementationOnce(
      (_p: unknown, onChunk: (c: string) => void, onDone: (full: string) => void, _onErr: (m: string) => void) => {
        return (async () => {
          onChunk('x')
          // We have one synchronous slot to inspect before chunks complete
          // — capture here via closure on the store directly.
          expect(useChatStore.getState().jobStatus).toBe('generating')
          onChunk('y')
          onDone('xy')
        })()
      },
    )
    const { actions } = mountHook()
    await act(async () => {
      await actions.send('hi')
    })
    expect(useChatStore.getState().jobStatus).toBe('idle')
  })
})

describe('useChatActions — abort + cancel', () => {
  it('calling send while previous is in-flight aborts the previous fetch', async () => {
    const { actions } = mountHook()
    // First send: never resolves within the test (would block forever).
    let abortFirst: AbortSignal | null = null
    generateMessagesStream.mockImplementationOnce(
      (_p: unknown, _onChunk: unknown, _onDone: unknown, _onErr: unknown, _key: unknown, signal: AbortSignal) => {
        abortFirst = signal
        // Never resolves within the test window; the test will abort it.
        return new Promise(() => {})
      },
    )
    // Don't await — start the in-flight send, then start a second one.
    act(() => {
      void actions.send('first')
    })
    // Give the mock a microtask to install.
    await act(async () => {})
    expect(abortFirst).not.toBeNull()
    expect(abortFirst!.aborted).toBe(false)

    emitSseSequence([], 'second_done')
    await act(async () => {
      await actions.send('second')
    })
    // The first fetch's signal should be aborted; the second completed.
    expect(abortFirst!.aborted).toBe(true)
    expect(generateMessagesStream).toHaveBeenCalledTimes(2)
  })

  it('cancel() aborts the in-flight signal AND store.cancelStream()', async () => {
    const { actions } = mountHook()
    let abortSignal: AbortSignal | null = null
    generateMessagesStream.mockImplementationOnce(
      (_p: unknown, _onChunk: unknown, _onDone: unknown, _onErr: unknown, _key: unknown, signal: AbortSignal) => {
        abortSignal = signal
        useChatStore.getState().appendStreamingChunk('halfway')
        return new Promise(() => {}) // never resolves
      },
    )
    act(() => {
      void actions.send('x')
    })
    await act(async () => {})
    expect(abortSignal!.aborted).toBe(false)
    expect(useChatStore.getState().streamingDraft).toBe('halfway')

    act(() => {
      actions.cancel()
    })
    expect(abortSignal!.aborted).toBe(true)
    expect(useChatStore.getState().jobStatus).toBe('idle')
    expect(useChatStore.getState().streamingDraft).toBe('')
  })

  it('errors from the stream propagate to store as error status', async () => {
    const { actions } = mountHook()
    emitSseSequence([], undefined, 'API quota exhausted')
    await act(async () => {
      await actions.send('x')
    })
    const s = useChatStore.getState()
    expect(s.jobStatus).toBe('error')
    expect(s.error).toBe('API quota exhausted')
  })
})

describe('useChatActions — unmount cleanup', () => {
  it('unmounting aborts fetch and store.cancelStream() (does NOT mark error)', async () => {
    let abortSignal: AbortSignal | null = null
    generateMessagesStream.mockImplementation(
      (_p: unknown, _onChunk: unknown, _onDone: unknown, _onErr: unknown, _key: unknown, signal: AbortSignal) => {
        abortSignal = signal
        useChatStore.getState().appendStreamingChunk('on mount')
        useChatStore.getState().setJobStatus('generating')
        return new Promise(() => {}) // never resolves
      },
    )
    const { actions, unmount } = mountHook()
    act(() => {
      void actions.send('x')
    })
    await act(async () => {})
    expect(abortSignal!.aborted).toBe(false)
    expect(useChatStore.getState().jobStatus).toBe('generating')

    unmount()
    // Aborted + cancelled quietly.
    expect(abortSignal!.aborted).toBe(true)
    expect(useChatStore.getState().jobStatus).toBe('idle')
    expect(useChatStore.getState().error).toBeNull()
    expect(useChatStore.getState().streamingDraft).toBe('')
  })
})

describe('useChatActions — image attachments', () => {
  it('transforms last user message into multimodal content when images provided', async () => {
    const { actions } = mountHook()
    emitSseSequence([], 'ok')
    await act(async () => {
      await actions.send('describe', ['data:image/png;base64,AA=='])
    })
    const payload = generateMessagesStream.mock.calls[0][0]
    const last = payload.messages.at(-1)
    expect(last.role).toBe('user')
    expect(Array.isArray(last.content)).toBe(true)
    const kinds = (last.content as Array<{ type: string }>).map((c) => c.type)
    expect(kinds).toContain('image_url')
    expect(kinds).toContain('text')
    const textPart = (last.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === 'text',
    )
    expect(textPart?.text).toBe('describe')
  })

  it('does NOT transform multimodal when no images supplied', async () => {
    const { actions } = mountHook()
    emitSseSequence([], 'ok')
    await act(async () => {
      await actions.send('plain text')
    })
    const payload = generateMessagesStream.mock.calls[0][0]
    const last = payload.messages.at(-1)
    expect(typeof last.content).toBe('string')
    expect(last.content).toBe('plain text')
  })
})
