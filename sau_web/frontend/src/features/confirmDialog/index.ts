// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/index.ts
//
// Public barrel — single import path for the entire confirmDialog slice.
//
// Round-OPT-prefs-dialog v6 (slice replication): establishes the
// canonical "operator-side destructive confirm" slice pattern that
// future dashboards wire into (sidebar UserMenu, batch-toolbar
// TaskBatchActions, command palette, etc.) — without re-implementing
// the AlertDialog shell + dispatch + per-kind tab routing each time.
//
// ── Consumer pattern: ──────────────────────────────────────────────────
//
//     import {
//       ConfirmDialog,
//       ConfirmDialogProvider,
//       useConfirmDialog,
//       DeleteApiKeyConfirm,
//       DeleteHistoryEntryConfirm,
//       ConfirmShell,
//       type ConfirmKind,
//       type ConfirmRequest,
//       type ConfirmDialogState,
//     } from '@/features/confirmDialog'
//
// ── What's NOT re-exported (and why): ───────────────────────────────────
//
// • `*.tsx` sub-paths (ConfirmDialogProvider, ConfirmDialog, tabs/*,
//   shared/*) — internal-only; consumers import the named exports via
//   this barrel. Same rationale as `features/preferences/index.ts`:
//   keeping the slice hierarchy opaque prevents future PRs from
//   reaching inside the slice capsule to grab a single tab without
//   touching the convention.
// ──────────────────────────────────────────────────────────────────────────

export {
  ConfirmDialogProvider,
  useConfirmDialog,
} from './ConfirmDialogProvider'

export { ConfirmDialog } from './ConfirmDialog'

export { DeleteApiKeyConfirm } from './tabs/DeleteApiKeyConfirm'
export type { DeleteApiKeyTarget } from './tabs/DeleteApiKeyConfirm'

export { DeleteHistoryEntryConfirm } from './tabs/DeleteHistoryEntryConfirm'

// Round-OPT-prefs-dialog v7 (dumb-component migration):
// `BatchDeleteGroupConfirm` is the canonical dumb tab for batch-
// deleting selected items from a user-owned group list. MIGRATED
// from `features/accounts/dialogs/BatchDeleteDialog.tsx` so the
// dialog body lives in the slice (alongside the other two confirm
// tabs) instead of in the consumer's own dialogs/ subfolder.
// Mounted by DialogHost with `state.selectedIds` + `state.groups`
// + `state.batchDeleteOpen` + `dispatch.setBatchDeleteOpen` +
// `dispatch.handleBatchDelete` wired in — same Page-level state,
// unified dialog body.
export { BatchDeleteGroupConfirm } from './tabs/BatchDeleteGroupConfirm'
export type { GroupSummary } from './tabs/BatchDeleteGroupConfirm'

export { ConfirmShell } from './shared/ConfirmShell'

export type {
  ConfirmKind,
  ConfirmRequest,
  ConfirmDialogState,
} from './ConfirmDialogProvider.helpers'
