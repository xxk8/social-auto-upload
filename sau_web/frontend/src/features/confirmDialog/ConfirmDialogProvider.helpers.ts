// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/ConfirmDialogProvider.helpers.ts
//
// Pure-types module — NO React, NO React hooks, NO context object.
//
// Round-OPT-prefs-dialog v6 (slice replication): extracted per the
// v4 pattern as the canonical home for "destructive confirm dialog"
// flows — delete API key (AiSidebar inline migrates here), delete
// history entry, batch delete groups (currently in features/accounts/
// dialogs/, future home), etc.
//
// Mirrors the canonical split:
//   • `ConfirmDialogProvider.tsx` — Provider component + public
//     `useConfirmDialog` hook + private `ConfirmDialogContext`.
//   • `ConfirmDialogProvider.helpers.ts` (THIS FILE) — pure types.
//
// Consumer import surface (single slice-path per consumer):
//   import {
//     ConfirmDialog,
//     ConfirmDialogProvider,
//     useConfirmDialog,
//     DeleteApiKeyConfirm,
//     type ConfirmKind,
//     type ConfirmRequest,
//     type ConfirmDialogState,
//   } from '@/features/confirmDialog'
// ──────────────────────────────────────────────────────────────────────────

/** All kinds of confirm dialogs owned by this slice. Adding a new
 * destructive flow (e.g. 'deleteAccount', 'deleteGroup') requires
 * updating this union AND the corresponding `Request<K>` mapping
 * below — TypeScript will surface the gap via the in-tab dispatch
 * switch in `ConfirmDialog.tsx`. */
export type ConfirmKind =
  | 'deleteApiKey'
  | 'deleteHistoryEntry'

/**
 * Per-kind request payload. Each branch declares exactly the data
 * the corresponding `<*Confirm>` tab needs to render its body +
 * dispatch the onConfirm. Adding a new kind requires adding a
 * payload interface here AND mapping it in `ConfirmDialog.tsx`.
 */
export type ConfirmRequest =
  | { kind: 'deleteApiKey'; target: { type: 'all' | 'single' | 'history'; id?: number | string } }
  | { kind: 'deleteHistoryEntry'; entryId: string }

/** Single shape returned by `useConfirmDialog()`. Read-only —
 * dispatch is done via the dedicated `request` / `cancel` setters
 * so the state object is exhaustively safe to spread into a
 * `<Context.Provider value={value}>`. */
export interface ConfirmDialogState {
  /** Whether the modal is currently mounted & visible. */
  open: boolean
  /** Current request payload (or `null` when the modal is closed).
   * The shape discriminator is the `kind` field. Naming note:
   * the FIELD was renamed `request` → `currentRequest` so it no
   * longer collides with the imperative SETTER below (`request`).
   * Without the rename, a destructure like
   * `const { request } = useConfirmDialog()` was ambiguous — a
   * future dev couldn't tell if `request` was the field (the
   * current payload) or the setter (the imperative trigger).
   * With the rename, call-site reading becomes:
   *   const { currentRequest, request } = useConfirmDialog()
   *     // `currentRequest` = current payload (or null)
   *     // `request`        = imperative setter
   */
  currentRequest: ConfirmRequest | null
  /** Open the modal with a typed request. Caller-dominant — each
   * trigger site decides its own payload at the call site. */
  request: (req: ConfirmRequest) => void
  /** Confirms the active request — invokes the registered onConfirm
   * callback AND closes the modal. */
  confirm: () => void
  /** Cancels the active request — invokes (if any) the registered
   * onCancel callback AND closes the modal WITHOUT firing onConfirm. */
  cancel: () => void
}
