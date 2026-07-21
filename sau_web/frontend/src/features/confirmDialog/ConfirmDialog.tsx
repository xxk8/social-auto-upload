// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/ConfirmDialog.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): composite component
// that reads from `<ConfirmDialogProvider />` and renders the ACTIVE
// tab body by `kind` discriminator. Mount it once at the AppShell
// boundary (next to `<ConfirmDialogProvider>`, just like
// `<PreferencesDialog />` sits next to its Provider).
//
// ── Provider mode (cross-surface triggers): ────────────────────────────
//
//   <ConfirmDialogProvider onConfirmExternal={...}>
//     <App />
//   </ConfirmDialogProvider>
//
//   // somewhere else (sidebar / popover / keyboard shortcut):
//   const { request } = useConfirmDialog()
//   onClick={() => request({ kind: 'deleteApiKey', target: { type: 'all' } })}
//
//   // The <ConfirmDialog /> composite renders the active tab body.
// ── Controlled-component mode (inline-trigger sites like AiSidebar): ────
//
//   // AiSidebar.tsx — owns deleteTarget state locally:
//   {deleteTarget && (
//     <DeleteApiKeyConfirm
//       target={deleteTarget}
//       onOpenChange={(open) => !open && setDeleteTarget(null)}
//       onConfirm={confirmDelete}
//     />
//   )}
//
// Both modes coexist. Mounting THIS composite `<ConfirmDialog />` is
// optional — it's only needed if you want the Provider's
// imperative-trigger flow to render its body somewhere.
// ──────────────────────────────────────────────────────────────────────────

import { ConfirmShell } from './shared/ConfirmShell'
import { CONFIRM_COPY, type ConfirmCopyEntry } from './shared/confirmCopy'
import { useConfirmDialog } from './ConfirmDialogProvider'
import type { ConfirmRequest } from './ConfirmDialogProvider.helpers'

/**
 * Maps each `<ConfirmRequest.kind>` to the corresponding `${confirmLabel}
 * + description` rendering. Adding a new kind requires extending this
 * map AND the `<ConfirmKind>` union in helpers.
 */
// Round-OPT-prefs-dialog v6 polish (reviewer bullet 3): deleted
// the local `describeRequest()` switch in favor of a single
// read off `CONFIRM_COPY` (defined in shared/confirmCopy.ts).
// Future copy changes land ONCE instead of across the 3 call
// sites. The wrapper is kept as a one-liner so the consumer
// side doesn't need to know about the discriminated shape —
// the function returns the same `{ title, description,
// confirmLabel }` shape as before.
function describeRequest(req: ConfirmRequest): ConfirmCopyEntry {
  if (req.kind === 'deleteApiKey') {
    return CONFIRM_COPY.deleteApiKey[req.target.type]
  }
  return CONFIRM_COPY.deleteHistoryEntry
}

export function ConfirmDialog() {
  const { open, currentRequest, confirm, cancel } = useConfirmDialog()
  if (!currentRequest) return null
  const { title, description, confirmLabel } = describeRequest(currentRequest)
  return (
    <ConfirmShell
      open={open}
      onOpenChange={(next) => {
        if (!next) cancel()
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      onConfirm={confirm}
      variant="destructive"
    />
  )
}
