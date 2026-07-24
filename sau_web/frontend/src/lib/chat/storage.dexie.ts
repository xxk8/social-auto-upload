import Dexie, { type Table } from 'dexie'
import type { ChatMessage, ChatSession, ChatStorage } from './types'

/** Session envelope without nested messages (messages live in their own table). */
type SessionRow = Omit<ChatSession, 'messages'>

type MessageRow = ChatMessage & { sessionId: string }

type MetaRow = { key: string; value: string }

/**
 * IndexedDB-backed ChatStorage via Dexie.
 *
 * Schema v1:
 *   sessions  — id PK, updatedAt index
 *   messages  — id PK, [sessionId+createdAt] compound, sessionId
 *   _meta     — singleton key/value (lastActiveSessionId)
 */
class ChatDexie extends Dexie {
  sessions!: Table<SessionRow, string>
  messages!: Table<MessageRow, string>
  _meta!: Table<MetaRow, string>

  constructor() {
    super('social-auto-upload-chat')
    this.version(1).stores({
      sessions: 'id, updatedAt',
      messages: 'id, [sessionId+createdAt], sessionId',
      _meta: 'key',
    })
  }
}

const META_LAST_ACTIVE = 'lastActiveSessionId'

export class DexieChatStorage implements ChatStorage {
  private db = new ChatDexie()

  async listSessions(): Promise<ChatSession[]> {
    const rows = await this.db.sessions.orderBy('updatedAt').reverse().toArray()
    const out: ChatSession[] = []
    for (const row of rows) {
      const msgs = await this.db.messages
        .where('sessionId')
        .equals(row.id)
        .sortBy('createdAt')
      out.push({
        ...row,
        messages: msgs.map(({ sessionId: _s, ...m }) => m),
      })
    }
    return out
  }

  async saveSession(session: ChatSession): Promise<void> {
    const { messages, ...meta } = session
    await this.db.transaction('rw', this.db.sessions, this.db.messages, async () => {
      await this.db.sessions.put(meta)
      await this.db.messages.where('sessionId').equals(session.id).delete()
      if (messages.length) {
        await this.db.messages.bulkPut(
          messages.map((m) => ({ ...m, sessionId: session.id })),
        )
      }
    })
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (!ids.length) return
    await this.db.transaction('rw', this.db.sessions, this.db.messages, async () => {
      await this.db.sessions.bulkDelete(ids)
      await this.db.messages.where('sessionId').anyOf(ids).delete()
    })
  }

  async getLastActiveId(): Promise<string | null> {
    const row = await this.db._meta.get(META_LAST_ACTIVE)
    return row?.value ?? null
  }

  async setLastActiveId(id: string | null): Promise<void> {
    if (id == null) {
      await this.db._meta.delete(META_LAST_ACTIVE)
      return
    }
    await this.db._meta.put({ key: META_LAST_ACTIVE, value: id })
  }

  /** Wipe all chat tables (store reset / clear-all). */
  async clearAll(): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.sessions,
      this.db.messages,
      this.db._meta,
      async () => {
        await this.db.sessions.clear()
        await this.db.messages.clear()
        await this.db._meta.clear()
      },
    )
  }
}
