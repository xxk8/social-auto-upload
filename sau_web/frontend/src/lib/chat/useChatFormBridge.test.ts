import { describe, it, expect, beforeEach } from 'vitest'
import {
  safeGetFormSnapshot,
  safeApplyAiResult,
  buildChatPayload,
  type MaybeRef,
  type FormHandle,
} from './chatFormBridge'
import { useChatStore } from '@/stores/useChatStore'

// ─── helpers ──────────────────────────────────────────────────────────────

function makeRef(h: FormHandle | null): MaybeRef<FormHandle | null> {
  return { current: h }
}

function makeHandle(overrides: Partial<FormHandle> = {}): FormHandle {
  return {
    getFormSnapshot: () => ({ title: '', desc: '', tags: [] }),
    applyAiResult: () => {},
    ...overrides,
  }
}

// ─── safeGetFormSnapshot: happy path ──────────────────────────────────────

describe('safeGetFormSnapshot — form mounted', () => {
  it('returns the form snapshot verbatim', () => {
    const ref = makeRef(
      makeHandle({
        getFormSnapshot: () => ({ title: '无敌美食', desc: '吃吃吃', tags: ['#food'] }),
      }),
    )
    expect(safeGetFormSnapshot(ref)).toEqual({ title: '无敌美食', desc: '吃吃吃', tags: ['#food'] })
  })

  it('returns an all-empty snapshot cleanly', () => {
    const ref = makeRef(makeHandle())
    expect(safeGetFormSnapshot(ref)).toEqual({ title: '', desc: '', tags: [] })
  })
})

// ─── safeGetFormSnapshot: degradation ─────────────────────────────────────

describe('safeGetFormSnapshot — form unmounted (degradation)', () => {
  it('returns null when ref.current is null', () => {
    expect(safeGetFormSnapshot(makeRef(null))).toBeNull()
  })

  it('returns null AND does not throw when getFormSnapshot throws', () => {
    const ref = makeRef(
      makeHandle({
        getFormSnapshot: () => {
          throw new Error('ref freed mid-render')
        },
      }),
    )
    let result: unknown = 'sentinel'
    expect(() => {
      result = safeGetFormSnapshot(ref)
    }).not.toThrow()
    expect(result).toBeNull()
  })
})

// ─── safeApplyAiResult: happy path ────────────────────────────────────────

describe('safeApplyAiResult — form mounted', () => {
  it('forwards to ref.current and returns { applied: true }', () => {
    let captured: { title?: string; desc?: string; tags?: string[] } | null = null
    const ref = makeRef(
      makeHandle({
        applyAiResult: (r) => {
          captured = r
        },
      }),
    )
    const result = safeApplyAiResult(ref, { title: 'X', desc: 'Y', tags: ['Z'] })
    expect(result).toEqual({ applied: true })
    expect(captured).toEqual({ title: 'X', desc: 'Y', tags: ['Z'] })
  })
})

// ─── safeApplyAiResult: degradation ───────────────────────────────────────

describe('safeApplyAiResult — form unmounted (degradation)', () => {
  it('returns reason: "unmounted" when ref.current is null', () => {
    expect(safeApplyAiResult(makeRef(null), { title: 'X' })).toEqual({
      applied: false,
      reason: 'unmounted',
    })
  })

  it('returns reason: "threw" when apply throws', () => {
    const ref = makeRef(
      makeHandle({
        applyAiResult: () => {
          throw new Error('ref blew up')
        },
      }),
    )
    expect(safeApplyAiResult(ref, { title: 'X' })).toEqual({
      applied: false,
      reason: 'threw',
    })
  })

  it('does NOT propagate exceptions out of safeApplyAiResult', () => {
    const ref = makeRef(
      makeHandle({
        applyAiResult: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(() => safeApplyAiResult(ref, { title: 'X' })).not.toThrow()
  })
})

// ─── buildChatPayload: happy path ─────────────────────────────────────────

describe('buildChatPayload — happy path (form mounted)', () => {
  it('injects form snapshot as a system message just before the user turn', () => {
    const ref = makeRef(
      makeHandle({
        getFormSnapshot: () => ({ title: '无敌美食', desc: '吃吃吃', tags: ['#food'] }),
      }),
    )
    const out = buildChatPayload({
      ref,
      history: [
        { role: 'user', content: '上一轮' },
        { role: 'assistant', content: '上一轮回答' },
      ],
      text: '缩短标题到 10 字',
    })
    expect(out.formAttached).toBe(true)
    expect(out.formSnapshot).toEqual({ title: '无敌美食', desc: '吃吃吃', tags: ['#food'] })
    expect(out.messages).toHaveLength(4)
    expect(out.messages[2].role).toBe('system')
    expect(out.messages[2].content).toContain('无敌美食')
    expect(out.messages.at(-1)).toEqual({ role: 'user', content: '缩短标题到 10 字' })
  })

  it('keeps history order intact and appends the snapshot + new turn', () => {
    const ref = makeRef(
      makeHandle({ getFormSnapshot: () => ({ title: 'T', desc: '', tags: [] }) }),
    )
    const out = buildChatPayload({
      ref,
      history: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ],
      text: 'u3',
    })
    expect(out.messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2', expect.stringContaining('T'), 'u3'])
  })
})

// ─── buildChatPayload: degradation (unmounted) ────────────────────────────

describe('buildChatPayload — degradation (form unmounted)', () => {
  it('omits the system snapshot message and reports formAttached: false', () => {
    const out = buildChatPayload({
      ref: makeRef(null),
      history: [
        { role: 'user', content: '上一轮' },
        { role: 'assistant', content: '上一轮回答' },
      ],
      text: '再来 5 个备选',
    })
    expect(out.formAttached).toBe(false)
    expect(out.formSnapshot).toBeNull()
    expect(out.messages).toEqual([
      { role: 'user', content: '上一轮' },
      { role: 'assistant', content: '上一轮回答' },
      { role: 'user', content: '再来 5 个备选' },
    ])
    expect(out.messages.some((m) => m.role === 'system')).toBe(false)
  })

  it('produces a no-form-context payload when getFormSnapshot throws (stale ref mid-render)', () => {
    const ref = makeRef(
      makeHandle({
        getFormSnapshot: () => {
          throw new Error('boom')
        },
      }),
    )
    const out = buildChatPayload({
      ref,
      history: [{ role: 'user', content: 'history' }],
      text: 'a',
    })
    expect(out.formAttached).toBe(false)
    expect(out.formSnapshot).toBeNull()
    expect(out.messages).toEqual([
      { role: 'user', content: 'history' },
      { role: 'user', content: 'a' },
    ])
  })
})

// ─── buildChatPayload: recentTurns + token budgeting ───────────────────────

describe('buildChatPayload — recentTurns slicing', () => {
  it('keeps only the last N history turns', () => {
    const ref = makeRef(makeHandle({ getFormSnapshot: () => ({ title: 'T', desc: '', tags: [] }) }))
    const history = Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, content: `turn-${i + 1}` }))
    const out = buildChatPayload({ ref, history, text: 'NOW', recentTurns: 3 })
    expect(out.messages.filter((m) => m.content.startsWith('turn-'))).toHaveLength(3)
    expect(out.messages.map((m) => m.content).filter((c) => c.startsWith('turn-'))).toEqual([
      'turn-10',
      'turn-11',
      'turn-12',
    ])
    expect(out.messages.at(-1)).toEqual({ role: 'user', content: 'NOW' })
  })

  it('recentTurns: 0 → only snapshot + new user turn (no history)', () => {
    const ref = makeRef(makeHandle({ getFormSnapshot: () => ({ title: 'T', desc: '', tags: [] }) }))
    const out = buildChatPayload({ ref, history: [{ role: 'user', content: 'ignored' }], text: 'fresh', recentTurns: 0 })
    expect(out.messages).toEqual([
      { role: 'system', content: expect.stringContaining('T') },
      { role: 'user', content: 'fresh' },
    ])
  })

  it('truncates long desc snapshot to 200 chars', () => {
    const ref = makeRef(makeHandle({ getFormSnapshot: () => ({ title: 'T', desc: 'A'.repeat(1000), tags: [] }) }))
    const out = buildChatPayload({ ref, history: [], text: 'go' })
    const sys = out.messages.find((m) => m.role === 'system')!
    expect(sys.content).toContain('A'.repeat(200))
    expect(sys.content).not.toContain('A'.repeat(201))
  })

  it('missing all form fields renders "(空)" placeholders', () => {
    const ref = makeRef(makeHandle({ getFormSnapshot: () => ({ title: '', desc: '', tags: [] }) }))
    const out = buildChatPayload({ ref, history: [], text: 'go' })
    const sys = out.messages.find((m) => m.role === 'system')!
    expect(sys.content).toMatch(/标题: \(空\)/)
    expect(sys.content).toMatch(/描述: \(空\)/)
    expect(sys.content).toMatch(/标签: \(空\)/)
  })
})

// ─── integration with the store ──────────────────────────────────────────

describe('useChatFormBridge + useChatStore — integration', () => {
  beforeEach(() => useChatStore.getState().reset())

  it('end-to-end: form mounted → send → assistant stream → commit → all state consistent', () => {
    const ref = makeRef(
      makeHandle({
        getFormSnapshot: () => ({ title: '无敌美食', desc: '吃吃吃', tags: ['#food'] }),
      }),
    )
    const sid = useChatStore.getState().newSession('video', 'douyin')
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
    const text = '给一些 emoji'

    const payload = buildChatPayload({ ref, history, text })
    expect(payload.formAttached).toBe(true)

    expect(useChatStore.getState().appendUserMessage(sid, {
      content: text,
      formContextAtSend: payload.formSnapshot ?? undefined,
    })).toBe(true)
    useChatStore.getState().appendStreamingChunk('工具人贴纸 ')
    useChatStore.getState().appendStreamingChunk('🥘 🍜 🌶️')
    const committed = useChatStore.getState().commitAssistantMessage(sid)

    const s = useChatStore.getState().sessions[sid]
    expect(s.messages).toHaveLength(2)
    expect(s.messages[0].role).toBe('user')
    expect(s.messages[0].formContextAtSend?.title).toBe('无敌美食')
    expect(s.messages[1].role).toBe('assistant')
    expect(s.messages[1].content).toBe('工具人贴纸 🥘 🍜 🌶️')
    expect(committed).toBe(s.messages[1])
    expect(useChatStore.getState().streamingDraft).toBe('')
    expect(useChatStore.getState().jobStatus).toBe('idle')
  })

  it('end-to-end degradation: form unmounted mid-flow → send + commit still work, payload has no form ctx', () => {
    const sid = useChatStore.getState().newSession('note', 'xiaohongshu')
    // Simulate user switching to a non-Publish tab — ref.current becomes null.
    const ref = makeRef(null)

    const payload = buildChatPayload({ ref, history: [], text: '来点 ins 风' })
    expect(payload.formAttached).toBe(false)
    expect(payload.formSnapshot).toBeNull()

    // Send still proceeds, just without form snapshot.
    useChatStore.getState().appendUserMessage(sid, { content: '来点 ins 风' })
    useChatStore.getState().appendStreamingChunk('#极简 #低饱和 ')
    const c = useChatStore.getState().commitAssistantMessage(sid)!

    const s = useChatStore.getState().sessions[sid]
    expect(s.messages).toHaveLength(2)
    expect(s.messages[0].formContextAtSend).toBeUndefined() // no snapshot was attached
    expect(c.content).toContain('极简')
    expect(c.appliedTo).toBeUndefined() // caller can markApplied + safeApplyAiResult later
  })

  it('safeApplyAiResult returned "unmounted" after cancelStream does NOT corrupt store state', () => {
    const sid = useChatStore.getState().newSession('video', 'douyin')
    useChatStore.getState().appendUserMessage(sid, { content: 'test' })
    useChatStore.getState().appendStreamingChunk('halfway')
    expect(useChatStore.getState().cancelStream()).toBe(true)

    // Side-channel apply attempt against a null ref (e.g. caller tried Apply on unmounted form)
    const attempt = safeApplyAiResult(makeRef(null), { title: 'X' })
    expect(attempt).toEqual({ applied: false, reason: 'unmounted' })

    // State preserved
    const s = useChatStore.getState().sessions[sid]
    expect(s.messages.map((m) => m.role)).toEqual(['user'])
    expect(useChatStore.getState().streamingDraft).toBe('')
    expect(useChatStore.getState().jobStatus).toBe('idle')
  })
})
