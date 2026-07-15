// ─────────────────────────────────────────────────────────────────────
// AdminUsersPage v3-table — TanStack Table v8.21.3 integration.
//
// v3-table delta vs v2:
//   • Inline <Table>/<TableHeader>/<TableBody>/<TableRow> replaced
//     by <AdminTable> — a generic wrapper that adds sort carets,
//     per-column filter inputs, column-visibility dropdown, row
//     multi-select checkbox column, and a sticky bulk-action toolbar
//     that mounts only when ≥1 row is selected.
//   • 7 columns now (selection + email + role + tier + created +
//     last_login + actions). The selection column is leftmost and
//     never gets hidden / never sorts / never filters.
//
// Locked test contract (admin tests in AdminDashboard.test.tsx):
//   • 'alice@test.com' / 'bob@test.com' / '管理员' / '用户' / 'pro' /
//     'free' / '2026-01-15' / '2026-07-05 09:00' / '—' — all visible
//     cell text. Preserved by mapping each accessorKey to a 1:1
//     cell renderer that emits the same text + role pill / CodePill
//     as v2.
//   • DropdownMenu trigger renders name === "变更角色 …email…" —
//     preserved.
//   • Menuitems render labels "设为管理员" / "设为用户" with
//     aria-disabled="true" on the current-role item.
//   • AlertDialog (page-level, not in table) carries the unchanged
//     title / description / button labels.
//   • Empty state title '还没有注册用户' rendered via the
//     `emptyState` slot on AdminTable.
//
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { adminApi, type AdminUser } from './adminApi'
import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
import { AdminNavTabs } from './components/AdminNavTabs'
import { Card, CardContent } from '@/Components/ui/card'
import { Skeleton } from '@/Components/ui/skeleton'
import { Button } from '@/Components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/Components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/Components/ui/alert-dialog'
import { Checkbox } from '@/Components/ui/checkbox'
import { useToast } from '@/Components/ui/toast'
import { ChevronDown, Crown, Key, MoreHorizontal, Shield, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneChipClasses, toneStyleClasses } from '@/lib/tone'
import { AdminStat } from './components/AdminStat'
import { AdminAvatar } from './components/AdminAvatar'
import { CodePill } from './components/CodePill'
import { PremiumEmptyState } from './components/PremiumEmptyState'
import { AdminTable, AdminBulkActionBar } from './components/AdminTable'
import { relativeTimeFromNow } from '@/lib/relativeTime'
import { useAuth } from '@/features/auth/useAuth'

// Founder pill (ai-api-keys-founder feature): renders a tightly coupled
// "Founder" chip NEXT TO the role pill so the founder rows are visually
// distinguishable from plain admins. Mounted inline in the cell rather
// than as a separate column so the table layout doesn't shift when a
// transfer lands; founder rows simply grow a second pill on the same
// line.
interface FounderPillProps {
  isFounder: boolean
}

function FounderPill({ isFounder }: FounderPillProps) {
  if (!isFounder) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ml-1',
        'border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
      )}
      title="AI API Key 唯一管理者（Founder）"
    >
      <Key className="h-3 w-3" strokeWidth={2} />
      <span>Founder</span>
    </span>
  )
}

interface RolePillProps {
  role: 'admin' | 'user' | string
  isFounder?: boolean
}

function RolePill({ role, isFounder }: RolePillProps) {
  const isAdmin = role === 'admin'
  return (
    <div className="inline-flex items-center gap-1">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
          isAdmin ? toneChipClasses('success') : toneChipClasses('info'),
        )}
      >
        {isAdmin ? <Crown className="h-3 w-3" strokeWidth={2} /> : <Users className="h-3 w-3" strokeWidth={2} />}
        <span>{isAdmin ? '管理员' : '用户'}</span>
      </span>
      <FounderPill isFounder={Boolean(isFounder)} />
    </div>
  )
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [confirmRole, setConfirmRole] = useState<{
    userId: number
    email: string
    newRole: 'admin' | 'user'
  } | null>(null)
  // Founder transfer confirmation (ai-api-keys-founder feature):
  // mirrors the role-change confirm-state shape. Only the current
  // founder can initiate a transfer; we surface the menu item
  // (`isCurrentFounder` flag below) and the dialog opens against a
  // specific target user.
  const [confirmFounderTransfer, setConfirmFounderTransfer] = useState<{
    userId: number
    email: string
  } | null>(null)
  // The viewer is who owns the founder action — mirrors the backend
  // `founder_required` decorator in /api/admin/founder/transfer so
  // the dropdown item is only visible (and clickable) for the actual
  // founder. Non-founders see the same AdminUsersPage but without
  // the menu entry; their backend call would 403 anyway.
  const { user: currentUser } = useAuth()
  const isCurrentFounder = Boolean(currentUser?.is_founder)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => adminApi.getUsers(),
    staleTime: 30_000,
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      adminApi.updateUserRole(userId, role),
    onSuccess: (result) => {
      if (result.success) {
        addToast('角色已更新', 'success')
        queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
        queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })
      } else {
        addToast(result.message || '更新失败', 'error')
      }
    },
    onError: () => {
      addToast('更新失败', 'error')
    },
  })

  // Founder transfer mutation: invalidates ['me'] so the viewer's
  // own founder status flips on the very next refetch (mirrors the
  // backend's `session["is_founder"]` removal — DB is the single
  // source of truth), ['admin','users'] so this page re-renders
  // with the new Founder pill placement, and ['admin','audit'] so
  // the founder_transfer row appears in the Audit page.
  const transferFounderMutation = useMutation({
    mutationFn: (targetUserId: number) => adminApi.transferFounder(targetUserId),
    onSuccess: (result) => {
      if (result.success) {
        const prior = result.data?.prior_founder?.email ?? '原 Founder'
        const next = result.data?.new_founder?.email ?? '目标用户'
        addToast(`已将 Founder 身份从 ${prior} 转移给 ${next}`, 'success')
        queryClient.invalidateQueries({ queryKey: ['me'] })
        queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
        queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })
      } else {
        addToast(result.message || 'Founder 移交失败', 'error')
      }
    },
    onError: () => {
      addToast('Founder 移交失败', 'error')
    },
  })

  const users = useMemo<AdminUser[]>(() => data?.data ?? [], [data])

  // Snapshot wall-clock time ONCE per mount via useState's lazy
  // initializer (the only call site that satisfies `react-hooks/
  // purity`'s "no Date.now during render" rule). The activeDay
  // stat below uses this captured snapshot — the meaning is "users
  // who logged in within 24h BEFORE my mount", not a per-render
  // live read. The unused `setNow` setter is elided via a leading
  // underscore so the unused-variable lint doesn't fire; callers
  // never need to set it because the page doesn't refresh the
  // 24-hour window on demand. Fresh activeDay values arrive on
  // each page navigation / refresh, which matches user expectation
  // for admin dashboards.
  const [mountNow] = useState(() => Date.now())

  // Bulk-export filename snapshot — captured ONCE per mount so the
  // bulkToolbar's `onExportSelected` closure (built every render)
  // doesn't reach for `Date.now()` at construction. The filename
  // embeds the same `mountNow` snapshot as the activeDay stat
  // below so the export and the dashboard are visibly from the
  // same load. Without this, the closure would call `Date.now()`
  // per render and trip the same `react-hooks/purity` lint rule
  // that flagged line 200 pre-fix.
  const csvFilename = useMemo(() => `users_${mountNow}.csv`, [mountNow])

  // Summary KPIs — derived locally so we don't add a new API call.
  const summary = useMemo(() => {
    const total = users.length
    const admins = users.filter((u) => u.role === 'admin').length
    const activeDay = users.filter((u) => {
      if (!u.last_login) return false
      const last = new Date(u.last_login)
      return mountNow - last.getTime() < 24 * 60 * 60 * 1000
    }).length
    return { total, admins, activeDay }
  }, [users, mountNow])

  // useCallback so the columns[] useMemo below doesn't rebuild on every
  // render (handleRoleChange closure is a stable wrapper around the
  // setConfirmRole state setter, which itself is stable).
  const handleRoleChange = useCallback(
    (userId: number, email: string, role: 'admin' | 'user') => {
      setConfirmRole({ userId, email, newRole: role })
    },
    [],
  )

  const confirmRoleChange = () => {
    if (!confirmRole) return
    updateRoleMutation.mutate({
      userId: confirmRole.userId,
      role: confirmRole.newRole,
    })
    setConfirmRole(null)
  }

  const confirmFounderTransferAction = () => {
    if (!confirmFounderTransfer) return
    transferFounderMutation.mutate(confirmFounderTransfer.userId)
    setConfirmFounderTransfer(null)
  }

  // ── Column definitions (TanStack) ──
  // Identity-fn cell renderers so the comments from v2 about
  // exact text emissions carry through unchanged.
  const columns = useMemo<ColumnDef<AdminUser>[]>(() => [
    {
      id: 'select',
      enableHiding: false,
      enableSorting: false,
      filterFn: undefined,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllRowsSelected()
              ? true
              : table.getIsSomeRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={(v) => table.toggleAllRowsSelected(Boolean(v))}
          aria-label="全选"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
          aria-label={`选择 ${row.original.email}`}
        />
      ),
    },
    {
      id: 'email',
      accessorKey: 'email',
      header: '邮箱',
      filterFn: 'includesString',
      cell: ({ row }) => (
        <div className="flex items-center gap-3 min-w-0">
          <AdminAvatar identifier={row.original.email} size="md" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">
              {row.original.email}
            </div>
            <div className="font-mono tabular-nums text-[10.5px] text-muted-foreground/70">
              ID #{row.original.id}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      accessorKey: 'role',
      header: '角色',
      filterFn: 'includesString',
      cell: ({ row }) => <RolePill role={row.original.role} isFounder={row.original.is_founder} />,
    },
    {
      id: 'tier',
      accessorKey: 'tier',
      header: 'Tier',
      filterFn: 'includesString',
      cell: ({ row }) => <CodePill>{row.original.tier}</CodePill>,
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: '注册时间',
      filterFn: 'includesString',
      cell: ({ row }) => (
        <div className="font-mono tabular-nums text-foreground/80">
          {row.original.created_at?.slice(0, 10) ?? '—'}
        </div>
      ),
    },
    {
      id: 'last_login',
      accessorKey: 'last_login',
      header: '最后登录',
      filterFn: 'includesString',
      cell: ({ row }) => {
        const u = row.original
        if (!u.last_login) {
          return <span className="text-muted-foreground/60">—</span>
        }
        const abs = u.last_login.slice(0, 16).replace('T', ' ') ?? '—'
        const rel = relativeTimeFromNow(u.last_login)
        return (
          <div className="flex flex-col leading-tight">
            <span className="font-mono tabular-nums text-foreground/80">{abs}</span>
            {rel && (
              <span className="text-[11px] text-muted-foreground/70">{rel}</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'actions',
      enableHiding: false,
      enableSorting: false,
      header: '操作',
      cell: ({ row }) => {
        const u = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
                disabled={updateRoleMutation.isPending || transferFounderMutation.isPending}
                aria-label={`变更角色 ${u.email}`}
              >
                <span>变更角色</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => handleRoleChange(u.id, u.email, 'admin')}
                disabled={u.role === 'admin'}
              >
                <Crown className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
                设为管理员
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRoleChange(u.id, u.email, 'user')}
                disabled={u.role === 'user'}
              >
                <Users className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
                设为用户
              </DropdownMenuItem>
              {/* Founder transfer (ai-api-keys-founder feature): only
                  surfaced when the viewer IS the founder. Disabled
                  when the target is already founder (the backend
                  would 400 "target already founder"; we mirror that
                  at the UI so the click target doesn't lie to the
                  user). Never rendered for non-founders — the
                  backend's @founder_required gate keeps parity. */}
              {isCurrentFounder && (
                <>
                  <div className="my-1 h-px bg-border/60" />
                  <DropdownMenuItem
                    onClick={() =>
                      setConfirmFounderTransfer({ userId: u.id, email: u.email })
                    }
                    disabled={
                      // Two reasons to disable the click target:
                      //  (1) target already is the founder → backend
                      //      400 'already founder' — UI must not lie
                      //      about what the click will do.
                      //  (2) target IS the viewer's own row → backend
                      //      400 self-transfer. Belt for the
                      //      stale-cache case (e.g. founder refetch
                      //      still in flight right after mount).
                      Boolean(u.is_founder) || u.id === currentUser?.id
                    }
                    data-testid={`founder-transfer-${u.id}`}
                  >
                    <Key className="h-3.5 w-3.5 mr-1.5 text-amber-600 dark:text-amber-400" strokeWidth={1.75} />
                    移交 Founder 身份
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [
    handleRoleChange,
    updateRoleMutation.isPending,
    transferFounderMutation.isPending,
    isCurrentFounder,
    currentUser?.id, // self-transfer guard reads this inside the menu item cell
  ])

  return (
    <PageWrapper topNav={<AdminNavTabs />}>
      <PageHeader
          title="用户管理"
          description="查看和管理所有注册用户"
          icon={<Shield className="h-5 w-5 text-[var(--status-info-fg)]" />}
          actions={
            <div
              className="hidden sm:flex items-center gap-1.5 font-mono tabular-nums text-[11px] text-muted-foreground/70"
              aria-live="polite"
            >
              <Users className="h-3 w-3" strokeWidth={1.75} />
              共 {summary.total} 位用户
            </div>
          }
        />

      {/* Summary sub-strip — three KPI cards. Hidden while loading so
          the strip doesn't flash 0 / 0 / 0 before data arrives. */}
      {!isLoading && users.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AdminStat
            label="总用户数"
            value={summary.total.toLocaleString()}
            icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
            tone="info"
            meta="全部账号"
          />
          <AdminStat
            label="管理员数"
            value={String(summary.admins)}
            icon={<Crown className="h-4 w-4" strokeWidth={1.75} />}
            tone="success"
            meta="有后台权限"
          />
          <AdminStat
            label="活跃（24h）"
            value={summary.activeDay.toLocaleString()}
            icon={<Shield className="h-4 w-4" strokeWidth={1.75} />}
            tone="warning"
            meta="登录过"
          />
        </div>
      )}

      <Card className="border-border/60 bg-card/60 shadow-[0_1px_0_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-1 px-3 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <AdminTable
              data={users}
              columns={columns}
              getRowId={(u) => String(u.id)}
              singleFilter
              filterPlaceholder="搜索邮箱、角色、Tier…"
              pagination
              defaultPageSize={20}
              emptyState={
                <PremiumEmptyState
                  tone="info"
                  eyebrow="EMPTY DIRECTORY"
                  icon={<Users className="h-6 w-6" strokeWidth={1.5} />}
                  title="还没有注册用户"
                  description="等待第一位用户通过邮箱验证码或社交登录注册"
                />
              }
              bulkToolbar={({ selectedRows, clearSelection, exportRowsToCSV }) => (
                <AdminBulkActionBar
                  onClearSelection={clearSelection}
                  onExportSelected={() =>
                    // v3-table scope: export ONLY the selected rows
                    // (not all-visible). `selectedRows` is a stable
                    // array of AdminUser objects in render order.
                    // `csvFilename` is a per-mount snapshot (see
                    // declaration above) so this closure doesn't
                    // reach for `Date.now()` at construction.
                    exportRowsToCSV(selectedRows, csvFilename)
                  }
                />
              )}
            />
          )}
        </CardContent>
      </Card>

      {/* Founder transfer confirmation (ai-api-keys-founder):
          page-level AlertDialog mirroring the role-change pattern,
          tone-styled amber (founder) instead of success (admin) /
          warning (demote) so the visual signal matches the chip. */}
      <AlertDialog
        open={confirmFounderTransfer !== null}
        onOpenChange={(open) => !open && setConfirmFounderTransfer(null)}
      >
        <AlertDialogContent className="overflow-hidden p-0">
          <span
            aria-hidden
            className={cn(
              'h-1 w-full block',
              toneStyleClasses.warning.fill, // amber stripe — matches FounderPill via design-token
            )}
          />
          <div className="px-6 py-5">
            <AlertDialogHeader>
              <div className="flex items-start gap-3">
                <AdminAvatar identifier={confirmFounderTransfer?.email ?? ''} size="md" />
                <div className="min-w-0">
                  <AlertDialogTitle className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={1.75} />
                    移交 Founder 身份
                  </AlertDialogTitle>
                  <p className="mt-1 text-[12px] text-muted-foreground/80 truncate">
                    {confirmFounderTransfer?.email}
                  </p>
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogDescription className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              将 Founder 身份（即 AI API Key 管理权）从 <span className="font-medium text-foreground">您</span> 转移给{' '}
              <span className="font-medium text-foreground">{confirmFounderTransfer?.email}</span>。
              此操作不可撤销（需要新 Founder 再转移一次）。AI 密钥的增删改将立即变更归属，
              操作会被记录到审计日志。
            </AlertDialogDescription>
            <AlertDialogFooter className="mt-6">
              <AlertDialogCancel className="h-9">取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmFounderTransferAction}
                className={cn(
                  'h-9',
                  'bg-[var(--status-warning-fg)] hover:opacity-90 text-white',
                )}
                data-testid="founder-transfer-confirm"
              >
                <Key className="h-3.5 w-3.5 mr-1" strokeWidth={2} />
                确认移交
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Role change confirmation — page-level state, NOT inside
          AdminTable. Keeps existing v2 AlertDialog contract intact. */}
      <AlertDialog
        open={confirmRole !== null}
        onOpenChange={(open) => !open && setConfirmRole(null)}
      >
        <AlertDialogContent className="overflow-hidden p-0">
          <span
            aria-hidden
            className={cn(
              'h-1 w-full block',
              confirmRole?.newRole === 'admin'
                ? toneStyleClasses.success.fill
                : toneStyleClasses.warning.fill,
            )}
          />
          <div className="px-6 py-5">
            <AlertDialogHeader>
              <div className="flex items-start gap-3">
                <AdminAvatar identifier={confirmRole?.email ?? ''} size="md" />
                <div className="min-w-0">
                  <AlertDialogTitle className="text-[15px] font-semibold tracking-tight">
                    确认变更角色
                  </AlertDialogTitle>
                  <p className="mt-1 text-[12px] text-muted-foreground/80 truncate">
                    {confirmRole?.email}
                  </p>
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogDescription className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              确定要将 <span className="font-medium text-foreground">{confirmRole?.email}</span> 的角色变更为{' '}
              <span className="font-medium text-foreground">
                {confirmRole?.newRole === 'admin' ? '管理员' : '用户'}
              </span>
              吗？此操作将被记录到审计日志。
            </AlertDialogDescription>
            <AlertDialogFooter className="mt-6">
              <AlertDialogCancel className="h-9">取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmRoleChange}
                className={cn(
                  'h-9',
                  confirmRole?.newRole === 'admin'
                    ? 'bg-[var(--status-success-fg)] hover:opacity-90 text-white'
                    : 'bg-[var(--status-warning-fg)] hover:opacity-90 text-white',
                )}
              >
                <MoreHorizontal className="h-3.5 w-3.5 mr-1" strokeWidth={2} />
                确认
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </PageWrapper>
  )
}
