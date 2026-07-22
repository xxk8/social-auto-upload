// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/shared/ConfirmShell.tsx
//
// Shared AlertDialog shell — extracted from the prior inline pattern
// repeated in AiSidebar.tsx + TaskBatchActions.tsx + SortableGroup.tsx
// + GroupListItem.tsx + TaskTableRow.tsx. Each of those inline
// AlertDialogs renders the same 4-piece layout: <Header /> (title +
// description slot) + <Footer /> (cancel button + destructive-styled
// confirm button). Centralizing here means a future styling change
// (e.g. amber-tinged destructive chip) lands once and inherits in all
// caller sites; before this slice extracted, each inline AlertDialog
// was its own SNAPSHOT of the same style.
//
// Usage:
//   <ConfirmShell
//     open={open}
//     onOpenChange={onOpenChange}
//     title="确认删除"
//     description="确定要删除这条历史记录吗？"
//     confirmLabel="删除"
//     onConfirm={onConfirm}
//     variant="destructive"
//   />
// ──────────────────────────────────────────────────────────────────────────

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

interface ConfirmShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Optional React node — supports both string copy and richer JSX
   * (e.g. inline lists, nested metadata). */
  description?: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  /** 'destructive' paints the confirm button red (delete flows).
   * 'default' leaves it as the primary CTAs (confirm approvals). */
  variant?: 'destructive' | 'default'
  /** Optional Cmd/Ctrl+Enter hot-key, scoped to the dialog content.
   * Mirrors the BatchDeleteDialog shortcut; default omits the handler
   * since most trigger sites don't want global hot-key hijacking. */
  hotkeyConfirm?: boolean
}

export function ConfirmShell({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = 'default',
  hotkeyConfirm = false,
}: ConfirmShellProps) {
  const handleKeyDown = hotkeyConfirm
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.repeat) {
          e.preventDefault()
          onConfirm()
        }
      }
    : undefined

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onKeyDown={handleKeyDown}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              variant === 'destructive' &&
                'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
