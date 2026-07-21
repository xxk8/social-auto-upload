import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/Components/ui/alert-dialog'
import { Button } from '@/Components/ui/button'
import type { AccountGroup } from '@/api/client'
import { useNavigate } from 'react-router-dom'
import { CheckSquare, GripVertical, Pencil, Plus, Send, Square, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSortable } from '@dnd-kit/react/sortable'
import {useAccountsDispatch} from './AccountsProvider.helpers';import { PlatformBadge } from './PlatformBadge'
import { toneChipClasses, toneFillBgClass, validityTone } from '@/lib/tone'
import { ROUTES } from '@/routes'

interface GroupListItemProps {
  group: AccountGroup
  selected: boolean
  index: number
}

function GroupValidityChip({
  validCount,
  totalCount,
  hasStale,
}: {
  validCount: number
  totalCount: number
  hasStale?: boolean
}) {
  const baseTone = validityTone(validCount, totalCount)
  const tone = baseTone === 'success' && hasStale ? 'warning' as const : baseTone
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums',
        toneChipClasses(tone),
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', toneFillBgClass(tone))} />
      {validCount}/{totalCount}
    </span>
  )
}

export function GroupListItem({ group, selected, index }: GroupListItemProps) {
  const dispatch = useAccountsDispatch()
  const navigate = useNavigate()
  const { ref, handleRef, isDragging } = useSortable({
    id: `group:${group.id}`,
    index,
  })
  const validCount = group.authorizations.filter((a) => a.valid).length
  const hasStale = group.authorizations.some((a) => a.stale)
  const totalCount = group.authorizations.length

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-4 p-4 rounded-xl border transition-all duration-200',
        'hover:bg-muted/20 hover:border-primary/15',
        selected && 'bg-primary/5 border-primary/25',
        !selected && 'border-border/50',
        isDragging && 'opacity-50 scale-[1.02] z-50',
      )}
    >
      <div
        ref={handleRef}
        className={cn(
          'cursor-grab active:cursor-grabbing p-1 rounded-md transition-colors flex-shrink-0',
          'text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50',
        )}
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <button
        type="button"
        onClick={() => dispatch.handleSelectGroup(group.id, !selected)}
        className="flex-shrink-0"
        aria-label={selected ? 'Deselect group' : 'Select group'}
      >
        {selected ? (
          <CheckSquare className="h-5 w-5 text-primary" />
        ) : (
          <Square className="h-5 w-5 text-muted-foreground/30 hover:text-muted-foreground/60" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[0.9375rem] truncate">{group.name}</span>
          {totalCount > 0 && (
            <GroupValidityChip validCount={validCount} totalCount={totalCount} hasStale={hasStale} />
          )}
        </div>
        <p className="text-xs text-muted-foreground/50 mt-0.5">
          创建于 {new Date(group.created).toLocaleDateString('zh-CN')}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {group.authorizations.slice(0, 5).map((auth) => (
          <PlatformBadge
            key={auth.id}
            platform={auth.platform}
            size="sm"
            title={dispatch.getPlatformLabel(auth.platform)}
          />
        ))}
        {group.authorizations.length > 5 && (
          <span className="text-xs text-muted-foreground/50 ml-1">
            +{group.authorizations.length - 5}
          </span>
        )}
      </div>

      {/*
        Same primary/secondary cluster split as SortableGroup — list
        view adds a "去发布此分组" Send button OUTSIDE the hover-gated
        cluster so the affordance is always discoverable, regardless
        of view mode (grid vs list). data-testid mirrors SortableGroup's
        so any future cross-view spec can locate both via the same key.
      */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground/60 hover:text-primary hover:bg-primary/10"
          onClick={() =>
            navigate(`${ROUTES.dashboard.publish}?group_id=${group.id}`)
          }
          aria-label="去发布中心 · 预选此分组"
          data-testid="go-to-publish-from-group-list"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
        {/* Single 2px between Send and the secondary wrapper comes from
            the outer `gap-0.5`. `border-l border-border/60` (vs /40) keeps
            the hairline crisp on retina. `md:focus-within:opacity-100`
            mirrors hover-reveal for keyboard-tab users. */}
        <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:hover:opacity-100 md:focus-within:opacity-100 transition-opacity border-l border-border/60 pl-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground/60 hover:text-primary hover:bg-primary/10"
            onClick={() => dispatch.handleStartRename(group.id, group.name)}
            aria-label="Rename group"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground/60 hover:text-primary hover:bg-primary/10"
            onClick={() => dispatch.handleStartAuthorize(group.id)}
            aria-label="Add authorization"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
                aria-label="Delete group"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认删除</AlertDialogTitle>
                <AlertDialogDescription>
                  删除分组 "{group.name}" 将同时删除所有平台授权，确认继续？
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void dispatch.handleDeleteGroup(group.id, group.name)}
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}
