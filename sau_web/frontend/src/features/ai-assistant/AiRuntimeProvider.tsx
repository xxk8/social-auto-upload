/**
 * Bridges our chat store (`useChatStore`) + chat-actions SSE pipeline
 * (`useAiChat`) ↔ assistant-ui's `useExternalStoreRuntime`.
 *
 * The runtime treats our store as the source of truth, then forwards
 * user actions (`onNew` / `onCancel` / `onEdit` / `onReload` /
 * `onSwitchBranch`) back to the store / actions layer. We do NOT
 * maintain a parallel copy of messages — anything committed to
 * `useChatStore` immediately flows out via the runtime's `messages`
 * channel (next render).
 *
 * ## Branch translation (assistant-ui ↔ useChatStore)
 *
 * The assistant-ui runtime consumes a flat `messages: T[]` (active
 * path) PLUS an optional `messageRepository: ExportedMessageRepository`
 * carrying the FULL graph (head + parentIds). When the runtime's
 * internal branch picker fires, it asks the adapter for siblings,
 * tells us to switch heads, and our store computes the new active
 * path.
 *
 *   - `messages` ← `getActiveMessages(session)` walk-from-head.
 *   - `messageRepository` ← `ExportedMessageRepository.fromBranchableArray(...)`
 *     built from every element of `session.messages[]` with its
 *     `parentId`.
 *
 * The two stay consistent because both derive from the same store
 * snapshot, and `unstable_useExternalStoreRuntime` listens to store
 * updates via zustand subscriptions.
 *
 * ## onEdit contract
 *
 * assistant-ui calls `onEdit(msg)` where `msg.id` is the id of the
 * message being edited (the user message). The user wants the OLD
 * branch preserved (a sibling for switching); so:
 *
 *   1. Look up the original user message.
 *   2. Call `branchUserMessage(sessionId, originalId, newContent)`
 *      — creates a NEW user message whose `parentId` equals the
 *      ORIGINAL's parentId. Old branch stays intact in
 *      `session.messages[]`.
 *   3. Call `chat.regenerateFrom(forkedId)` — streams a new
 *      assistant whose `parentId = forkedId`. The new assistant is
 *      a SIBLING of the original assistant.
 *
 * Both phases share the runtime's AbortController via `useAiChat`.
 *
 * ## onReload contract
 *
 * assistant-ui calls `onReload(parentId, config)` where `parentId`
 * is the user message that triggered the assistant turn being
 * regenerated.
 *
 *   1. Switch head to `parentId` (`useChatStore.switchHead`).
 *   2. Call `chat.regenerateFrom(parentId)` — streams a new
 *      assistant whose `parentId = parentId`. The new assistant
 *      becomes a SIBLING of the original assistant under that
 *      same user message. The original branch stays preserved.
 *
 * ## Magic-command interception
 *
 * The `onNew` handler is the **only** hook where the user can
 * submit text. Therefore it's the natural place to recognize
 * `/magic` commands BEFORE we hand the message to
 * `chatActions.send()`.
 *
 *   1. Read the new text from `AppendMessage`.
 *   2. Call `parseMagicCommand(text)`.
 *   3. If we get a known command, dispatch via `extras.dispatchMagic`
 *      (set by AiAssistantPanel).
 *   4. Otherwise, hand the text to `chatActions.send()` like any
 *      ordinary user turn.
 */
/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo } from 'react'
import {
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { useChatStore, getActiveMessages } from '@/stores/useChatStore'
import type { UseAiChatResult } from './useAiChat'
import { convertMessage } from './externalMessageConverter'
import {
  buildMagicCommandMessage,
  parseMagicCommand,
  type MagicCommand,
} from './magicCommands'
import type { ChatMessage } from '@/lib/chat/types'
import type { ReactNode } from 'react'

/**
 * Imperative surface the runtime hands to downstream consumers.
 * Currently a thin wrapper — kept as a named shape for future
 * assistant-ui primitives that read `extras.dispatchMagic`.
 */
export interface AiRuntimeExtras {
  dispatchMagic: (command: MagicCommand) => Promise<void> | void
}

interface AiRuntimeProviderProps {
  /**
   * Hook result from the panel's parent (`useAiChat`). The runtime
   * NEVER instantiates its own pipeline — the panel owns the
   * AbortController and re-broadcasts it here so both call sites
   * (composer's submit + runtime's `onNew` / `onEdit` / `onReload`)
   * cancel in lockstep with one another.
   */
  chatActions: UseAiChatResult
  /** Implementation of the magic-command dispatcher. Bound upstream. */
  dispatchMagic: (command: MagicCommand) => Promise<void> | void
  /** Helper: render-prop so the panel renders surfaces inside the provider. */
  children: (runtime: ReturnType<typeof useExternalStoreRuntime>) => ReactNode
}

/**
 * Helper: pull the first text part's content out of an
 * `AppendMessage`. `convertMessage` already wrote one `{type:'text'}`
 * part per message; anything else is unsupported (no tool calls,
 * no images yet) — fall back to empty.
 */
function readMessageText(m: AppendMessage): string {
  const part = m.content.find((p) => p.type === 'text')
  return part && part.type === 'text' ? part.text : ''
}

/**
 * Internal hook — builds the runtime from store state. Kept
 * separate from the provider so the panel can render
 * `<AiRuntimeProvider>` as a thin provider node and put `<Thread />`
 * (or any consumer) underneath.
 */
function useAiChatRuntime(
  chatActions: UseAiChatResult,
  dispatchMagic: (command: MagicCommand) => Promise<void> | void,
) {
  // Subscribe narrowly so the runtime reference stays stable; the
  // runtime adapter docs warn that recreating `messages` every
  // render defeats memoization. Spread across multiple selectors
  // already keeps these primitives stable per render.
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const session = useChatStore((s) => (activeSessionId ? s.sessions[activeSessionId] : null))
  const jobStatus = useChatStore((s) => s.jobStatus)
  const streamingDraft = useChatStore((s) => s.streamingDraft)
  const isRunning = jobStatus === 'generating' || jobStatus === 'enhancing'

  // Build `messages` → ONLY the visible path. Walks from `headId`
  // backwards through `parentId` chains.
  const messages: ThreadMessageLike[] = useMemo(() => {
    const active = getActiveMessages(session)
    const base = active.map((m) =>
      convertMessage({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        platform: m.platform,
        parseError: m.parseError,
        appliedTo: m.appliedTo,
      }),
    )
    // Append the streaming-tail for live in-progress drafts.
    if (jobStatus === 'generating' && streamingDraft.length > 0) {
      base.push({
        id: '__streaming__:tail',
        role: 'assistant',
        content: [{ type: 'text', text: streamingDraft }],
        createdAt: new Date(),
      })
    }
    return base
  }, [session, jobStatus, streamingDraft])

  // Build `messageRepository` → FULL graph (all branches). Uses the
  // authoritative `ExportedMessageRepository.fromBranchableArray`
  // factory so the runtime's branch-picker primitives render the
  // sibling picker UI correctly.
  //
  // Map ChatMessage → ThreadMessageLike via the SAME converter used
  // for `messages` so id/role/content/createdAt stay consistent
  // across the two surfaces.
  const messageRepository = useMemo<ExportedMessageRepository>(() => {
    if (!session) {
      return ExportedMessageRepository.fromArray([])
    }
    const items = session.messages.map((m: ChatMessage) => {
      // Legacy migration: messages persisted before parentId existed
      // get parentId derived lazily by getActiveMessages. We mirror
      // that here for the repository graph (so the branch picker
      // shows consistent siblings on freshly-hydrated sessions).
      const idx = session.messages.findIndex((x) => x.id === m.id)
      const legacyParent =
        m.parentId === undefined
          ? idx > 0
            ? session.messages[idx - 1]!.id
            : null
          : m.parentId
      return {
        message: convertMessage({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          platform: m.platform,
          parseError: m.parseError,
          appliedTo: m.appliedTo,
        }),
        parentId: legacyParent,
      }
    })
    return ExportedMessageRepository.fromBranchableArray(items, {
      headId: session.headId ?? null,
    })
  }, [session])

  /**
   * `onNew` — the entry point for user-submitted messages. README
   * of the protocol:
   *   1. If the text matches a slash command, fire-and-forget
   *      dispatch. Return early so we don't ALSO send it as a
   *      regular chat turn (would burn tokens on a `/help`).
   *   2. Otherwise, push the user message into the store via
   *      `chatActions.send`.
   */
  const onNew = useCallback(
    async (msg: AppendMessage) => {
      const text = readMessageText(msg)
      const parsed = parseMagicCommand(text)
      if (parsed.kind !== 'error') {
        await dispatchMagic(parsed)
        return
      }
      // Forward normal chat text to the SSE pipeline. Note that this
      // shares the same AbortController as the composer's send() —
      // a 取消 click in either surface aborts both.
      await chatActions.send(text)
    },
    [chatActions, dispatchMagic],
  )

  const onCancel = useCallback(async () => {
    chatActions.cancel()
  }, [chatActions])

  /**
   * `onEdit` — rewind and FORK on the same parent.
   *
   * assistant-ui calls this with the edited message's id (and a new
   * content). Creates a sibling user message + streams a fresh
   * assistant as a sibling of any prior assistant. Both old + new
   * branches remain navigable via the branch picker.
   *
   * The runtime also says to use `setMessages` to update visible
   * ordering, but since the branch picker reads the graph
   * (`messageRepository`), `setMessages` here is purely
   * informational. The store IS the source of truth.
   */
  const onEdit = useCallback(
    async (msg: AppendMessage) => {
      const newText = readMessageText(msg)
      // AppendMessage has no `id` field (Omit<ThreadMessage, "id">);
      // the parent message being edited is carried via `parentId`.
      const originalId = msg.parentId
      if (!originalId) return

      const store = useChatStore.getState()
      const sid = store.activeSessionId
      if (!sid) return

      const forkedId = store.branchUserMessage(sid, originalId, newText)
      if (!forkedId) return

      // Stream a new assistant whose parentId = forkedId. The new
      // assistant will be a sibling of any prior assistant under
      // the original user message. Shared AbortController with the
      // rest of the runtime — a 取消 click aborts both here and
      // any concurrent composer submit.
      await chatActions.regenerateFrom(forkedId)
    },
    [chatActions],
  )

  /**
   * `onReload(parentId, config)` — regenerate the assistant under
   * the given user message. Creates a sibling assistant in the
   * graph; the original assistant stays intact.
   *
   * Note: We do NOT use `config` (StartRunConfig) — our pipeline
   * reads session context itself via buildChatPayload. `config`
   * is reserved for future adapter integration if we ever wire
   * tools / multimodal inputs that assistant-ui declares here.
   */
  const onReload = useCallback(
    async (parentId: string | null) => {
      if (!parentId) return
      const store = useChatStore.getState()
      const sid = store.activeSessionId
      if (!sid) return
      const sessionNow = store.sessions[sid]
      if (!sessionNow) return
      // Sanity check — parentId must point at a user message in the
      // active session. (assistant-ui should pass the user message's
      // id — that's the contract after our migration refactor.)
      const target = sessionNow.messages.find((m) => m.id === parentId)
      if (!target || target.role !== 'user') return

      await chatActions.regenerateFrom(parentId)
    },
    [chatActions],
  )

  /**
   * Default `setMessages` — assistant-ui calls this when the
   * visible messages array should change (e.g. branch switching
   * inside an edited composer). Because the branch picker reads
   * the graph (`messageRepository`) AND our store is the source
   * of truth, `setMessages` is a no-op here — any switch or edit
   * we care about already happened via `switchHead` /
   * `branchUserMessage`.
   *
   * We keep the prop present so assistant-ui's contract is
   * satisfied (the runtime warns on missing setMessages for
   * branch modes).
   */
  const setMessages = useCallback((_next: readonly ThreadMessageLike[]) => {
    void _next
  }, [])

  const extras = useMemo<AiRuntimeExtras>(
    () => ({
      dispatchMagic: async (cmd) => {
        await dispatchMagic(cmd)
      },
    }),
    [dispatchMagic],
  )

  return useExternalStoreRuntime({
    messages,
    messageRepository,
    isRunning,
    onNew,
    onCancel,
    onEdit,
    onReload,
    setMessages,
    // `messages` + `messageRepository` are pre-converted to
    // ThreadMessageLike in the useMemos above. The runtime's
    // `convertMessage` option is required by the
    // ExternalStoreMessageConverterAdapter type when T ≠ ThreadMessageLike,
    // but even when T === ThreadMessageLike the type system demands the
    // field. Pass an identity converter so any on-the-fly conversion the
    // runtime triggers is a no-op (our messages are already in the
    // target shape).
    convertMessage: (m: ThreadMessageLike) => m,
    extras,
  })
}

/**
 * Provider component. Children receive a fully wired
 * `AssistantRuntimeProvider` and just need to render any of the
 * assistant-ui surface components (`<Thread>`, `<ThreadList>`,
 * `<Composer>`, etc.) underneath.
 */
export function AiRuntimeProvider({
  chatActions,
  dispatchMagic,
  children,
}: AiRuntimeProviderProps) {
  const runtime = useAiChatRuntime(chatActions, dispatchMagic)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children(runtime)}
    </AssistantRuntimeProvider>
  )
}

/**
 * Re-export for the panel — useful when the panel wants to render
 * suggestion chips or fire its own magic commands without going
 * through the runtime's `onNew`.
 */
export { buildMagicCommandMessage }
