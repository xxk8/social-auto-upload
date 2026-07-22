/**
 * Chat domain types — shared by store, persistence layer, and bridge helpers.
 * Pure types only; runtime lives in storage.ts / useChatStore.ts.
 */

export type Role = 'user' | 'assistant' | 'system'

/** Granular streaming state. 'idle' is the steady state for both panels. */
export type JobStatus = 'idle' | 'generating' | 'enhancing' | 'error'

export type FormMode = 'video' | 'note'

export interface FormSnapshot {
  title: string
  desc: string
  /**
   * Path C: `string[]` natively. Legacy `string` payloads (from chat
   * storage written before the refactor) are normalized to `string[]`
   * on read via `lib/tags::parseTags` — the only place that needs to
   * know about both shapes. New writes are always `string[]`.
   */
  tags: string[]
}

export interface ChatAttachment {
  type: string
  /** Base64 data URL — already extracted from a File, ready to send. */
  dataUrl: string
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  /**
   * Branch graph pointer. `null` for root messages (the very first
   * user message of a session). Sibling branches share the same
   * `parentId`. Derived lazily when reading legacy sessions without
   * `parentId` set (see `useChatStore.getActiveMessages`).
   *
   * Why `parentId` instead of an explicit adjacency map: keeps the
   * flat array serializable to IndexedDB / SQLite without a
   * second pass, and the linear "active path" is one walk from
   * `ChatSession.headId` backwards.
   */
  parentId?: string | null
  /**
   * Only the most recent user message carries attachments —
   * earlier ancestors are trimmed before sending to the LLM.
   */
  attachments?: ChatAttachment[]
  createdAt: number
  /** Fields that were applied to the publish form: 'title' | 'desc' | 'tags'. */
  appliedTo?: string[]
  /** Form snapshot at send time, for audit / "what context did it use" UX. */
  formContextAtSend?: FormSnapshot
  /**
   * Platform key — set on assistant messages produced by the
   * `/variants` dedicated SSE consumer (one bubble per platform).
   * The render layer uses this to swap default chat-rendering for
   * the compact platform-chip card UI. Absent for normal `chat.send`
   * and `chat.regenerateFrom` assistant turns.
   */
  platform?: string
  /**
   * Optional parse failure flag — distinguishes a successful but
   * unparseable variant result (raw LLM output fell outside the
   * `{title,description,tags}` JSON envelope). Mirror of the
   * backend `parseError` flag on PlatformVariant payloads.
   */
  parseError?: boolean
}

export interface ChatSession {
  id: string
  title: string
  /**
   * Cursor pointing at the leaf of the currently-visible branch.
   * `null` for an empty session. The active message path is computed
   * by walking `parentId` chains backwards from `headId` to a
   * `parentId === null` root.
   *
   * `messages[]` keeps EVERY message across EVERY branch — the
   * session is the union, the head is the projection.
   */
  headId: string | null
  messages: ChatMessage[]
  formMode: FormMode
  platform?: string
  updatedAt: number
  /**
   * Approximate byte size for storage accounting. Updated on each
   * append so the pruner doesn't have to re-serialize the whole tree.
   */
  totalSize: number
}

/** Generic storage contract — implemented by InMemory today, Dexie later. */
export interface ChatStorage {
  listSessions(): Promise<ChatSession[]>
  saveSession(session: ChatSession): Promise<void>
  deleteMany(ids: string[]): Promise<void>
}
