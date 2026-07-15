/**
 * `useAiChat` — single, shared SSE pipeline for the AI assistant
 * panel. Replaces the historical "panel-local sendToChat +
 * runEnhanceStream" path AND the runtime-provider's internal
 * `useChatActions` call so the panel + the assistant-ui runtime
 * share ONE AbortController per mounted panel.
 *
 * ## Cancellation contract
 *
 * Every public method goes through the same `acquire()` function
 * which aborts the prior controller and creates a fresh one. This
 * matches the "second-send cancels the first" pattern that's been
 * the project's working behavior since before the assistant-ui
 * refactor.
 *
 * The big change in this round is BOTH branches share a single
 * AbortController AND regeneration / edit paths funnel through a
 * common `regenerateFrom(parentUserMessageId)` method instead of
 * duplicating pipeline code.
 *
 * ## Branch semantics
 *
 *   - `send(text, images)` — fresh turn. Creates a new user message
 *     as a child of the current head (typical user-driven flow).
 *   - `regenerateFrom(parentUserMessageId)` — fork. Streams a new
 *     assistant message whose `parentId` is `parentUserMessageId`
 *     (the user message). Any prior assistant already attached to
 *     the same parent stays in `session.messages[]` as a sibling,
 *     untouched. Used by both `onReload` (rewind then fork) and
 *     `onEdit` (after `branchUserMessage` creates the forked user
 *     message).
 *   - `runFullflow(topic)` — enhance prompt, then `send(enhanced)`.
 *     Both phases under ONE AbortController.
 *
 * Any chunk callback that fires after an abort silently drops the
 * chunk (`ctrlRef.current !== ctrl`); already-committed messages
 * stay intact (`cancelStream` clears the draft, never the messages
 * array).
 *
 * ## Why one hook, not two (e.g., enhancer + chat) sharing context
 *
 * We're not using a React context here because the call site is
 * narrow: the Panel mounts the Runtime Provider in the same JSX
 * subtree, so passing the hook's actions as a single prop is the
 * simplest contract. A context is the right escape hatch once we
 * have ≥3 callers that all share the same controller; today we
 * have 2 (Panel composer's submit + Runtime's `onNew`).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useChatStore } from '@/stores/useChatStore'
import { api } from '@/api/client'
import {
  buildChatPayload,
  safeApplyAiResult,
  type FormHandle,
  type MaybeRef,
} from '@/lib/chat/chatFormBridge'
import { parseTags } from '@/lib/tags'

/** Subset of the parsed AI-result shape consumed by `applyAiResult`. */
export interface ParsedResponse {
  title?: string
  desc?: string
  tags?: string
}

export interface UseAiChatParams {
  /** Active publish-form ref — same bridge the legacy hook consumed. */
  formRef: MaybeRef<FormHandle | null>
  /** Publish mode (`'video' | 'note'`). */
  mode: 'video' | 'note'
  /** Optional platform id (multi-platform variant hints). */
  platform?: string
  /**
   * Active model id. Caller-supplied (we don't subscribe to
   * `useAiStore` so tests can swap models without faking the store).
   */
  model: string
  /**
   * Optional parser. Receives the raw assistant content and returns a
   * shape suitable for `formRef.applyAiResult`. If undefined, we
   * commit the assistant turn without auto-applying — fine for
   * generic chat replies.
   */
  parseResponse?: (raw: string) => ParsedResponse
}

export interface UseAiChatResult {
  /**
   * Send a fresh user turn. Aborts any prior in-flight stream first.
   * Creates a new user message as a child of the current head, then
   * streams the assistant reply as a child of THAT new user message.
   */
  send: (text: string, images?: string[]) => Promise<void>
  /**
   * Run enhance-prompt only. Returns the enhanced text on success.
   * Used by `/enhance` and as a building block of `runFullflow`.
   * Aborts any prior in-flight stream first.
   */
  enhance: (text: string) => Promise<string>
  /**
   * `/fullflow` — enhance → chat-stream UNDER ONE shared
   * AbortController. If the user cancels during phase 1,
   * phase 2 short-circuits (does NOT fire). The single controller
   * guarantee is the whole point of consolidating the pipelines into
   * this hook.
   */
  runFullflow: (text: string, images?: string[]) => Promise<void>
  /**
   * Fork: stream a new assistant message whose `parentId` is
   * `parentUserMessageId` (a user message that already exists in the
   * session). Switches the head to that user message first so the
   * committed assistant becomes a SIBLING of any prior assistant
   * under the same parent — the original branch is preserved.
   *
   * Used by:
   *   - `onReload(parentId)` — rewind head to the user message,
   *     re-issue `regenerateFrom(userMsgId)`.
   *   - `onEdit(newForkedUserMsgId)` — after `branchUserMessage`
   *     creates the forked user message, the recompute routes
   *     through `regenerateFrom(newForkedId)` so both phases share
   *     a single AbortController with the rest of the runtime.
   */
  regenerateFrom: (parentUserMessageId: string) => Promise<void>
  /**
   * `/variants` — dedicated per-platform SSE consumer. Replaces the
   * older "/variants asked LLM to emit a JSON array" approach with
   * a real stream that hits `aiApi.generatePlatformVariantsStream`
   * (which routes to `/api/ai/generate/variants`). One platform
   * event ⇄ ONE direct-append assistant message; all platforms land
   * as SIBLINGS under the synthetic user bubble.
   *
   *   - Pre-pends a user bubble whose content describes the topic.
   *     That becomes the parentId for every platform bubble.
   *   - Aborts any prior in-flight stream first (`acquire()`).
   *   - Throws synchronously when `platforms` is empty — callers
   *     must check before invoking (the Panel guards this).
   */
  generateVariants: (
    topic: string,
    platforms: string[],
    search?: boolean,
  ) => Promise<void>
  /**
   * Imperative cancel — aborts whatever controller is currently in
   * `ctrlRef.current`. Idempotent. UI calls this from the 取消
   * button. Side effect: drops streamingDraft via `cancelStream()`.
   */
  cancel: () => void
  /**
   * Live `isRunning` derived from `useChatStore.jobStatus`. Components
   * that need a sync render-time signal can read this instead of
   * subscribing to the store themselves.
   */
  isRunning: boolean
}

/**
 * Unified AI chat hook. One AbortController, four actions.
 *
 * Strict rule: never call `useChatStore.getState().appendStreamingChunk`
 * directly from this hook — it would set jobStatus to `'generating'`,
 * conflicting with the enhance phase. We use `useChatStore.setState`
 * directly to flip `'enhancing'` during phase 1 and `'generating'`
 * during phase 2.
 */
export function useAiChat(params: UseAiChatParams): UseAiChatResult {
  const { formRef, mode, platform, model, parseResponse } = params

  // The single shared AbortController. Every public method goes
  // through `acquire()` which replaces this ref.
  const ctrlRef = useRef<AbortController | null>(null)

  const isRunning = useChatStore(
    (s) => s.jobStatus === 'generating' || s.jobStatus === 'enhancing',
  )

  // ── Controller management ─────────────────────────────────────────
  // Aborts whatever's currently in `ctrlRef.current` and assigns a
  // fresh controller. Returned controller is the one all subsequent
  // fetch calls in a single pipeline must listen on.
  const acquire = useCallback((): AbortController => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    return ctrl
  }, [])

  // ── Phase 2 (chat stream) — internal ──────────────────────────────
  // Takes the controller AND an explicit parentUserMessageId so the
  // caller (send / regenerateFrom / runFullflow) decides whether to
  // prepend a brand-new user message or fork off an existing one.
  // The committed assistant message's parentId = parentUserMessageId,
  // so forks become SIBLINGS — the branch graph stays consistent.
  const sendInternal = useCallback(
    async (
      ctrl: AbortController,
      parentUserMessageId: string,
      text: string,
      images: string[],
    ): Promise<void> => {
      // Re-aborted between phases? bail before scheduling anything.
      if (ctrl.signal.aborted) return

      const store = useChatStore.getState()
      const sid = store.activeSessionId
      if (!sid) return

      // Build history: messages up to (but NOT including) the trigger
      // user message. buildChatPayload will append `text` (= the
      // trigger's own content) as the final user turn.
      const session = useChatStore.getState().sessions[sid]
      if (!session) return
      const allMsgs = session.messages
      const triggerIdx = allMsgs.findIndex((m) => m.id === parentUserMessageId)
      const history =
        triggerIdx === -1
          ? allMsgs.map((m) => ({ role: m.role, content: m.content }))
          : allMsgs
              .slice(0, triggerIdx)
              .map((m) => ({ role: m.role, content: m.content }))

      // Build the messages array (with optional form-snapshot system
      // message) via the existing chat-bridge helper.
      const payload = buildChatPayload({
        ref: formRef,
        history,
        text,
        recentTurns: 12,
      })

      // OpenRouter-shaped messages array; last user turn may be
      // multimodal (text + image_url parts) when image attachments
      // are present.
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
          { messages: apiMessages, model, platform },
          (chunk) => {
            // Drop chunks if we've been aborted or replaced.
            if (ctrlRef.current !== ctrl) return
            useChatStore.getState().appendStreamingChunk(chunk)
          },
          () => {
            // Server `event: done`. No-op if the controller was
            // replaced/aborted mid-flight.
            if (ctrlRef.current !== ctrl) return
            const sidInner = useChatStore.getState().activeSessionId
            if (!sidInner) return
            // COMMIT WITH EXPLICIT parentId — this is the fork
            // guarantee. The new assistant becomes a SIBLING of any
            // prior assistant already attached to parentUserMessageId.
            const committed = useChatStore
              .getState()
              .commitAssistantMessage(sidInner, parentUserMessageId)
            if (!committed) return
            const parsed = parseResponse
              ? parseResponse(committed.content)
              : ({ title: undefined, desc: undefined, tags: undefined } as ParsedResponse)
            const fields: string[] = []
            if (parsed.title) fields.push('title')
            if (parsed.desc) fields.push('desc')
            if (parsed.tags) fields.push('tags')
            if (fields.length > 0) {
              const attempt = safeApplyAiResult(formRef, {
                title: parsed.title,
                desc: parsed.desc,
                tags: parsed.tags ? parseTags(parsed.tags) : undefined,
              })
              if (attempt.applied) {
                useChatStore.getState().markApplied(sidInner, committed.id, fields)
              }
            }
          },
          (err) => {
            if (ctrlRef.current !== ctrl) return
            useChatStore.getState().setJobStatus('error', err)
          },
          undefined,
          ctrl.signal,
        )
      } catch (e: unknown) {
        // AbortError is silent cancellation. Anything else propagates
        // to the error toast.
        if (e instanceof DOMException && e.name === 'AbortError') return
        const msg = e instanceof Error ? e.message : 'Network error'
        useChatStore.getState().setJobStatus('error', msg)
      } finally {
        if (ctrlRef.current === ctrl) {
          ctrlRef.current = null
        }
      }
    },
    [formRef, mode, platform, model, parseResponse],
  )

  // ── Phase 1 (enhance stream) — internal ────────────────────────────
  // Uses `setState` directly because `appendStreamingChunk` would
  // flip `jobStatus` to `'generating'`; we want `'enhancing'`
  // during the enhance phase so the UI breadcrumb shows the right
  // state.
  const enhanceInternal = useCallback(
    async (ctrl: AbortController, text: string): Promise<string> => {
      if (ctrl.signal.aborted) return text
      if (!text.trim()) return text

      useChatStore.getState().setJobStatus('enhancing')

      // IMPORTANT: `readSSEStream` swallows AbortError internally and
      // resolves. `api.enhancePrompt` returns a Promise that ALSO
      // resolves (never rejects) on cancel. Without an explicit abort
      // listener, neither `onDone` nor the `.catch` branch settle the
      // outer Promise, so `runFullflow`'s `await enhanceInternal(...)`
      // would hang indefinitely — never reaching the
      // `ctrl.signal.aborted` gate, never firing phase 2. This listener
      // is THE fix.
      return new Promise<string>((resolve, reject) => {
        let full = ''
        let settled = false
        const settle = (value: string) => {
          if (settled) return
          settled = true
          // Drain the draft + reset status regardless of path.
          useChatStore.setState({
            streamingDraft: '',
            jobStatus: 'idle',
            error: null,
          })
          resolve(value)
        }
        // ONE named handler. Removing / referencing it from `.catch`
        // and `errCb` requires the SAME function reference; previously
        // the code passed a fresh arrow to removeEventListener which
        // silently no-op'd and left a stale observer hanging on the
        // signal until GC.
        const onAbort = () => settle(full || text)
        ctrl.signal.addEventListener('abort', onAbort, { once: true })

        api
          .enhancePrompt(
            { text, model, platform },
            (chunk) => {
              if (ctrlRef.current !== ctrl) return
              full += chunk
              // Belt-and-suspenders mirror of ⚠️C review R4 for
              // the chat-stream path. Even though the LEAD
              // `useChatStore.getState().setJobStatus('enhancing')`
              // above already clears `streamingVariantsCount` via
              // the consolidated cleanup branch, this inline null
              // guarantees the breadcrumb stays `generating`
              // (single-phase) — NOT `streaming N platforms` —
              // should a future refactor bypass the lead
              // setJobStatus call. Locked by
              // `useAiChat.generateVariants.test.tsx::useAiChat.
              // enhance — belt-and-suspenders chunk-write clear
              // (R4-twin for enhance-phase)`.
              useChatStore.setState((s) => ({
                streamingDraft: s.streamingDraft + chunk,
                jobStatus: 'enhancing',
                streamingVariantsCount: undefined,
              }))
            },
            (final) => {
              if (ctrlRef.current !== ctrl) return
              settle((final ?? full).trim() || text)
            },
            (err) => {
              // Drop stale errors if a new stream acquired mid-flight
              // — otherwise we'd flip jobStatus to 'error' over the
              // active stream's status, surfacing a phantom failure.
              if (ctrlRef.current !== ctrl) return
              useChatStore.setState({ streamingDraft: '', jobStatus: 'error', error: err })
              if (!settled) {
                settled = true
                ctrl.signal.removeEventListener('abort', onAbort)
                reject(new Error(err))
              }
            },
          )
          .catch((err: unknown) => {
            // Network-layer abort (fetch throws AbortError BEFORE
            // readSSEStream swallows it). Treat as silent.
            if (err instanceof DOMException && err.name === 'AbortError') {
              settle(full || text)
              return
            }
            if (!settled) {
              settled = true
              ctrl.signal.removeEventListener('abort', onAbort)
              reject(err)
            }
          })
      })
    },
    [model, platform],
  )

  // ── Public API ────────────────────────────────────────────────────

  /** Fresh user turn. Prepends a new user message (child of current head), then streams assistant. */
   
  const send = useCallback(
    async (text: string, images: string[] = []) => {
      const ctrl = acquire()
      const store = useChatStore.getState()
      let sid = store.activeSessionId
      if (!sid || !store.sessions[sid]) {
        sid = store.newSession(mode, platform)
      }

      // Pre-append the user message. The store action moves headId
      // to the new message, so `sendInternal`'s committed assistant
      // will be a child of THIS turn.
      const sessionNow = useChatStore.getState().sessions[sid]!
      const history = sessionNow.messages.map((m) => ({ role: m.role, content: m.content }))
      const payload = buildChatPayload({
        ref: formRef,
        history,
        text,
        recentTurns: 12,
      })
      store.appendUserMessage(sid!, {
        content: text,
        attachments: images.map((url) => ({
          type: url.startsWith('data:video') ? 'video/jpeg' : 'image/jpeg',
          dataUrl: url,
        })),
        formContextAtSend: payload.formSnapshot ?? undefined,
      })
      // Read the freshly-appended user's id back from the store.
      // It lives at the end of `messages[]`.
      const sidSession = useChatStore.getState().sessions[sid]!
      const newUserMsgId = sidSession.messages[sidSession.messages.length - 1]!.id
      await sendInternal(ctrl, newUserMsgId, text, images)
    },
    [acquire, sendInternal, formRef, mode, platform],
  )

  /** Independent enhance. Acquires (replaces) the shared controller. */
  const enhance = useCallback(
    async (text: string): Promise<string> => {
      const ctrl = acquire()
      return enhanceInternal(ctrl, text)
    },
    [acquire, enhanceInternal],
  )

  /**
   * `/fullflow`: enhance → chat-stream under ONE shared controller.
   * If the user cancels during phase 1, the controller is aborted;
   * the explicit `ctrl.signal.aborted` gate then prevents phase 2
   * from being scheduled at all.
   */
  const runFullflow = useCallback(
    async (text: string, _images: string[] = []) => {
      const ctrl = acquire()
      try {
        const enhanced = text.trim() ? await enhanceInternal(ctrl, text) : text
        if (ctrl.signal.aborted) return
        await send(enhanced)
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        throw err
      }
    },
    [acquire, enhanceInternal, send],
  )

  /**
   * Fork: rewind head to `parentUserMessageId` (a user message that
   * already exists), then stream a NEW assistant message whose
   * `parentId` is that user message. The new assistant becomes a
   * SIBLING of any prior assistant already attached to that user
   * message — preserves the original branch in `session.messages[]`.
   */
  const regenerateFrom = useCallback(
    async (parentUserMessageId: string) => {
      const ctrl = acquire()
      const store = useChatStore.getState()
      const sid = store.activeSessionId
      if (!sid) return
      const session = store.sessions[sid]
      if (!session) return
      const userMsg = session.messages.find((m) => m.id === parentUserMessageId)
      if (!userMsg || userMsg.role !== 'user') return

      // Rewind head to the user message so the next commit
      // (via sendInternal's `commitAssistantMessage(sid, parentUserMessageId)`)
      // attaches the new assistant as its child, not a continuation
      // of whatever message was previously the head.
      store.switchHead(sid, parentUserMessageId)

      await sendInternal(ctrl, parentUserMessageId, userMsg.content, [])
    },
    [acquire, sendInternal],
  )

  /**
   * `/variants` — per-platform SSE consumer. Pre-pends a synthetic
   * user bubble (parent for the platform graph fork), then for each
   * `variant_result` event from the backend commits one assistant
   * bubble as a SIBLING under that user turn. Does NOT touch the
   * single-scalar `streamingDraft` (multiple platforms would
   * clobber it concurrently) — instead bypasses via
   * `useChatStore.appendDirectAssistantMessage`.
   *
   * Jobstatus: flips to `'generating'` so the existing Cancel
   * button stays accurate and the UI knows "in-flight" status.
   * The streaming-draft indicator in the panel stays empty during
   * a variants run (no per-platform draft, by design — each
   * platform lands as a discrete committed bubble).
   */
  const generateVariants = useCallback(
    async (topic: string, platforms: string[], search = false): Promise<void> => {
      if (!platforms || platforms.length === 0) {
        throw new Error('generateVariants: platforms list is empty')
      }
      if (!topic.trim()) {
        throw new Error('generateVariants: topic is empty')
      }
      const ctrl = acquire()
      const store = useChatStore.getState()
      let sid = store.activeSessionId
      if (!sid || !store.sessions[sid]) {
        sid = store.newSession(mode, platform)
      }
      const sidStr = sid!

      // Pre-append a real USER bubble (not system breadcrumb —
      // we want platform bubbles to be SIBLING assistants of this
      // turn). Content embeds topic for display + downstream
      // auditing. appendUserMessage moves headId → this user msg
      // (the head stays there; appendDirectAssistantMessage
      // DELIBERATELY does not move it).
      store.appendUserMessage(sidStr, {
        content: `🎨 多平台变体生成 — 主题：「${topic}」`,
      })
      const sessionNow = useChatStore.getState().sessions[sidStr]!
      const userMsgId = sessionNow.messages[sessionNow.messages.length - 1]!.id

      useChatStore.setState({
        jobStatus: 'generating',
        streamingDraft: '',
        streamingVariantsCount: platforms.length,
        error: null,
      })

      // Format one platform's payload so `parseAssistantResult`
      // (the existing /fullflow helper) picks up the fields from
      // a user-style 标题/描述/标签 scheme. Mono tags joined with
      // the standard `, ` separator so `parseTags` collapses them.
      // INVARIANT — this string format is CO-DEPENDENT with the
      // regex in `AiAssistantPanel.parseAssistantResult` (the only
      // consumer that parses per-platform bubble content). If you
      // change the prefix characters here (e.g. `Title:` instead of
      // `标题：`), the parser must change in lockstep — otherwise
      // the bubble renders raw text with no title/desc/tags chips
      // surfaced, silently. Reuse the same regex from
      // `parseAssistantResult` rather than inventing new prefixes
      // when extending the contract.
      const formatBubble = (v: {
        platform: string
        title: string
        description: string
        tags: string[]
      }): string =>
        `标题：${v.title}\n描述：${v.description}\n标签：${v.tags.join(', ')}`

      try {
        await api.generatePlatformVariantsStream(
          { topic, platforms, model, search },
          (v) => {
            // Drop stale events if we've been aborted / replaced.
            if (ctrlRef.current !== ctrl) return
            const d = useChatStore.getState()
            const sidInner = d.activeSessionId ?? sidStr
            d.appendDirectAssistantMessage(
              sidInner,
              userMsgId,
              formatBubble(v),
              { platform: v.platform },
            )
          },
          (e) => {
            if (ctrlRef.current !== ctrl) return
            const d = useChatStore.getState()
            const sidInner = d.activeSessionId ?? sidStr
            d.appendDirectAssistantMessage(
              sidInner,
              userMsgId,
              // Surface the raw error label in the bubble so the
              // chip card's [解析失败] badge has narrative context.
              e.error || `生成失败：${e.platform}`,
              { platform: e.platform, parseError: true },
            )
          },
          () => {
            if (ctrlRef.current !== ctrl) return
            // Done → clear both the variants counter AND the draft.
            // setJobStatus('idle') already nulls the count via the
            // consolidated cleanup in the store; explicit
            // streamingDraft clear is defensive in case a different
            // status branch leaked it.
            useChatStore.setState({
              jobStatus: 'idle',
              streamingDraft: '',
              streamingVariantsCount: undefined,
              error: null,
            })
          },
          (err) => {
            if (ctrlRef.current !== ctrl) return
            useChatStore.getState().setJobStatus('error', err)
          },
          ctrl.signal,
        )
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          // Abort path: explicitly clear the variants counter so the
          // breadcrumb flips back to 'mainline' even though the
          // caller already aborted. GATED on `ctrlRef.current === ctrl`
          // — if a fresh acquire() replaced THIS ctrl with a sibling
          // (e.g. user fired a second `/variants` mid-stream), the
          // fresh ctrl already owns its own count and we must NOT
          // clobber it (see ⚠️C review R2). The fresh ctrl's own
          // lifecycle is responsible for clearing its own state; the
          // aborted ctrl stays silent.
          if (ctrlRef.current === ctrl) {
            useChatStore.setState({ streamingVariantsCount: undefined })
          }
          return
        }
        const msg = e instanceof Error ? e.message : '多平台变体请求失败'
        useChatStore.getState().setJobStatus('error', msg)
      } finally {
        if (ctrlRef.current === ctrl) {
          ctrlRef.current = null
        }
      }
    },
    [acquire, mode, platform, model],
  )

  /** Imperative cancel. Aborts the current controller + drains the draft. */
  const cancel = useCallback(() => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    useChatStore.getState().cancelStream()
  }, [])

  // Cleanup on unmount. Aborts the in-flight stream silently so a
  // navigation away mid-generation doesn't carry a dangling fetch.
  // (React 19 strict mode double-mounts in dev. Aborting twice is a
  // no-op so this is safe.)
  useEffect(
    () => () => {
      ctrlRef.current?.abort()
      ctrlRef.current = null
    },
    [],
  )

  return useMemo(
    () => ({ send, enhance, runFullflow, regenerateFrom, generateVariants, cancel, isRunning }),
    [send, enhance, runFullflow, regenerateFrom, generateVariants, cancel, isRunning],
  )
}
