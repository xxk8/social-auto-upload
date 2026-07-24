import { beforeEach, describe, expect, it } from 'vitest'
import { DexieChatStorage } from './storage.dexie'
import { InMemoryChatStorage } from './storage'
import { pruneChatStorage, DEFAULT_PRUNE_POLICY } from './pruner'
import type { ChatMessage, ChatSession, ChatStorage } from './types'

function msg(id: string, role: 'user' | 'assistant', content: string, createdAt: number): ChatMessage {
  return { id, role, content, createdAt, parentId: null }
}

function session(
  id: string,
  updatedAt: number,
  messages: ChatMessage[],
  totalSize = 100,
): ChatSession {
  return {
    id,
    title: `Session ${id}`,
    messages,
    headId: messages.length ? messages[messages.length - 1]!.id : null,
    updatedAt,
    totalSize,
  }
}

describe('DexieChatStorage', () => {
  let db: DexieChatStorage

  beforeEach(async () => {
    db = new DexieChatStorage()
    await db.clearAll()
  })

  it('listSessions returns rows sorted by updatedAt desc', async () => {
    await db.saveSession(session('a', 1000, [msg('m1', 'user', 'hi', 1000)]))
    await db.saveSession(session('b', 3000, [msg('m2', 'user', 'yo', 3000)]))
    await db.saveSession(session('c', 2000, [msg('m3', 'user', 'hey', 2000)]))
    const list = await db.listSessions()
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('saveSession upserts and replaces messages atomically', async () => {
    await db.saveSession(
      session('s1', 1000, [
        msg('m1', 'user', 'old', 1000),
        msg('m2', 'assistant', 'old-reply', 1001),
      ]),
    )
    await db.saveSession(
      session('s1', 2000, [msg('m3', 'user', 'new', 2000)]),
    )
    const list = await db.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0]!.messages.map((m) => m.id)).toEqual(['m3'])
    expect(list[0]!.updatedAt).toBe(2000)
  })

  it('deleteMany removes sessions and messages', async () => {
    await db.saveSession(session('s1', 1000, [msg('m1', 'user', 'a', 1000)]))
    await db.saveSession(session('s2', 2000, [msg('m2', 'user', 'b', 2000)]))
    await db.deleteMany(['s1'])
    const list = await db.listSessions()
    expect(list.map((s) => s.id)).toEqual(['s2'])
  })

  it('lastActive meta round-trips', async () => {
    expect(await db.getLastActiveId()).toBeNull()
    await db.setLastActiveId('s9')
    expect(await db.getLastActiveId()).toBe('s9')
    await db.setLastActiveId(null)
    expect(await db.getLastActiveId()).toBeNull()
  })

  it('pruneChatStorage works against Dexie adapter', async () => {
    const now = 100_000
    await db.saveSession(session('old', now - 20_000, [msg('m1', 'user', 'x', now - 20_000)], 50))
    await db.saveSession(session('fresh', now - 1000, [msg('m2', 'user', 'y', now - 1000)], 50))
    const report = await pruneChatStorage(db, { ttlMs: 10_000, maxTotalBytes: 1_000_000 }, now)
    expect(report.deletedByTtl).toContain('old')
    const survivors = await db.listSessions()
    expect(survivors.map((s) => s.id)).toEqual(['fresh'])
  })
})

/**
 * Contract suite: same behavioural expectations for InMemory and Dexie.
 */
function chatStorageContractSuite(name: string, factory: () => ChatStorage | Promise<ChatStorage>) {
  describe(`ChatStorage contract — ${name}`, () => {
    let storage: ChatStorage

    beforeEach(async () => {
      storage = await factory()
      if (storage instanceof DexieChatStorage) {
        await storage.clearAll()
      } else if (storage instanceof InMemoryChatStorage) {
        storage.__seed([])
      }
    })

    it('round-trips a session with messages', async () => {
      const s = session('c1', 5000, [
        msg('u1', 'user', 'hello', 5000),
        msg('a1', 'assistant', 'world', 5001),
      ])
      await storage.saveSession(s)
      const list = await storage.listSessions()
      expect(list).toHaveLength(1)
      expect(list[0]!.title).toBe('Session c1')
      expect(list[0]!.messages).toHaveLength(2)
    })

    it('deleteMany is a no-op for unknown ids', async () => {
      await storage.deleteMany(['nope'])
      expect(await storage.listSessions()).toEqual([])
    })
  })
}

chatStorageContractSuite('InMemoryChatStorage', () => new InMemoryChatStorage())
chatStorageContractSuite('DexieChatStorage', () => new DexieChatStorage())

// silence unused DEFAULT import when tree-shaken in some runners
void DEFAULT_PRUNE_POLICY
