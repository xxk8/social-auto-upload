import { memo, useState } from 'react'
import { useDraggable } from '@dnd-kit/react'
import { useTranslation } from 'react-i18next'
import { GripVertical, LogIn, MoreHorizontal, QrCode, RefreshCw, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PlatformBadge } from './PlatformBadge'
import { QR_LOGIN_PLATFORMS, type AccountAuthorization } from '@/api/client'
import { useAccountsDispatch, useAccountsState } from './AccountsProvider.helpers'
import { toneChipClasses, toneFillBgClass, type Tone } from '@/lib/tone'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'

interface SortableAuthorizationItemProps {
  auth: AccountAuthorization
  groupId: number
}

/**
 * Single status vocabulary for an authorization row.
 *
 * Previously the row stacked three near-synonyms:
 *   HealthBadge "未检查" + button "立即检查" + pill "失效/有效"
 * which read as three different states. One pill is enough:
 *   有效 | 过期 | 失效
 * Detection is an *action* in the ⋯ menu, not a second status.
 */
function AuthorizationStatusPill({
  valid,
  stale,
  ageHours,
}: {
  valid: boolean
  stale?: boolean
  ageHours?: number | null
}) {
  const tone: Tone = valid && !stale ? 'success' : valid && stale ? 'warning' : 'error'
  const label = !valid ? '失效' : stale ? '过期' : '有效'
  const title = !valid
    ? 'Cookie 缺失或损坏，请重新授权'
    : stale && ageHours != null
      ? `Cookie 已超过 ${Math.round(ageHours)} 小时，建议重新登录`
      : '登录态正常'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap',
        toneChipClasses(tone),
      )}
      title={title}
      data-testid="auth-status-pill"
      data-status={label}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', toneFillBgClass(tone))} />
      {label}
    </span>
  )
}

/** Prefer API `account_name`; fall back to cookie stem after `platform_`. */
function resolveAccountId(auth: AccountAuthorization): string {
  if (auth.account_name?.trim()) return auth.account_name.trim()
  const stem = auth.cookie_file?.split(/[/\\]/).pop()?.replace(/\.json$/i, '') ?? ''
  const parts = stem.split('_')
  if (parts.length >= 2) {
    // platform may itself contain underscores in theory; cookie convention is
    // `{platform}_{account}` with platform from a fixed set (no underscore).
    return parts.slice(1).join('_') || stem
  }
  return stem || '—'
}

function SortableAuthorizationItemImpl({
  auth,
  groupId,
}: SortableAuthorizationItemProps) {
  const { t } = useTranslation()
  const dispatch = useAccountsDispatch()
  const { refetch } = useAccountsState()
  const { addToast } = useToast()
  const { ref, isDragging } = useDraggable({
    id: `auth:${groupId}:${auth.id}`,
    data: { groupId, authId: auth.id, platform: auth.platform },
  })
  const [checking, setChecking] = useState(false)

  const platformLabel = dispatch.getPlatformLabel(auth.platform)
  const accountId = resolveAccountId(auth)
  // Re-scan gate: surface for both 失效 and 过期. Hidden for fresh+valid.
  const canRescan = !auth.valid || auth.stale
  const isQrPlatform = QR_LOGIN_PLATFORMS.includes(auth.platform)

  const handleCheckNow = async () => {
    if (checking) return
    setChecking(true)
    try {
      const res = await api.checkAuthorizationHealth(auth.id)
      await refetch()
      if (!res?.success) {
        addToast(res?.message ?? '检测失败', 'error')
        return
      }
      const data = res.data as
        | { valid?: boolean; stale?: boolean; health?: string; message?: string }
        | undefined
      if (data?.valid && !data?.stale) {
        addToast(`${platformLabel} · ${accountId} 登录态有效`, 'success')
      } else if (data?.valid && data?.stale) {
        addToast(`${platformLabel} · ${accountId} Cookie 已过期，建议重新登录`, 'warning')
      } else {
        addToast(`${platformLabel} · ${accountId} 已失效，请重新授权`, 'error')
      }
    } catch {
      addToast('检测请求失败，请检查后端连接', 'error')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      ref={ref}
      className={cn(
        'auth-row group/auth',
        isDragging && 'opacity-50 shadow-lg scale-[1.01] z-10',
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div
          className={cn(
            'cursor-grab active:cursor-grabbing p-0.5 rounded transition-colors flex-shrink-0',
            'text-muted-foreground/25 hover:text-muted-foreground/60',
          )}
        >
          <GripVertical className="h-3 w-3" />
        </div>
        <PlatformBadge
          platform={auth.platform}
          size="md"
          interactive
          title={platformLabel}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{platformLabel}</span>
          </div>
          {/* Account id (CLI --account / cookie label), not platform pinyin. */}
          <p
            className="text-[11px] text-muted-foreground/60 truncate mt-0.5 font-mono"
            title={`账号 ID：${accountId}`}
            data-testid={`auth-account-id-${auth.id}`}
          >
            {accountId}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <AuthorizationStatusPill
          valid={auth.valid}
          stale={auth.stale}
          ageHours={auth.age_hours}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 opacity-100 md:opacity-0 md:group-hover/auth:opacity-100 transition-all"
              aria-label={t('accounts.actions.menu', 'Authorization actions')}
              disabled={checking}
            >
              {checking ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => void handleCheckNow()}
              disabled={checking}
              data-testid={`check-health-${auth.id}`}
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', checking && 'animate-spin')} />
              {checking ? '检测中…' : '检测登录态'}
            </DropdownMenuItem>
            {canRescan && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => dispatch.handleReauthorize(groupId, auth.platform)}
                  data-testid={`reauthorize-${groupId}-${auth.platform}`}
                >
                  {isQrPlatform ? (
                    <QrCode className="h-3.5 w-3.5 mr-2" />
                  ) : (
                    <LogIn className="h-3.5 w-3.5 mr-2" />
                  )}
                  {isQrPlatform ? '重新扫码' : '重新登录'}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive cursor-pointer"
              onClick={() => void dispatch.handleRemoveAuth(groupId, auth.platform)}
            >
              <Unlink className="h-3.5 w-3.5 mr-2" />
              断开连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export const SortableAuthorizationItem = memo(SortableAuthorizationItemImpl)
