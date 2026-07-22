import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/useChatStore'
import { api } from '@/api/client'
import {
  buildChatPayload,
  safeApplyAiResult,
  type FormHandle,
  type MaybeRef,
  type AiGenerationResult,
} from '@/lib/chat/chatFormBridge'
import { parseTags } from '@/lib/tags'

/**
 * Parsed AI-result shape read by the form-bridge's `applyAiResult`. The
 * chat pipeline reuses AiSidebar's parser (`parseResult` in
 * AiSidebar.tsx) at the boundary; this hook returns whatever shape the
 * caller hands back via `parseResponse`. Kept here as a structural
 * type so the file can stand alone.
 */
export interface ParsedResponse {
  title?: string
  desc?: string
  tags?: string
}

interface UseChatActionsParams {
  /** Active form ref whose `getFormSnapshot` is read at send time. */
  formRef: MaybeRef<FormHandle | null>
  mode: 'video' | 'note'
  platform?: string
  model: string
  /**
   * Optional parser. Receives the raw assistant content and returns a
   * shape suitable for `formRef.applyAiResult`. If undefined, the
   * committed content is sent through `applyAiResult` unchanged —
   * which is fine for "纯文本对答" cases.
   */
  parseResponse?: (rawContent: string) => ParsedResponse
}

export interface UseChatActionsResult {
  /** Send a new user turn. Aborts any in-flight stream first. */
  send: (text: string, images?: string[], overrideModel?: string) => Promise<void>
  /** Cancel the in-flight stream; preserves committed messages. */
  cancel: () => void
}

/**
 * Encapsulates the multi-turn chat pipeline against the backend SSE
 * endpoint (`/api/ai/generate/stream` with `{messages}` payload).
 *
 * Responsibilities:
 *  - Lazily create / look-up the active chat session
 *  - Build the messages array (with optional form snapshot system
 *    message) via `buildChatPayload`
 *  - Stream SSE chunks into the store via `appendStreamingChunk` so
 *    `ChatArea` can render in-flight text
 *  - On `done`, call `commitAssistantMessage`, parse the result, and
 *    apply to the form via `safeApplyAiResult` + `markApplied`
 *  - Own a single AbortController so a second `send` cancels the
 *    first, and so unmount/cancel cleanly tears the stream down.
 *
 * Margins of safety:
 *  - Never fires `setJobStatus('error')` on cancel or unmount —
 *    navigation shouldn't surface as a UX error toast.
 *  - Reads store state via `useChatStore.getState()` inside callbacks
 *    so function identities stay stable across renders.
 */
export function useChatActions(params: UseChatActionsParams): UseChatActionsResult {
  const { formRef, mode, platform, model, parseResponse } = params

  // Single, mutable ref for the in-flight fetch's AbortController.
  // A ref (not state) so callbacks never re-create themselves when
  // it's swapped.
  const abortCtrlRef = useRef<AbortController | null>(null)

  // Cleanup on unmount: abort any in-flight stream + cancel the stream
  // from the store side. Either alone is enough to stop the stream;
  // doing both is defensive (e.g. snapshot state inconsistencies).
  useEffect(() => {
    return () => {
      abortCtrlRef.current?.abort()
      abortCtrlRef.current = null
      useChatStore.getState().cancelStream()
    }
  }, [])

  const send = useCallback(
    async (text: string, images: string[] = [], overrideModel?: string) => {
      // 1. Abort any in-flight stream — if the user double-clicks Send,
      //    only the latest request wins.
      abortCtrlRef.current?.abort()
      const ctrl = new AbortController()
      abortCtrlRef.current = ctrl

      // 2. Lazy-create or reuse the active chat session.
      const store = useChatStore.getState()
      let sid = store.activeSessionId
      if (!sid || !store.sessions[sid]) {
        sid = store.newSession(mode, platform)
      }

      // 3. Snapshot the conversation context that the AI will see.
      const session = useChatStore.getState().sessions[sid]
      const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> =
        session?.messages.map((m) => ({ role: m.role, content: m.content })) ?? []
      const payload = buildChatPayload({
        ref: formRef,
        history,
        text,
        recentTurns: 12,
      })

      // 4. Persist the user's turn into the session. Attachments are
      //    stored separately from `content` (which stays as plain text
      //    for storage / persistence) so that history doesn't bloat
      //    with base64 image data in IndexedDB.
      const attachments = images.map((url) => ({
        type: url.startsWith('data:video') ? 'video/jpeg' : 'image/jpeg',
        dataUrl: url,
      }))
      store.appendUserMessage(sid, {
        content: text,
        attachments,
        formContextAtSend: payload.formSnapshot ?? undefined,
      })

      // 5. Build the OpenRouter-shaped messages array. The last turn
      //    may need to be multimodal (text + image_url parts) when
      //    image attachments are present.
      const apiMessages: Array<{ role: string; content: unknown }> = payload.messages.map(
        (m) => ({ role: m.role, content: m.content }),
      )
      if (images.length > 0) {
        const lastIdx = apiMessages.length - 1
        const lastText =
          typeof apiMessages[lastIdx].content === 'string'
            ? (apiMessages[lastIdx].content as string)
            : ''
        apiMessages[lastIdx] = {
          role: 'user',
          content: [
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            { type: 'text', text: lastText },
          ],
        }
      }

      try {
        await api.generateMessagesStream(
          {
            messages: apiMessages,
            model: overrideModel || model,
            platform,
          },
          (chunk) => {
            // Chunk keystroke update: drop into the store so ChatArea
            // renders. If we've been cancelled, drop the chunk.
            if (abortCtrlRef.current === ctrl) {
              useChatStore.getState().appendStreamingChunk(chunk)
            }
          },
          () => {
            // Server sent `event: done`. Commit the assistant turn
            // (or no-op if the stream was aborted mid-flight).
            if (abortCtrlRef.current !== ctrl) return
            const committed = useChatStore.getState().commitAssistantMessage(sid!)
            if (!committed) return
            const parsed = parseResponse
              ? parseResponse(committed.content)
              : ({ title: undefined, desc: undefined, tags: undefined } as ParsedResponse)
            const parsedTags = parsed.tags ? parseTags(parsed.tags) : []
            const applied: AiGenerationResult = {
              title: parsed.title ?? '',
              desc: parsed.desc ?? '',
              tags: parsedTags,
            }
            const fields: string[] = []
            if (applied.title) fields.push('title')
            if (applied.desc) fields.push('desc')
            if (parsedTags.length > 0) fields.push('tags')
            // Skip the form-touching step entirely when no fields were
            // parsed (avoids spurious apply calls when the AI returns
            // a general prose with no 标题/描述/标签 labels).
            if (fields.length > 0) {
              const attempt = safeApplyAiResult(formRef, applied)
              if (attempt.applied) {
                useChatStore.getState().markApplied(sid!, committed.id, fields)
              }
            }
          },
          (err) => {
            // Server-stream error (NOT abort). Surface to store so
            // ChatArea / error UI can render it.
            if (abortCtrlRef.current !== ctrl) return
            useChatStore.getState().setJobStatus('error', err)
          },
          undefined,
          ctrl.signal,
        )
      } catch (e: unknown) {
        // AbortError is silent cancellation — handled by the cleanup
        // path. Anything else propagates to the error toast.
        if (e instanceof DOMException && e.name === 'AbortError') return
        const msg = e instanceof Error ? e.message : 'Network error'
        useChatStore.getState().setJobStatus('error', msg)
      } finally {
        // Release our hold on the controller if it's still ours.
        if (abortCtrlRef.current === ctrl) {
          abortCtrlRef.current = null
        }
      }
    },
    [formRef, mode, platform, model, parseResponse],
  )

  const cancel = useCallback(() => {
    abortCtrlRef.current?.abort()
    abortCtrlRef.current = null
    useChatStore.getState().cancelStream()
  }, [])

  return { send, cancel }
}
