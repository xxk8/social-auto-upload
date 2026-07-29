import { createContext, useContext } from 'react'

/**
 * Scroll parent for accounts group virtualization.
 * Provided by AccountsPage (the pane that actually scrolls); consumed by
 * GroupGridArea / GroupListArea so @tanstack/react-virtual can attach
 * without owning its own overflow container.
 */
export const AccountsScrollContext = createContext<HTMLElement | null>(null)

export function useAccountsScrollParent(): HTMLElement | null {
  return useContext(AccountsScrollContext)
}

/** Virtualize once the list is large enough that DOM cost dominates. */
export const ACCOUNTS_VIRTUALIZE_THRESHOLD = 20
