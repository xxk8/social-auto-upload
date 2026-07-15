/**
 * `message-graph` — branch graph primitives.
 *
 * These specs lock the contract for the assistant-ui branching
 * translation. The runtime layer (`AiRuntimeProvider`) depends on
 * these invariants:
 *
 *   - `getActiveMessages` walks `headId` backwards via `parentId`.
 *   - Legacy sessions (no `headId`, no `parentId`) walk the tail.
 *   - Cycle protection — a corrupted dataset must NOT hang React.
 *   - Sibling query returns ALL message ids sharing the same parent.
 */
import { describe, expect, it } from 'vitest'
import { getActiveMessages, getSiblings, findMessageIndex } from './message-graph'
import type { ChatSession } from './types'

function makeMessage(
  id: string,
  role: 'user' | 'assistant' | 'system',
  parentId: string | null = null,
  content = '',
) {
  return { id, role, content, parentId, createdAt: Date.now() }
}

describe('getActiveMessages', () => {
  it('returns [] for empty / missing sessions', () => {
    expect(getActiveMessages(null)).toEqual([])
    expect(getActiveMessages(undefined)).toEqual([])
    const empty: ChatSession = {
      id: 's1',
      title: '',
      messages: [],
      headId: null,
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
    }
    expect(getActiveMessages(empty)).toEqual([])
  })

  it('walks head → root via parentId for an explicitly-headed session', () => {
    const session: ChatSession = {
      id: 's1',
      title: '',
      headId: 'a2',
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [
        makeMessage('u1', 'user', null, '原始提问'),
        makeMessage('a1', 'assistant', 'u1', '第一次回答'),
        makeMessage('a2', 'assistant', 'u1', '第二次回答（regenerate 后）'),
      ],
    }
    expect(getActiveMessages(session).map((m) => m.id)).toEqual(['u1', 'a2'])
  })

  it('legacy migration — walks array tail when headId is absent', () => {
    const session: ChatSession = {
      id: 's2',
      title: '',
      headId: null,
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [
        // No `parentId` field at all (pre-branch persistence).
        { id: 'u1', role: 'user', content: 'q', createdAt: 0 },
        { id: 'a1', role: 'assistant', content: 'a', createdAt: 0 },
      ],
    }
    const path = getActiveMessages(session)
    expect(path.map((m) => m.id)).toEqual(['u1', 'a1'])
  })

  it('does not hang on a cycle (corrupted dataset)', () => {
    const session: ChatSession = {
      id: 'cyc',
      title: '',
      headId: 'u1',
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [
        // Forged cycle: a1.parentId === a1 (self).
        makeMessage('u1', 'user', null, 'q'),
        makeMessage('a1', 'assistant', 'a1', 'a'),
      ],
    }
    // Must terminate via either visited-set OR MAX_PATH_LENGTH.
    const start = Date.now()
    const path = getActiveMessages(session)
    expect(Date.now() - start).toBeLessThan(50)
    expect(path.map((m) => m.id)).toContain('u1')
  })

  it('falls back gracefully when parentId references a missing id', () => {
    const session: ChatSession = {
      id: 'mb',
      title: '',
      headId: 'a1',
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [
        makeMessage('a1', 'assistant', 'nonexistent-id', 'a'),
      ],
    }
    // The walk should silently stop at the broken link rather than
    // throwing. Active path is just [a1] (root-ish: missing parent).
    expect(getActiveMessages(session).map((m) => m.id)).toEqual(['a1'])
  })

  it('handles a 3-deep multi-branch session correctly', () => {
    // Tree:
    //   u1 (root)
    //   ├── a1 (assistant, parent=u1)
    //   │   └── u2 (user, parent=a1)  ← user follow-up
    //   └── a2 (assistant, parent=u1)  ← regenerated sibling of a1
    //       └── a3 (assistant, parent=a2)
    //
    // Head = a3 → active path: u1, a2, a3
    const session: ChatSession = {
      id: 'tree',
      title: '',
      headId: 'a3',
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [
        makeMessage('u1', 'user', null, 'first q'),
        makeMessage('a1', 'assistant', 'u1', 'first answer'),
        makeMessage('u2', 'user', 'a1', 'follow-up'),
        makeMessage('a2', 'assistant', 'u1', 'regen of first answer'),
        makeMessage('a3', 'assistant', 'a2', 'continuation'),
      ],
    }
    expect(getActiveMessages(session).map((m) => m.id)).toEqual(['u1', 'a2', 'a3'])
  })
})

describe('getSiblings', () => {
  it('returns siblings sharing the same parentId (in insertion order)', () => {
    const session: ChatSession = {
      id: 's',
      title: '',
      headId: null,
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [
        makeMessage('u1', 'user', null, 'q'),
        makeMessage('a1', 'assistant', 'u1', 'v1'),
        makeMessage('a2', 'assistant', 'u1', 'v2'),
        makeMessage('a3', 'assistant', 'u1', 'v3'),
      ],
    }
    expect(getSiblings(session, 'a2')).toEqual(['a1', 'a2', 'a3'])
    expect(getSiblings(session, 'u1')).toEqual(['u1'])
    expect(getSiblings(session, 'missing')).toEqual([])
  })

  it('returns root siblings when querying a root message', () => {
    const session: ChatSession = {
      id: 's',
      title: '',
      headId: null,
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [
        makeMessage('u1', 'user', null, 'q1'),
        makeMessage('u2', 'user', null, 'q2'),
      ],
    }
    expect(getSiblings(session, 'u1')).toEqual(['u1', 'u2'])
  })
})

describe('findMessageIndex', () => {
  it('returns the index or -1', () => {
    const session: ChatSession = {
      id: 's',
      title: '',
      headId: null,
      formMode: 'video',
      updatedAt: 0,
      totalSize: 0,
      messages: [makeMessage('a', 'user'), makeMessage('b', 'user')],
    }
    expect(findMessageIndex(session, 'a')).toBe(0)
    expect(findMessageIndex(session, 'b')).toBe(1)
    expect(findMessageIndex(session, 'missing')).toBe(-1)
  })
})
