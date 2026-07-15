/**
 * `message-graph` — flat-array branch graph primitives.
 *
 * The chat store uses a SINGLE flat `messages: ChatMessage[]` per
 * session (serializable to IndexedDB / SQLite in one shot) plus a
 * `headId: string | null` cursor. Sibling branches share the same
 * `parentId`. Reconstructing the visible (active) message path from
 * the head is a single back-walk.
 *
 * Why not an explicit adjacency map:
 *   - Serialization is one JSON write/parse for the whole session.
 *   - Branch operations are O(n) in the worst case but n is tiny
 *     (typical session has 5–30 messages).
 *   - Legacy sessions stored before the headId/parentId refactor
 *     can be migrated lazily on read (see `migrateLegacyParentIds`).
 */
import type { ChatMessage, ChatSession } from './types'

/**
 * Bound on the back-walk to guard against corrupted data (e.g. a
 * cycle introduced by a future bug). The path length is at most
 * `session.messages.length` so this is a safe upper limit.
 */
const MAX_PATH_LENGTH = 4096

/**
 * Walk the parentId chain backwards from `headId` and return the
 * messages in root→leaf order (suitable for direct rendering).
 *
 * Legacy compatibility: an element whose `parentId` is `undefined`
 * (i.e. absent JSON field) is migrated on the fly — its parentId is
 * derived from the preceding element of `session.messages[]`. This
 * lets pre-branch sessions render correctly without a DB migration.
 *
 * Robustness:
 *   - Cycle protection via `visited` set + `MAX_PATH_LENGTH`.
 *   - Walks past missing ids (broken parentId references) silently.
 *   - Returns `[]` for empty sessions or undefined inputs.
 */
export function getActiveMessages(
  session: ChatSession | undefined | null,
): ChatMessage[] {
  if (!session || session.messages.length === 0) return []

  // Build the migrated lookup once. Mutating the elements in-place
  // would corrupt store state — so we materialize a private copy.
  const byId = new Map<string, ChatMessage>()
  for (let i = 0; i < session.messages.length; i++) {
    const m = session.messages[i]
    if (m.parentId === undefined) {
      // Legacy migration: parentId absent → derive from the
      // preceding array element. Root messages (i === 0) get null.
      byId.set(m.id, {
        ...m,
        parentId: i > 0 ? session.messages[i - 1].id : null,
      })
    } else {
      byId.set(m.id, m)
    }
  }

  // Default headId: last element of `messages[]` (legacy sessions
  // don't carry headId — the tail IS the visible leaf by convention).
  const headId = session.headId ?? session.messages[session.messages.length - 1].id

  const path: ChatMessage[] = []
  const visited = new Set<string>()
  let cursor: string | null = headId
  while (cursor && path.length < MAX_PATH_LENGTH) {
    if (visited.has(cursor)) break
    visited.add(cursor)
    const m = byId.get(cursor)
    if (!m) break
    path.unshift(m)
    cursor = m.parentId ?? null
  }
  return path
}

/**
 * Convenience: return the index of `messageId` within `session.messages`,
 * or `-1` if absent. O(n) — fine for typical session sizes.
 */
export function findMessageIndex(
  session: ChatSession,
  messageId: string,
): number {
  return session.messages.findIndex((m) => m.id === messageId)
}

/**
 * Sibling query — given a messageId, return ALL ids of messages
 * sharing its `parentId` (including the message itself), in
 * insertion order. Used by the assistant-ui branch picker when
 * it asks "which variants exist for this node?".
 */
export function getSiblings(session: ChatSession, messageId: string): string[] {
  const target = session.messages.find((m) => m.id === messageId)
  if (!target) return []
  const targetParentId = target.parentId ?? null
  return session.messages
    .filter((m) => (m.parentId ?? null) === targetParentId)
    .map((m) => m.id)
}
