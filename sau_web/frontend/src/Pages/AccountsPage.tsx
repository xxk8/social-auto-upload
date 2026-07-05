import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/Components/ui/button'
import { EmptyState } from '@/Components/ui/empty-state'
import { PageHeader } from '@/Components/ui/page-header'
import {
  AccountsBodyCtx,
  useAccountsBody,
  useAccountsDispatch,
  useAccountsState,
  type AccountsBodyContextValue,
} from '@/features/accounts/AccountsProvider.helpers'
import { GroupGridArea } from '@/features/accounts/GroupGridArea'
import { GroupListArea } from '@/features/accounts/GroupListArea'
import { GroupToolbar } from '@/features/accounts/GroupToolbar'
import { HomepageOverview } from '@/features/accounts/HomepageOverview'
import { DialogHost } from '@/features/accounts/dialogs'
import { Loader2, Plus, RefreshCw, Search, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * AccountsPage — App.tsx import target. Composes AccountsShell, which
 * itself mounts <AccountsBodyCtx.Provider> for the layout subtree.
 * `<AccountsProvider>` is hoisted by App.tsx above the lazy route so
 * context survives navigation; AccountsShell is wiring, not state.
 *
 * Split rationale (round N+1 AccountsProvider-wrap-regression fix):
 *   The 7-layout-branch tests under `AccountsPage.test.tsx` were
 *   failing with `useAccountsState must be used inside <AccountsProvider>`
 *   because the test mocked `@/features/accounts/AccountsProvider`
 *   (the barrel) but NOT `@/features/accounts/AccountsProvider.helpers`
 *   (the actual hook module). The fix is structural, not mock-deep:
 *   pull layout out of the hook-call surface so tests stub a single
 *   React context value instead of needing to mock two module paths.
 */
export default function AccountsPage() {
  return <AccountsShell />
}

/**
 * AccountsShell — wiring layer. Translates `useNavigate()` into
 * navigation callbacks and bundles `{ state, dispatch, navigation }`
 * into the AccountsBodyContext. Memoizes the ctxValue so the body
 * subtree does NOT re-render unless one of the 3 fields actually
 * changed — `useMemo` is necessary even though `state`/`dispatch`
 * are individually stable, because the literal `{ ... }` would
 * otherwise give consumers a new identity every render.
 */
function AccountsShell() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()
  const navigate = useNavigate()

  const onOpenTasks = useCallback(() => navigate('/tasks'), [navigate])
  const onOpenPublish = useCallback(() => navigate('/publish'), [navigate])

  const ctxValue = useMemo<AccountsBodyContextValue>(
    () => ({
      state,
      dispatch,
      navigation: { onOpenTasks, onOpenPublish },
    }),
    [state, dispatch, onOpenTasks, onOpenPublish],
  )

  return (
    <AccountsBodyCtx.Provider value={ctxValue}>
      <AccountsBody />
    </AccountsBodyCtx.Provider>
  )
}

/**
 * AccountsBody — pure layout. Reads ONE context object
 * (`useAccountsBody()`) and never touches the router or the
 * account-state hooks directly. Tests wrap the body in
 * `<AccountsBodyCtx.Provider value={stub}>` instead of mocking
 * `useAccountsState`/`useAccountsDispatch` modules.
 */
export function AccountsBody() {
  const { state, dispatch, navigation } = useAccountsBody()
  const handleCreateGroup = useCallback(
    () => dispatch.setCreateDialogOpen(true),
    [dispatch],
  )
  const handleCheckAllStatus = useCallback(
    () => void dispatch.handleCheckAllStatus(),
    [dispatch],
  )

  return (
    <div className="space-y-6 p-6 max-w-[1600px] mx-auto w-full">
      <PageHeader
        title="账号管理"
        description="管理账号分组和平台授权"
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        actions={<HeaderActions />}
      />

      <HomepageOverview
        onCreateGroup={handleCreateGroup}
        onCheckAllStatus={handleCheckAllStatus}
        onOpenTasks={navigation.onOpenTasks}
        onOpenPublish={navigation.onOpenPublish}
      />

      {state.localGroups.length > 0 && <GroupToolbar />}

      <BodyArea />

      <DialogHost />
    </div>
  )
}

// HeaderActions / BodyArea stay file-scoped (NOT nested inside
// AccountsBody) so their function identities are stable across renders.
// Nesting would re-create the function def on every parent render and
// invalidate downstream memoization.

function HeaderActions() {
  const { state, dispatch } = useAccountsBody()
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void dispatch.handleCheckAllStatus()}
        disabled={state.isCheckingStatus || state.groups.length === 0}
        className="gap-1.5"
        data-tour="check-all"
      >
        <RefreshCw
          className={cn('h-3.5 w-3.5', state.isCheckingStatus && 'animate-spin')}
        />
        {state.isCheckingStatus ? '检测中…' : '一键检测'}
      </Button>
      <Button size="sm" onClick={() => dispatch.setCreateDialogOpen(true)} data-tour="new-group">
        <Plus className="h-4 w-4 mr-1" />
        新建分组
      </Button>
    </div>
  )
}

function BodyArea() {
  const { state, dispatch } = useAccountsBody()
  if (state.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
        <span className="text-sm text-muted-foreground/50">加载中…</span>
      </div>
    )
  }
  if (state.groups.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title="暂无账号分组"
        description="创建一个分组，然后添加各平台的授权"
        action={
          <Button size="sm" onClick={() => dispatch.setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            新建分组
          </Button>
        }
      />
    )
  }
  if (state.filteredGroups.length === 0) {
    return (
      <EmptyState
        icon={<Search className="h-6 w-6" />}
        title="未找到匹配的分组"
        description={`没有找到包含 "${state.searchQuery}" 的分组`}
        action={
          <Button size="sm" variant="outline" onClick={dispatch.handleClearSearch}>
            清除搜索
          </Button>
        }
      />
    )
  }
  return state.viewMode === 'grid' ? <GroupGridArea /> : <GroupListArea />
}
