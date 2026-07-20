// TODO(migration-stub): minimal placeholder for the pre-existing
// `src/lib/features.ts` module that was missing on origin/main.
// Use LOOSE TYPING (any returns) to avoid downstream TS2345/TS2322
// mismatches. Replace with the real implementation in a follow-up PR.

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export const formatDateTime = (_value: any): string => ''
export const BATCH_CONCURRENCY = 5
export const runWithConcurrency = async (
  _items: any[],
  _limit: number,
  _fn: any,
  _onProgress?: any,
): Promise<void> => {}
export const shortenId = (id: string): string => id