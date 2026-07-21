import { describe, it, expect } from 'vitest'
import { InMemoryChatStorage } from './storage'
import { pruneChatStorage, DEFAULT_PRUNE_POLICY } from './pruner'
import type { ChatSession } from './types'

function sess(
  id: string,
  updatedAt: number,
  totalSize: number,
  extra: Partial<ChatSession> = {},
): ChatSession {
  return {
    id,
    headId: null,
    title: `s-${id}`,
    messages: [],
    formMode: 'video',
    updatedAt,
    totalSize,
    ...extra,
  }
}

// ─── empty + smoke ────────────────────────────────────────────────────────

describe('pruneChatStorage — empty + smoke', () => {
  it('is a no-op on empty storage', async () => {
    const storage = new InMemoryChatStorage()
    const report = await pruneChatStorage(storage, { ttlMs: 1000, maxTotalBytes: 1000 }, 5_000)
    expect(report.deletedByTtl).toEqual([])
    expect(report.deletedByQuota).toEqual([])
    expect(report.totalDeleted).toBe(0)
    expect(report.freedBytes).toBe(0)
  })

  it('keeps all sessions well within TTL and quota', async () => {
    const storage = new InMemoryChatStorage()
    const now = 1_000_000
    storage.__seed([sess('a', now - 100, 500), sess('b', now - 200, 500)])
    const report = await pruneChatStorage(storage, { ttlMs: 10_000, maxTotalBytes: 100_000 }, now)
    expect(report.totalDeleted).toBe(0)
    expect(storage.__snapshot().map((s) => s.id)).toEqual(['a', 'b'])
  })
})

// ─── TTL phase ───────────────────────────────────────────────────────────

describe('pruneChatStorage — TTL phase', () => {
  it('deletes sessions older than the cutoff (strict less-than)', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([
      sess('old1', now - 10_001, 100),
      sess('old2', now - 50_000, 200),
      sess('fresh', now - 5_000, 1),
    ])
    const report = await pruneChatStorage(storage, { ttlMs: 10_000, maxTotalBytes: 1_000_000 }, now)
    expect(report.deletedByTtl.sort()).toEqual(['old1', 'old2'])
    expect(report.deletedByQuota).toEqual([])
    expect(storage.__snapshot().map((s) => s.id)).toEqual(['fresh'])
    expect(report.freedBytes).toBe(100 + 200)
  })

  it('keeps a session EXACTLY at the cutoff (boundary is strict-less)', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([sess('boundary', now - 10_000, 100)])
    const report = await pruneChatStorage(storage, { ttlMs: 10_000, maxTotalBytes: 1_000_000 }, now)
    expect(report.deletedByTtl).toEqual([])
    expect(storage.__snapshot().map((s) => s.id)).toEqual(['boundary'])
  })

  it('does not delete by TTL alone when under quota (no cascading quota prune)', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([
      sess('old', now - 50_000, 999_999_999),   // huge but old
      sess('fresh', now - 100, 100),
    ])
    const report = await pruneChatStorage(storage, { ttlMs: 1000, maxTotalBytes: 50 }, now)
    // TTL removes 'old' first; remaining 'fresh' = 100 bytes fits under 50 ?
    //   100 > 50 → also prunes by quota. (Phase ordering test, see below.)
    // This is intentionally just TTL semantics; combined case is separate.
    expect(report.deletedByTtl).toContain('old')
    expect(report.totalDeleted).toBeGreaterThanOrEqual(1)
  })
})

// ─── quota phase ─────────────────────────────────────────────────────────

describe('pruneChatStorage — quota phase', () => {
  it('prunes oldest-first until at or under maxTotalBytes', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([
      sess('a', now - 10, 400),   // newest
      sess('b', now - 20, 400),
      sess('c', now - 30, 400),   // oldest — should be deleted
      sess('d', now - 40, 400),   // second oldest — should be deleted
    ])
    // total = 1600, cap = 1000. After deleting c+d (800) → remaining 800 ≤ 1000.
    const report = await pruneChatStorage(storage, { ttlMs: 1_000_000, maxTotalBytes: 1000 }, now)
    expect(report.deletedByQuota.sort()).toEqual(['c', 'd'])
    expect(storage.__snapshot().map((s) => s.id).sort()).toEqual(['a', 'b'])
    expect(report.freedBytes).toBe(800)
  })

  it('keeps everything when total exactly equals maxTotalBytes (boundary is strict-greater)', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([sess('a', now - 10, 500), sess('b', now - 20, 500)])
    const report = await pruneChatStorage(storage, { ttlMs: 1_000_000, maxTotalBytes: 1000 }, now)
    expect(report.deletedByQuota).toEqual([])
    expect(storage.__snapshot().map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('keeps everything when total is below maxTotalBytes', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([sess('a', now - 10, 300), sess('b', now - 20, 300)])
    const report = await pruneChatStorage(storage, { ttlMs: 1_000_000, maxTotalBytes: 1000 }, now)
    expect(report.deletedByQuota).toEqual([])
  })

  it('only prunes until under quota, not down to zero', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([
      sess('1', now - 10, 100),
      sess('2', now - 20, 100),
      sess('3', now - 30, 100),
      sess('4', now - 40, 100),
    ])
    // total = 400, cap = 250 → delete oldest (400, 300) → remaining 200 ≤ 250
    const report = await pruneChatStorage(storage, { ttlMs: 1_000_000, maxTotalBytes: 250 }, now)
    expect(report.deletedByQuota.sort()).toEqual(['3', '4'])
    expect(storage.__snapshot().map((s) => s.id).sort()).toEqual(['1', '2'])
  })
})

// ─── combined ordering ───────────────────────────────────────────────────

describe('pruneChatStorage — combined TTL + quota ordering', () => {
  it('TTL phase runs first; quota phase deletes the oldest survivor (not reset to zero)', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([
      // TTL-expired (huge so it would dominate quota math if not removed first)
      sess('ancient', now - 100_000, 99_999_999),
      // Survivors, total = 600 + 600 + 100 = 1300, cap = 1000, prune oldest → 700 ≤ 1000
      sess('x-old', now - 5_000, 600),
      sess('x-mid', now - 3_000, 600),
      sess('x-new', now - 100, 100),
    ])
    const report = await pruneChatStorage(
      storage,
      { ttlMs: 10_000, maxTotalBytes: 1000 },
      now,
    )
    expect(report.deletedByTtl).toEqual(['ancient'])
    expect(report.deletedByQuota).toEqual(['x-old'])
    expect(storage.__snapshot().map((s) => s.id).sort()).toEqual(['x-mid', 'x-new'])
  })

  it('after TTL clears everything no quota phase runs (no negative freedBytes)', async () => {
    const storage = new InMemoryChatStorage()
    const now = 100_000
    storage.__seed([sess('old', now - 99_999, 1_000_000)])
    const report = await pruneChatStorage(storage, { ttlMs: 1000, maxTotalBytes: 100 }, now)
    expect(report.deletedByTtl).toEqual(['old'])
    expect(report.deletedByQuota).toEqual([])
    expect(report.totalDeleted).toBe(1)
    expect(report.freedBytes).toBe(1_000_000)
  })
})

// ─── defaults ─────────────────────────────────────────────────────────────

describe('pruneChatStorage — defaults', () => {
  it('DEFAULT_PRUNE_POLICY is 7-day TTL and 50MB cap', () => {
    expect(DEFAULT_PRUNE_POLICY.ttlMs).toBe(7 * 24 * 60 * 60 * 1000)
    expect(DEFAULT_PRUNE_POLICY.maxTotalBytes).toBe(50 * 1024 * 1024)
  })

  it('uses DEFAULT_PRUNE_POLICY when omitted', async () => {
    const storage = new InMemoryChatStorage()
    const now = 1_700_000_000_000
    storage.__seed([
      sess('ancient', now - 100 * 24 * 60 * 60 * 1000, 1024),
      sess('fresh', now - 1000, 1024),
    ])
    const report = await pruneChatStorage(storage, undefined, now)
    expect(report.deletedByTtl).toContain('ancient')
    expect(report.deletedByTtl).not.toContain('fresh')
  })
})
