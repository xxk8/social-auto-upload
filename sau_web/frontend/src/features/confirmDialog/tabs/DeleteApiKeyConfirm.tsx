// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/tabs/DeleteApiKeyConfirm.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): MIGRATED from the
// inline `<AlertDialog>` that previously lived at the bottom of
// `Components/AiSidebar/AiSidebar.tsx`. The trigger side
// (`setDeleteTarget` + `confirmDelete` callback) stays in AiSidebar
// because that's where the trigger buttons live; the dialog body
// moved here so future destructive-confirm style fixes land ONCE.
//
// Controlled-component mode (no Provider needed):
//   • `target` — the active delete request (null when modal is closed)
//   • `onOpenChange` — wire to `{ (open) => !open && setDeleteTarget(null) }`
//   • `onConfirm` — wire to the existing `confirmDelete` callback that
//     dispatches on `target.type` ('all' / 'single' / 'history')
//
// When the slice eventually needs cross-surface triggers (e.g. a
// "delete all API keys" command from the CommandPalette), mount
// `<ConfirmDialogProvider>` at AppShell level + the global
// `<ConfirmDialog />` composite renders from the active `request`
// payload (provider mode). The current inline-trigger sites stay
// on the controlled-component API — both paths coexist.
// ──────────────────────────────────────────────────────────────────────────

import { ConfirmShell } from '../shared/ConfirmShell'
import { CONFIRM_COPY } from '../shared/confirmCopy'

export type DeleteApiKeyTarget =
  | { type: 'all' }
  | { type: 'single'; id: number }
  | { type: 'history'; id: string }

interface DeleteApiKeyConfirmProps {
  target: DeleteApiKeyTarget | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function DeleteApiKeyConfirm({
  target,
  onOpenChange,
  onConfirm,
}: DeleteApiKeyConfirmProps) {
  const open = target !== null
  // Round-OPT-prefs-dialog v6 polish (reviewer bullet 3):
  // read title + description + confirmLabel from the shared
  // CONFIRM_COPY map instead of inlining the per-target strings
  // three times. When target is null the modal is closed
  // (ConfirmShell renders nothing) so the read is harmless.
  const { title, description, confirmLabel } =
    target === null
      ? { title: '', description: '', confirmLabel: '确认' }
      : CONFIRM_COPY.deleteApiKey[target.type]

  return (
    <ConfirmShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      onConfirm={() => void onConfirm()}
      variant="destructive"
    />
  )
}
