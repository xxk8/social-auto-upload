// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/UploadProgressDialogProvider.helpers.ts
//
// Pure-types module — NO React, NO React hooks, NO context object.
//
// Round-OPT-prefs-dialog v6 (slice replication): pure scaffold —
// mirroring the canonical `features/preferences/` split as the
// future home for async upload-progress flows (publishing a video
// to multiple platforms, batch-importing accounts, etc.). Existing
// inline progress UI in Pages/TasksPage.tsx + Components/AiSidebar
// stays in place until the next round migrates it through this
// slice.
//
// Mirrors the canonical split:
//   • `UploadProgressDialogProvider.tsx` — Provider component + public
//     `useUploadProgressDialog` hook + private context.
//   • `UploadProgressDialogProvider.helpers.ts` (THIS FILE) —
//     pure types.
// ──────────────────────────────────────────────────────────────────────────

export type UploadStage =
  | 'preparing'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'failed'

export interface UploadProgress {
  /** Discriminator for which tab body to render. */
  kind: 'publish' | 'batchImport'
  /** Stable identifier — the modal might be re-mounted and the
   * `request` payload is keyed off this so callers can re-issue a
   * `start(...)` with the same id without flickering the progress
   * bar backwards mid-render. */
  id: string
  /** Display label (`account name` / `import filename`). */
  label: string
  /** 0..1 normalized step ratio. The mod-2 stage ('uploading')
   * sub-divides via `bytesSent` / `bytesTotal` which the composite
   * synthesizes into the bar width. */
  ratio: number
  /** Stage string from `UploadStage` union — drives the bottom
   * status row copy + spinner / checkmark swap. */
  stage: UploadStage
  /** Optional cancellation token — when set, the modal exposes a
   * 取消 button that calls `useUploadProgressDialog().cancel(id)`. */
  cancellable?: boolean
  /** Error message when `stage === 'failed'`. */
  error?: string
}

export interface UploadProgressDialogState {
  /** Whether the modal is mounted. */
  open: boolean
  /** Active progress records. The slice supports PARALLEL progress
   * (one per platform for publish, one per batch item); the modal
   * renders the most-recent OR all via the composite's choice. */
  records: ReadonlyArray<UploadProgress>
  /** Kick off a new upload-progress record. Idempotent on `id` —
   * calling `start(progress)` with an existing id updates in place. */
  start: (progress: UploadProgress) => void
  /** Per-tick progress update — composes a new record with the same
   * id, fresh ratio / stage. */
  update: (id: string, patch: Partial<UploadProgress>) => void
  /** Mark a record as done / failed (drives `stage === 'done' |
   * 'failed'`). */
  finish: (id: string, status: 'done' | 'failed', error?: string) => void
  /** Cancel a single record. No-op if id not present. */
  cancel: (id: string) => void
  /** Close the modal — does NOT clear records so reopening shows
   * the latest progress at the user's last-seen point. Records
   * are cleared separately via `clear(id)`. */
  close: () => void
  /** Drop a record by id. Called by the consumer when an upload has
   * been dismissed / read. */
  clear: (id: string) => void
}
