import type { ChatStorage } from './types'

export interface PrunePolicy {
  /** Sessions whose `updatedAt` is strictly older than `now - ttlMs` get deleted. */
  ttlMs: number
  /** If combined `totalSize` of survivors exceeds this, oldest are deleted until under. */
  maxTotalBytes: number
}

export interface PruneReport {
  deletedByTtl: string[]
  deletedByQuota: string[]
  totalDeleted: number
  freedBytes: number
}

export const DEFAULT_PRUNE_POLICY: PrunePolicy = {
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxTotalBytes: 50 * 1024 * 1024,
}

/**
 * Remove chat sessions older than `ttlMs`, then delete the oldest
 * survivors until combined size is at or under `maxTotalBytes`.
 *
 * TTL runs first because it's the cheaper decision and means quota
 * math runs against a smaller set. The `now` parameter is injectable
 * for deterministic tests.
 */
export async function pruneChatStorage(
  storage: ChatStorage,
  policy: PrunePolicy = DEFAULT_PRUNE_POLICY,
  now: number = Date.now(),
): Promise<PruneReport> {
  const all = await storage.listSessions()
  const ttlCutoff = now - policy.ttlMs

  // ── Phase 1: TTL ──────────────────────────────────────────────────────
  const expired = all.filter((s) => s.updatedAt < ttlCutoff)
  const surviving = all.filter((s) => s.updatedAt >= ttlCutoff)
  const freedFromTtl = expired.reduce((acc, s) => acc + s.totalSize, 0)

  if (expired.length) {
    await storage.deleteMany(expired.map((s) => s.id))
  }

  // ── Phase 2: Quota (only against survivors) ───────────────────────────
  let deletedByQuota: string[] = []
  let freedFromQuota = 0
  const totalAfterTtl = surviving.reduce((acc, s) => acc + s.totalSize, 0)

  if (totalAfterTtl > policy.maxTotalBytes) {
    const oldestFirst = [...surviving].sort((a, b) => a.updatedAt - b.updatedAt)
    const toDelete: string[] = []
    let remaining = totalAfterTtl
    for (const s of oldestFirst) {
      // Strict greater-than: equal-to-cap is acceptable.
      if (remaining <= policy.maxTotalBytes) break
      toDelete.push(s.id)
      remaining -= s.totalSize
    }
    if (toDelete.length) {
      deletedByQuota = toDelete
      freedFromQuota = toDelete.reduce((acc, id) => {
        const s = surviving.find((x) => x.id === id)
        return acc + (s?.totalSize ?? 0)
      }, 0)
      await storage.deleteMany(toDelete)
    }
  }

  return {
    deletedByTtl: expired.map((s) => s.id),
    deletedByQuota,
    totalDeleted: expired.length + deletedByQuota.length,
    freedBytes: freedFromTtl + freedFromQuota,
  }
}
