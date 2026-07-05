import { useCallback } from 'react'
import { LoginProgressModal } from '@/Components/LoginProgressModal'
import {
  BatchDeleteGroupConfirm,
  type GroupSummary,
} from '@/features/confirmDialog'
import { useAccountsDispatch, useAccountsState } from '../AccountsProvider'
import { AuthorizeDialog } from './AuthorizeDialog'
import { CreateGroupDialog } from './CreateGroupDialog'
import { GroupRenameDialog } from './GroupRenameDialog'

/**
 * Single mount point for every dialog used by the accounts feature. Keeps
 * AccountsPage a slim shell — it just renders <DialogHost /> once, and the
 * DialogHost renders all 5 modals (4 owned here + LoginProgressModal).
 *
 * The Login progress modal is conditionally rendered only when a group
 * has been picked (its props require a non-null groupId).
 */
export function DialogHost() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()

  const loginModalGroupName =
    state.groups.find((g) => g.id === state.selectedGroupId)?.name ?? ''
  const loginModalPlatformLabel = dispatch.getPlatformLabel(state.selectedPlatform)

  // Stable refetch handler — prevents LoginProgressModal useEffect deps
  // from churning when DialogHost re-renders.
  const handleComplete = useCallback(() => state.refetch(), [state.refetch])

  return (
    <>
      {/* Round-OPT-prefs-dialog v7: BatchDeleteDialog →
          BatchDeleteGroupConfirm (slice-owned). The
          `as ReadonlyArray<GroupSummary>` cast is the single
          boundary point — the dumb body only reads `id` +
          `name` + `authorizations.length`. */}
      <BatchDeleteGroupConfirm
        selectedIds={state.selectedIds}
        groups={state.groups as ReadonlyArray<GroupSummary>}
        open={state.batchDeleteOpen}
        onOpenChange={dispatch.setBatchDeleteOpen}
        onConfirm={() => void dispatch.handleBatchDelete()}
      />
      <CreateGroupDialog />
      <AuthorizeDialog />
      <GroupRenameDialog />
      {state.selectedGroupId !== null && (
        <LoginProgressModal
          open={state.loginModalOpen}
          onOpenChange={dispatch.setLoginModalOpen}
          groupId={state.selectedGroupId}
          platform={state.selectedPlatform}
          groupName={loginModalGroupName}
          platformLabel={loginModalPlatformLabel}
          onComplete={handleComplete}
        />
      )}
    </>
  )
}
