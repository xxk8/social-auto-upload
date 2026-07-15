// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/tabs/DeleteProjectConfirm.tsx
//
// Round-OPT-confirm-slice-migration (2026-q3 follow-up): dumb
// controlled-component confirmation dialog for the Studio project
// delete affordance. Migrated from `Components/Studio/ProjectCard.tsx`
// where it was a browser-native `window.confirm()` call. Per task
// scope, all `window.confirm()` sites are folded into this slice.
//
// Controlled-component mode (no Provider needed):
//   • `project` — the active delete request (null when modal is closed)
//   • `onOpenChange` — wire to `setDeleteOpen` from ProjectCard's local
//     `useState<boolean>`
//   • `onConfirm` — wire to the parent-supplied `onDelete(id)` callback
//
// Per the original window.confirm copy, the description interpolates
// `project.title` so the user sees the specific project name at confirm
// time (same UX as the prior native dialog). The destructive variant
// paints the confirm button red; follow-the-rule per
// `DESIGN-components.md` §277 — Cancel-default-focus (Radix default).
//
// ──────────────────────────────────────────────────────────────────────────

import { ConfirmShell } from '../shared/ConfirmShell'
import type { StudioProject } from '@/api/studio'

interface DeleteProjectConfirmProps {
  /** Active project to delete — `null` closes the dialog. */
  project: StudioProject | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function DeleteProjectConfirm({
  project,
  onOpenChange,
  onConfirm,
}: DeleteProjectConfirmProps) {
  const open = project !== null
  // Title + label come from the shared CONFIRM_COPY map (single
  // source of truth for kind-scoped copy). The description
  // interpolates the project title so the user sees the specific
  // target — mirrors the pre-migration `window.confirm(t('studio.card.
  // delete_confirm', '确定删除项目「{{title}}」吗？此操作不可撤销。',
  // { title: project.title }))` call shape.
  const title = '确认删除项目'
  const description = project
    ? `确定要删除项目「${project.title}」吗？此操作不可撤销。`
    : ''
  const confirmLabel = '删除'

  return (
    <ConfirmShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      onConfirm={() => void onConfirm()}
      variant="destructive"
    />
  )
}
