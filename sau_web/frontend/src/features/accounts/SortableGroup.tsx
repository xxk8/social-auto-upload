import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useSortable } from '@dnd-kit/react/sortable'
import { useNavigate } from '@tanstack/react-router'
import { GripVertical, Pencil, Plus, Send, Shield, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pctToTone, toneChipClasses, toneDotStyle, toneFgVar, toneTextClass, validityTone } from '@/lib/tone'
import type { AccountGroup } from '@/api/client'
import { ROUTES } from '@/routes'
import {useAccountsDispatch} from './AccountsProvider.helpers'
import { SortableAuthorizationList } from './SortableAuthorizationList'

interface SortableGroupProps {
  group: AccountGroup
  index: number
}

function GroupGridEmptyState({ onAuthorize }: { onAuthorize: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/40 bg-gradient-to-b from-muted/15 to-transparent px-3 py-7 text-center">
      <div className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl border border-border/30 bg-background/70 shadow-sm">
        <Shield className="h-4 w-4 text-muted-foreground/35" />
      </div>
      <p className="text-[13px] font-medium text-muted-foreground/75">暂无平台授权</p>
      <p className="mt-0.5 mb-3 text-[11px] text-muted-foreground/50">添加平台以开始使用</p>
      <Button
        variant="ghost"
        size="sm"
        className="btn-dashed mx-auto max-w-[160px] h-8 text-[12px]"
        onClick={onAuthorize}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        添加授权
      </Button>
    </div>
  )
}

function GroupSummaryLine({
  validCount,
  totalCount,
}: {
  validCount: number
  totalCount: number
}) {
  // Drives ONLY the text color (no chip background in the summary line).
  // `validityTone` is the dedicated 2-band mapper (success / warning) used
  // across the accounts surface — `rateToTone` is the 4-band alternative
  // for "validity ratio" displays that benefit from an `info` band (e.g.
  // the homepage tile). This sister component recomputes the tone from
  // its props (idempotent — the parent chip body and this line call the
  // same pure mapper, so the result is identical without prop drilling).
  const text =
    totalCount > 0 ? (
      <>
        <span className={cn('font-medium tabular-nums text-xs', toneTextClass(validityTone(validCount, totalCount)))}>
          {validCount}/{totalCount}
        </span>{' '}
        <span className="text-muted-foreground/60">个平台已授权</span>
      </>
    ) : (
      <span className="text-muted-foreground/50">暂无授权</span>
    )

  return <p className="text-xs mt-0.5">{text}</p>
}

function TokenHealthBar({
  validCount,
  totalCount,
}: {
  validCount: number
  totalCount: number
}) {
  if (totalCount === 0) return null
  const pct = Math.round((validCount / totalCount) * 100)
  const tone = pctToTone(pct)

  return (
    <div className="token-indicator mt-1.5 max-w-[140px]">
      <div
        className="token-indicator-bar"
        style={{
          width: `${pct}%`,
          background: toneFgVar(tone),
        }}
      />
    </div>
  )
}

function GroupDeleteDialog({
  name,
  authCount,
  onConfirm,
}: {
  name: string
  authCount: number
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
          aria-label="Delete group"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            {'删除分组 "'}
            {name}
            {'" 将同时清空其 '}
            <span className="font-medium text-foreground">{authCount}</span>
            {' 项平台授权，确认继续？'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function SortableGroup({ group, index }: SortableGroupProps) {
  const dispatch = useAccountsDispatch()
  const navigate = useNavigate()
  const { ref, handleRef, isDragging } = useSortable({
    id: `group:${group.id}`,
    index,
  })

  const validCount = group.authorizations.filter((a) => a.valid).length
  const hasStale = group.authorizations.some((a) => a.stale)
  const totalCount = group.authorizations.length
  // Hoist the chip tone to component scope so the chip body (`toneChipClasses`)
  // and inner dot (`toneDotStyle`) helpers share a single mapper call — both
  // helpers absorb `Tone | null | undefined` gracefully so the JSX-level
  // `{totalCount > 0 && <chip>}` guard is the only shape-relevant check.
  // Downgrade to warning if any auth is stale (cookie expired but file OK).
  const chipTone = validityTone(validCount, totalCount) === 'success' && hasStale
    ? 'warning' as const
    : validityTone(validCount, totalCount)

  return (
    <Card
      ref={ref}
      className={cn(
        'card-refined group/card relative overflow-hidden',
        'shadow-[0_1px_0_oklch(1_0_0_/_0.03)_inset]',
        'transition-[border-color,background-color,box-shadow,transform] duration-200',
        'hover:shadow-[0_8px_24px_-14px_oklch(0_0_0_/_0.12)]',
        isDragging && 'z-50 scale-[1.02] opacity-50 shadow-lg',
      )}
    >
      {/* Top hairline + hover wash */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent dark:via-white/[0.08]"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.035] via-transparent to-violet-500/[0.02] opacity-0 transition-opacity duration-300 group-hover/card:opacity-100" />

      <CardHeader className="relative pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div
              ref={handleRef}
              className={cn(
                'cursor-grab active:cursor-grabbing rounded-md p-1 transition-colors',
                'text-muted-foreground/25 hover:bg-muted/50 hover:text-muted-foreground',
                'group-hover/card:text-muted-foreground/50',
              )}
            >
              <GripVertical className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[0.9375rem] font-semibold leading-tight tracking-tight text-foreground/90">
                  {group.name}
                </h3>
                {totalCount > 0 && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                      toneChipClasses(chipTone),
                    )}
                  >
                    <span className="status-dot" style={toneDotStyle(chipTone)} />
                    {validCount}/{totalCount}
                  </span>
                )}
              </div>
              <GroupSummaryLine validCount={validCount} totalCount={totalCount} />
              <TokenHealthBar validCount={validCount} totalCount={totalCount} />
            </div>
          </div>

          {/*
            Action cluster — split into two visual tiers so the primary
            "去发布此分组" affordance is always discoverable while the
            secondary admin actions (rename / add auth / delete) stay
            hover-reveal on desktop:

              1. PRIMARY — Send icon button. ALWAYS visible (not hover-
                 gated) because the whole point of this affordance is
                 "引导用户往前一步 from group list to publish wizard".
                 Visually same `Button size="icon"` shape as the secondary
                 cluster so the cluster reads as a unified toolbar; the
                 always-visible vs hover-gated opacity is the only signal
                 of the visual tier.

              2. SECONDARY (hover-reveal on md+) — pencil / + / trash.
                 Existing behavior kept as-is so a power user who lingers
                 on the card and sees the hover cluster is not surprised
                 by a future change. Visible on mobile because hover is
                 not a mobile affordance.

            The two tiers are visually separated by a 1px hairline border-l
            so the eye groups them as "(primary | secondary)" rather than
            "(1 + 2 + 3) undifferentiated". `data-testid` on the primary
            button locks the affordance for E2E specs without coupling to
            the i18n'ed `aria-label` string.
          */}
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground/55 hover:bg-primary/10 hover:text-primary"
              onClick={() =>
                navigate({ to: `${ROUTES.dashboard.publish}?group_id=${group.id}` as never })
              }
              aria-label="去发布中心 · 预选此分组"
              data-testid="go-to-publish-from-group-grid"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
            <div className="flex items-center gap-0.5 border-l border-border/50 pl-1 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground/55 hover:bg-primary/10 hover:text-primary"
                onClick={() => dispatch.handleStartRename(group.id, group.name)}
                aria-label="Rename group"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground/55 hover:bg-primary/10 hover:text-primary"
                onClick={() => dispatch.handleStartAuthorize(group.id)}
                aria-label="Add authorization"
                data-tour="add-auth"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <GroupDeleteDialog
                name={group.name}
                authCount={group.authorizations.length}
                onConfirm={() => void dispatch.handleDeleteGroup(group.id, group.name)}
              />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="relative pt-0">
        {group.authorizations.length === 0 ? (
          <GroupGridEmptyState
            onAuthorize={() => dispatch.handleStartAuthorize(group.id)}
          />
        ) : (
          <SortableAuthorizationList
            groupId={group.id}
            authorizations={group.authorizations}
          />
        )}
      </CardContent>

      {totalCount > 0 && (
        <div className="relative px-5 pb-3.5">
          <button
            type="button"
            className="btn-dashed"
            onClick={() => dispatch.handleStartAuthorize(group.id)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            添加更多平台
          </button>
        </div>
      )}
    </Card>
  )
}
