import { useEffect, useRef, useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SortableGroup } from './SortableGroup'
import { useAccountsDispatch, useAccountsState } from './AccountsProvider'
import {
  ACCOUNTS_VIRTUALIZE_THRESHOLD,
  useAccountsScrollParent,
} from './AccountsScrollContext'
import { useScrollMargin } from './useScrollMargin'

/** Estimated card height (px) — refined by measureElement. */
const GRID_CARD_ESTIMATE = 300
const GRID_GAP = 14

function useGridColumns(scrollParent: HTMLElement | null): number {
  const [cols, setCols] = useState(1)

  useEffect(() => {
    if (!scrollParent) {
      setCols(1)
      return
    }
    const compute = () => {
      // Match non-virtual grid: md ≥768 → 2, xl ≥1280 → 3.
      const w = scrollParent.clientWidth
      setCols(w >= 1280 ? 3 : w >= 768 ? 2 : 1)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(scrollParent)
    return () => ro.disconnect()
  }, [scrollParent])

  return cols
}

/**
 * Grid view of account groups.
 *
 * Large lists (≥ ACCOUNTS_VIRTUALIZE_THRESHOLD) use tanstack-virtual `lanes`
 * so only on-screen cards mount. DnD still works among currently rendered
 * cards. Smaller lists keep the plain CSS grid for simpler DnD coverage.
 */
export function GroupGridArea() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()
  const scrollParent = useAccountsScrollParent()
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollMargin = useScrollMargin(scrollParent, gridRef)
  const groups = state.filteredGroups
  const cols = useGridColumns(scrollParent)
  const virtualize =
    groups.length >= ACCOUNTS_VIRTUALIZE_THRESHOLD && scrollParent != null

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollParent,
    estimateSize: () => GRID_CARD_ESTIMATE,
    overscan: 6,
    lanes: cols,
    enabled: virtualize,
    scrollMargin,
    measureElement:
      typeof window !== 'undefined'
        ? (el) => el.getBoundingClientRect().height
        : undefined,
  })

  useEffect(() => {
    if (!virtualize) return
    virtualizer.measure()
  }, [virtualize, cols, groups.length, scrollMargin, virtualizer])

  return (
    <DragDropProvider
      onDragStart={dispatch.handleDragStart}
      onDragEnd={dispatch.handleDragEnd}
    >
      {virtualize ? (
        <div
          ref={gridRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const group = groups[vItem.index]
            if (!group) return null
            const colW = `calc((100% - ${(cols - 1) * GRID_GAP}px) / ${cols})`
            return (
              <div
                key={group.id}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 box-border"
                style={{
                  width: colW,
                  left: `calc(${vItem.lane} * (${colW} + ${GRID_GAP}px))`,
                  transform: `translateY(${vItem.start - scrollMargin}px)`,
                  paddingBottom: GRID_GAP,
                }}
              >
                <SortableGroup group={group} index={vItem.index} />
              </div>
            )
          })}
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-3.5 xl:grid-cols-3 xl:gap-4"
        >
          {groups.map((group, index) => (
            <SortableGroup key={group.id} group={group} index={index} />
          ))}
        </div>
      )}
    </DragDropProvider>
  )
}
