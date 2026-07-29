/**
 * Module-level AbortControllers for in-flight inbox jobs.
 * Survives route changes so cancel works from the global job queue.
 */

const controllers = new Map<string, AbortController>()

export function beginInboxJob(entryId: string): AbortSignal {
  // Abort any previous controller for the same row
  const prev = controllers.get(entryId)
  if (prev) {
    try {
      prev.abort()
    } catch {
      /* ignore */
    }
  }
  const ac = new AbortController()
  controllers.set(entryId, ac)
  return ac.signal
}

export function endInboxJob(entryId: string, signal?: AbortSignal): void {
  const cur = controllers.get(entryId)
  if (!cur) return
  if (signal && cur.signal !== signal) return
  controllers.delete(entryId)
}

export function cancelInboxJob(entryId: string): boolean {
  const cur = controllers.get(entryId)
  if (!cur) return false
  try {
    cur.abort()
  } catch {
    /* ignore */
  }
  controllers.delete(entryId)
  return true
}

export function cancelAllInboxJobs(): number {
  let n = 0
  for (const [id, ac] of controllers) {
    try {
      ac.abort()
      n++
    } catch {
      /* ignore */
    }
    controllers.delete(id)
  }
  return n
}

export function hasInboxJob(entryId: string): boolean {
  return controllers.has(entryId)
}
