// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/tabs/DeleteHistoryEntryConfirm.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): scaffold-only tab —
// establishes the convention that "delete history entry" is a confirm
// kind WITHOUT migrating the existing inline AlertDialog at AiSidebar
// (that one is batched into the migrated `DeleteApiKeyConfirm` per
// its `target.type === 'history'` branch).
//
// Future trigger sites that need a history-specific confirm (e.g.
// a dedicated "clear history" button at /app/logs) can render this
// tab directly via:
//
//   <DeleteHistoryEntryConfirm
//     entryId={entry.id}
//     onOpenChange={...}
//     onConfirm={...}
//   />
//
// ──────────────────────────────────────────────────────────────────────────

import { ConfirmShell } from '../shared/ConfirmShell'
import { CONFIRM_COPY } from '../shared/confirmCopy'

interface DeleteHistoryEntryConfirmProps {
  entryId: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function DeleteHistoryEntryConfirm({
  entryId,
  onOpenChange,
  onConfirm,
}: DeleteHistoryEntryConfirmProps) {
  const open = entryId !== null

  return (
    <ConfirmShell
      open={open}
      onOpenChange={onOpenChange}
      // Round-OPT-prefs-dialog v6 polish (reviewer bullet 3):
      // read title + description + confirmLabel from the shared
      // CONFIRM_COPY map instead of hardcoding. Future copy
      // changes land ONCE.
      {...CONFIRM_COPY.deleteHistoryEntry}
      onConfirm={() => void onConfirm()}
      variant="destructive"
    />
  )
}
