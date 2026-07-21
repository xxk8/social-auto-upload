import { create } from 'zustand'
import type {
  ChatMessage,
  ChatSession,
  FormMode,
  JobStatus,
  Role,
} from '@/lib/chat/types'
import { getActiveMessages } from '@/lib/chat/message-graph'

const newId = (): string => crypto.randomUUID()

function approxMessageSize(m: Pick<ChatMessage, 'content' | 'attachments'>): number {
  let n = m.content.length
  if (m.attachments) for (const a of m.attachments) n += a.dataUrl.length
  return n
}

function deriveTitle(userText: string): string {
  if (!userText) return '新对话'
  return userText.length > 24 ? userText.slice(0, 24) + '…' : userText
}

/**
 * Re-export `getActiveMessages` here for convenient
 * `useChatStore.getActiveMessages(session)` symmetry with the
 * helper module. The actual implementation lives in
 * `lib/chat/message-graph.ts` (imported above) so it stays
 * unit-testable in isolation.
 */
export { getActiveMessages }

export interface ChatState {
  activeSessionId: string | null
  sessions: Record<string, ChatSession>
  jobStatus: JobStatus
  /**
   * Optional USED WHILE `jobStatus === 'generating'`. When set,
   * indicates the in-flight stream is the per-platform `/variants`
   * SSE consumer spawning N concurrent platform tasks. The header/
   * mono breadcrumb surfaces this as `streaming N platforms` — a
   * visible UX differentiator from the single-text `generating`
   * chip the chat-stream path surfaces.
   *
   * Always `undefined` outside an active `/variants` stream's
   * lifetime. The Panel reads this value and falls back to
   * `generating` (single chat) → `mainline` (idle) when
   * undefined.
   *
   * ── CLEAR-SITE CATALOG (⚠️C hardening) ──
   * Every code path that may flip the count back to `undefined`:
   *
   *   1. `setJobStatus(non-'generating')` — consolidated cleanup
   *      branch fires for any status other than 'generating'
   *      (e.g. 'enhancing', 'idle', 'error'). Single source of
   *      truth for non-variants terminal paths.
   *   2. `cancelStream()` — user-driven 取消. Clears
   *      `streamingDraft` + `jobStatus: 'idle'` AND
   *      `streamingVariantsCount` (R1 fix).
   *   3. `useAiChat.generateVariants`' AbortError catch —
   *      fires when the variants ctrl is aborted. R2: GATED on
   *      `ctrlRef.current === ctrl` so a fresh acquire-replaced
   *      sibling's count is NOT clobbered by the stale catch.
   *   4. `useAiChat.generateVariants`' onDone callback —
   *      explicit `streamingVariantsCount: undefined` in the
   *      `setState({...})` payload alongside `jobStatus: 'idle'`.
 *   5. `appendStreamingChunk(chunk)` — chat-stream first chunk
 *      defensively writes `streamingVariantsCount: undefined`
 *      alongside `jobStatus: 'generating'` so `chat.send`
 *      mid-`/variants` doesn't leave a stale count. R4 fix.
 *   5a. `useAiChat.enhanceInternal`'s chunk-write callback —
 *       enhance-phase stream chunk-cb mirrors R4 for the
 *       lead-`setJobStatus('enhancing')` path. Even though
 *       that lead already clears count via the consolidated
 *       cleanup branch, the chunk-write null-then-restore
 *       guarantees the breadcrumb stays correct (single-phase
 *       `generating`, NOT `streaming N platforms`) should a
 *       future refactor bypass the lead setJobStatus call.
 *       Belt-and-suspenders. Locked by
 *       `useAiChat.generateVariants.test.tsx::useAiChat.enhance
 *       — belt-and-suspenders chunk-write clear (R4-twin for
 *       enhance-phase)`.
 *   6. `setStreamingVariantsCount(null)` — direct clear API
 *      (currently consumed only by tests; reserved for future
 *      callers).
   *   7. `reset()` — full state reset includes `INITIAL`'s
   *      `streamingVariantsCount: undefined`.
   *
   * Only `setJobStatus('generating')` and the lead
   * `streamingVariantsCount: N` write inside `generateVariants`
   * PRESERVE the count (legitimate variants-flow writes). Any
   * other write that touches this slice should land count at
   * `undefined` unless the writing site is the variants hook
   * itself. CI DOES NOT enforce this — discipline only. If a
   * future code path writes a state slice while leaving count
   * untouched, the breadcrumb will regress; grep
   * `streamingVariantsCount` for the audit trail.
   */
  streamingVariantsCount?: number
  /** SSE accumulator. Cleared on commit or cancel. Never persisted raw. */
  streamingDraft: string
  error: string | null
}

export interface ChatActions {
  /**
   * Resolve `parentId` for a brand-new append. Rule:
   *   - If `session.headId` is set, the new message is a child of head
   *     (the assistant turn answering the previous user message, etc.).
   *   - If `session.headId` is null (empty/legacy session), the new
   *     message is a root (`parentId === null`).
   *   - For backwards compat with sessions that LACK a `headId` field
   *     (legacy JSON), fall back to the tail of `messages[]`.
   */
  parentOfHead: (session: ChatSession) => string | null
  /** Create a new session and make it active. */
  newSession: (formMode: FormMode, platform?: string) => string
  switchSession: (id: string) => boolean
  deleteSession: (id: string) => void
  /**
   * Append a user message as a child of the current head. Sets
   * `headId` to the new message id (so subsequent commits become
   * children of this turn).
   */
  appendUserMessage: (
    sessionId: string,
    msg: Pick<ChatMessage, 'content' | 'attachments' | 'formContextAtSend'>,
  ) => boolean
  /**
   * Append a `system`-typed breadcrumb (e.g. /magic help text) as a
   * child of the current head. Updates `headId` so the breadcrumb
   * stays visible until a real user turn.
   */
  appendSystemMessage: (sessionId: string, content: string) => boolean
  /** Append a streamed chunk; flips jobStatus to 'generating'. */
  appendStreamingChunk: (chunk: string) => void
  /**
   * Commit the streamed draft as a final assistant message. The new
   * message's parent is the EXPLICITLY PASSED `parentId` if given,
   * otherwise the current head. Sets `headId` to the new assistant
   * message.
   *
   * `parentId` is REQUIRED for forks (regenerate-from-user-msg,
   * edit-then-resend) so the new assistant becomes a SIBLING of any
   * prior assistant already attached to that user message.
   */
  commitAssistantMessage: (
    sessionId: string,
    parentId?: string | null,
  ) => ChatMessage | null
  /** Abort in-flight stream; preserves all already-committed messages. */
  cancelStream: () => boolean
  markApplied: (sessionId: string, messageId: string, fields: string[]) => void
  setJobStatus: (s: JobStatus, err?: string | null) => void
  /**
   * Set or clear the `streamingVariantsCount` indicator on the
   * chat-state slice. Pass `null` (or `undefined`) to clear.
   *
   * The count is read by the Panel's mono breadcrumb to surface
   * `streaming N platforms` while a `/variants` run is in flight.
   * Outside such runs the breadcrumb falls back to the legacy
   * `generating` chip — so the consumer is optional.
   */
  setStreamingVariantsCount: (count: number | null) => void
  /**
   * Switch the active branch by moving `headId`. The session's
   * `messages[]` is preserved verbatim; only the projection cursor
   * changes. Returns `false` if `headId` doesn't exist in the session.
   *
   * Used by:
   *   - `onReload` (rewind head to the user message before
   *     regenerating — produces a sibling assistant).
   *   - Future branch-picker UI — operator clicks "v2" to walk to a
   *     sibling assistant's head.
   */
  switchHead: (sessionId: string, headId: string) => boolean
  /**
   * `onEdit` helper: create a NEW user message whose `parentId` is
   * the SAME as the edited message's parentId (i.e. a SIBLING of
   * the edited turn). Sets `headId` to the new message id so the
   * subsequent `chat.send` / `chat.regenerateFrom` writes its
   * assistant turn as a sibling of the original assistant.
   *
   *   - Returns the new message id on success.
   *   - Returns `null` if the session/original message can't be found.
   *
   * The OLD branch (original user message + its assistant + everything
   * downstream) stays in `session.messages` as a preserved sibling
   * path; only the projection cursor moved.
   */
  branchUserMessage: (
    sessionId: string,
    originalMessageId: string,
    content: string,
  ) => string | null
  /**
   * `/variants` direct-append: write a finished assistant message
   * for one platform-keyed variant WITHOUT going through the
   * single-scalar `streamingDraft` accumulator. Bypasses the draft
   * because multiple platforms resolve concurrently and would
   * clobber the draft if shared.
   *
   *   - `parentId` is EXPLICIT (must be the synthetic `/variants`
   *     user-bubble id) so all platform bubbles are SIBLINGS of
   *     the same root — they're a graph fork off one user turn.
   *   - `platform` opts in to platform-tagged rendering
   *     (`<PlatformVariantBubble>`); absent → renders as plain text.
   *   - `parseError` flips the render into a "raw LLM output,
   *     parse failed" badge.
   *
   * INVARIANT — platform bubbles OWN THEIR OWN UI. The Panel's
   * route in `messages.map()` halves the renderer onto
   * `<PlatformVariantBubble>` whenever `message.platform` is set,
   * BYPASSING the standard `MessageBubble` chrome. That means
   * the `appliedTo` badge in the default `MessageBubble` assistant
   * branch is INVISIBLE for any platform-tagged bubble. If you
   * ever call this with both `options.platform` AND a downstream
   * write that touches `appliedTo`, add the platform-aware badge
   * to `PlatformVariantBubble` first or downstream callers will
   * silently mark fields as applied without any user-visible
   * confirmation.
   *
   * Returns the new message id, or `null` if the session can't be
   * found.
   */
  appendDirectAssistantMessage: (
    sessionId: string,
    parentId: string,
    content: string,
    options?: { platform?: string; parseError?: boolean },
  ) => string | null
  hydrate: (sessions: ChatSession[], activeId: string | null) => void
  reset: () => void
}

const INITIAL: ChatState = {
  activeSessionId: null,
  sessions: {},
  jobStatus: 'idle',
  streamingVariantsCount: undefined,
  streamingDraft: '',
  error: null,
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  ...INITIAL,

  parentOfHead: (session) => {
    if (session.headId) return session.headId
    // Legacy fallback for sessions persisted before headId existed.
    const tail = session.messages[session.messages.length - 1]
    return tail?.id ?? null
  },

  newSession: (formMode, platform) => {
    const id = newId()
    const now = Date.now()
    const session: ChatSession = {
      id,
      title: '新对话',
      messages: [],
      headId: null,
      formMode,
      platform,
      updatedAt: now,
      totalSize: 0,
    }
    set((s) => ({ activeSessionId: id, sessions: { ...s.sessions, [id]: session } }))
    return id
  },

  switchSession: (id) => {
    if (!get().sessions[id]) return false
    set({ activeSessionId: id })
    return true
  },

  deleteSession: (id) => {
    if (!get().sessions[id]) return
    set((s) => {
      const next = { ...s.sessions }
      delete next[id]
      return {
        sessions: next,
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      }
    })
  },

  appendUserMessage: (sessionId, msg) => {
    const session = get().sessions[sessionId]
    if (!session) return false
    const parentId = get().parentOfHead(session)
    const message: ChatMessage = {
      id: newId(),
      role: 'user',
      content: msg.content,
      attachments: msg.attachments,
      formContextAtSend: msg.formContextAtSend,
      createdAt: Date.now(),
      parentId,
    }
    const title =
      getActiveMessages(session).length === 0 ? deriveTitle(msg.content) : session.title
    const updated: ChatSession = {
      ...session,
      title,
      headId: message.id,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
      totalSize: session.totalSize + approxMessageSize(message),
    }
    set((s) => ({ sessions: { ...s.sessions, [sessionId]: updated } }))
    return true
  },

  appendSystemMessage: (sessionId, content) => {
    const session = get().sessions[sessionId]
    if (!session) return false
    const parentId = get().parentOfHead(session)
    const message: ChatMessage = {
      id: newId(),
      role: 'system',
      content,
      createdAt: Date.now(),
      parentId,
    }
    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...session,
          headId: message.id,
          messages: [...session.messages, message],
          updatedAt: Date.now(),
          totalSize: session.totalSize + approxMessageSize(message),
        },
      },
    }))
    return true
  },

  appendStreamingChunk: (chunk) => {
    if (!chunk) return
    // INVARIANT — chat-side first chunks MUST defensively null the
    // variants count (see ⚠️C review R4). When a chat stream takes
    // over from a /variants run mid-flight, `acquire()` aborts the
    // variants ctrl. The variants' AbortError catch DOES clear count
    // — but only if this ctrl is still the active one (the R2 gate).
    // If a fresh chat acquire already replaced the variants ctrl by
    // the time the catch microtask runs, the gate stops the catch
    // from clearing. Without THIS defensive clear in
    // `appendStreamingChunk`, the count stays at the variants-N and
    // the breadcrumb shows `streaming N platforms` while a chat
    // stream is the active one — UX lie. Chat-stream path is single,
    // not multi-platform, so count is correctly undefined.
    set((s) => ({
      streamingDraft: s.streamingDraft + chunk,
      jobStatus: 'generating',
      streamingVariantsCount: undefined,
    }))
  },

  commitAssistantMessage: (sessionId, parentId) => {
    const { streamingDraft, sessions } = get()
    const session = sessions[sessionId]
    if (!session || !streamingDraft) return null
    // Explicit parentId > current head. The explicit-param path is
    // what forks (regenerate / edited-turn) take — the assistant
    // becomes a SIBLING of any prior assistant.
    const resolvedParent = parentId !== undefined ? parentId : session.headId
    const message: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: streamingDraft,
      createdAt: Date.now(),
      parentId: resolvedParent,
    }
    const updated: ChatSession = {
      ...session,
      headId: message.id,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
      totalSize: session.totalSize + approxMessageSize(message),
    }
    set((s) => ({
      streamingDraft: '',
      jobStatus: 'idle',
      error: null,
      sessions: { ...s.sessions, [sessionId]: updated },
    }))
    return message
  },

  cancelStream: () => {
    const { jobStatus } = get()
    const wasActive = jobStatus === 'generating' || jobStatus === 'enhancing'
    if (!wasActive) return false
    // Crucially: do NOT touch `sessions`. Already-committed messages
    // remain intact; only the in-flight draft is discarded.
    //
    // INVARIANT — MUST keep `streamingVariantsCount` in sync with
    // the non-'generating' cleanup. `cancelStream` is the
    // user-driven 取消 path; without this reset the breadcrumb
    // would stay `streaming N platforms` indefinitely (see ⚠️C
    // review R1). This mirrors `setJobStatus`'s consolidated
    // cleanup so any non-'generating' terminal path converges on
    // `streamingVariantsCount === undefined`.
    set({
      streamingDraft: '',
      jobStatus: 'idle',
      streamingVariantsCount: undefined,
      error: null,
    })
    return true
  },

  markApplied: (sessionId, messageId, fields) => {
    if (!fields.length) return
    const session = get().sessions[sessionId]
    if (!session) return
    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...session,
          messages: session.messages.map((m) =>
            m.id === messageId
              ? { ...m, appliedTo: Array.from(new Set([...(m.appliedTo ?? []), ...fields])) }
              : m,
          ),
        },
      },
    }))
  },

  switchHead: (sessionId, headId) => {
    const session = get().sessions[sessionId]
    if (!session) return false
    if (!session.messages.some((m) => m.id === headId)) return false
    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: { ...session, headId, updatedAt: Date.now() },
      },
    }))
    return true
  },

  branchUserMessage: (sessionId, originalMessageId, content) => {
    const session = get().sessions[sessionId]
    if (!session) return null
    const original = session.messages.find((m) => m.id === originalMessageId)
    if (!original || original.role !== ('user' as Role)) return null
    const forkedId = newId()
    const forked: ChatMessage = {
      id: forkedId,
      role: 'user',
      content,
      createdAt: Date.now(),
      parentId: original.parentId ?? null,
    }
    const title = session.messages.length === 0 ? deriveTitle(content) : session.title
    const updated: ChatSession = {
      ...session,
      title,
      headId: forkedId,
      messages: [...session.messages, forked],
      updatedAt: Date.now(),
      totalSize: session.totalSize + approxMessageSize(forked),
    }
    set((s) => ({ sessions: { ...s.sessions, [sessionId]: updated } }))
    return forkedId
  },

  appendDirectAssistantMessage: (sessionId, parentId, content, options) => {
    const session = get().sessions[sessionId]
    if (!session) return null
    // Validate the parent exists in this session — prevents orphan
    // appends if the caller passes a stale id (e.g. after a session
    // switch or a headId that was switched away). Without this check
    // we'd silently write a sibling under a non-existent parent and
    // corrupt the branch graph for all subsequent reads.
    if (!session.messages.some((m) => m.id === parentId)) return null
    const message: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content,
      createdAt: Date.now(),
      parentId,
      platform: options?.platform,
      parseError: options?.parseError,
    }
    // DELIBERATELY do NOT move headId for platform-variant appends.
    // Each platform bubble is a SIBLING under the synthetic
    // `/variants <topic>` user bubble; the head should stay on
    // that synthetic user bubble so the user's NEXT turn
    // (`chat.send` → `appendUserMessage`) branches from the
    // user-turn root, not from any individual platform variant.
    // Without this guard, the next turn's user message would
    // become a child of (e.g.) the B站 platform bubble instead
    // of the synthetic user hand-off, which would orphan the
    // synchronous "regenerate / edit" anchored at the user turn.
    const updated: ChatSession = {
      ...session,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
      totalSize: session.totalSize + approxMessageSize(message),
    }
    set((s) => ({ sessions: { ...s.sessions, [sessionId]: updated } }))
    return message.id
  },

  setJobStatus: (jobStatus, error = null) => {
    // Any non-'generating' status flips the indicator off — the
    // variants-stream counterpart is `setStreamingVariantsCount(null)`
    // so we consolidate the cleanup here too.
    if (jobStatus !== 'generating') {
      set({ jobStatus, error, streamingVariantsCount: undefined })
      return
    }
    set({ jobStatus, error })
  },
  setStreamingVariantsCount: (count) =>
    set({ streamingVariantsCount: count ?? undefined }),

  hydrate: (sessions, activeId) => {
    const byId: Record<string, ChatSession> = {}
    for (const s of sessions) {
      byId[s.id] = {
        ...s,
        // Backfill headId from tail for legacy persistence (only
        // fires when s.headId is null AND s.messages is non-empty
        // — the null-coalescing above is the actual logic). The
        // spread MUST come first so this override isn't clobbered
        // by the `headId: null` in `s` (which would silently
        // re-introduce the legacy-orphan bug for `commitAssistantMessage`
        // when the caller doesn't pass an explicit `parentId`).
        headId: s.headId ?? (s.messages.length > 0 ? s.messages[s.messages.length - 1]!.id : null),
      }
    }
    set({
      sessions: byId,
      activeSessionId: sessions.some((s) => s.id === activeId) ? activeId : null,
    })
  },

  reset: () => set(INITIAL),
}))
