// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/UploadProgressDialogProvider.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): Provider component
// + public dispatch hook + private context. Mirrors the canonical
// shape established for Account / Preferences slices.
//
// Why this slice HAS a Provider (even though the slice is scaffold-
// only today): an upload-progress poll can't live in trigger-local
// state because the trigger site is typically the publish-form
// (`/dashboard/publish`) while the user wants progress visibly echoed
// elsewhere (sidebar status badge, AI sidebar progress chip, the
// toast queue). Cross-surface mounting is the WHOLE point.
// ──────────────────────────────────────────────────────────────────────────

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  UploadProgress,
  UploadProgressDialogState,
} from './UploadProgressDialogProvider.helpers'

// Private — NOT exported. Consumer entry-point is `useUploadProgressDialog`.
const UploadProgressDialogContext =
  createContext<UploadProgressDialogState | null>(null)

interface UploadProgressDialogProviderProps {
  children: ReactNode
}

export function UploadProgressDialogProvider({
  children,
}: UploadProgressDialogProviderProps) {
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<ReadonlyArray<UploadProgress>>([])

  const start = useCallback((progress: UploadProgress) => {
    setRecords((prev) => {
      const existing = prev.findIndex((r) => r.id === progress.id)
      if (existing >= 0) {
        // Replace in place — preserve order so a re-key doesn't
        // cause the modal to flash the wrong item.
        const next = prev.slice()
        next[existing] = progress
        return next
      }
      return [...prev, progress]
    })
    setOpen(true)
  }, [])

  const update = useCallback(
    (id: string, patch: Partial<UploadProgress>) => {
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      )
    },
    [],
  )

  const finish = useCallback(
    (id: string, status: 'done' | 'failed', error?: string) => {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                stage: status,
                ratio: status === 'done' ? 1 : r.ratio,
                error,
              }
            : r,
        ),
      )
    },
    [],
  )

  // Render-coupled by design (round-OPT-prefs-dialog v6 polish).
  // `setOpen(false)` reads the same tick's post-filter state
  // INSIDE the updater — the atomic setState pattern. A future
  // hook-based refactor (`useEffect[records.length]`) would
  // risk stale-state flicker on fast cancel sequences: the
  // effect's deps read the PRE-commit snapshot, so a "cancel
  // last record" burst could momentarily emit 0-length records
  // twice and pop the modal on / off in a single frame. Keep
  // the inline pattern until an async signal (retry, staged
  // cancel) makes a separate effect worth the dependency-
  // tracking overhead.
  const cancel = useCallback((id: string) => {
    setRecords((prev) => {
      const next = prev.filter((r) => r.id !== id)
      if (next.length === 0) setOpen(false)
      return next
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const clear = useCallback((id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const value = useMemo<UploadProgressDialogState>(
    () => ({ open, records, start, update, finish, cancel, close, clear }),
    [open, records, start, update, finish, cancel, close, clear],
  )

  return (
    <UploadProgressDialogContext.Provider value={value}>
      {children}
    </UploadProgressDialogContext.Provider>
  )
}

/**
 * Hook to read & drive upload-progress state. Throws when called
 * outside a `<UploadProgressDialogProvider>` so a future shell that
 * drops the Provider wrapper fails loudly at the first `start(progress)`
 * call rather than silently returning undefined and crashing mid-flow.
 */
export function useUploadProgressDialog(): UploadProgressDialogState {
  const ctx = useContext(UploadProgressDialogContext)
  if (!ctx) {
    throw new Error(
      'useUploadProgressDialog must be used within a UploadProgressDialogProvider',
    )
  }
  return ctx
}
