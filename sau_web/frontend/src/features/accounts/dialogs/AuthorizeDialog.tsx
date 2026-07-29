import { useMemo } from 'react'
import { Check, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PLATFORMS, QR_LOGIN_PLATFORMS } from '@/api/client'
import { PlatformBadge } from '../PlatformBadge'
import { useAccountsDispatch, useAccountsState } from '../AccountsProvider.helpers'
import { cn } from '@/lib/utils'

/**
 * Add-platform-to-group modal.
 *
 * Platform picker is a visual radiogroup of icon+name cards (not a
 * `<Select>` dropdown). Already-authorized platforms stay visible but
 * dimmed / disabled with an 「已授权」 tag so the user sees *why* they
 * can't re-pick them here (re-scan lives on the authorization row).
 */
export function AuthorizeDialog() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()

  const authorizedPlatforms = useMemo(() => {
    const group = state.groups.find((g) => g.id === state.selectedGroupId)
    if (!group) return new Set<string>()
    return new Set(group.authorizations.map((a) => a.platform))
  }, [state.groups, state.selectedGroupId])

  const selectPlatform = (value: string, disabled: boolean) => {
    if (disabled) return
    dispatch.setSelectedPlatform(value)
  }

  return (
    <Dialog
      open={state.authorizeDialogOpen}
      onOpenChange={dispatch.setAuthorizeDialogOpen}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加平台授权</DialogTitle>
          <DialogDescription>选择要授权的平台，然后扫码登录</DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="选择平台"
          className="grid grid-cols-4 gap-2"
        >
          {PLATFORMS.map((p) => {
            const already = authorizedPlatforms.has(p.value)
            const selected = state.selectedPlatform === p.value
            const isQr = QR_LOGIN_PLATFORMS.includes(p.value)

            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                data-testid={`platform-card-${p.value}`}
                aria-checked={selected}
                aria-disabled={already}
                disabled={already}
                tabIndex={already ? -1 : 0}
                onClick={() => selectPlatform(p.value, already)}
                onKeyDown={(e) => {
                  // jsdom does not synthesize button click on Enter;
                  // keep keyboard parity with real browsers.
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    selectPlatform(p.value, already)
                  }
                }}
                className={cn(
                  'relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2',
                  already
                    ? 'cursor-not-allowed border-border/40 bg-muted/30 opacity-55'
                    : selected
                      ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30 shadow-sm'
                      : 'border-border/60 bg-card hover:border-primary/30 hover:bg-muted/40 hover:shadow-sm cursor-pointer',
                )}
              >
                {selected && !already && (
                  <span
                    className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    aria-hidden
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                )}
                <PlatformBadge platform={p.value} size="md" title={p.label} />
                <span
                  className={cn(
                    'text-xs font-medium leading-tight',
                    selected && !already ? 'text-foreground' : 'text-foreground/80',
                  )}
                >
                  {p.label}
                </span>
                {already ? (
                  <span className="text-[10px] font-medium text-muted-foreground">
                    已授权
                  </span>
                ) : isQr ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
                    <QrCode className="h-2.5 w-2.5" />
                    扫码
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground/70">登录</span>
                )}
              </button>
            )
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => dispatch.setAuthorizeDialogOpen(false)}
          >
            取消
          </Button>
          <Button
            onClick={dispatch.handleAuthorize}
            disabled={!state.selectedPlatform || authorizedPlatforms.has(state.selectedPlatform)}
          >
            开始授权
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
