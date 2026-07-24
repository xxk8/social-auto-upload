/**
 * Open Dexie chat storage, prune, hydrate the zustand store, then
 * write-through on session diffs (debounced 100ms).
 *
 * Safe to call once at app boot. StrictMode double-invoke is gated by
 * the module-level `listenerInstalled` flag.
 */
import { DexieChatStorage } from './storage.dexie'
import { DEFAULT_PRUNE_POLICY, pruneChatStorage } from './pruner'
import type { ChatSession } from './types'
import { useChatStore } from '@/stores/useChatStore'

let listenerInstalled = false
let chatDB: DexieChatStorage | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingSaves = new Map<string, ChatSession>()
let lastSeenJson = ''
let lastActiveSeen: string | null = null

function sessionsFingerprint(sessions: Record<string, ChatSession>): string {
  // Stable enough for equality; ids + updatedAt catch mutations without full serialize.
  const ids = Object.keys(sessions).sort()
  return ids.map((id) => `${id}:${sessions[id]?.updatedAt ?? 0}:${sessions[id]?.totalSize ?? 0}:${sessions[id]?.messages?.length ?? 0}`).join('|')
}

async function flushPending(): Promise<void> {
  if (!chatDB || pendingSaves.size === 0) return
  const batch = Array.from(pendingSaves.values())
  pendingSaves.clear()
  for (const s of batch) {
    try {
      await chatDB.saveSession(s)
    } catch (err) {
      console.warn('[chat-persistence] saveSession failed', err)
    }
  }
}

function scheduleSave(session: ChatSession): void {
  pendingSaves.set(session.id, session)
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPending()
  }, 100)
}

export async function bootstrapChatPersistence(): Promise<DexieChatStorage> {
  if (!chatDB) {
    chatDB = new DexieChatStorage()
  }

  await pruneChatStorage(chatDB, DEFAULT_PRUNE_POLICY)
  const sessions = await chatDB.listSessions()
  const lastActive = await chatDB.getLastActiveId()
  useChatStore.getState().hydrate(sessions, lastActive)
  lastSeenJson = sessionsFingerprint(
    Object.fromEntries(sessions.map((s) => [s.id, s])),
  )
  lastActiveSeen = lastActive

  if (!listenerInstalled) {
    listenerInstalled = true
    useChatStore.subscribe((state) => {
      if (!chatDB) return
      const fp = sessionsFingerprint(state.sessions)
      if (fp !== lastSeenJson) {
        lastSeenJson = fp
        for (const s of Object.values(state.sessions)) {
          scheduleSave(s)
        }
        // Sessions removed from store → delete from IDB
        void (async () => {
          try {
            const live = new Set(Object.keys(state.sessions))
            const all = await chatDB!.listSessions()
            const gone = all.map((s) => s.id).filter((id) => !live.has(id))
            if (gone.length) await chatDB!.deleteMany(gone)
          } catch (err) {
            console.warn('[chat-persistence] deleteMany failed', err)
          }
        })()
      }
      if (state.activeSessionId !== lastActiveSeen) {
        lastActiveSeen = state.activeSessionId
        void chatDB.setLastActiveId(state.activeSessionId)
      }
    })

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        // best-effort sync drain — fire-and-forget promises may still race
        void flushPending()
      })
    }
  }

  return chatDB
}

export function getChatDB(): DexieChatStorage | null {
  return chatDB
}
