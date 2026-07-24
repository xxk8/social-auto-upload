import type { ChatSession, ChatStorage } from './types'

export type { ChatStorage } from './types'
export { DexieChatStorage } from './storage.dexie'

/**
 * In-memory ChatStorage adapter.
 *
 * Used:
 *   - As a deterministic adapter in tests.
 *   - As a fallback when IndexedDB is unavailable.
 *
 * Production boot uses {@link DexieChatStorage} via `bootstrapChatPersistence`.
 */
export class InMemoryChatStorage implements ChatStorage {
  private map = new Map<string, ChatSession>()

  async listSessions(): Promise<ChatSession[]> {
    return Array.from(this.map.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async saveSession(session: ChatSession): Promise<void> {
    this.map.set(session.id, session)
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) this.map.delete(id)
  }

  // ── test helpers (intentionally not used at runtime) ──────────────────

  /** Replace the entire contents. Test-only. */
  __seed(sessions: ChatSession[]): void {
    this.map.clear()
    for (const s of sessions) this.map.set(s.id, s)
  }

  /** Snapshot deterministic to test order (sorted by id, not updatedAt). */
  __snapshot(): ChatSession[] {
    return Array.from(this.map.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
}
