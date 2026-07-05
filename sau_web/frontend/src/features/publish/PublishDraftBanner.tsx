import { AlertTriangle, History, Trash2 } from 'lucide-react'
import { Button } from '@/Components/ui/button'
import { cn } from '@/lib/utils'
import { toneChipClasses } from '@/lib/tone'

/**
 * PR-OPT-2D-1 — Draft recovery banner.
 *
 * Sits above the submit/clear row inside the publish form. The parent
 * (VideoForm / NoteForm) renders this only when `usePublishDraft` reports a
 * non-null `pendingDraft`. Clicking 「恢复」 runs the form's restore
 * callback (applies each persisted field); clicking 「丢弃」 clears the LS
 * slot and dismisses the banner via `onAcknowledge`.
 *
 * The banner uses a soft warning tone (`toneChipClasses('warning')`) to
 * signal "non-blocking informational" without screaming red. Icon is a
 * History outline so it reads as "earlier session".
 */

interface PublishDraftBannerProps {
  /** True when a draft is awaiting user decision. */
  visible: boolean
  /** ISO timestamp from the LS envelope — drives "X 分钟前" copy. */
  savedAt: string | null
  /** How persisted fields were most likely applied (e.g. "已恢复标题、正文、标签"). */
  fieldsHint?: string
  /** Number of fields that will be restored, used as a memory aid. */
  fieldCount?: number
  /** Restore handler — parent writes back to its useState setters. */
  onRestore: () => void
  /** Acknowledge + remove from LS. */
  onDiscard: () => void
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return ''
  try {
    const ms = Date.now() - new Date(iso).getTime()
    if (Number.isNaN(ms)) return ''
    if (ms < 60_000) return '刚刚'
    const mins = Math.floor(ms / 60_000)
    if (mins < 60) return `${mins} 分钟前`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} 小时前`
    const days = Math.floor(hrs / 24)
    return `${days} 天前`
  } catch {
    return ''
  }
}

export function PublishDraftBanner({
  visible,
  savedAt,
  fieldsHint,
  fieldCount,
  onRestore,
  onDiscard,
}: PublishDraftBannerProps) {
  if (!visible) return null

  const when = formatSavedAt(savedAt)

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border p-3 text-sm shadow-sm',
        toneChipClasses('warning'),
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <History className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium leading-tight">
            检测到上次未提交的草稿{when && <span className="ml-1 text-xs font-normal opacity-75">（{when}）</span>}
          </p>
          <p className="text-xs opacity-80 leading-snug mt-0.5">
            {fieldsHint ??
              (fieldCount != null
                ? `将恢复 ${fieldCount} 项字段；文件请重新上传。`
                : '将恢复字段；文件请重新上传。')}
          </p>
          {fieldCount != null && fieldCount === 0 && (
            <p className="text-[11px] opacity-70 mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              草稿中已无可恢复的文本字段（文件不会保存到草稿）。
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-md px-2.5 text-xs font-medium"
          onClick={onDiscard}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          丢弃
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-md px-2.5 text-xs font-medium"
          onClick={onRestore}
        >
          恢复
        </Button>
      </div>
    </div>
  )
}
