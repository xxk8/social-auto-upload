/**
 * Maps the project's chat-store messages to assistant-ui's
 * `ThreadMessageLike` shape consumed by `useExternalStoreRuntime`.
 *
 * The mapping intentionally stays one-way (no inverse). assistant-ui
 * never needs to know our internal `ChatMessage` shape because the
 * runtime adapter hands us the `convertMessage` callback once and we
 * do not feed messages back through the assistant-ui pipeline.
 *
 * Streaming-draft handling lives in `streamingTailMessage()` below —
 * the runtime appends one synthetic "running" message when the chat
 * store reports `jobStatus === 'generating'` with a non-empty draft.
 */
import type { ThreadMessageLike } from '@assistant-ui/react'
import type { ChatMessage } from '@/lib/chat/types'

/**
 * assistant-ui's official external-store re-export. Patch the import
 * surface here if the runtime package ever moves the symbol.
 */
export type { ThreadMessageLike }

/**
 * Minimal shape we feed into the runtime. The same fields the
 * `ChatMessage` shape carries minus attachments + form-context —
 * neither of those need to round-trip through assistant-ui because
 * the chat pipeline already owns attachments in the active session,
 * and form context stays out-of-band via `getFormSnapshot()`.
 */
export type AssistantMessage = {
  id: string
  role: ChatMessage['role']
  content: string
  createdAt: number
  /** Platform key for /variants assistant messages (one bubble per platform). */
  platform?: string
  /** Parse failure flag for /variants messages that fell outside the JSON envelope. */
  parseError?: boolean
  /** Fields that were applied to the publish form: 'title' | 'desc' | 'tags'. */
  appliedTo?: string[]
}

/** Pure mapper — easy to unit-test, easy to swap. */
export function convertMessage(message: AssistantMessage): ThreadMessageLike {
  // Carry platform / parseError / appliedTo through metadata.custom so
  // the ThreadPrimitive.Messages renderer can detect platform-variant
  // messages and show the PlatformVariantBubble, plus the "已应用" badge.
  const custom: Record<string, unknown> = {}
  if (message.platform) custom.platform = message.platform
  if (message.parseError) custom.parseError = message.parseError
  if (message.appliedTo && message.appliedTo.length > 0) custom.appliedTo = message.appliedTo
  return {
    role: message.role,
    content: [{ type: 'text', text: message.content }],
    id: message.id,
    createdAt: new Date(message.createdAt),
    ...(Object.keys(custom).length > 0 ? { metadata: { custom } } : {}),
  }
}

/**
 * Stable synthetic id for the streaming tail. assistant-ui uses
 * message id for key reconciliation, so the streaming tail must hold
 * a stable id across re-renders OR never conflict with a real
 * committed message id. UUIDs from the chat store use
 * `crypto.randomUUID()`; reserving a `__streaming__:` prefix keeps
 * the namespace collision-free.
 */
export const STREAMING_TAIL_ID = '__streaming__:tail'

/**
 * Build the messages array that gets handed to the runtime.
 *
 * - Maps committed `ChatMessage[]` through `convertMessage`.
 * - Appends ONE synthetic assistant message with `role === 'assistant'`
 *   and the current `streamingDraft` text when:
 *     jobStatus === 'generating' AND streamingDraft is non-empty
 * - Drops the synthetic tail otherwise, so a re-render during `idle`
 *   never leaves a ghost cursor.
 */
export interface BuildMessagesInput {
  committed: ChatMessage[]
  /** Live SSE accumulator from `useChatStore.streamingDraft`. */
  streamingDraft: string
  /** Live status from `useChatStore.jobStatus`. */
  jobStatus: string
}

export function buildRuntimeMessages(input: BuildMessagesInput): ThreadMessageLike[] {
  const base = input.committed.map((m) =>
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

  if (input.jobStatus === 'generating' && input.streamingDraft.length > 0) {
    base.push({
      id: STREAMING_TAIL_ID,
      role: 'assistant',
      content: [{ type: 'text', text: input.streamingDraft }],
      createdAt: new Date(),
    })
  }

  return base
}
