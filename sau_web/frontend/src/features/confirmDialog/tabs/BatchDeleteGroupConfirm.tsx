// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/tabs/BatchDeleteGroupConfirm.tsx
//
// Dumb confirm tab — decoupled from the accounts slice. The dialog
// body accepts pure props (selectedIds + groups + open + onOpenChange
// + onConfirm), so it lives in this slice alongside the other two
// tabs while Page-level state stays in AccountsProvider / DialogHost.
//
// Props (all caller-owned):
//   • selectedIds   — selection set; empty drives the no-selection body
//   • groups        — list of `GroupSummary` records (structural type;
//                     only `id` + `name` + `authorizations.length` are
//                     read here)
//   • open          — caller-owned boolean
//   • onOpenChange  — caller-owned close trigger
//   • onConfirm     — caller-owned dispatch (click + Cmd/Ctrl+Enter
//                     hotkey both route here)
//
// Rich JSX body (selectedCount + authCount + preview list +
// Cmd/Ctrl+Enter kbd hint) is composed inline because these are
// specifically-batch-delete-groups affordances — the other two
// confirm tabs read flat strings from CONFIRM_COPY because their
// bodies don't need a per-item preview. The shared AlertDialog
// shell (<ConfirmShell />) unifies the three variants; the rich
// preview is per-kind additive chrome.
// ──────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import { ConfirmShell } from '../shared/ConfirmShell'
import { CONFIRM_COPY } from '../shared/confirmCopy'

const MAX_NAMES_SHOWN = 3

/** Structural minimal shape — readable from any group record the
 *  caller owns (account slice, task slice, future trash-bin flow).
 *  Only `id` + `name` + `authorizations.length` are read by this
 *  dumb dialog; the rest is opaque.
 *
 *  `authorizations: ArrayLike<unknown>` keeps the structural minimum
 *  explicit: any indexed element is `unknown` (so e.g.
 *  `PlatformAuthorization[]` is assignable at the mount boundary)
 *  but indexed access is forbidden inside this dumb body — the only
 *  field read is `.length`. Tighter alternatives like
 *  `ReadonlyArray<{ length: number }>` would break the cast compat
 *  (PlatformAuthorization doesn't carry a `.length` field). */
export interface GroupSummary {
  readonly id: string
  readonly name: string
  readonly authorizations: ArrayLike<unknown>
}

interface BatchDeleteGroupConfirmProps {
  /** Selection set in the caller — empty set renders the modal with
   *  a no-selection state (still safe; the confirm button is
   *  disabled by the dispatch path elsewhere). */
  selectedIds: ReadonlySet<string>
  /** Full group list — the dialog indexes this list by ID to
   *  resolve the selected subset into displayable metadata. */
  groups: ReadonlyArray<GroupSummary>
  /** Open / close state in the caller. */
  open: boolean
  /** Cancel + close-icon wires to this; the dialog itself doesn't
   *  own a state machine, just forwards the boolean back. */
  onOpenChange: (open: boolean) => void
  /** Confirm-click + Cmd/Ctrl+Enter hot-key both call this once.
   *  Caller decides what the dispatch path looks like (typically
   *  `() => void dispatch.handleBatchDelete()`). */
  onConfirm: () => void | Promise<void>
}

export function BatchDeleteGroupConfirm({
  selectedIds,
  groups,
  open,
  onOpenChange,
  onConfirm,
}: BatchDeleteGroupConfirmProps) {
  /* Resolve the selection-set into a stable slice of displayable
   * metadata. Memoized against the actual inputs (re-deriving on
   * every external re-render — e.g. role UI updates after a
   * selectedId changes — would be wasteful). */
  const { previewNames, hiddenCount, totalAuthCount, selectedCount } =
    useMemo(() => {
      if (selectedIds.size === 0) {
        return {
          previewNames: [],
          hiddenCount: 0,
          totalAuthCount: 0,
          selectedCount: 0,
        }
      }
      const matched = Array.from(selectedIds)
        .map((id) => groups.find((g) => g.id === id))
        .filter((g): g is GroupSummary => Boolean(g))
      const names = matched.map((g) => g.name)
      const authCount = matched.reduce(
        (s, g) => s + g.authorizations.length,
        0,
      )
      return {
        previewNames: names.slice(0, MAX_NAMES_SHOWN),
        hiddenCount: Math.max(0, names.length - MAX_NAMES_SHOWN),
        totalAuthCount: authCount,
        selectedCount: selectedIds.size,
      }
    }, [selectedIds, groups])

  /* Wrapped version used by both the click handler and the kbd
   * shortcut — `void` discards the returned promise silently so the
   * `Promise<void>` return type matches what callers typically pass
   * (`() => void dispatch.handleBatchDelete()` already swallows the
   * promise). */
  const handleConfirm = () => void onConfirm()

  return (
    <ConfirmShell
      open={open}
      onOpenChange={onOpenChange}
      title={CONFIRM_COPY.deleteGroup.title}
      /* Rich JSX description (overrides the base string in
       * CONFIRM_COPY.deleteGroup.description). The shared shell
       * renders this through `<AlertDialogDescription>` so screen
       * readers still announce the dialog title + description as a
       * single aria-describedby unit; the inner JSX is decorative
       * text content. */
      description={
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            将删除以下{' '}
            <span className="font-medium text-foreground">
              {selectedCount}
            </span>{' '}
            个分组，并同时清空{' '}
            {totalAuthCount > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {totalAuthCount}
                </span>{' '}
                项平台授权
              </>
            ) : (
              <span className="text-foreground/80">
                所有关联平台授权（暂无）
              </span>
            )}
            。
          </p>
          {previewNames.length > 0 && (
            <ul className="text-[12px] space-y-0.5 pl-1">
              {previewNames.map((name) => (
                <li
                  key={name}
                  className="truncate text-foreground/80"
                >
                  · {name}
                </li>
              ))}
              {hiddenCount > 0 && (
                <li className="text-muted-foreground/60">
                  …其它 {hiddenCount} 个
                </li>
              )}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground/60 pt-1">
            提示：按{' '}
            <kbd className="kbd-hint mr-1">⌘</kbd>
            <kbd className="kbd-hint">Enter</kbd> 直接确认
          </p>
        </div>
      }
      /* Dynamic confirm label — base verb from CONFIRM_COPY +
       * selectedCount tail for at-a-glance scope. The dumb body
       * computes the count inline because the value depends on a
       * prop (selectedIds.size), not on CONFIRM_COPY. */
      confirmLabel={`${CONFIRM_COPY.deleteGroup.confirmLabel} ${selectedCount} 个分组`}
      onConfirm={handleConfirm}
      variant="destructive"
      /* Cmd/Ctrl+Enter to confirm without lifting hands off the
       * keyboard — shared shell scopes the keydown to the open
       * dialog content (Radix unmounts on close), and the `!repeat`
       * guard prevents a held key from re-firing into the closed
       * dialog. Same affordance as the original inline dialog. */
      hotkeyConfirm
    />
  )
}
