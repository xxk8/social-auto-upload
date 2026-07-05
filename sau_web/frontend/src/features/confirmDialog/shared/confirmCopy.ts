// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/shared/confirmCopy.ts
//
// Round-OPT-prefs-dialog v6 polish (reviewer bullet 3): single source
// of truth for the per-kind destructive-confirm copy. Before this
// extraction, the strings lived in 3 places:
//   • ConfirmDialog.tsx::describeRequest() (Provider-mode rendering)
//   • DeleteApiKeyConfirm.tsx (controlled-mode 'all' / 'single' / 'history' branches)
//   • DeleteHistoryEntryConfirm.tsx (controlled-mode 'history' hardcoded copy)
// A future copy change (e.g. 确认删除 → 删除确认, or 'AI 功能' → 'AI 助手
// 功能') risked drift across those 3 sites. This map centralizes the
// per-kind copy so a future PR lands ONCE.
//
// The per-sub-kind `deleteApiKey` branches ('all' / 'single' /
// 'history') get their own nested map because the destructure in
// AiSidebar's translation passes a `target.type` discriminator, not
// the full `ConfirmRequest` shape — separating the two shapes here
// means both call sites can read directly without an intermediate
// `<ConfirmRequest>` adapter.
// ──────────────────────────────────────────────────────────────────────────

import type { ConfirmKind } from '../ConfirmDialogProvider.helpers'

export interface ConfirmCopyEntry {
  title: string
  description: string
  confirmLabel: string
}

/** Map `kind: 'deleteApiKey'` × `target.type: 'all'|'single'|'history'`
 * → copy entry. Index directly via CONFIRM_COPY.deleteApiKey[type]. */
const DELETE_API_KEY_COPY: Record<
  'all' | 'single' | 'history',
  ConfirmCopyEntry
> = {
  all: {
    title: '确认删除',
    description: '确定要删除全部 API Key 吗？删除后将无法使用 AI 功能。',
    confirmLabel: '确认',
  },
  single: {
    title: '确认删除',
    description: '确定要删除这个 API Key 吗？',
    confirmLabel: '确认',
  },
  history: {
    title: '确认删除',
    description: '确定要删除这条历史记录吗？',
    confirmLabel: '确认',
  },
}

/** Map `<ConfirmKind>` → copy entry. `deleteApiKey` is a sub-map; the
 * other kinds are flat objects. The discriminated shape means call
 * sites handle each kind differently — flat kinds read
 * `CONFIRM_COPY[kind]` directly, sub-kinds read
 * `CONFIRM_COPY.deleteApiKey[type]`. */
export const CONFIRM_COPY = {
  deleteApiKey: DELETE_API_KEY_COPY,
  deleteHistoryEntry: {
    title: '确认删除历史记录',
    description:
      '此操作将从本地历史记录中移除该条目，未来无法再次引用。',
    confirmLabel: '删除',
  },
  // ── Batch-delete-groups entry (round-OPT-prefs-dialog v7 migration) ──
  // The dumb `BatchDeleteGroupConfirm` tab renders a rich JSX body
  // (selectedCount + authCount + preview list + Cmd/Ctrl+Enter hint)
  // computed INLINE from the `{ selectedIds, groups }` props, so this
  // entry is the title + base confirmLabel ONLY — the rich body is
  // drawn at the call site. The `description` slot is a grep-friendly
  // human fallback for any future provider-mode `kind: 'deleteGroup'`
  // routing through `<ConfirmDialog />` composite; the dumb mount at
  // DialogHost does NOT read it (it composes its own JSX).
  deleteGroup: {
    title: '确认批量删除',
    description:
      '将删除选中的分组并清空其关联平台授权。此操作不可恢复。',
    confirmLabel: '删除',
  },
} as const satisfies Record<ConfirmKind, ConfirmCopyEntry | Record<string, ConfirmCopyEntry>>
