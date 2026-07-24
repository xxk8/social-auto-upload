// `export type { X } from 'M'` is a re-export-only form under
// `verbatimModuleSyntax: true` and does NOT bind `X` into local
// scope. Split the import + re-export as two statements so this file
// itself can use `ToastType` and consumers of `@/lib/softError` can
// also import it (the store-side `errorTone` mirrors toast tones
// one-to-one: ToastType ⊆ AlertProps.variant).
import type { ToastType } from '@/components/ui/toast.helpers'
export type { ToastType }

/**
 * Soft-prompt resolver — classifies `success: false` API responses into an
 * appropriate UX tone + verification message.
 *
 * ## Why
 *
 * The previous convention surfaced every 4xx `success: false` as a hard
 * red error toast + red banner (`addToast(result.message || 'fallback', 'error')`).
 * This produces user-hostile UX for actions the user intended as no-ops:
 *
 *   • double-clicking "create" on an already-existing account group
 *   • re-adding an already-added License Key after a slow network
 *   • re-saving an API Key that's already saved
 *
 * The hard red banner scolds the user for an action that didn't actually
 * fail. The fix is the `info` tone (a calm "this name is taken" / "key
 * already exists" hint) for those idempotent cases.
 *
 * ## Heuristic rubric
 *
 *   • **Tier 1 — idempotent 409-add**: `status === 409 && verb === 'add' | 'update'`
 *     → `'info'`. Message-fallback (`/已经|already|已存在|已经被|duplicate/i`)
 *     catches cases where status/verb weren't supplied by the caller.
 *   • **Tier 2 — stale-cache 404-delete**: `status === 404 && verb === 'delete'`
 *     → `'info'`. Already gone, no need to scare the user.
 *   • **Tier 3 — 409 state-conflict**:
 *     `status === 409 && /cannot|can'?t|can only/i` → `'warning'`. The action
 *     was blocked by lifecycle, not by user error — amber acknowledges the
 *     block without scolding.
 *   • **Default**: `'error'` — every other case keeps the current red banner.
 *
 * ## Caller ergonomics
 *
 * Each call site picks its verb + status BEFORE invoking this helper, then
 * feeds `{message, tone}` into `addToast(...)`. Explicit invocation keeps
 * `toast.tsx` purely visual (no magic auto-promoting toasts).
 *
 * ## Status-bubbling caveat
 *
 * The API client (`sau_web/frontend/src/api/client.ts`) destructures
 * `res.data` so HTTP `status` is NOT bubbled into the `success` envelope.
 * Callers that know their endpoint returns 4xx can supply it explicitly
 * via `context.status`. New callers that don't yet know can rely on
 * the message-only heuristic (which catches the most common Tier 1
 * stems in both English and Chinese).
 */

export interface SoftPromptContext {
  /** HTTP status code if the API client bubbles it through the response envelope. */
  status?: number
  /**
   * Operation verb — disambiguates 404s (`verb: 'delete'` → `info`;
   * other verbs → `error`) and locks Tier 1 classification even when
   * the backend message uses a stem that doesn't match the regex
   * (e.g. License Key's "已被其他用户使用" — `verb: 'add'` + `status: 409`
   * resolves to `info` regardless of message content).
   */
  verb?: 'add' | 'delete' | 'update' | 'action'
}

export interface SoftPromptResult {
  /** Verification message — typically verbatim from the backend OR `fallbackMessage`. */
  message: string
  /** Tone for `addToast(msg, tone)`. */
  tone: ToastType
}

// TODO(audit-followup): 2 deferred Tier 2 sites — `templates.delete` (store consumer at `TemplateChipRow` has no addToast wiring) and `inbox.reveal` (POST not DELETE; consumer at `InboxPage::InboxRow` is fire-and-forget) — need consumer-side hook integration before helper migration.

/** Tier 1 message-fallback regex. Matches the common "already exists" stems in English + CJK. */
const RE_DUPLICATE = /已经|already|已存在|已经被|duplicate/i
/** Tier 3 message-fallback regex. Matches lifecycle-blocked state changes. */
const RE_STATE_CONFLICT = /cannot|can'?t|can only/i

/**
 * Resolve a `success: false` API response into a soft UI prompt.
 *
 * @param backendMessage - `result.message` from the API envelope (may be null/undefined/empty)
 * @param fallbackMessage - Generic message used when `backendMessage` is empty
 * @param context - Optional `status` + `verb` to tighten classification
 * @returns `{message, tone}` ready to feed into `addToast(...)`
 *
 * @example
 * ```ts
 * const result = await api.createAccountGroup(trimmed)
 * if (!result.success) {
 *   const { message, tone } = resolveSoftPrompt(
 *     result.message, '创建失败', { status: 409, verb: 'add' }
 *   )
 *   addToast(message, tone)   // → 'info' for duplicate-name 409, 'error' otherwise
 * }
 * ```
 */
/**
 * Last-resort message used when BOTH inputs are empty/whitespace.
 * Exported so test assertions can lock to the exact constant — this
 * escapes the str_replace char-substitution risk for CJK source
 * literals that bit the v1 defensive tests (literal `'操作失败'` in
 * the test file was rewritten to `'樽作失败'` by tooling on at least
 * one round, breaking the regression lock).
 */
export const DEFAULT_FALLBACK_MESSAGE = '操作失败'

export function resolveSoftPrompt(
  backendMessage: string | null | undefined,
  fallbackMessage: string,
  context: SoftPromptContext = {},
): SoftPromptResult {
  // Trim + fallback: a backend message of "" / "   " is treated as absent.
  // Defensive last-resort guarantees `message` is always non-empty
  // regardless of caller misuse — the toast component would otherwise
  // render a decoration-only chip with no body (visually broken).
  const raw = (backendMessage ?? '').trim()
  const message = ((raw || fallbackMessage).trim()) || DEFAULT_FALLBACK_MESSAGE
  const lower = message.toLowerCase()
  const status = context.status
  const verb = context.verb

  // Tier classification into a let-bound `tone` + tail guard. The
  // refactor from 4 separate return blocks to a single tail return
  // makes the runtime tone-validity check below meaningful (it
  // can't be a tautological check at each branch).
  let tone: ToastType = 'error'
  // Tier 1 (verb-driven): status=409 + verb='add'|'update' is ALWAYS the
  // idempotent-no-op soft-success semantic from the user's POV, regardless
  // of the specific message stem. Catches "已被其他用户使用" (License)
  // which the regex fallback would miss.
  if (status === 409 && (verb === 'add' || verb === 'update')) tone = 'info'
  // Tier 1 (regex fallback): 409 OR no-status supplied + message matches
  // any of the common "already exists" stems in English or Chinese.
  else if ((status === 409 || status === undefined) && RE_DUPLICATE.test(lower)) tone = 'info'
  // Tier 2: verbose-cache 404-delete (rare from the FE since `result.success`
  // envelopes often hide the status code; verb-gated for safety).
  else if (status === 404 && verb === 'delete') tone = 'info'
  // Tier 3: 409 state-conflict — the action was blocked by lifecycle,
  // not by user error. Amber acknowledges the block without scolding.
  else if (status === 409 && RE_STATE_CONFLICT.test(lower)) tone = 'warning'

  // Runtime guard: byte-for-byte lock of the ToastType union literal.
  // Currently unreachable — `tone: ToastType` constrains the assigned
  // values at compile time, so this `throw` cannot fire today. Kept as
  // a safety net in case a future maintainer accidentally widens the
  // union for an unrelated reason; the throw turns a silent runtime
  // regression into a hard failure surfaced in QA.
  const ALLOWED_TONES = ['default', 'success', 'info', 'warning', 'error'] as const
  if (!ALLOWED_TONES.includes(tone)) throw new Error(`resolveSoftPrompt returned out-of-union tone: ${tone}`)

  return { message, tone }
}
