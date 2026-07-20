// TODO(migration-stub): minimal placeholder for the pre-existing
// `src/stores/inboxStore.ts` module that was missing on origin/main.
// Use LOOSE TYPING (any returns) + a no-op Zustand-like shape to
// avoid runtime crashes when `inboxResume.ts` calls `getInboxStore()`.
// Replace with the real Zustand store implementation in a follow-up PR.

export interface InboxStoreState {
  items: any[]
  loading: boolean
  error: any
  filters: any
  selectedIds: string[]
}

const noopStore: any = {
  getState: (): InboxStoreState => ({
    items: [],
    loading: false,
    error: null,
    filters: {},
    selectedIds: [],
  }),
  setState: (_partial: any): void => {},
  subscribe: (_listener: any): (() => void) => () => {},
  getInitialState: (): InboxStoreState => ({
    items: [],
    loading: false,
    error: null,
    filters: {},
    selectedIds: [],
  }),
}

export function getInboxStore(): any {
  return noopStore
}

export function useInboxStore<T = InboxStoreState>(_selector?: any): T {
  const state = noopStore.getState()
  return (_selector ? _selector(state) : state) as T
}

export default noopStore