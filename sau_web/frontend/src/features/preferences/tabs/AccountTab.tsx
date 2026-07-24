// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/AccountTab.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): the round-OPT-prefs-dialog
// v2 layout previously bundled 4 body components in `Components/
// PreferencesContent.tsx`. v4 splits them into per-tab files under
// `features/preferences/tabs/` so each body lives next to the dialog
// provider that drives it.
//
// AccountTab is the round-OPT-prefs-dialog v1+ read-only account body.
// It's mounted by:
//   • `<PreferencesDialog>`'s `<Tabs.Content value="account">` pane
//     (auto-unmounts when inactive)
//   • `/dashboard/account` route → `<ProfilePage>` (thin wrapper)
//
// Two surfaces render the same component, so email / role / name
// fields stay in lockstep through the same `useAuth()` hook — flip
// `authUser.tier` on one and the other reacts through the same call.
// data-testid invariants (`preferences-tab-account` trigger +
// dialog header `data-tab="account"`) live on the dialog shell, NOT
// here, so this component is reachable from any future shell that
// drops in the provider.
// ──────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { UserCircle, Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/useAuth'
import { authApi } from '@/features/auth/authApi'
import { useToast } from '@/components/ui/toast'
import { InfoRow } from '../shared/info-row'
import { Loader2 } from 'lucide-react'

export function AccountTab() {
  const { user: authUser } = useAuth()
  const { addToast } = useToast()
  const email = authUser?.email ?? '—'
  const rawName = authUser?.name
  const displayName = rawName && rawName.trim() !== '' ? rawName : '—'
  const roleLabel = authUser?.role === 'admin' ? '管理员' : '用户'
  const hasPassword = authUser?.has_password ?? false

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSetPassword = async () => {
    setPasswordError(null)
    setPasswordSuccess(false)
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('密码长度不能少于 8 位')
      return
    }
    if (!/[a-zA-Z]/.test(newPassword)) {
      setPasswordError('密码必须包含字母')
      return
    }
    if (!/\d/.test(newPassword)) {
      setPasswordError('密码必须包含数字')
      return
    }
    setSaving(true)
    try {
      const result = await authApi.setPassword(newPassword)
      if (result.success) {
        setPasswordSuccess(true)
        addToast('密码设置成功', 'success')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPasswordError(result.message || '设置失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : '网络错误'
      setPasswordError(msg || '设置密码失败')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError(null)
    setPasswordSuccess(false)
    if (!oldPassword) {
      setPasswordError('请输入旧密码')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('密码长度不能少于 8 位')
      return
    }
    if (!/[a-zA-Z]/.test(newPassword)) {
      setPasswordError('密码必须包含字母')
      return
    }
    if (!/\d/.test(newPassword)) {
      setPasswordError('密码必须包含数字')
      return
    }
    setSaving(true)
    try {
      const result = await authApi.changePassword(oldPassword, newPassword)
      if (result.success) {
        setPasswordSuccess(true)
        addToast('密码修改成功', 'success')
        setOldPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPasswordError(result.message || '修改失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : '网络错误'
      setPasswordError(msg || '修改密码失败')
    } finally {
      setSaving(false)
    }
  }

  const initial =
    (displayName !== '—' ? displayName : email !== '—' ? email : '?').slice(0, 1).toUpperCase()

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/40 shadow-none ring-1 ring-border/40">
        <CardHeader className="border-b border-border/30 bg-muted/15 pb-4">
          <div className="flex items-center gap-3.5">
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[15px] font-semibold text-primary ring-1 ring-primary/15"
            >
              {initial}
            </span>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-[14px] font-semibold tracking-tight">
                <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                账号信息
              </CardTitle>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {email}
                <span className="mx-1.5 text-border">·</span>
                {roleLabel}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          <InfoRow label="邮箱" value={email} />
          <InfoRow label="角色" value={roleLabel} />
          <InfoRow label="显示名" value={displayName} />
          {authUser?.last_login && (
            <InfoRow label="最近登录" value={authUser.last_login} mono />
          )}
          {authUser?.created_at && (
            <InfoRow label="注册时间" value={authUser.created_at} mono />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/40 shadow-none ring-1 ring-border/40">
        <CardHeader className="border-b border-border/30 bg-muted/15 pb-4">
          <CardTitle className="flex items-center gap-2.5 text-[14px] font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Lock className="h-3.5 w-3.5" />
            </span>
            {hasPassword ? '修改密码' : '设置密码'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {hasPassword
              ? '修改登录密码。至少 8 位，需包含字母和数字。'
              : '设置密码后可使用密码登录。至少 8 位，需包含字母和数字。'}
          </p>

          {passwordError && (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive">
              {passwordError}
            </div>
          )}

          {passwordSuccess && (
            <div className="rounded-lg border border-[color:var(--status-success-border)] bg-[var(--status-success-bg)] px-3.5 py-2.5 text-[13px] text-[color:var(--status-success-fg)]">
              密码已更新
            </div>
          )}

          <div className="space-y-3.5">
            {hasPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="old-password" className="text-[13px] font-medium">
                  旧密码
                </Label>
                <Input
                  id="old-password"
                  type="password"
                  placeholder="输入当前密码"
                  className="h-10 text-sm"
                  autoComplete="current-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-[13px] font-medium">
                {hasPassword ? '新密码' : '密码'}
              </Label>
              <Input
                id="new-password"
                type="password"
                placeholder="至少 8 位，包含字母和数字"
                className="h-10 text-sm"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-[13px] font-medium">
                确认密码
              </Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="再次输入密码"
                className="h-10 text-sm"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <Button
              className="h-10 text-sm font-medium"
              disabled={saving || (!newPassword && !confirmPassword)}
              onClick={hasPassword ? handleChangePassword : handleSetPassword}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                '保存'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── InfoRow (round-OPT-3G+) ─────────────────────────────────────────
// Round-OPT-3G+ moved AccountTab's local InfoRow helper to
// `features/preferences/shared/info-row.tsx` because OverviewTab's
// 2x2 jump-off tile grid renders up to 4 InfoRows per tile (the
// literal "32 个开关/字段" flatten interpretation — Account tile
// shows 邮箱 / 角色 / 显示名 / 最近登录, Settings shows 套餐 / 价格
// / 已包含 / 相关页面, etc.). Two consumers justifies the
// promotion to shared/.
