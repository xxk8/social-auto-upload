import type { FormSnapshot, Role } from './types'
// Re-export `FormSnapshot` so consumers (e.g. PublishPage) can import
// it through the bridge module — the canonical entry-point for the
// `FormHandle` contract. Keeps the type definition local to
// `./types` while exposing it via the bridge as a single re-export.
export type { FormSnapshot }
import { parseTags, serializeTags } from '../tags'

/**
 * Minimal contract that PublishPage's form refs expose to the chat
 * pipeline. Kept local so this file doesn't pull in React.
 *
 * Real implementations live in VideoForm.tsx / NoteForm.tsx, which
 * use `useImperativeHandle` to publish these methods.
 */
export interface FormHandle {
  /**
   * `tags` is `string[]` post-Path-C. Callers (PublishPage's
   * `useWizardFormHandle` and the bridge's `safeApplyAiResult`)
   * truncate the array to `effectiveMaxTags(activePlatforms)` BEFORE
   * invoking the form's `setContent({tags})` — the form itself
   * never silently drops tags. Legacy write sites that still pass
   * `string` work via `parseTags` inside `setContent`.
   */
  applyAiResult: (result: { title?: string; desc?: string; tags?: string[] | string }) => void
  /**
   * **NEW in ai-sidebar-material-search §3 + §4** — apply a media payload
   * sourced from the AI sidebar's MaterialSection (image search + URL
   * one-click-fetch) to the form. ALL THREE KEYS ARE OPTIONAL but each
   * form only OWNS a subset; keys the form does not own reject with
   * `{ applied: false, reason: 'no-media-slot' }` so the caller toasts
   * a precise hint instead of silently dropping:
   *
   *   ┌───────────────┬──────────────────────┬───────────────────┐
   *   │ formMode      │ accepts (writes)      │ rejects (no-slot) │
   *   ├───────────────┼──────────────────────┼───────────────────┤
   *   │ VideoForm     │ { file, thumbnail }  │ { images }        │
   *   │ NoteForm      │ { images }           │ { file, thumbnail }│
   *   └───────────────┴──────────────────────┴───────────────────┘
   *
   *   - `VideoForm.applyMedia({ thumbnail })` — updates the single
   *     main cover URL string. Locked by openspec §4.1.
   *   - `VideoForm.applyMedia({ file })`  — REPLACES the main video
   *     File (URL-fetched Inbox download). Spec invariant: "not appended,
   *     since this is the main media". Locked by spec.md §"URL one-click".
   *     (spec gap fix: tasks.md §3 only listed `{thumbnail, images}`;
   *     this `{file}` key was added when §7.3 needed to apply URL-fetched
   *     videos.)
   *   - `NoteForm.applyMedia({ images })` — APPENDS File[] to the
   *     existing image list (NOT replace). Pillars respects
   *     `addImagesWithinLimit` platform-MAX. Locked by openspec §4.2.
   *
   * The method returns `ApplyAttempt` so callers branch on
   * `reason` uniformly (no-media-slot vs. unmounted vs. threw).
   */
  applyMedia?: (media: { file?: File; thumbnail?: string; images?: File[] }) => ApplyAttempt
  getFormSnapshot: () => FormSnapshot
  /** Set schedule input (`YYYY-MM-DDTHH:mm` local). Optional. */
  setSchedule?: (value: string) => void
  /** Trigger the form's primary submit. Optional. */
  submit?: () => void | Promise<void>
}

/**
 * Canonical name for the parsed AI result shape. Re-exported so callers
 * can keep the legacy `AiGenerationResult` import path while the type is
 * centrally defined here alongside the bridge contract.
 */
export type AiGenerationResult = FormSnapshot

/** Mirror of React.RefObject — local so tests don't reach into React. */
export interface MaybeRef<T> {
  current: T | null
}

/**
 * Outcome envelope returned by FormHandle.applyAiResult / applyMedia.
 * The discriminator covers the failure modes reachable from the bridge:
 *   - `'unmounted'` — form ref is null (component unmounted between
 *     call-site resolve and apply).
 *   - `'threw'`     — the form's imperative handle threw (e.g. a key
 *     write lost its setter between useImperativeHandle deps and call).
 *     Carries an OPTIONAL `message: string` so callers can toast the
 *     precise text without re-throwing — keeps the contract flat.
 *   - `'no-media-slot'` — caller asked for a media key the form does
 *      not implement (e.g. video mode + `images`, note mode +
 *      `thumbnail`). Distinguishing this from a generic failure lets
 *      the AI sidebar toast a SPECIFIC hint ("请切换到图文模式")
 *      instead of a generic "failed" message.
 *   - `'debounced'` — store-level spam-click debounce kicked in
 *     (e.g. addImageToForm early-returns when the same tile is clicked
 *     twice before the prior request completes). Silent on the
 *     caller's side — keeps spam-click UX tight without firing a
 *     rejection toast on every rapid duplicate.
 *
 * Design note: `'no-media-slot'` intentionally merges the
 * "form doesn't implement applyMedia" case with "form rejected the
 * keys the caller sent" — from the AI sidebar's perspective both
 * mean the same thing and surface one consistent "switch modes"
 * hint. Splitting would make the caller branch on the same UI text
 * for what is functionally identical UX.
 */
export type ApplyAttempt =
  | { applied: true }
  | { applied: false; reason: 'unmounted' | 'no-media-slot' | 'debounced' }
  | { applied: false; reason: 'threw'; message?: string }

/**
 * Safely read the current form snapshot. Returns `null` when the form
 * is unmounted OR throws — never propagates an exception out.
 *
 * Callers MUST handle null (typically by skipping the system-message
 * injection in `buildChatPayload` and continuing without form context).
 */
export function safeGetFormSnapshot(ref: MaybeRef<FormHandle | null>): FormSnapshot | null {
  if (!ref.current) return null
  try {
    return ref.current.getFormSnapshot()
  } catch {
    return null
  }
}

/** Best-effort apply. Returns a structured outcome so callers can toast/log. */
export function safeApplyAiResult(
  ref: MaybeRef<FormHandle | null>,
  result: { title?: string; desc?: string; tags?: string[] | string },
): ApplyAttempt {
  if (!ref.current) return { applied: false, reason: 'unmounted' }
  try {
    ref.current.applyAiResult(result)
    return { applied: true }
  } catch {
    return { applied: false, reason: 'threw' }
  }
}

/**
 * Best-effort apply for media (image search result / URL-fetched asset)
 * dropping into the form. Returns:
 *   - `{ applied: true }`             — form wrote the value(s)
 *   - `{ applied: false, reason: 'unmounted' }`       — ref is null
 *   - `{ applied: false, reason: 'no-media-slot' }`  — form rejected
 *     the keys (e.g. asked VideoForm to take images). Caller should
 *     surface a mode-switch hint.
 *   - `{ applied: false, reason: 'threw' }`           — form impl raised
 *
 * Note: when `ref.current.applyMedia` is undefined (form doesn't
 * implement the optional method), treat as `'no-media-slot'` so the
 * caller can branch on the same toggle regardless of whether the
 * form is mounted-but-unsupported or just plain unimplemented.
 */
export function safeApplyMedia(
  ref: MaybeRef<FormHandle | null>,
  media: { file?: File; thumbnail?: string; images?: File[] },
): ApplyAttempt {
  if (!ref.current) return { applied: false, reason: 'unmounted' }
  if (!ref.current.applyMedia) {
    // FormHandle is mounted but doesn't expose `applyMedia` — treat
    // the missing method as a no-media-slot signal so callers branch
    // on the same reason regardless of legacy vs. unsupported keys.
    return { applied: false, reason: 'no-media-slot' }
  }
  try {
    return ref.current.applyMedia(media)
  } catch {
    return { applied: false, reason: 'threw' }
  }
}

export interface BuildChatPayloadInput {
  ref: MaybeRef<FormHandle | null>
  history: Array<{ role: Role; content: string }>
  text: string
  /** Optional: only keep the last N history turns (to bound token usage). */
  recentTurns?: number
}

export interface BuildChatPayloadOutput {
  messages: Array<{ role: Role; content: string }>
  /** True iff a form snapshot was injected as a system message. */
  formAttached: boolean
  /** Echo of the snapshot, useful for "what context did the AI see?" UI. */
  formSnapshot: FormSnapshot | null
}

/**
 * Compose the messages array for the next LLM call.
 *
 * - Slices `history` to the last `recentTurns` (default = all).
 * - If the form is mounted AND has a snapshot, prepends a system message
 *   so the AI sees the user's latest edits ("无敌美食" rather than the
 *   stale first-pass title).
 * - If unmounted, sends the conversation without the form context — the
 *   AI still answers, just with less grounding.
 */
export function buildChatPayload(input: BuildChatPayloadInput): BuildChatPayloadOutput {
  const { ref, history, text } = input
  const recentTurns = input.recentTurns ?? history.length

  // Slice from the end. `Math.max` guards against:
  //   - `recentTurns = 0` (would otherwise return the full array because
  //     `Array.prototype.slice(-0) === slice(0)`)
  //   - overshoot (`recentTurns > history.length`)
  const slice = history.slice(Math.max(0, history.length - recentTurns))
  const snapshot = safeGetFormSnapshot(ref)
  const formAttached = snapshot !== null

  const messages: Array<{ role: Role; content: string }> = [...slice]
  if (snapshot) {
    // Snapshot.tags is string[] post-Path-C. Render as comma-joined
    // string in the system message (`serializeTags` ran through
    // `parseTags` so dedup / canonical-hash collapse is preserved).
    // Legacy `string` payloads are normalized via `parseTags` for
    // forward-compat with chat history written before the refactor.
    const tagList = serializeTags(parseTags(snapshot.tags))
    messages.push({
      role: 'system',
      content:
        `[当前表单状态] 标题: ${snapshot.title || '(空)'}; ` +
        `描述: ${(snapshot.desc || '').slice(0, 200) || '(空)'}; ` +
        `标签: ${tagList || '(空)'}`,
    })
  }
  messages.push({ role: 'user', content: text })

  return { messages, formAttached, formSnapshot: snapshot }
}
