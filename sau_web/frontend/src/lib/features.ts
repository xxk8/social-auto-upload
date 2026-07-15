/**
 * Cross-page helpers that originated inside `features/publish/shared` and
 * `features/tasks/shared` but are now reusable across any feature page
 * (Tasks, Publish, Accounts, Logs — anywhere an account key, an ISO date, a
 * task id, a file size, or bounded async fan-out is needed).
 *
 * Domain-specific helpers (`STATUS_META`, `effectiveMaxTags`,
 * `platformTagLabel`, `SectionHeader`) intentionally stay inside their
 * owning feature folder; lifting those up would couple unrelated features.
 */

// ── account key ─────────────────────────────────────────────────────────
/**
 * Format used by this codebase: `${platform}::${account_name}`.
 * Publishing endpoints and a few other call-sites expect the bare
 * `account_name`, so the second segment is what they actually want.
 */
export function parseAccountKey(key: string): string {
  const parts = key.split('::')
  return parts[1] ?? key
}

// ── bytes ───────────────────────────────────────────────────────────────
/**
 * Human-readable byte formatting. B / KB / MB tiers — GB isn't needed for
 * the video files this app accepts, but the function is monotonic so a
 * caller can scale up trivially.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── dates ───────────────────────────────────────────────────────────────
/**
 * Friendly ISO date formatter. Falls back to the raw string on parse
 * failure so a malformed payload doesn't render as `Invalid Date`.
 */
export function formatDateTime(value?: string): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

// ── ids ─────────────────────────────────────────────────────────────────
/**
 * Compact task-id display: keeps the meaningful tail and condenses the
 * prefix. Used wherever a long backend id needs to fit in a tight UI cell.
 */
export function shortenId(value?: string): string {
  if (!value) return '-'
  if (value.length <= 16) return value
  const lastDash = value.lastIndexOf('-')
  if (lastDash > 0) {
    const prefix = value.slice(0, lastDash)
    const suffix = value.slice(lastDash + 1)
    const short = `${prefix}-${suffix.slice(-6)}`
    return short.length <= 24 ? short : `${prefix.slice(0, 10)}-${suffix.slice(-6)}`
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

// ── batch concurrency ───────────────────────────────────────────────────
/**
 * Max concurrent in-flight batch ops against the backend. Lower = gentler
 * on the backend; higher = faster wall-clock for large batches.
 */
export const BATCH_CONCURRENCY = 3

/**
 * Run `items.length` async jobs with at most `concurrency` in-flight at
 * once. Calls `onProgress(index, result)` after each job completes with
 * the zero-based array index of the completed item.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<R>,
  onProgress: (index: number, result: R) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++
      const result = await handler(items[currentIndex], currentIndex)
      results[currentIndex] = result
      onProgress(currentIndex, result)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
