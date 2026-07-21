import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useInboxStore, clearInboxStorage } from './inboxStore'

/**
 * Regression suite — locks the cross-reload-survival contract for the
 * inbox download store (round-inbox-page-switch-cancel). Five
 * scenarios per the design table:
 *
 *   A. partialize sanitization
 *      - Drops `transcript` per entry (would blow ~5MB LS cap when
 *        OpenAI streams a long video).
 *      - Keeps `error` (small diagnostic string the user wants after
 *        reload).
 *      - Keeps id/url/filename/dir/engine/status/startedAt.
 *
 *   B. UI-local fields are NOT persisted
 *      - The WRITE path never carries selectedIds / filterStatus
 *        / collapsedGroups / searchQuery / batchBusy /
 *        inflightEntryIds. A rehydrate from a poisoned / legacy
 *        blob also doesn't carry state-not-in-defaults (zustand
 *        shallow merge keys-not-present stay at current
 *        in-memory default value, which is the fresh Set / 'all'
 *        / '' / false).
 *
 *   C. Cross-reload restoration
 *      - setState entries → LS has them (write path).
 *      - rehydrate from a written LS blob → entries come back into
 *        in-memory.
 *
 *   D. Stale in-progress flip
 *      - Persisted status='downloading' / 'transcribing' entries get
 *        auto-flipped to 'failed' with the pinned interrupted
 *        message; pre-existing `error` on already-failed entries is
 *        preserved; the in-flight Set is UNCONDITIONALLY cleared
 *        (see onRehydrateStorage comment for why we can't short-
 *        circuit when no stale entries exist).
 *
 *   E. clearInboxStorage() helper
 *      - Removes the LS blob. Idempotent (multiple calls no-throw).
 *      - Pass-through to useInboxStore.persist.clearStorage.
 */

const LS_KEY = 'sau-inbox'

beforeEach(() => {
  // Wipe LS BEFORE reset so the next test's first render sees an
  // empty persisted state. The in-memory `reset()` writes defaults
  // back to LS via the persist middleware, so without this wipe,
  // prior-test entries would lurk in LS and rehydrate into the
  // current test. Belt-and-suspenders hygiene, matches the
  // materialPanelStore.test.tsx pattern.
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY)
  useInboxStore.getState().reset()
})

// ── A. partialize sanitization ──────────────────────────────
describe('persist partialize shape', () => {
  it('strips transcript from each entry (long-form transcription would blow ~5MB LS cap)', () => {
    useInboxStore.setState({
      entries: [
        {
          id: 'a1',
          url: 'https://example.com/x.mp4',
          status: 'downloaded',
          filename: 'x.mp4',
          transcript:
            '一条长到能撑爆 localStorage 的转写文本（或一千行 OpenAI 流式输出中文 transcript）',
          engine: 'yt-dlp',
        },
      ],
    })
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    const persistedEntry = raw.state?.entries?.[0] ?? {}
    expect(persistedEntry).not.toHaveProperty('transcript')
    expect(persistedEntry).toMatchObject({
      id: 'a1',
      url: 'https://example.com/x.mp4',
      status: 'downloaded',
      filename: 'x.mp4',
      engine: 'yt-dlp',
    })
  })

  it('preserves error per entry (small diagnostic string the user wants post-reload)', () => {
    useInboxStore.setState({
      entries: [
        {
          id: 'a2',
          url: 'https://example.com/y.mp4',
          status: 'failed',
          error: 'fresh cookies (not necessarily logged in) are needed',
        },
      ],
    })
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    const persistedEntry = raw.state?.entries?.[0] ?? {}
    expect(persistedEntry).toHaveProperty(
      'error',
      'fresh cookies (not necessarily logged in) are needed',
    )
    expect(persistedEntry).toMatchObject({
      id: 'a2',
      status: 'failed',
    })
  })
})

// ── B. UI-local fields are NOT persisted (WRITE path) ────────
describe('UI-local fields are NOT written to LS (partialize exclusion)', () => {
  it('selectedIds is excluded from the LS blob (selection is per-batch, not cross-reload)', () => {
    useInboxStore.setState({
      entries: [
        {
          id: 'a1',
          url: 'https://example.com/x.mp4',
          status: 'downloaded',
          filename: 'x.mp4',
        },
      ],
    })
    useInboxStore.getState().toggleSelect('a1')
    expect(useInboxStore.getState().selectedIds.size).toBe(1)
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    expect(raw.state.entries).toHaveLength(1)
    expect(raw.state).not.toHaveProperty('selectedIds')
  })

  it('filterStatus is excluded from the LS blob (filter is per-session, not cross-reload)', () => {
    useInboxStore.setState({
      entries: [
        {
          id: 'a1',
          url: 'https://example.com/x.mp4',
          status: 'downloaded',
        },
      ],
      filterStatus: 'failed',
    })
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    expect(raw.state.entries).toHaveLength(1)
    expect(raw.state).not.toHaveProperty('filterStatus')
  })
})

// ── C. Cross-reload restoration (write + rehydrate) ──────────
describe('cross-reload restoration — entries round-trip through LS', () => {
  it('setState entries → LS has them (write path through partialize)', () => {
    useInboxStore.setState({
      entries: [
        {
          id: 'a1',
          url: 'https://example.com/x.mp4',
          status: 'downloaded',
          filename: 'x.mp4',
          engine: 'yt-dlp',
          startedAt: 1000,
        },
      ],
    })
    const ls = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    expect(ls.state?.entries).toHaveLength(1)
    expect(ls.state.entries[0]).toMatchObject({
      id: 'a1',
      url: 'https://example.com/x.mp4',
      status: 'downloaded',
      filename: 'x.mp4',
      engine: 'yt-dlp',
      startedAt: 1000,
    })
  })

  it('rehydrate from LS-only populated blob restores entries into in-memory (read path)', async () => {
    // Seed LS as a fresh user session would see: a prior session's
    // blob with one downloaded entry. beforeEach already cleared
    // LS + in-memory, so the in-memory state is initial.
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        state: {
          entries: [
            {
              id: 'a1',
              url: 'https://example.com/x.mp4',
              status: 'downloaded',
              filename: 'x.mp4',
              engine: 'yt-dlp',
            },
          ],
        },
        version: 1,
      }),
    )
    await useInboxStore.persist.rehydrate()
    expect(useInboxStore.getState().entries).toHaveLength(1)
    expect(useInboxStore.getState().entries[0]?.filename).toBe('x.mp4')
    expect(useInboxStore.getState().entries[0]?.engine).toBe('yt-dlp')
    // UI-local state stays at fresh defaults (zustand's shallow merge
    // leaves keys-not-present at current in-memory default).
    expect(useInboxStore.getState().selectedIds.size).toBe(0)
    expect(useInboxStore.getState().filterStatus).toBe('all')
  })

  it('merge callback always sets inflightEntryIds to empty Set post-rehydrate (no fetches are alive after reload)', async () => {
    // Seed LS with 3 stable entries (no inflight / no stale). We
    // deliberately do NOT inflate `inflightEntryIds` via
    // `useInboxStore.setState(...)` — that path triggers persist's
    // auto-write, which would overwrite the seeded LS blob (LS
    // post-loadSnapshot only knows about fields partialize wrote,
    // so the inflated Set would land in the LS blob but the seeded
    // entries would be wiped because the in-memory state's entries
    // were already `[]` from beforeEach). Post-reload reality is
    // that the in-memory state STARTS fresh (entries: [],
    // inflightEntryIds: new Set()), so this test focuses on what
    // the merge callback PRODUCES rather than simulating a stale
    // pre-reload memory inflation.
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        state: {
          entries: [
            { id: 'a1', url: 'u1', status: 'downloaded', filename: 'f1.mp4' },
            { id: 'a2', url: 'u2', status: 'failed', error: 'cookie expired' },
            { id: 'a3', url: 'u3', status: 'transcribed', filename: 'f3.mp4' },
          ],
        },
        version: 1,
      }),
    )
    await useInboxStore.persist.rehydrate()
    const s = useInboxStore.getState()
    // All 3 entries come back from LS — covers the case where
    // merge receives 3 stable-status entries that don't flip.
    expect(s.entries).toHaveLength(3)
    expect(s.entries.map((e) => e.status)).toEqual([
      'downloaded',
      'failed',
      'transcribed',
    ])
    // Pre-existing `error` on the originally-failed entry must
    // survive the merge — `merge` only touches `downloading` /
    // `transcribing` entries.
    expect(s.entries[1]?.error).toBe('cookie expired')
    // Post-reload: no fetches are running, so merge unconditionally
    // produces an empty inflightEntryIds (UI-local state, not
    // persisted, so this is the fresh-defaults contract, not a
    // round-trip through LS).
    expect(s.inflightEntryIds.size).toBe(0)
  })
})

// ── D. Stale in-progress flip ───────────────────────────────
describe('stale-downloading / stale-transcribing → failed on rehydrate', () => {
  it("entry with persisted status='downloading' becomes 'failed' with the pinned interrupted message", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        state: {
          entries: [
            {
              id: 'a1',
              url: 'https://example.com/x.mp4',
              status: 'downloading',
              startedAt: 1000,
            },
          ],
        },
        version: 1,
      }),
    )
    await useInboxStore.persist.rehydrate()
    expect(useInboxStore.getState().entries[0]?.status).toBe('failed')
    expect(useInboxStore.getState().entries[0]?.error).toBe(
      '页面刷新时下载中断，文件可能已落盘到 videos/inbox/，请重试或手动核验',
    )
    expect(useInboxStore.getState().inflightEntryIds.size).toBe(0)
  })

  it("entry with persisted status='transcribing' becomes 'failed' (transcribe stream is also live-killed by reload)", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        state: {
          entries: [
            {
              id: 'a2',
              url: 'https://example.com/y.mp4',
              status: 'transcribing',
              filename: 'y.mp4',
            },
          ],
        },
        version: 1,
      }),
    )
    await useInboxStore.persist.rehydrate()
    expect(useInboxStore.getState().entries[0]?.status).toBe('failed')
  })

  it('mixed-status entry list: stable statuses preserved, only downloading/transcribing flipped', async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        state: {
          entries: [
            {
              id: 'a1',
              url: 'u1',
              status: 'downloaded',
              filename: 'f1.mp4',
            },
            {
              id: 'a2',
              url: 'u2',
              status: 'failed',
              error: 'pre-existing error',
            },
            {
              id: 'a3',
              url: 'u3',
              status: 'downloading',
              startedAt: 1000,
            },
            {
              id: 'a4',
              url: 'u4',
              status: 'transcribed',
              filename: 'f4.mp4',
            },
          ],
        },
        version: 1,
      }),
    )
    await useInboxStore.persist.rehydrate()
    const s = useInboxStore.getState()
    expect(s.entries.map((e) => e.status)).toEqual([
      'downloaded',
      'failed',
      'failed', // ← flipped from 'downloading'
      'transcribed',
    ])
    // Pre-existing error on the originally-failed entry survives.
    expect(s.entries[1]?.error).toBe('pre-existing error')
    // Flipped entry's error is the pinned interrupted string.
    expect(s.entries[2]?.error).toBe(
      '页面刷新时下载中断，文件可能已落盘到 videos/inbox/，请重试或手动核验',
    )
    // No stale-flip → no error overwrite on this entry.
    expect(s.entries[3]?.error).toBeUndefined()
  })
})

// ── E. clearInboxStorage() helper ──────────────────────────
describe('clearInboxStorage() helper', () => {
  it('removes the LS entry (verified via direct LS read)', () => {
    useInboxStore.setState({
      entries: [
        {
          id: 'a1',
          url: 'https://example.com/x.mp4',
          status: 'downloaded',
        },
      ],
    })
    expect(localStorage.getItem(LS_KEY)).not.toBeNull()
    clearInboxStorage()
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })

  it('is idempotent (multiple calls no-throw on empty/fresh LS)', () => {
    expect(() => clearInboxStorage()).not.toThrow()
    expect(() => clearInboxStorage()).not.toThrow()
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })

  it('export wired to useInboxStore.persist.clearStorage (so external callers do not need to reach into `persist` internals)', () => {
    // Spy on the underlying persist.clearStorage to confirm
    // clearInboxStorage is a thin pass-through — no business logic.
    const spy = vi.spyOn(useInboxStore.persist, 'clearStorage')
    clearInboxStorage()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
