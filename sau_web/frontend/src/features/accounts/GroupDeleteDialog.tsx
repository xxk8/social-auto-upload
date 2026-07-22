// ──────────────────────────────────────────────────────────────────────────
// features/accounts/GroupDeleteDialog.tsx
//
// Round-OPT-accounts-Enter-confirm (2026-q3 follow-up): dumb
// controlled-component confirmation dialog for the SINGLE-row
// account-group delete affordance. Pairs with GroupListItem (list
// view) + SortableGroup (grid view) so both view modes share one
// canonical delete-confirm surface.
//
// ── Why NOT ConfirmShell: ────────────────────────────────────────────
// ConfirmShell only handles Cmd/Ctrl+Enter via the `hotkeyConfirm`
// prop; bare Enter is unbound. The user-reported bug on
// /dashboard/accounts is exactly the bare-Enter case ("I clicked
// delete, then pressed Enter, nothing happened"). ConfirmShell's
// shape is correct for the batch-delete affordance (where Cmd+Enter
// is the documented hot-key + the `⌘+Enter` chip is rendered) but
// wrong for the per-row single-delete case where the user just
// clicked Trash and expects Enter to fire.
//
// ── Why NOT provider-mode useConfirmDialog(): ────────────────────────
// Batch-delete (BatchDeleteGroupConfirm) is already wired via
// DialogHost. Single-row delete is a PER-ROW concern — each row
// opens its own dialog via local useState; the imperative-trigger
// pattern would force every row through AccountsProvider state +
// dispatch, expanding the blast radius to the provider for no UX
// benefit. If a future cross-surface trigger (sidebar UserMenu,
// global keyboard shortcut) needs to launch this dialog, migration
// is a one-pr change: add `kind: 'deleteSingleGroup'` to the
// `<ConfirmKind>` union + wire it through DialogHost.
//
// ── Safety vs convention trade-off: ───────────────────────────────────
// DESIGN-components.md §277 mandates default-focus Cancel via Radix
// `onOpenAutoFocus` for destructive confirm dialogs (prevents
// accidental Enter-confirm in one-off destructive flows). THIS
// dialog DELIBERATELY diverges for the row-delete affordance:
// the user clicked Trash just now → Enter should confirm. This
// matches macOS Finder / Gmail delete convention. The §277 rule
// still applies to BatchDeleteGroupConfirm + project-level
// destructive flows; documented here so future readers don't
// "fix" this back into a violation.
//
// ──────────────────────────────────────────────────────────────────────────

import { useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

// Module-level: ENTER_DEFERRED_TAGS hoisted out of the component so React
// doesn't re-allocate the Set on every render. The set covers the five
// elements whose browser-default Enter activation we DEFER to (let the
// element fire its native click / form-submit / native commit) instead
// of treating Enter as our bare onConfirm shortcut — that way "click
// Trash → Enter confirms" stays correct for the destructive button
// case AND a future variant that adds a confirmation input or a
// "查看详情" link inside the dialog doesn't have Enter trigger unwanted
// deletion via the focused element:
//   • focused <button> — fires its onClick (which IS our onConfirm
//     here, but we belt-and-suspenders-EARLY-EXIT to avoid
//     double-fire if a future browser mishandles the spec)
//   • <input>/<textarea>/<select> — fire form-submit / native
//     commit, both of which are wrong for destructive deletes
//   • <a> — per HTML spec, Enter on a focused <a href> fires the
//     anchor's click event; future variants that add a "查看详情"
//     link inside the dialog would want the same early-exit so
//     Enter on the link navigates instead of confirming delete
const ENTER_DEFERRED_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'])

interface GroupDeleteDialogProps {
  /** Group name — interpolated into the description. */
  name: string
  /** Authorization count — interpolated into the description so the
   * user sees the blast-radius ("X 项平台授权") at confirm time. */
  authCount: number
  /** Caller-controlled open state. Each row tracks via local useState. */
  open: boolean
  /** Close trigger — Esc key, close icon, and Cancel button all
   * route through Radix `DialogPrimitive.Close` which fires
   * `onOpenChange(false)`. */
  onOpenChange: (open: boolean) => void
  /** Fires the deletion thunk. Auto-close happens via shadcn
   * `<AlertDialogAction>`'s built-in Close primitive, so callers
   * don't need to manually call `onOpenChange(false)`. */
  onConfirm: () => void
}

export function GroupDeleteDialog({
  name,
  authCount,
  open,
  onOpenChange,
  onConfirm,
}: GroupDeleteDialogProps) {
  // Refocus the destructive button on open so the browser-native
  // "focused button + Enter = click" path fires. Without this, focus
  // stays on the Cancel button (per Radix default) and Enter dismisses.
  const confirmRef = useRef<HTMLButtonElement>(null)
  const handleOpenAutoFocus = (e: Event) => {
    e.preventDefault()
    confirmRef.current?.focus()
  }

  // Belt-and-suspenders for cases where focus escapes the dialog (e.g.
  // user mouses onto overlay then presses Enter). Modifiers and repeats
  // are no-ops so the user can compose multi-line copy without
  // accidentally firing deletion. Interactive form elements (a / button
  // / input / textarea / select) also short-circuit via the
  // ENTER_DEFERRED_TAGS lookup so a future variant with a confirmation
  // input ("type group name to delete") or a "查看详情" link doesn't have
  // Enter trigger unwanted delete via the focused element — HTML's
  // native keydown→click activation on those elements handles the
  // user-intended action (form-submit / click) and the early-exit
  // prevents our preventDefault from blocking it.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.repeat) {
      return
    }
    // Browser-native keydown→click activation on a focused interactive
    // element (button / a / etc.) fires the element's onClick after
    // the keydown resolves. Browsers honor preventDefault() and skip
    // the synthetic click. We belt-and-suspenders early-exit when
    // focus is already on such an element, so that even if a future
    // browser mishandles the spec (or if Radix synthesizes the click
    // via setTimeout), we don't double-fire onConfirm.
    const target = e.target as HTMLElement | null
    if (target && ENTER_DEFERRED_TAGS.has(target.tagName)) return
    e.preventDefault()
    onConfirm()
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onOpenAutoFocus={handleOpenAutoFocus}
        onKeyDown={handleKeyDown}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            删除分组 "{name}" 将同时清空其{' '}
            <span className="font-medium text-foreground">{authCount}</span>{' '}
            项平台授权，此操作不可撤销。确认继续？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            onClick={onConfirm}
            className={cn(
              'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
