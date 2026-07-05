// Round-OPT-prefs-dialog v7 (dumb migration): `BatchDeleteDialog` is
// retired — the slice-aware version is now `BatchDeleteGroupConfirm`
// in `@/features/confirmDialog/tabs/`. The dialog body lives in the
// confirmDialog slice; the Page-level state (selectedIds + groups +
// batchDeleteOpen + setBatchDeleteOpen + handleBatchDelete) stays
// in AccountsProvider/DialogHost. The mount in DialogHost now wires
// the slice-owned tab directly.
//
// export { BatchDeleteDialog } from './BatchDeleteDialog'  ← removed
export { CreateGroupDialog } from './CreateGroupDialog'
export { AuthorizeDialog } from './AuthorizeDialog'
export { GroupRenameDialog } from './GroupRenameDialog'
export { DialogHost } from './DialogHost'
