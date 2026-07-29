import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  useInboxStore,
  getInboxStore,
  clearInboxStorage,
  type InboxEntry,
} from './inboxStore'

function makeEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: `e_${Math.random().toString(36).slice(2, 9)}`,
    url: `https://example.com/video_${Math.random().toString(36).slice(2, 6)}`,
    status: 'downloaded',
    ...overrides,
  }
}

function resetStore() {
  getInboxStore().reset()
  globalThis.localStorage?.clear()
}

describe('inboxStore — entries', () => {
  beforeEach(() => {
    resetStore()
  })

  it('starts empty', () => {
    expect(getInboxStore().entries).toEqual([])
  })

  it('addEntry prepends and stores a single entry', () => {
    const e = makeEntry({ url: 'https://youtu.be/abc', status: 'downloading' })
    getInboxStore().addEntry(e)
    expect(getInboxStore().entries).toHaveLength(1)
    expect(getInboxStore().entries[0].url).toBe('https://youtu.be/abc')
    expect(getInboxStore().entries[0].status).toBe('downloading')
  })

  it('addEntry prepends newest first (LIFO)', () => {
    const a = makeEntry({ id: 'a', url: 'https://a.com' })
    const b = makeEntry({ id: 'b', url: 'https://b.com' })
    getInboxStore().addEntry(a)
    getInboxStore().addEntry(b)
    expect(getInboxStore().entries.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('updateEntry patches an existing entry', () => {
    getInboxStore().addEntry(makeEntry({ id: 'x', status: 'downloading' }))
    getInboxStore().updateEntry('x', { status: 'downloaded', filename: 'video.mp4' })
    const entry = getInboxStore().entries.find((e) => e.id === 'x')
    expect(entry?.status).toBe('downloaded')
    expect(entry?.filename).toBe('video.mp4')
  })

  it('updateEntry does nothing for unknown id', () => {
    getInboxStore().addEntry(makeEntry({ id: 'known' }))
    const prev = getInboxStore().entries.length
    getInboxStore().updateEntry('nonexistent', { status: 'failed' })
    expect(getInboxStore().entries.length).toBe(prev)
  })

  it('appendTranscript appends text chunks', () => {
    getInboxStore().addEntry(makeEntry({ id: 't' }))
    getInboxStore().appendTranscript('t', 'Hello ')
    getInboxStore().appendTranscript('t', 'world!')
    expect(getInboxStore().entries.find((e) => e.id === 't')?.transcript).toBe('Hello world!')
  })

  it('removeEntry removes the entry and clears it from selection/inflight', () => {
    getInboxStore().addEntry(makeEntry({ id: 'r', url: 'https://r.com' }))
    getInboxStore().markInflight('r')
    getInboxStore().toggleSelect('r')
    expect(getInboxStore().entries).toHaveLength(1)
    getInboxStore().removeEntry('r')
    expect(getInboxStore().entries).toHaveLength(0)
    expect(getInboxStore().inflightEntryIds.has('r')).toBe(false)
    expect(getInboxStore().selectedIds.has('r')).toBe(false)
  })

  it('clearAll empties entries, inflight, and selection', () => {
    getInboxStore().addEntry(makeEntry({ id: 'a' }))
    getInboxStore().addEntry(makeEntry({ id: 'b' }))
    getInboxStore().markInflight('a')
    getInboxStore().selectAll()
    getInboxStore().clearAll()
    expect(getInboxStore().entries).toHaveLength(0)
    expect(getInboxStore().inflightEntryIds.size).toBe(0)
    expect(getInboxStore().selectedIds.size).toBe(0)
  })

  it('setEntries replaces all entries', () => {
    getInboxStore().addEntry(makeEntry({ id: 'old' }))
    const fresh = [makeEntry({ id: 'n1' }), makeEntry({ id: 'n2' })]
    getInboxStore().setEntries(fresh)
    expect(getInboxStore().entries).toHaveLength(2)
    expect(getInboxStore().entries[0].id).toBe('n1')
  })
})

describe('inboxStore — inflight tracking', () => {
  beforeEach(() => {
    resetStore()
  })

  it('markInflight adds id to inflightEntryIds', () => {
    getInboxStore().markInflight('id-1')
    expect(getInboxStore().inflightEntryIds.has('id-1')).toBe(true)
  })

  it('markInflight is idempotent', () => {
    getInboxStore().markInflight('id-1')
    getInboxStore().markInflight('id-1')
    expect(getInboxStore().inflightEntryIds.size).toBe(1)
  })

  it('clearInflight removes id', () => {
    getInboxStore().markInflight('id-1')
    getInboxStore().markInflight('id-2')
    getInboxStore().clearInflight('id-1')
    expect(getInboxStore().inflightEntryIds.has('id-1')).toBe(false)
    expect(getInboxStore().inflightEntryIds.has('id-2')).toBe(true)
  })

  it('clearInflight is idempotent (no throw on absent id)', () => {
    expect(() => getInboxStore().clearInflight('nope')).not.toThrow()
  })
})

describe('inboxStore — selection', () => {
  beforeEach(() => {
    resetStore()
    getInboxStore().addEntry(makeEntry({ id: 'a' }))
    getInboxStore().addEntry(makeEntry({ id: 'b' }))
    getInboxStore().addEntry(makeEntry({ id: 'c' }))
  })

  it('toggleSelect adds and removes from selection', () => {
    getInboxStore().toggleSelect('a')
    expect(getInboxStore().selectedIds.has('a')).toBe(true)
    getInboxStore().toggleSelect('a')
    expect(getInboxStore().selectedIds.has('a')).toBe(false)
  })

  it('selectAll selects all entries', () => {
    getInboxStore().selectAll()
    expect(getInboxStore().selectedIds.size).toBe(3)
  })

  it('clearSelection empties selection', () => {
    getInboxStore().selectAll()
    getInboxStore().clearSelection()
    expect(getInboxStore().selectedIds.size).toBe(0)
  })
})

describe('inboxStore — filtering and search', () => {
  beforeEach(() => {
    resetStore()
  })

  it('setFilterStatus updates the active filter', () => {
    expect(getInboxStore().filterStatus).toBe('all')
    getInboxStore().setFilterStatus('failed')
    expect(getInboxStore().filterStatus).toBe('failed')
    getInboxStore().setFilterStatus('downloaded')
    expect(getInboxStore().filterStatus).toBe('downloaded')
  })

  it('setSearchQuery updates the search query', () => {
    getInboxStore().setSearchQuery('test url')
    expect(getInboxStore().searchQuery).toBe('test url')
  })
})

describe('inboxStore — collapse groups', () => {
  beforeEach(() => {
    resetStore()
  })

  it('toggleCollapse toggles group collapse state', () => {
    expect(getInboxStore().collapsedGroups.has('failed')).toBe(false)
    getInboxStore().toggleCollapse('failed')
    expect(getInboxStore().collapsedGroups.has('failed')).toBe(true)
    getInboxStore().toggleCollapse('failed')
    expect(getInboxStore().collapsedGroups.has('failed')).toBe(false)
  })

  it('setCollapsedGroups replaces the entire set', () => {
    getInboxStore().setCollapsedGroups(new Set(['downloading', 'failed']))
    expect(getInboxStore().collapsedGroups.has('downloading')).toBe(true)
    expect(getInboxStore().collapsedGroups.has('failed')).toBe(true)
    expect(getInboxStore().collapsedGroups.has('downloaded')).toBe(false)
  })
})

describe('inboxStore — batchBusy', () => {
  beforeEach(() => {
    resetStore()
  })

  it('setBatchBusy toggles the batch busy flag', () => {
    expect(getInboxStore().batchBusy).toBe(false)
    getInboxStore().setBatchBusy(true)
    expect(getInboxStore().batchBusy).toBe(true)
    getInboxStore().setBatchBusy(false)
    expect(getInboxStore().batchBusy).toBe(false)
  })
})

describe('inboxStore — mergeDiskFiles', () => {
  beforeEach(() => {
    resetStore()
  })

  it('adds new disk files as downloaded entries', () => {
    getInboxStore().mergeDiskFiles([
      { filename: 'video1.mp4', size: 12345, mtime: '2026-07-28T10:00:00' },
    ])
    expect(getInboxStore().entries).toHaveLength(1)
    const e = getInboxStore().entries[0]
    expect(e.filename).toBe('video1.mp4')
    expect(e.status).toBe('downloaded')
    expect(e.sizeBytes).toBe(12345)
    expect(e.url).toBe('') // disk files have no original URL
  })

  it('skips filenames already in the store', () => {
    getInboxStore().addEntry(makeEntry({ id: 'existing', filename: 'video1.mp4' }))
    getInboxStore().mergeDiskFiles([
      { filename: 'video1.mp4', size: 999 },
      { filename: 'video2.mp4', size: 888 },
    ])
    const entries = getInboxStore().entries
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.filename === 'video2.mp4')).toBeDefined()
  })

  it('sorts disk files by mtime descending', () => {
    getInboxStore().mergeDiskFiles([
      { filename: 'old.mp4', mtime: '2026-01-01T00:00:00' },
      { filename: 'new.mp4', mtime: '2026-07-28T10:00:00' },
    ])
    const entries = getInboxStore().entries
    expect(entries[0].filename).toBe('new.mp4')
    expect(entries[1].filename).toBe('old.mp4')
  })

  it('handles empty file list gracefully', () => {
    expect(() => getInboxStore().mergeDiskFiles([])).not.toThrow()
    expect(getInboxStore().entries).toHaveLength(0)
  })

  it('skips entries without a filename', () => {
    getInboxStore().mergeDiskFiles([
      { filename: '', size: 0 },
      { filename: '  ', size: 0 },
      { filename: 'real.mp4', size: 100 },
    ])
    expect(getInboxStore().entries).toHaveLength(1)
    expect(getInboxStore().entries[0].filename).toBe('real.mp4')
  })
})

describe('inboxStore — persistence (partialize)', () => {
  beforeEach(() => {
    resetStore()
  })

  it('partialize strips transcript but keeps error and other fields', () => {
    const persisted = useInboxStore.persist.getOptions()
    expect(persisted.partialize).toBeDefined()

    // Verify that partialize removes transcript
    const result = persisted.partialize!({
      entries: [
        { id: 'p1', transcript: 'long transcript', error: 'short', filename: 'vid.mp4', url: 'https://x.com', status: 'downloaded' } as InboxEntry,
      ],
      inflightEntryIds: new Set(),
      batchBusy: false,
      selectedIds: new Set(),
      filterStatus: 'all',
      collapsedGroups: new Set(),
      searchQuery: '',
      addEntry: () => {},
      updateEntry: () => {},
      appendTranscript: () => {},
      removeEntry: () => {},
      clearAll: () => {},
      setEntries: () => {},
      mergeDiskFiles: () => {},
      markInflight: () => {},
      clearInflight: () => {},
      setBatchBusy: () => {},
      toggleSelect: () => {},
      selectAll: () => {},
      clearSelection: () => {},
      setFilterStatus: () => {},
      toggleCollapse: () => {},
      setCollapsedGroups: () => {},
      setSearchQuery: () => {},
      reset: () => {},
    })
    expect(result.entries[0].transcript).toBeUndefined()
    expect(result.entries[0].error).toBe('short')
    expect(result.entries[0].filename).toBe('vid.mp4')
  })

  it('merge handler downgrades subtitling → downloaded on rehydrate', () => {
    const merge = useInboxStore.persist.getOptions().merge!
    const result = merge(
      { entries: [{ id: 's1', status: 'subtitling', url: 'https://x.com' }] },
      getInboxStore(),
    )
    const s1 = result.entries.find((e) => e.id === 's1')
    expect(s1?.status).toBe('downloaded')
  })

  it('migration v3 passes through unchanged', () => {
    const migrate = useInboxStore.persist.getOptions().migrate!
    const result = migrate(
      { entries: [{ id: 'm1', status: 'downloaded', url: 'https://x.com' }] },
      3,
    )
    const m1 = (result as { entries: InboxEntry[] }).entries.find((e) => e.id === 'm1')
    expect(m1?.status).toBe('downloaded')
  })

  it('migration pre-v3 extracts entries from persisted state', () => {
    const migrate = useInboxStore.persist.getOptions().migrate!
    const result = migrate(
      { entries: [{ id: 'old', status: 'downloaded', url: 'https://x.com' }] },
      2,
    )
    expect((result as { entries: InboxEntry[] }).entries).toHaveLength(1)
  })

  it('migration on non-object persisted state returns empty entries', () => {
    const migrate = useInboxStore.persist.getOptions().migrate!
    const result = migrate('garbage string' as unknown as Record<string, unknown>, 0)
    expect((result as { entries: InboxEntry[] }).entries).toEqual([])
  })
})

describe('inboxStore — reset', () => {
  beforeEach(() => {
    resetStore()
  })

  it('reset clears all state to defaults', () => {
    getInboxStore().addEntry(makeEntry({ id: 'r1' }))
    getInboxStore().markInflight('r1')
    getInboxStore().setBatchBusy(true)
    getInboxStore().selectAll()
    getInboxStore().setFilterStatus('failed')
    getInboxStore().setSearchQuery('test')
    getInboxStore().toggleCollapse('downloading')

    getInboxStore().reset()

    const s = getInboxStore()
    expect(s.entries).toEqual([])
    expect(s.inflightEntryIds.size).toBe(0)
    expect(s.batchBusy).toBe(false)
    expect(s.selectedIds.size).toBe(0)
    expect(s.filterStatus).toBe('all')
    expect(s.searchQuery).toBe('')
    expect(s.collapsedGroups.size).toBe(0)
  })
})

describe('inboxStore — clearInboxStorage', () => {
  beforeEach(() => {
    resetStore()
  })

  it('clears persisted localStorage', () => {
    expect(() => clearInboxStorage()).not.toThrow()
  })
})
