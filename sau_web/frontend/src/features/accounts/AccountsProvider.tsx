/* eslint-disable react-refresh/only-export-components */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { arrayMove } from '@dnd-kit/helpers'
import { useDragDropMonitor } from '@dnd-kit/react'
import { useToast } from '@/Components/ui/toast'
import { resolveSoftPrompt } from '@/lib/softError'
export { useAccountsState, useAccountsDispatch, validateGroupName } from './AccountsProvider.helpers'
import { api, PLATFORMS, type AccountGroup } from '@/api/client'
import {
  useAccountGroups,
  useCreateAccountGroup,
  useDeleteAccountGroup,
  useMoveAuthorization,
  useRemoveAuthorization,
  useReorderAccountGroups,
  useReorderAuthorizations,
  useRenameAccountGroup,
} from '@/hooks/useAccountGroups'
import {
  validateGroupName,
  AccountsStateCtx,
  AccountsDispatchCtx,
  type AccountsState,
  type AccountsDispatch,
  type DragEndEvent,
} from './AccountsProvider.helpers'

// ── Drag-end id prefixes — discriminates group vs auth drags under one
//    single-root DragDropProvider.
const GROUP_ID_PREFIX = 'group:'
const AUTH_ID_PREFIX = 'auth:'

// OPT-follow-up-3-sweep-2: `validateGroupName`, `GroupNameValidation`,
// `useAccountsState`, `useAccountsDispatch`, the `AccountsState` /
// `AccountsDispatch` / `DragEndEvent` types, the `AccountsStateCtx` /
// `AccountsDispatchCtx` React context objects, and the local
// `_FORBIDDEN_NAME_RE` / `_NAME_MAX_LEN` consts moved to
// `./AccountsProvider.helpers.ts`. This file's only remaining top-level
// export is the `<AccountsProvider>` component.

const _EMPTY_GROUPS: AccountGroup[] = []

// Minimal structural subset for `checkAllAccounts` — backend populates
// `quick.{valid,stale,reason,age_hours,file_size}` per test fixture.
type AccountQuickCheck = { quick?: { valid?: boolean; stale?: boolean } }

export function AccountsProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast()

  // ── server ──
  const { data: groups = _EMPTY_GROUPS, isLoading, refetch } = useAccountGroups()
  const createGroup = useCreateAccountGroup()
  const deleteGroup = useDeleteAccountGroup()
  const renameGroup = useRenameAccountGroup()
  const removeAuth = useRemoveAuthorization()
  const reorderGroups = useReorderAccountGroups()
  const reorderAuths = useReorderAuthorizations()
  const moveAuth = useMoveAuthorization()

  // ── local/dialog UI state ──
  const [newGroupName, setNewGroupName] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [authorizeDialogOpen, setAuthorizeDialogOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameDialogGroupId, setRenameDialogGroupId] = useState<number | null>(null)
  const [renameDialogCurrentName, setRenameDialogCurrentName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [validityFilter, setValidityFilter] = useState<'all' | 'valid' | 'invalid'>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [hoverTargetGroupId, setHoverTargetGroupId] = useState<number | null>(null)

  // ── optimistic local copy of server data; drag guard prevents mid-drag clobbers ──
  const isDraggingRef = useRef(false)
  const [localGroups, setLocalGroups] = useState<AccountGroup[]>(groups)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalGroups(groups)
    }
  }, [groups])

  // ── ref-mirrors so dispatch handlers can read latest state WITHOUT
  //    capturing the state in useCallback deps (keeps dispatch identity
  //    stable across state updates). Same trick mirrored for the
  //    react-query mutation objects — their identity changes whenever
  //    isPending toggles, so handlers must NOT close over them directly.
  const localGroupsRef = useRef(localGroups)
  useEffect(() => {
    localGroupsRef.current = localGroups
  }, [localGroups])
  const filteredGroupsRef = useRef<AccountGroup[]>([])
  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])
  const groupsRef = useRef(groups)
  useEffect(() => {
    groupsRef.current = groups
  }, [groups])
  const newGroupNameRef = useRef(newGroupName)
  useEffect(() => {
    newGroupNameRef.current = newGroupName
  }, [newGroupName])
  const selectedGroupIdRef = useRef(selectedGroupId)
  useEffect(() => {
    selectedGroupIdRef.current = selectedGroupId
  }, [selectedGroupId])
  const selectedPlatformRef = useRef(selectedPlatform)
  useEffect(() => {
    selectedPlatformRef.current = selectedPlatform
  }, [selectedPlatform])

  // mutation refs — capture the live mutate functions on every render so
  // stable handlers can call them without keeping mutation objects in deps.
  const createMutateAsyncRef = useRef(createGroup.mutateAsync)
  useEffect(() => {
    createMutateAsyncRef.current = createGroup.mutateAsync
  }, [createGroup.mutateAsync])
  const deleteMutateAsyncRef = useRef(deleteGroup.mutateAsync)
  useEffect(() => {
    deleteMutateAsyncRef.current = deleteGroup.mutateAsync
  }, [deleteGroup.mutateAsync])
  const renameMutateAsyncRef = useRef(renameGroup.mutateAsync)
  useEffect(() => {
    renameMutateAsyncRef.current = renameGroup.mutateAsync
  }, [renameGroup.mutateAsync])
  const removeAuthMutateAsyncRef = useRef(removeAuth.mutateAsync)
  useEffect(() => {
    removeAuthMutateAsyncRef.current = removeAuth.mutateAsync
  }, [removeAuth.mutateAsync])
  const reorderMutateRef = useRef(reorderGroups.mutate)
  useEffect(() => {
    reorderMutateRef.current = reorderGroups.mutate
  }, [reorderGroups.mutate])
  const reorderAuthsMutateRef = useRef(reorderAuths.mutate)
  useEffect(() => {
    reorderAuthsMutateRef.current = reorderAuths.mutate
  }, [reorderAuths.mutate])
  const moveAuthMutateAsyncRef = useRef(moveAuth.mutateAsync)
  useEffect(() => {
    moveAuthMutateAsyncRef.current = moveAuth.mutateAsync
  }, [moveAuth.mutateAsync])
  const refetchRef = useRef(refetch)
  useEffect(() => {
    refetchRef.current = refetch
  }, [refetch])

  const isReorderInFlight = reorderGroups.isPending || reorderAuths.isPending || moveAuth.isPending

  // ── drag-hover tracking for cross-group move visual feedback ──
  useDragDropMonitor({
    onDragOver({ operation }) {
      const { source, target } = operation
      if (!source || !target) {
        setHoverTargetGroupId(null)
        return
      }
      const sourceId = String(source.id)
      const targetId = String(target.id)
      if (sourceId.startsWith(AUTH_ID_PREFIX) && targetId.startsWith(GROUP_ID_PREFIX)) {
        const targetGroupId = Number(targetId.slice(GROUP_ID_PREFIX.length))
        const sourceGroupId = Number(sourceId.split(':')[1])
        setHoverTargetGroupId(targetGroupId !== sourceGroupId ? targetGroupId : null)
      } else {
        setHoverTargetGroupId(null)
      }
    },
    onDragEnd() {
      setHoverTargetGroupId(null)
    },
  })

  // ── stable platform-label helper (MUST be defined before filteredGroups
  //     useMemo to avoid Temporal Dead Zone access).
  const getPlatformLabel = useCallback(
    (value: string) => PLATFORMS.find((p) => p.value === value)?.label ?? value,
    [],
  )

  // Belt-and-braces: validityFilter is held in a useState typed as the
  // narrow union 'all' | 'valid' | 'invalid', but if a future migration
  // widens the type or an older saved value is replayed, we want a safe
  // fallback rather than a silent miss.
  const safeValidityFilter: 'all' | 'valid' | 'invalid' =
    validityFilter === 'valid' || validityFilter === 'invalid'
      ? validityFilter
      : 'all'

  // ── derived: filteredGroups ───────────────────────────────────────
  // Pipeline: localGroups → safeValidityFilter → searchQuery trim+match.
  // Validity filter runs first so an empty group with zero auths is hidden
  // from both 有效 and 失效 views (only groups with at least one all-valid
  // auth qualify for 有效; only groups containing an invalid auth qualify
  // for 失效 — empty groups have neither and so live only in 全部).
  // Magic-string 有效/失效 search-keyword matching was removed; the toolbar
  // exposes this as a segmented control so the contract is explicit.
  const filteredGroups = useMemo(() => {
    let result = localGroups
    if (safeValidityFilter === 'valid') {
      result = result.filter(
        (g) => g.authorizations.length > 0 && g.authorizations.every((a) => a.valid && !a.stale),
      )
    } else if (safeValidityFilter === 'invalid') {
      result = result.filter((g) => g.authorizations.some((a) => !a.valid || a.stale))
    }

    const query = searchQuery.trim().toLowerCase()
    if (!query) return result
    return result.filter((group) => {
      const nameMatch = group.name.toLowerCase().includes(query)
      const platformMatch = group.authorizations.some(
        (auth) =>
          auth.platform.toLowerCase().includes(query) ||
          getPlatformLabel(auth.platform).toLowerCase().includes(query),
      )
      return nameMatch || platformMatch
    })
  }, [localGroups, searchQuery, safeValidityFilter, getPlatformLabel])
  useEffect(() => {
    filteredGroupsRef.current = filteredGroups
  }, [filteredGroups])

  // ── dnd handlers ──
  // Optimistic mutate-first-then-callback. The onError path fires a
  // refetch; the server→local useEffect then clobbers any stuck optimistic
  // order. stable deps (`[]` or just `addToast`) keep identity stable.
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false
      const { target, source } = event.operation
      if (!target || !source) return

      const sourceId = String(source.id)
      const targetId = String(target.id)
      const snapshot = localGroupsRef.current

      // Group reorder branch: `group:<id>` on both sides.
      if (
        sourceId.startsWith(GROUP_ID_PREFIX) &&
        targetId.startsWith(GROUP_ID_PREFIX)
      ) {
        const sourceGroupId = Number(sourceId.slice(GROUP_ID_PREFIX.length))
        const targetGroupId = Number(targetId.slice(GROUP_ID_PREFIX.length))
        const sourceIndex = snapshot.findIndex((g) => g.id === sourceGroupId)
        const targetIndex = snapshot.findIndex((g) => g.id === targetGroupId)
        if (
          sourceIndex === -1 ||
          targetIndex === -1 ||
          sourceIndex === targetIndex
        ) {
          return
        }
        const newGroups = arrayMove(snapshot, sourceIndex, targetIndex)
        setLocalGroups(newGroups)
        reorderMutateRef.current(newGroups.map((g) => g.id), {
          onError: () => {
            addToast('保存顺序失败，正在恢复…', 'error')
            refetchRef.current()
          },
        })
        return
      }

      // Auth reorder branch: `auth:<groupId>:<authId>` on both sides.
      // Cross-group move: auth dropped on a group card.
      if (sourceId.startsWith(AUTH_ID_PREFIX)) {
        const [, srcGroupRaw, srcAuthRaw] = sourceId.split(':')
        const sourceGroupId = Number(srcGroupRaw)
        const sourceAuthId = Number(srcAuthRaw)

        // Cross-group move: target is a group.
        if (targetId.startsWith(GROUP_ID_PREFIX)) {
          const targetGroupId = Number(targetId.slice(GROUP_ID_PREFIX.length))
          if (sourceGroupId === targetGroupId) return
          const sourceGroup = snapshot.find((g) => g.id === sourceGroupId)
          if (!sourceGroup) return
          const auth = sourceGroup.authorizations.find((a) => a.id === sourceAuthId)
          if (!auth) return
          const targetGroup = snapshot.find((g) => g.id === targetGroupId)
          if (!targetGroup) return
          if (targetGroup.authorizations.some((a) => a.platform === auth.platform)) {
            addToast(`目标分组已包含 ${auth.platform}`, 'warning')
            return
          }
          setLocalGroups((prev) =>
            prev.map((g) => {
              if (g.id === sourceGroupId) {
                return { ...g, authorizations: g.authorizations.filter((a) => a.id !== sourceAuthId) }
              }
              if (g.id === targetGroupId) {
                return { ...g, authorizations: [...g.authorizations, auth] }
              }
              return g
            }),
          )
          moveAuthMutateAsyncRef.current(
            { fromGroupId: sourceGroupId, toGroupId: targetGroupId, platform: auth.platform },
            {
              onError: () => {
                addToast('移动授权失败，正在恢复…', 'error')
                refetchRef.current()
              },
            },
          )
          return
        }

        // Same-group reorder: target is another auth.
        if (targetId.startsWith(AUTH_ID_PREFIX)) {
          const [, tgtGroupRaw, tgtAuthRaw] = targetId.split(':')
          const targetGroupId = Number(tgtGroupRaw)
          const targetAuthId = Number(tgtAuthRaw)
          if (sourceGroupId !== targetGroupId) return
          const groupIdx = snapshot.findIndex((g) => g.id === sourceGroupId)
          if (groupIdx === -1) return
          const authList = snapshot[groupIdx].authorizations
          const sourceIndex = authList.findIndex((a) => a.id === sourceAuthId)
          const targetIndex = authList.findIndex((a) => a.id === targetAuthId)
          if (
            sourceIndex === -1 ||
            targetIndex === -1 ||
            sourceIndex === targetIndex
          ) {
            return
          }
          const newAuths = arrayMove(authList, sourceIndex, targetIndex)
          setLocalGroups((prev) =>
            prev.map((g) =>
              g.id === sourceGroupId ? { ...g, authorizations: newAuths } : g,
            ),
          )
          reorderAuthsMutateRef.current(
            { groupId: sourceGroupId, authIds: newAuths.map((a) => a.id) },
            {
              onError: () => {
                addToast('保存顺序失败，正在恢复…', 'error')
                refetchRef.current()
              },
            },
          )
        }
      }
    },
    [addToast],
  )

  // ── selection handlers (refs only — stable identity) ──
  const handleSelectGroup = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const filtered = filteredGroupsRef.current
    const current = selectedIdsRef.current
    if (current.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((g) => g.id)))
    }
  }, [])

  // ── batch / create / delete / rename / remove-auth handlers — all
  //    stable; they read mutate fns via refs and capture `addToast`
  //    only by reference. addToast identity is stable (useToast wraps
  //    it in useCallback per toast.tsx line 46).
  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedIdsRef.current)
    const count = ids.length
    const settled = await Promise.allSettled(
      ids.map((id) => deleteMutateAsyncRef.current(id)),
    )
    const failed = settled.filter((r) => {
      if (r.status === 'rejected') return true
      return r.value?.success === false
    })
    const succeeded = count - failed.length

    setSelectedIds(new Set())
    setBatchDeleteOpen(false)

    if (failed.length === 0) {
      addToast(`已删除 ${count} 个分组`, 'success')
    } else if (succeeded === 0) {
      addToast(`${failed.length} 个分组删除失败`, 'error')
    } else {
      addToast(
        `成功删除 ${succeeded}/${count} 个分组，${failed.length} 个失败`,
        'warning',
      )
    }
  }, [addToast])

  const handleCreateGroup = useCallback(async () => {
    const trimmed = newGroupNameRef.current.trim()
    if (!trimmed) {
      addToast('请输入账号分组名称', 'warning')
      return
    }
    try {
      const result = await createMutateAsyncRef.current(trimmed)
      if (result.success) {
        addToast(`分组 "${trimmed}" 创建成功`, 'success')
        setNewGroupName('')
        setCreateDialogOpen(false)
      } else {
        const { message, tone } = resolveSoftPrompt(result.message, '创建失败', { status: 409, verb: 'add' })
        addToast(message, tone)
      }
    } catch {
      addToast('创建请求失败', 'error')
    }
  }, [addToast])

  const handleDeleteGroup = useCallback(
    async (groupId: number, name: string) => {
      try {
        const result = await deleteMutateAsyncRef.current(groupId)
        if (result.success) {
          addToast(`分组 "${name}" 已删除`, 'success')
        } else {
          const { message, tone } = resolveSoftPrompt(result.message, '删除失败', { status: 404, verb: 'delete' })
          addToast(message, tone)
        }
      } catch {
        addToast('删除请求失败', 'error')
      }
    },
    [addToast],
  )

  const handleStartRename = useCallback((groupId: number, currentName: string) => {
    setRenameDialogGroupId(groupId)
    setRenameDialogCurrentName(currentName)
    setRenameDialogOpen(true)
  }, [])

  const handleRename = useCallback(
    async (groupId: number, newName: string) => {
      const v = validateGroupName(newName)
      if (!v.ok) {
        addToast(v.message, 'warning')
        return
      }
      try {
        const result = await renameMutateAsyncRef.current({
          groupId,
          name: v.cleaned,
        })
        if (result.success) {
          addToast(`分组已重命名为 "${v.cleaned}"`, 'success')
          setRenameDialogOpen(false)
          setRenameDialogGroupId(null)
          setRenameDialogCurrentName('')
        } else {
          const { message, tone } = resolveSoftPrompt(result.message, '重命名失败', { status: 409, verb: 'update' })
          addToast(message, tone)
        }
      } catch {
        addToast('重命名请求失败', 'error')
      }
    },
    [addToast],
  )

  const handleStartAuthorize = useCallback((groupId: number) => {
    setSelectedGroupId(groupId)
    setSelectedPlatform('')
    setAuthorizeDialogOpen(true)
  }, [])

  // ── re-scan / re-authorize: skip the platform-picker dialog ──
  // Used by the per-row "重新扫码" menu item in SortableAuthorizationItem
  // for failed/stale authorizations. Pre-sets selectedPlatform so the
  // LoginProgressModal opens directly (no AuthorizeDialog intermediate
  // step). Same destination as handleAuthorize(), but without the
  // manual platform-pick UI round-trip — the platform is already known
  // because the cookie that's failing is tied to a specific (group,
  // platform) pair.
  const handleReauthorize = useCallback((groupId: number, platform: string) => {
    setSelectedGroupId(groupId)
    setSelectedPlatform(platform)
    setLoginModalOpen(true)
  }, [])

  // Note: refs declared above the handleAuthorize definition so the
  // hook-order lint/eslint rule is satisfied (see selectedGroupIdRef /
  // selectedPlatformRef at the top of the file).
  const handleAuthorize = useCallback(() => {
    const gid = selectedGroupIdRef.current
    const platform = selectedPlatformRef.current
    if (!gid || !platform) {
      addToast('请选择平台', 'warning')
      return
    }
    setAuthorizeDialogOpen(false)
    setLoginModalOpen(true)
  }, [addToast])

  const handleRemoveAuth = useCallback(
    async (groupId: number, platform: string) => {
      try {
        const result = await removeAuthMutateAsyncRef.current({
          groupId,
          platform,
        })
        if (result.success) {
          addToast(`已移除 ${platform} 授权`, 'success')
        } else {
          const { message, tone } = resolveSoftPrompt(result.message, '移除失败', { status: 404, verb: 'delete' })
          addToast(message, tone)
        }
      } catch {
        addToast('移除请求失败', 'error')
      }
    },
    [addToast],
  )

  const handleClearSearch = useCallback(() => setSearchQuery(''), [])

  const handleCheckAllStatus = useCallback(async () => {
    if (groupsRef.current.length === 0) return
    setIsCheckingStatus(true)
    try {
      const res = await api.checkAllAccounts()
      if (res.success && res.data) {
        const total = res.data.length
        const valid = res.data.filter((d: AccountQuickCheck) => d.quick?.valid === true).length
        const stale = res.data.filter((d: AccountQuickCheck) => d.quick?.stale === true).length
        const invalid = total - valid
        if (total === 0) {
          addToast('当前没有可检测的授权账号', 'info')
        } else if (invalid === 0 && stale === 0) {
          addToast(`已检测 ${total} 个授权，全部有效`, 'success')
        } else if (invalid === 0 && stale > 0) {
          addToast(
            `已检测 ${total} 个授权：${valid - stale} 个有效，${stale} 个 Cookie 过期，请刷新`,
            'warning',
          )
        } else {
          addToast(
            `已检测 ${total} 个授权：${valid - stale} 个有效，${stale} 个过期，${invalid} 个失效`,
            'warning',
          )
        }
        refetchRef.current()
      } else {
        addToast('检测请求失败', 'error')
      }
    } catch {
      addToast('检测请求失败，请检查后端连接', 'error')
    } finally {
      setIsCheckingStatus(false)
    }
  }, [addToast])

  // ── dispatch object — stable identity when handlers above don't churn ──
  const dispatch = useMemo<AccountsDispatch>(
    () => ({
      setSearchQuery,
      setValidityFilter,
      setViewMode,
      setSelectedIds,
      setNewGroupName,
      setCreateDialogOpen,
      setBatchDeleteOpen,
      setAuthorizeDialogOpen,
      setSelectedPlatform,
      setLoginModalOpen,
      setRenameDialogOpen,
      handleDragStart,
      handleDragEnd,
      handleSelectGroup,
      handleSelectAll,
      handleBatchDelete,
      handleCreateGroup,
      handleDeleteGroup,
      handleStartRename,
      handleRename,
      handleStartAuthorize,
      handleReauthorize,
      handleAuthorize,
      handleRemoveAuth,
      handleClearSearch,
      handleCheckAllStatus,
      getPlatformLabel,
      hoverTargetGroupId,
    }),
    [
      handleDragStart,
      handleDragEnd,
      handleSelectGroup,
      handleSelectAll,
      handleBatchDelete,
      handleCreateGroup,
      handleDeleteGroup,
      handleStartRename,
      handleRename,
      handleStartAuthorize,
      handleReauthorize,
      handleAuthorize,
      handleRemoveAuth,
      handleClearSearch,
      handleCheckAllStatus,
      getPlatformLabel,
      hoverTargetGroupId,
    ],
  )

  const state = useMemo<AccountsState>(
    () => ({
      groups,
      isLoading,
      refetch,
      isCreatePending: createGroup.isPending,
      isRenamePending: renameGroup.isPending,
      isReorderInFlight,
      localGroups,
      filteredGroups,
      searchQuery,
      validityFilter,
      viewMode,
      selectedIds,
      newGroupName,
      createDialogOpen,
      batchDeleteOpen,
      authorizeDialogOpen,
      renameDialogOpen,
      renameDialogGroupId,
      renameDialogCurrentName,
      selectedGroupId,
      selectedPlatform,
      loginModalOpen,
      isCheckingStatus,
    }),
    [
      groups,
      isLoading,
      refetch,
      createGroup.isPending,
      renameGroup.isPending,
      isReorderInFlight,
      localGroups,
      filteredGroups,
      searchQuery,
      validityFilter,
      viewMode,
      selectedIds,
      newGroupName,
      createDialogOpen,
      batchDeleteOpen,
      authorizeDialogOpen,
      renameDialogOpen,
      renameDialogGroupId,
      renameDialogCurrentName,
      selectedGroupId,
      selectedPlatform,
      loginModalOpen,
      isCheckingStatus,
    ],
  )

  return (
    <AccountsDispatchCtx.Provider value={dispatch}>
      <AccountsStateCtx.Provider value={state}>{children}</AccountsStateCtx.Provider>
    </AccountsDispatchCtx.Provider>
  )
}
