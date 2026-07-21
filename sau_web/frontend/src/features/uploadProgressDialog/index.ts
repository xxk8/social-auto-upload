// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/index.ts
//
// Public barrel — single import path for the entire uploadProgressDialog
// slice.
//
// Round-OPT-prefs-dialog v6 (slice replication): pure scaffold —
// establishes the canonical "async upload-progress" slice pattern that
// the publish-page flow + the AI sidebar's batch-import flow can
// migrate through, without re-implementing the progress UI each time.
// No existing inline progress UI was migrated this turn (the existing
// bits in Pages/TasksPage + AiSidebar are minimal-spanshotted UI that's
// still tied to local useState); the slice is ready to receive them
// when a future migration turn lands.
//
// ── Future consumer pattern: ───────────────────────────────────────────
//
//     import {
//       UploadProgressDialog,
//       UploadProgressDialogProvider,
//       useUploadProgressDialog,
//     } from '@/features/uploadProgressDialog'
//
// ── What's NOT re-exported (and why): ───────────────────────────────────
//
// • `*.tsx` sub-paths (UploadProgressDialogProvider, tabs/*, shared/*) —
//   internal-only; consumers import the named exports via this barrel.
// ──────────────────────────────────────────────────────────────────────────

export {
  UploadProgressDialogProvider,
  useUploadProgressDialog,
} from './UploadProgressDialogProvider'

export { UploadProgressDialog } from './UploadProgressDialog'

export { PublishProgressTab } from './tabs/PublishProgressTab'
export { BatchImportProgressTab } from './tabs/BatchImportProgressTab'

export { ProgressBar } from './shared/ProgressBar'

export type {
  UploadStage,
  UploadProgress,
  UploadProgressDialogState,
} from './UploadProgressDialogProvider.helpers'
