import type { ChatSession, ChatStorage } from './types'

/**
 * In-memory ChatStorage adapter.
 *
 * Used:
 *   - As the production fallback until an IndexedDB adapter ships.
 *   - In tests as a deterministic, synchronous-feeling adapter.
 *
 * To migrate to IndexedDB, write a `DexieChatStorage` that implements the
 * same `ChatStorage` contract and swap the export from this module (or
 * inject it into the store init).
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
