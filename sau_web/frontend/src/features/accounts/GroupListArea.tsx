import { DragDropProvider } from '@dnd-kit/react'
import { GroupListItem } from './GroupListItem'
import {useAccountsDispatch, useAccountsState} from './AccountsProvider';/**
 * List view of account groups with drag-and-drop reordering.
 */
export function GroupListArea() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()

  return (
    <DragDropProvider
      onDragStart={dispatch.handleDragStart}
      onDragEnd={dispatch.handleDragEnd}
    >
      <div className="space-y-2">
        {state.filteredGroups.map((group, index) => (
          <GroupListItem
            key={group.id}
            group={group}
            selected={state.selectedIds.has(group.id)}
            index={index}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
