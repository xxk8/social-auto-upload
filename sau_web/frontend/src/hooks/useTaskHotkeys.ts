import { useEffect, type RefObject } from 'react'

/**
 * useTaskHotkeys — global keyboard shortcuts for TasksPage.
 *
 *   R   — refresh
 *   N   — open the add-task modal
 *   /   — focus the search input
 *
 * Each shortcut is suppressed when:
 *   - The active element is a text-input, textarea, select, or
 *     contenteditable (so typing `r` inside a row edit doesn't
 *     trigger a refresh)
 *   - A meta / ctrl / alt modifier is held (so OS shortcuts and
 *     dev-tools shortcuts aren't captured)
 *   - A Radix dialog is mounted (so the user can `r` inside a
 *     dialog filter without false-firing the page shortcut)
 *   - The drawer or add modal is already open (so opening a modal
 *     doesn't immediately steal focus from inside the form)
 *
 * Hook deps follow the original TasksPage pattern exactly:
 * `[refresh, drawerTaskId, addModalOpen, handleOpenAddModal]` —
 * re-binds the listener on toggle so a fresh `refresh` closure
 * bound through `useTaskMutations` is picked up.
 */
export function useTaskHotkeys(opts: {
  refresh: () => Promise<void> | void
  drawerTaskId: string | null
  addModalOpen: boolean
  handleOpenAddModal: () => void
  searchInputRef: RefObject<HTMLInputElement | null>
}): void {
  const { refresh, drawerTaskId, addModalOpen, handleOpenAddModal, searchInputRef } = opts

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('[data-radix-dialog-content]')) return
      if (drawerTaskId || addModalOpen) return
      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault()
          void refresh()
          break
        case 'n':
          e.preventDefault()
          handleOpenAddModal()
          break
        case '/':
          e.preventDefault()
          searchInputRef.current?.focus()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [refresh, drawerTaskId, addModalOpen, handleOpenAddModal, searchInputRef])
}
