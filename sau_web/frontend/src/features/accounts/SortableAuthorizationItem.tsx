import { memo } from 'react'
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
import { HealthBadge } from './HealthBadge'
import { QR_LOGIN_PLATFORMS, type AccountAuthorization } from '@/api/client'
import { useAccountsDispatch, useAccountsState } from './AccountsProvider.helpers'
import { toneChipClasses, toneFillBgClass, type Tone } from '@/lib/tone'
import { api } from '@/api/client'
import { useState } from 'react'

interface SortableAuthorizationItemProps {
  auth: AccountAuthorization
  groupId: number
}

function AuthorizationStatusPill({ valid, stale, ageHours }: { valid: boolean; stale?: boolean; ageHours?: number | null }) {
  // Three-band visual state:
  //   valid && !stale  → success (mint) "有效"
  //   valid && stale   → warning (amber) "过期" (cookie content expired)
  //   !valid           → warning (amber) "失效" (file missing / broken)
  const tone: Tone = valid && !stale ? 'success' : 'warning'
  const label = !valid ? '失效' : stale ? '过期' : '有效'
  const title = stale && ageHours != null
    ? `Cookie 已过期 (${Math.round(ageHours)} 小时前刷新，需 24 小时内)`
    : undefined
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap',
        toneChipClasses(tone),
      )}
      title={title}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', toneFillBgClass(tone))} />
      {label}
    </span>
  )
}

function SortableAuthorizationItemImpl({
  auth,
  groupId,
}: SortableAuthorizationItemProps) {
  const { t } = useTranslation()
  const dispatch = useAccountsDispatch()
  const { refetch } = useAccountsState()
  const { ref, isDragging } = useDraggable({
    id: `auth:${groupId}:${auth.id}`,
    data: { groupId, authId: auth.id, platform: auth.platform },
  })
  const [checking, setChecking] = useState(false)

  const platformLabel = dispatch.getPlatformLabel(auth.platform)
  // Re-scan gate: surface the action for both "失效" (cookie file
  // missing/broken, valid: false) and "过期" (cookie file present but
  // expired, valid && stale). Both cases need the same recovery flow
  // (re-open LoginProgressModal for that platform). Hidden for
  // valid-and-fresh authorizations where re-scanning is unnecessary.
  const canRescan = !auth.valid || auth.stale
  // Icon + label branch: QR platforms get "重新扫码" with the QrCode
  // icon (matches the modal's primary affordance). Non-QR platforms
  // (tiktok / baijiahao) get "重新登录" with the LogIn icon — the
  // modal falls through to the CLI-instruction view for these, so
  // "重新扫码" would be misleading.
  const isQrPlatform = QR_LOGIN_PLATFORMS.includes(auth.platform)

  const handleCheckNow = async () => {
    if (checking) return
    setChecking(true)
    try {
      await api.checkAuthorizationHealth(auth.id)
      refetch()
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
            <span className="text-sm font-medium truncate">
              {platformLabel}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5 font-mono">
            {auth.platform}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <HealthBadge health={auth.health} />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={handleCheckNow}
          disabled={checking}
          data-testid={`check-health-${auth.id}`}
        >
          <RefreshCw className={cn('h-3 w-3 mr-1', checking && 'animate-spin')} />
          {checking ? '检查中' : '立即检查'}
        </Button>
        <AuthorizationStatusPill valid={auth.valid} stale={auth.stale} ageHours={auth.age_hours} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 opacity-100 md:opacity-0 md:group-hover/auth:opacity-100 transition-all"
              aria-label={t('accounts.actions.menu', 'Authorization actions')}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {canRescan && (
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
            )}
            {canRescan && <DropdownMenuSeparator />}
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
