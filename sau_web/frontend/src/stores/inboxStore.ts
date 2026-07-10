import { create } from 'zustand'

// ── Inbox download store ────────────────────────────────────────────────
//
// Module-level Zustand store that survives InboxPage unmount/remount
// across route changes. The previous design kept all download state in
// `useState` inside the InboxPage component — when React Router
// unmounted InboxPage (user navigated to /dashboard/tasks), the in-flight
// `api.inboxDownload()` promises' `.then()` / `.catch()` / `.finally()`
// callbacks called `setEntries(...)` / `clearInflight(...)` on dead
// state setters (no-ops), so:
//   1. The download result was silently lost.
//   2. The inflight count chip was stuck at a stale count.
//
// Moving entries + inflightEntryIds (+ batchBusy + UI selection state)
// into this store means the async callbacks call store actions
// (`getState().setEntries(...)` etc.) which work regardless of whether
// InboxPage is mounted. When the user navigates back to /dashboard/inbox,
// the component re-mounts, reads the store, and the in-flight entries
// are still there — the download continues uninterrupted and the
// result lands when the promise resolves.
//
// NOT persisted to localStorage — download entries are ephemeral (the
// backend cleans up files after 24h) and persisting them would create
// stale references to deleted files after a page reload.

export type InboxStatus =
  | 'downloading'
  | 'downloaded'
  | 'failed'
  | 'transcribing'
  | 'transcribed'

export interface InboxEntry {
  id: string
  url: string
  filename?: string
  dir?: string
  engine?: 'yt-dlp' | 'patchright' | 'bbdown'
  status: InboxStatus
  error?: string
  transcript?: string
  startedAt?: number
}

export type StatusFilter = InboxStatus | 'all'

interface InboxStore {
  // ── Data state ──
  entries: InboxEntry[]
  inflightEntryIds: Set<string>
  batchBusy: boolean

  // ── UI state (also survives navigation) ──
  selectedIds: Set<string>
  filterStatus: StatusFilter
  collapsedGroups: Set<InboxStatus>
  searchQuery: string

  // ── Entry mutations ──
  addEntry: (entry: InboxEntry) => void
  updateEntry: (id: string, patch: Partial<InboxEntry>) => void
  appendTranscript: (id: string, chunk: string) => void
  removeEntry: (id: string) => void
  clearAll: () => void
  /** Replace all entries (used by batch remove / drag reorder) */
  setEntries: (entries: InboxEntry[]) => void

  // ── Inflight tracking ──
  markInflight: (id: string) => void
  clearInflight: (id: string) => void

  // ── Batch ──
  setBatchBusy: (busy: boolean) => void

  // ── Selection ──
  toggleSelect: (id: string) => void
  selectAll: () => void
  clearSelection: () => void

  // ── Filtering / grouping ──
  setFilterStatus: (status: StatusFilter) => void
  toggleCollapse: (status: InboxStatus) => void
  setCollapsedGroups: (groups: Set<InboxStatus>) => void
  setSearchQuery: (query: string) => void

  // ── Full reset (test-only) ──
  reset: () => void
}

const newSet = <T>(prev: Set<T>): Set<T> => new Set(prev)

export const useInboxStore = create<InboxStore>((set) => ({
  entries: [],
  inflightEntryIds: new Set<string>(),
  batchBusy: false,
  selectedIds: new Set<string>(),
  filterStatus: 'all' as StatusFilter,
  collapsedGroups: new Set<InboxStatus>(),
  searchQuery: '',

  // ── Entry mutations ──
  addEntry: (entry) =>
    set((s) => ({ entries: [entry, ...s.entries] })),

  updateEntry: (id, patch) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  appendTranscript: (id, chunk) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id ? { ...e, transcript: (e.transcript ?? '') + chunk } : e,
      ),
    })),

  removeEntry: (id) =>
    set((s) => ({
      entries: s.entries.filter((e) => e.id !== id),
      selectedIds: (() => {
        const next = newSet(s.selectedIds)
        next.delete(id)
        return next
      })(),
      inflightEntryIds: (() => {
        if (!s.inflightEntryIds.has(id)) return s.inflightEntryIds
        const next = newSet(s.inflightEntryIds)
        next.delete(id)
        return next
      })(),
    })),

  clearAll: () =>
    set({
      entries: [],
      inflightEntryIds: new Set<string>(),
      selectedIds: new Set<string>(),
    }),

  setEntries: (entries) => set({ entries }),

  // ── Inflight tracking ──
  markInflight: (id) =>
    set((s) => {
      if (s.inflightEntryIds.has(id)) return s
      const next = newSet(s.inflightEntryIds)
      next.add(id)
      return { inflightEntryIds: next }
    }),

  clearInflight: (id) =>
    set((s) => {
      if (!s.inflightEntryIds.has(id)) return s
      const next = newSet(s.inflightEntryIds)
      next.delete(id)
      return { inflightEntryIds: next }
    }),

  // ── Batch ──
  setBatchBusy: (busy) => set({ batchBusy: busy }),

  // ── Selection ──
  toggleSelect: (id) =>
    set((s) => {
      const next = newSet(s.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    }),

  selectAll: () =>
    set((s) => ({ selectedIds: new Set(s.entries.map((e) => e.id)) })),

  clearSelection: () => set({ selectedIds: new Set<string>() }),

  // ── Filtering / grouping ──
  setFilterStatus: (status) => set({ filterStatus: status }),

  toggleCollapse: (status) =>
    set((s) => {
      const next = newSet(s.collapsedGroups)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return { collapsedGroups: next }
    }),

  setCollapsedGroups: (groups) => set({ collapsedGroups: groups }),

  // ── Search ──
  setSearchQuery: (query) => set({ searchQuery: query }),

  // ── Full reset ──
  reset: () =>
    set({
      entries: [],
      inflightEntryIds: new Set<string>(),
      batchBusy: false,
      selectedIds: new Set<string>(),
      filterStatus: 'all',
      collapsedGroups: new Set<InboxStatus>(),
      searchQuery: '',
    }),
}))

// Convenience getter for use outside React components (inside async
// callbacks where hooks can't be called).
export const getInboxStore = () => useInboxStore.getState()
