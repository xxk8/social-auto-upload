import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

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
// Persisted to localStorage (`sau-inbox`) so rows survive a full page
// reload (which kills the in-flight fetch chain — only the row metadata
// is preserved; file recovery is out of scope for v1). Per-entry
// stripping drops `transcript` (could be 100 KB+ during an OpenAI stream
// and would blow the ~5 MB localStorage cap) but keeps `error` (handy
// diagnostic the user wants to see after reload). UI-local state
// (selection, filter, collapse, search, batch busy, in-flight set) is
// NOT persisted — fresh defaults on each rehydrate. After hydration,
// any entry whose persisted `status` was `'downloading'` or
// `'transcribing'` is auto-flipped to `'failed'` with a clear error
// message: the underlying fetch promise was killed by the reload, so
// the row stays visible but the chip honestly turns red instead of
// being stuck in an infinite-spinner "downloading" state.

export type InboxStatus =
  | 'downloading'
  | 'downloaded'
  | 'failed'
  | 'transcribing'
  | 'transcribed'

// All fields MUST be JSON-serializable primitives — Sets, Dates,
// and class instances will crash partialize + merge (zustand blindly
// JSON.stringify()s at the persist boundary, and a Set throws
// `TypeError: Converting circular structure to JSON`). If the
// persisted shape ever changes, bump `version` + add a `migrate:`
// handler in the options block.
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

export const useInboxStore = create<InboxStore>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'sau-inbox',
      version: 1,
      // Only `entries` is persisted. UI-local state (selectedIds /
      // collapsedGroups / search query / filterStatus / batchBusy /
      // inflightEntryIds) is intentionally dropped: cross-reload
      // they're not meaningful (selection is per-batch; search is
      // per-session; collapse state would feel jarring on rehydrate).
      // Stripping `transcript` per entry keeps a long in-progress
      // OpenAI transcription from blowing the ~5 MB localStorage cap
      // — pinned at the field level rather than via an "after N KB
      // stop reading" guard so the contract is explicit. `error` is
      // small enough to keep (~200-char diagnostic string).
      partialize: (state) => ({
        entries: state.entries.map((e) => {
          const { transcript: _transcript, ...rest } = e
          return rest
        }),
      }),
      // localStorage explicitly named so test envs (where `window`
      // exists but `localStorage` may be missing in some jsdom
      // configurations) error loudly rather than silently disabling
      // persist. Production Vite SPA always has localStorage.
      storage: createJSONStorage(() => localStorage),
      // Pure data-massage callback that fires DURING hydrate (before
      // `create()` returns the store AND before `useInboxStore` is
      // bound on the LHS). We deliberately DO NOT reference
      // `useInboxStore` from inside this callback — the closure-on-
      // itself would sit in TDZ and throw `ReferenceError: Cannot
      // access 'useInboxStore' before initialization` whenever the
      // in-browser page reloaded with non-trivial LS state (vitest
      // + jsdom with `isolate: true` masks this in unit tests, but
      // real browsers don't). Using the `merge:` callback keeps the
      // transform pure (no closure needed) and gets the same
      // post-rehydrate state shape that onRehydrateStorage would
      // have produced.
      //
      // Three transforms:
      //   1. `entries` — each entry whose persisted status was
      //      `'downloading'` or `'transcribing'` is flipped to
      //      `'failed'` with the pinned interrupted message; the
      //      underlying fetch promise was killed by the reload, so
      //      leaving the row stuck in an infinite-spinner state
      //      would be dishonest. Pre-existing `error` on already-
      //      failed entries is NOT touched (only the two in-progress
      //      statuses flip; stable statuses pass through).
      //   2. `inflightEntryIds` — reset to an empty Set. The LS blob
      //      carries no in-flight Set (partialize drops it), but the
      //      in-memory `currentState` may carry one if helper code
      //      set it via `setState(...)`. After a reload, ZERO
      //      fetches are running, so empty is the honest state.
      //      `handleRetry` + `markInflight` re-mark per-id
      //      immediately when the user clicks 重试.
      //   3. UI-local state (`selectedIds`, `filterStatus`,
      //      `collapsedGroups`, `searchQuery`, `batchBusy`) stays at
      //      its in-memory default because we DON'T spread
      //      `persistedState` over `currentState` — only `entries`
      //      is pulled from LS. This is the same contract partialize
      //      gives on the WRITE path; symmetry eliminates a subtle
      //      bug class where a rehydrated UI chip could leak across
      //      reloads.
      //
      // Future compatibility: bump `version` + add a `migrate:`
      // handler here if the persisted shape ever changes.
      merge: (
        persistedState: unknown,
        currentState: InboxStore,
      ): InboxStore => {
        // Reuse Partial<InboxStore> so the cast auto-tracks whenever
        // a new persisted-key is added to InboxStore (e.g. a future
        // `pinned` flag) — no second structural-type definition to
        // drift out of sync.
        const persistedEntries =
          (persistedState as Partial<InboxStore> | null | undefined)
            ?.entries ?? []
        return {
          ...currentState,
          entries: persistedEntries.map((e): InboxEntry =>
            e.status === 'downloading' || e.status === 'transcribing'
              ? {
                  ...e,
                  status: 'failed',
                  error:
                    '页面刷新时下载中断，文件可能已落盘到 videos/inbox/，请重试或手动核验',
                }
              : { ...e },
          ),
          inflightEntryIds: new Set<string>(),
        }
      },
    },
  ),
)

// Convenience getter for use outside React components (inside async
// callbacks where hooks can't be called).
export const getInboxStore = () => useInboxStore.getState()

/**
 * Test/admin helper — wipe the persisted `sau-inbox` blob from
 * localStorage. Tests call this in `beforeEach` so prior-run state
 * does not leak into the next test's first render (the in-memory
 * `reset()` action alone is not sufficient — the persist middleware
 * rehydrates from storage immediately after, undoing the reset).
 * Production code should never need this: the user-visible "全部清除"
 * button already empties in-memory entries + clears inflight, and
 * storage naturally rotates on key-version bumps via the persist
 * `version` field above.
 */
export const clearInboxStorage = (): void => {
  useInboxStore.persist.clearStorage()
}
