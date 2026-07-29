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
// reload. Per-entry stripping drops `transcript` (could be 100 KB+ and
// would blow the ~5 MB localStorage cap) but keeps `error`. UI-local
// state (selection, filter, collapse, search, batch busy, in-flight set)
// is NOT persisted. In-progress rows (`downloading` / `transcribing`)
// stay as-is after rehydrate — `resumeInterruptedDownloads()` in
// `inboxResume.ts` re-issues the fetch so background work continues
// across reloads. Disk-side history is merged from `GET /api/inbox/list`
// on InboxPage mount (files under videos/inbox/ that LS never saw).

export type InboxStatus =
  | 'downloading'
  | 'downloaded'
  | 'failed'
  | 'transcribing'
  | 'transcribed'
  | 'subtitling'

export type SubtitleMode = 'bilingual' | 'zh' | 'en' | 'source'

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
  /** Last successful subtitle job result (soft SRT + optional burned video). */
  subtitleMode?: SubtitleMode
  subtitleSrtFilename?: string
  subtitleSrtUrl?: string
  subtitleBurnedFilename?: string
  subtitleBurnedUrl?: string
  /** Live subtitle job progress (0–100). Not persisted. */
  subtitleProgress?: number
  subtitlePhase?: string
  subtitleLabel?: string
  /** Editable SRT body after generation. */
  subtitleSrtText?: string
  /** File size bytes if known from disk list. */
  sizeBytes?: number
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
  /**
   * Merge files already on disk (`GET /api/inbox/list`) into the UI list.
   * Skips filenames already present so in-flight / LS rows win.
   */
  mergeDiskFiles: (
    files: ReadonlyArray<{ filename: string; size?: number; mtime?: string }>,
  ) => void

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

      mergeDiskFiles: (files) =>
        set((s) => {
          if (!files.length) return s
          const known = new Set(
            s.entries
              .map((e) => e.filename)
              .filter((name): name is string => Boolean(name)),
          )
          const additions: InboxEntry[] = []
          for (const f of files) {
            const name = (f.filename || '').trim()
            if (!name || known.has(name)) continue
            known.add(name)
            const mtimeMs = f.mtime ? Date.parse(f.mtime) : NaN
            additions.push({
              id: `disk_${name}`,
              // Disk rows have no original share URL — UI falls back to filename.
              url: '',
              filename: name,
              status: 'downloaded',
              startedAt: Number.isFinite(mtimeMs) ? mtimeMs : undefined,
              sizeBytes: typeof f.size === 'number' ? f.size : undefined,
            })
          }
          if (additions.length === 0) return s
          // Newest disk files first among additions; keep existing (in-session) rows on top.
          additions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
          return { entries: [...s.entries, ...additions] }
        }),

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
      version: 3,
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
      migrate: (persistedState: unknown, version: number) => {
        // Version 3 (current): already correct format, pass through
        // — `merge()` below handles final shaping.
        // Version 2, 1, undefined (legacy unversioned): drop any
        // stale shape and let `merge()` extract entries from whatever
        // shape was stored.
        if (version >= 3) return persistedState
        // Fallback: return a minimal object with just entries so the
        // rest of the state falls to in-memory defaults.
        if (persistedState && typeof persistedState === 'object') {
          const p = persistedState as Record<string, unknown>
          if (Array.isArray(p.entries)) {
            return { entries: p.entries }
          }
        }
        return { entries: [] }
      },
      // Pure data-massage callback that fires DURING hydrate (before
      // `create()` returns). Do NOT reference `useInboxStore` here —
      // that would sit in TDZ and throw on real-browser reloads.
      //
      // Transforms:
      //   1. `entries` — restore as-is. In-progress rows keep
      //      `downloading` / `transcribing` so `resumeInterruptedDownloads`
      //      can re-issue the HTTP work after a full page reload.
      //   2. `inflightEntryIds` — empty Set (no live fetches yet;
      //      resume marks them again).
      //   3. UI-local state stays at in-memory defaults (only `entries`
      //      comes from LS — mirrors partialize on the write path).
      merge: (
        persistedState: unknown,
        currentState: InboxStore,
      ): InboxStore => {
        const persistedEntries =
          (persistedState as Partial<InboxStore> | null | undefined)
            ?.entries ?? []
        return {
          ...currentState,
          entries: persistedEntries.map((e): InboxEntry => {
            // Subtitle jobs are not auto-resumed (long ffmpeg). Drop back to
            // a stable row so the user can click「添加字幕」again.
            if (e.status === 'subtitling') {
              return { ...e, status: 'downloaded', error: undefined }
            }
            return { ...e }
          }),
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
