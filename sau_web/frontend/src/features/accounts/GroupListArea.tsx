import { useEffect, useRef } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { GroupListItem } from './GroupListItem'
import { useAccountsDispatch, useAccountsState } from './AccountsProvider'
import {
  ACCOUNTS_VIRTUALIZE_THRESHOLD,
  useAccountsScrollParent,
} from './AccountsScrollContext'
import { useScrollMargin } from './useScrollMargin'

/** Estimated list-row height (px) incl. gap — refined by measureElement. */
const LIST_ROW_ESTIMATE = 88
const LIST_GAP = 8

/**
 * List view of account groups with drag-and-drop reordering.
 * Virtualizes once the filtered list exceeds ACCOUNTS_VIRTUALIZE_THRESHOLD
 * so only on-screen rows mount (scroll parent = AccountsPage body).
 */
export function GroupListArea() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()
  const scrollParent = useAccountsScrollParent()
  const listRef = useRef<HTMLDivElement>(null)
  const scrollMargin = useScrollMargin(scrollParent, listRef)
  const groups = state.filteredGroups
  const virtualize =
    groups.length >= ACCOUNTS_VIRTUALIZE_THRESHOLD && scrollParent != null

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollParent,
    estimateSize: () => LIST_ROW_ESTIMATE,
    overscan: 8,
    enabled: virtualize,
    scrollMargin,
    measureElement:
      typeof window !== 'undefined'
        ? (el) => el.getBoundingClientRect().height + LIST_GAP
        : undefined,
  })

  useEffect(() => {
    if (!virtualize) return
    virtualizer.measure()
  }, [virtualize, groups.length, scrollMargin, virtualizer])

  return (
    <DragDropProvider
      onDragStart={dispatch.handleDragStart}
      onDragEnd={dispatch.handleDragEnd}
    >
      {virtualize ? (
        <div
          ref={listRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const group = groups[vRow.index]
            if (!group) return null
            return (
              <div
                key={group.id}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{
                  // scrollMargin is subtracted so items align to the list root.
                  transform: `translateY(${vRow.start - scrollMargin}px)`,
                  paddingBottom: LIST_GAP,
                }}
              >
                <GroupListItem
                  group={group}
                  selected={state.selectedIds.has(group.id)}
                  index={vRow.index}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div ref={listRef} className="space-y-2">
          {groups.map((group, index) => (
            <GroupListItem
              key={group.id}
              group={group}
              selected={state.selectedIds.has(group.id)}
              index={index}
            />
          ))}
        </div>
      )}
    </DragDropProvider>
  )
}
