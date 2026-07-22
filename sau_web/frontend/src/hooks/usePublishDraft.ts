import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * PR-OPT-2D-1: persist publish-form drafts to LocalStorage so an interrupted
 * session (refresh, tab close, accidental nav) doesn't drop unsaved work.
 *
 * Round-3 fix address the round-2 reviewer-flag: `isPlainMetadataObject`
 * accepted `File` objects because `File` exposes `name`/`size`/`lastModified`
 * as enumerable primitives. We now (a) reject by `instanceof File/Blob/FileList`
 * and (b) require all keys to be a subset of a fixed metadata whitelist.
 *
 * Round-2 fixes (kept):
 *   * Default filter accepts plain metadata objects so VideoForm's
 *     `lastFileMeta` round-trips through LocalStorage.
 *   * `writeSnapshot` is gated on `hasMeaningfulContent` so an empty
 *     default form state never overwrites a real LS draft.
 *
 * Lifecycle:
 *   1. On mount, read LocalStorage key; if non-empty and matches `mode`,
 *      return it as `pendingDraft` (and `draftSavedAt`); do NOT auto-apply.
 *   2. On every change to `snapshot` (after a 800ms debounce), write to LS
 *      ONLY IF `hasMeaningfulContent(snapshot)` is true.
 *   3. When the form calls `acknowledge`, `pendingDraft` becomes null and
 *      the banner disappears.
 */

export type DraftMode = 'video' | 'note'

export type SnapshotPredicate<T> = (key: keyof T, value: unknown) => boolean

/** Generic helper that ignores File / FileList / Blob / unknown opaque types. */
export const isPersistable = (v: unknown): boolean => {
  if (v === null || v === undefined) return true
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  return false
}

const ALLOWED_METADATA_KEYS = new Set(['name', 'size', 'lastModified', 'type'])

/**
 * Permits plain-object metadata shapes (e.g., `{ name: string; size: number }`)
 * through the filter. Rejects:
 *   - File/Blob/FileList instances (have non-serializable internals).
 *   - Objects with keys outside the metadata whitelist.
 *   - Nested objects or arrays.
 *
 * The whitelist is intentionally narrow: only fields with these names and
 * primitive values are considered "metadata". Adding new fields requires
 * updating this set (fail-loud) to avoid accidentally persisting user
 * Binary data.
 */
export const isPlainMetadataObject = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  // Type guards: React's environment may polyfill File/Blob; use runtime
  // check so this works in browsers, jsdom (tests), and provides a real
  // error path if someone passes a File expecting it to round-trip.
  if (typeof File !== 'undefined' && v instanceof File) return false
  if (typeof Blob !== 'undefined' && v instanceof Blob) return false
  if (typeof FileList !== 'undefined' && v instanceof FileList) return false
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 0) return false
  for (const key of keys) {
    if (!ALLOWED_METADATA_KEYS.has(key)) return false
    if (!isPersistable(obj[key])) return false
  }
  return true
}

const defaultFilter: SnapshotPredicate<Record<string, unknown>> = (_k, v) =>
  isPersistable(v) || isPlainMetadataObject(v)

/**
 * Returns true if any persisted value carries actual content. Booleans alone
 * (e.g., default `headless: true`) don't count. Strings of length>0, numbers,
 * and non-null objects all count.
 */
const hasMeaningfulContent = (filtered: Record<string, unknown>): boolean => {
  for (const v of Object.values(filtered)) {
    if (v === null) continue
    if (typeof v === 'string') {
      if (v.length > 0) return true
      continue
    }
    if (typeof v === 'boolean') continue
    if (typeof v === 'number') return true
    if (typeof v === 'object') return true
  }
  return false
}

export interface UsePublishDraftOptions<T> {
  /** Optional predicate to filter which snapshot keys to persist. */
  filter?: SnapshotPredicate<T>
  /** Override debounce (ms). Defaults to 800. */
  debounceMs?: number
  /** Disable persistence (SSR / tests). */
  disabled?: boolean
}

export interface UsePublishDraftResult<T> {
  /** A draft was found on mount and has not yet been acknowledged. */
  pendingDraft: T | null
  /** ISO save-timestamp mirrored from the LS envelope (or null after acknowledge). */
  draftSavedAt: string | null
  /** Called by the banner: clear "pendingDraft" so banner disappears. */
  acknowledge: () => void
  /** Wipe the LS key entirely. Useful for "丢弃" or test cleanup. */
  clearDraftStorage: () => void
  /** Force-write current snapshot (e.g. before unmount). */
  flushNow: () => void
}

interface DraftEnvelope<T> {
  mode: DraftMode
  savedAt: string
  payload: T
}

/**
 * §9.2 — Drafts older than 24 hours are expired and should not be offered
 * for restore. When an expired draft is found, the LS slot is silently
 * cleared so the banner never shows stale data.
 */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000 // 24h

function readDraft<T>(mode: DraftMode): DraftEnvelope<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`sau-publish-draft-${mode}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    if (parsed?.mode !== mode || typeof parsed?.payload !== 'object') return null
    // §9.2: expire drafts older than 24h. Silently delete the LS slot so
    // the banner doesn't surface stale data on the next mount.
    if (parsed.savedAt) {
      const ageMs = Date.now() - new Date(parsed.savedAt).getTime()
      if (ageMs > DRAFT_TTL_MS) {
        clearDraftStorageKey(mode)
        return null
      }
    }
    return parsed
  } catch {
    return null
  }
}

function writeDraft<T>(mode: DraftMode, payload: T): void {
  if (typeof window === 'undefined') return
  try {
    const envelope: DraftEnvelope<T> = {
      mode,
      savedAt: new Date().toISOString(),
      payload,
    }
    window.localStorage.setItem(`sau-publish-draft-${mode}`, JSON.stringify(envelope))
  } catch {
    /* QuotaError / Safari private mode — silently drop */
  }
}

function clearDraftStorageKey(mode: DraftMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(`sau-publish-draft-${mode}`)
  } catch {
    /* noop */
  }
}

export function usePublishDraft<T extends Record<string, unknown>>(
  mode: DraftMode,
  snapshot: T,
  options: UsePublishDraftOptions<T> = {},
): UsePublishDraftResult<T> {
  const { filter = defaultFilter as SnapshotPredicate<T>, debounceMs = 800, disabled = false } =
    options

  const [pendingDraft, setPendingDraft] = useState<T | null>(() => {
    if (disabled) return null
    const env = readDraft<T>(mode)
    return env?.payload ?? null
  })
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(() => {
    if (disabled) return null
    const env = readDraft<T>(mode)
    return env?.savedAt ?? null
  })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Pristine `snapshot` is read from the React closure at call time;
  // no ref-mirror-during-render. Sequencing `snapshot` into the
  // shape of an explicit parameter makes React 19's `react-hooks/refs`
  // rule happy and removes the previous mount-time-onwards stale-value
  // hairpin that `snapshotRef.current = snapshot` introduced between
  // the call site and the useCallback closure.

  const writeSnapshot = useCallback(
    (currentSnapshot: T) => {
      if (disabled) return
      const filtered: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(currentSnapshot)) {
        if (filter(k as keyof T, v)) filtered[k as string] = v
      }
      if (!hasMeaningfulContent(filtered)) return
      writeDraft(mode, filtered as T)
      setDraftSavedAt(new Date().toISOString())
    },
    [mode, disabled, filter],
  )

  useEffect(() => {
    if (disabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      writeSnapshot(snapshot)
    }, debounceMs)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [snapshot, debounceMs, disabled, writeSnapshot])

  const acknowledge = useCallback(() => {
    setPendingDraft(null)
    setDraftSavedAt(null)
  }, [])

  const clearDraftStorage = useCallback(() => {
    clearDraftStorageKey(mode)
  }, [mode])

  const flushNow = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    writeSnapshot(snapshot)
  }, [writeSnapshot, snapshot])

  return { pendingDraft, draftSavedAt, acknowledge, clearDraftStorage, flushNow }
}
