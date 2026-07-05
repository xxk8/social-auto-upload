// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/ConfirmDialogProvider.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): mirrors the v4
// canonical shape — Provider component + public dispatch hook
// (co-located) + private context (NOT exported). Mirrors
// `<AccountsProvider />` + `useAccountsDispatch()` + `<PreferencesDialogProvider />`
// + `usePreferencesDialog()`.
//
// Why this slice HAS a Provider (unlike inline AlertDialogs which
// don't need one): the destructive-confirm trigger surfaces are
// SCATTERED across the operator dashboard — sidebar <UserMenu /> for
// "delete API key", batch-toolbar <TaskBatchActions /> for "batch
// delete tasks", AiSidebar for "delete history entry" — so each
// caller wants a SHARED modal that's owned at AppShell level and
// driven imperatively from sibling triggers.
//
// The cross-surface `useConfirmDialog().request({ kind, payload })`
// pattern is the AppShell-bound equivalent of `usePreferencesDialog().
// openPreferences(tab)`. The trigger button lives next to its
// call-site; the modal lives next to the Provider, no prop-drilling.
//
// Mount placement: App.tsx → `AppShellWithConfirmDialog`
// (parallels `AppShellWithPrefs`). Option to use the slice WITHOUT
// the Provider mount (pure controlled-component mode) is supported
// by exporting per-tab dialog components that take `target` + `onOpenChange`
// + `onConfirm` props directly — see `DeleteApiKeyConfirm.tsx`.
// ──────────────────────────────────────────────────────────────────────────

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  ConfirmDialogState,
  ConfirmRequest,
} from './ConfirmDialogProvider.helpers'

// Private — NOT exported. Consumer entry-point is `useConfirmDialog`.
const ConfirmDialogContext = createContext<ConfirmDialogState | null>(null)

interface ConfirmDialogProviderProps {
  children: ReactNode
  /** Optional external onConfirm dispatch. If provided, the modal's
   * confirm button invokes this with the active request's payload
   * instead of relying on per-mount callbacks. Useful for cross-
   * surface flows where the trigger doesn't know its own trigger
   * site (e.g. a global keyboard shortcut). */
  onConfirmExternal?: (request: ConfirmRequest) => void | Promise<void>
}

export function ConfirmDialogProvider({
  children,
  onConfirmExternal,
}: ConfirmDialogProviderProps) {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  // Resolve the latest external confirmation handler on each render
  // without forcing a closure-capture of the call site. Set via ref
  // so the public `confirm()` callback stays stable even as consumers
  // pass different handlers on re-renders.
  const onConfirmRef = useRef<typeof onConfirmExternal>(onConfirmExternal)
  useEffect(() => {
    onConfirmRef.current = onConfirmExternal
  }, [onConfirmExternal])

  const requestConfirm = useCallback((req: ConfirmRequest) => {
    setRequest(req)
    setOpen(true)
  }, [])

  const cancel = useCallback(() => {
    setRequest(null)
    setOpen(false)
  }, [])

  const confirm = useCallback(async () => {
    // Snapshot the active request so the dispatch sees a stable
    // payload even if the modal unmounts React-side after the
    // first await tick.
    const active = request
    setRequest(null)
    setOpen(false)
    if (active && onConfirmRef.current) {
      await onConfirmRef.current(active)
    }
  }, [request])

  const value = useMemo<ConfirmDialogState>(
    () => ({
      open,
      // Field/split: the LOCAL hook variable is still named
      // `request` so the existing setter call sites keep
      // working unchanged; the INTERFACE field, on the other
      // hand, lives as `currentRequest` on the returned state
      // so the consumer-side destructure is unambiguous.
      currentRequest: request,
      request: requestConfirm,
      confirm,
      cancel,
    }),
    [open, request, requestConfirm, confirm, cancel],
  )

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
    </ConfirmDialogContext.Provider>
  )
}

/** Hook to read & control the confirm-dialog state. Throws when
 * called outside a `<ConfirmDialogProvider>` so a future shell that
 * drops the Provider wrapper fails loudly at the first `request({kind})`
 * call rather than silently returning undefined and crashing mid-flow.
 *
 * For inline-trigger sites that ALREADY own local state (e.g. the
 * AiSidebar's `deleteKey`/`deleteHistoryEntry` useState), prefer the
 * per-tab controlled-component API: rendered `<DeleteApiKeyConfirm
 * target={...} onConfirm={...} />` directly WITHOUT the Provider,
 * sidesteps the cross-surface state hop. The Provider is the
 * orchestrator-level escape hatch.
 */
export function useConfirmDialog(): ConfirmDialogState {
  const ctx = useContext(ConfirmDialogContext)
  if (!ctx) {
    throw new Error(
      'useConfirmDialog must be used within a ConfirmDialogProvider',
    )
  }
  return ctx
}
