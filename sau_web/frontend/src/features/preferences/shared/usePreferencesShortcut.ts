// ──────────────────────────────────────────────────────────────────────────
// features/preferences/shared/usePreferencesShortcut.ts
//
// Round-OPT-3G+ v3 (Preferences keyboard shortcut). Purpose-built hook
// that listens for `Cmd+,` (macOS) / `Ctrl+,` (Win/Linux) on
// `document.keydown` and invokes a caller-supplied callback.
//
// Design rationale:
// • Lives in `features/preferences/shared/` (NOT `hooks/` at project
//   root) because the shortcut is a slice-level concern — only the
//   `<PreferencesDialog />` slice needs the handler, and any future
//   shell that drops in `<PreferencesDialogProvider>` + this hook
//   inherits the behavior without needing to refetch AppShell.
// • Single-purpose: the hook accepts a callback, NO inline
//   PreferencesDialog imports — keeps the slice-hierarchy opaque
//   (AppShell composes `usePreferencesShortcut` +
//   `usePreferencesDialog().openPreferences('overview')`).
// • Suppression contract: a user typing `<Cmd+,>` in an `<input>`
//   (e.g. an SVG path with comma in a tag-input composer) MUST
//   NOT crash the dialog. Same suppression rule the AppShell's
//   `/` and `n` shortcuts already apply (line 144-149 of
//   AppShell.tsx) — matches the project rhythm.
// • Modifier disambiguation: `metaKey` XOR `ctrlKey` (one OR the
//   other, NOT both — explicit `metaKey || ctrlKey` matches
//   either platform while still rejecting accidental combo presses).
//   `!shiftKey && !altKey` rejects the other variants users
//   might hit by mistake.
//
// Why NOT a library like `react-hotkeys-hook`: round-OPT-3G+ v3
// is one shortcut, deps cost > lock-in cost for a 12-line useEffect.
// If a future round needs 5+ shortcuts across slices, introduce
// the library then.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'

interface UsePreferencesShortcutOptions {
  /** Fired once on a clean keypress that matches the shortcut
   *  AND passes the suppression rule. Synchronous. */
  onTrigger: () => void
  /** Disable the listener without unmounting (e.g. when the
   *  dialog state proves no-op). Default = enabled. */
  enabled?: boolean
}

export function usePreferencesShortcut({
  onTrigger,
  enabled = true,
}: UsePreferencesShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // Match: Cmd+, (macOS) / Ctrl+, (Win/Linux). Reject combo
      // presses with shift / alt.
      if (
        !(e.metaKey || e.ctrlKey) ||
        e.key !== ',' ||
        e.shiftKey ||
        e.altKey
      ) {
        return
      }
      // Suppression rule: a user typing in an input/textarea/
      // contenteditable surface MUST NOT have their keystroke
      // swallowed by the shortcut (mirrors AppShell's
      // `isTyping` gate at lines 144-149).
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable === true
      ) {
        return
      }
      // `e.repeat === true` means the user is holding the keys
      // down — fire ONCE on the first keydown only. Holding
      // Cmd+, must NOT spam-open the dialog.
      if (e.repeat) return

      e.preventDefault()
      onTrigger()
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onTrigger, enabled])
}
