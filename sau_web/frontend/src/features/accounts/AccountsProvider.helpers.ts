// ──────────────────────────────────────────────────────────────────────────
// accounts/AccountsProvider.helpers.ts — `react-refresh/only-export-components`
// allow-list.
//
// Companion to `accounts/AccountsProvider.tsx`. The original exported three
// value-level non-component functions plus several type-only exports and a
// pair of React contexts; the value-level exports broke Fast Refresh. The
// hooks (`useAccountsState`, `useAccountsDispatch`) and validation function
// (`validateGroupName`) live here alongside the user-facing types and the
// two React contexts those hooks consume.
//
// The trimmed `AccountsProvider.tsx` keeps only the `<AccountsProvider>`
// component itself plus its server / local state machinery. It imports the
// contexts/types/validation helper back from this file. Consumers split:
//   - `<AccountsProvider>` from `@/features/accounts/AccountsProvider`
//   - hooks / types / contexts / `validateGroupName` from
//     `@/features/accounts/AccountsProvider.helpers`
// ──────────────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react'
import type { AccountGroup } from '@/api/client'

// ── Group-name validation (mirrors backend `_validate_group_name`) ────────
// OPT-follow-up-3-sweep-2: this regex was previously module-private to
// AccountsProvider.tsx. It mirrors the backend `_validate_group_name`
// validator and intentionally covers ASCII control characters (NUL..US +
// DEL). ESLint's `no-control-regex` flag is waived here because the
// control range is the contract, not an oversight.
// eslint-disable-next-line no-control-regex
const _FORBIDDEN_NAME_RE = /[/\\:*?"<>|\x00-\x1F\x7F]/
const _NAME_MAX_LEN = 64

export type GroupNameValidation =
  | { ok: true; cleaned: string }
  | { ok: false; message: string }

export function validateGroupName(value: unknown): GroupNameValidation {
  if (typeof value !== 'string') return { ok: false, message: '分组名不能为空' }
  const cleaned = value.trim()
  if (!cleaned) return { ok: false, message: '分组名不能为空' }
  if (cleaned.length > _NAME_MAX_LEN) {
    return { ok: false, message: `分组名长度不能超过 ${_NAME_MAX_LEN} 个字符` }
  }
  if (_FORBIDDEN_NAME_RE.test(cleaned)) {
    return { ok: false, message: '分组名包含不允许的字符（/\\:*?"<>|）' }
  }
  return { ok: true, cleaned }
}

// ── Drag-end event shape used by GroupGridArea + SortableAuthorizationItem ─
export type DragEndEvent = {
  operation: {
    target: { id: string | number } | null
    source: { id: string | number } | null
  }
}

// ── State context (values that change on render / server updates) ────────
// NOTE: React Query useMutation objects are intentionally NOT passed
// through context — they return new object identities on every render,
// which destabilises useMemo deps and triggers "Maximum update depth
// exceeded".  Instead we expose only the primitive isPending flags that
// consumers need for loading spinners / button-disabled state.
export type AccountsState = {
  groups: AccountGroup[]
  isLoading: boolean
  refetch: () => void

  isCreatePending: boolean
  isRenamePending: boolean
  isReorderInFlight: boolean

  localGroups: AccountGroup[]
  filteredGroups: AccountGroup[]

  searchQuery: string
  validityFilter: 'all' | 'valid' | 'invalid'
  viewMode: 'grid' | 'list'
  selectedIds: Set<number>

  newGroupName: string
  createDialogOpen: boolean
  batchDeleteOpen: boolean
  authorizeDialogOpen: boolean
  renameDialogOpen: boolean
  renameDialogGroupId: number | null
  renameDialogCurrentName: string
  selectedGroupId: number | null
  selectedPlatform: string
  loginModalOpen: boolean

  isCheckingStatus: boolean
}

// ── Dispatch context ─────────────────────────────────────────────────────
export type AccountsDispatch = {
  setSearchQuery: (q: string) => void
  setValidityFilter: (f: 'all' | 'valid' | 'invalid') => void
  setViewMode: (m: 'grid' | 'list') => void
  setSelectedIds: (s: Set<number>) => void
  setNewGroupName: (n: string) => void
  setCreateDialogOpen: (o: boolean) => void
  setBatchDeleteOpen: (o: boolean) => void
  setAuthorizeDialogOpen: (o: boolean) => void
  setSelectedPlatform: (p: string) => void
  setLoginModalOpen: (o: boolean) => void
  setRenameDialogOpen: (o: boolean) => void

  handleDragStart: () => void
  handleDragEnd: (event: DragEndEvent) => void

  hoverTargetGroupId: number | null

  handleSelectGroup: (id: number, checked: boolean) => void
  handleSelectAll: () => void
  handleBatchDelete: () => Promise<void>
  handleCreateGroup: () => Promise<void>
  handleDeleteGroup: (groupId: number, name: string) => Promise<void>
  handleStartRename: (groupId: number, currentName: string) => void
  handleRename: (groupId: number, newName: string) => Promise<void>
  handleStartAuthorize: (groupId: number) => void
  handleReauthorize: (groupId: number, platform: string) => void
  handleAuthorize: () => void
  handleRemoveAuth: (groupId: number, platform: string) => Promise<void>
  handleClearSearch: () => void
  handleCheckAllStatus: () => Promise<void>

  getPlatformLabel: (value: string) => string
}

export const AccountsStateCtx = createContext<AccountsState | null>(null)
export const AccountsDispatchCtx = createContext<AccountsDispatch | null>(null)

export function useAccountsState(): AccountsState {
  const ctx = useContext(AccountsStateCtx)
  if (!ctx) throw new Error('useAccountsState must be used inside <AccountsProvider>')
  return ctx
}

export function useAccountsDispatch(): AccountsDispatch {
  const ctx = useContext(AccountsDispatchCtx)
  if (!ctx) throw new Error('useAccountsDispatch must be used inside <AccountsProvider>')
  return ctx
}

// ── Body context (routing-translated snapshot for AccountsBody) ────────
// AccountsShell bundles `{ state, dispatch, navigation }` into ONE ctx
// so AccountsBody reads a single context object instead of two throwing
// hooks + a router hook. Tests stub this ctx via a plain React context
// provider — `AccountsBody.test.tsx` no longer needs to vi.mock the
// throwing-hook module path, which was the root cause of the 7
// AccountsPage.test.tsx failures (`useAccountsState must be used inside
// <AccountsProvider>` thrown from the helpers-path hooks, which the
// test's barrel-path vi.mock did not intercept).
//
// The navigation callbacks live in the ctx value rather than as
// AccountsBody props so the entire data surface stays behind a single
// React context. AccountsShell is the only thing that calls
// `useNavigate()`; the body never touches the router.
export type AccountsBodyContextValue = {
  state: AccountsState
  dispatch: AccountsDispatch
  navigation: {
    onOpenTasks: () => void
    onOpenPublish: () => void
  }
}
export const AccountsBodyCtx = createContext<AccountsBodyContextValue | null>(null)
export function useAccountsBody(): AccountsBodyContextValue {
  const ctx = useContext(AccountsBodyCtx)
  if (!ctx) throw new Error('useAccountsBody must be used inside <AccountsShell>')
  return ctx
}
