/**
 * Global mini task queue for inbox background jobs (download / transcribe / subtitle).
 * Pinned near the top-right of the main content area; supports cancel + jump to inbox.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Mic,
  Pin,
  Subtitles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/routes'
import { useInboxStore, getInboxStore, type InboxEntry } from '@/stores/inboxStore'
import { cancelInboxJob, cancelAllInboxJobs } from '@/stores/inboxJobRegistry'

function jobKind(e: InboxEntry): 'download' | 'transcribe' | 'subtitle' | null {
  if (e.status === 'downloading') return 'download'
  if (e.status === 'transcribing') return 'transcribe'
  if (e.status === 'subtitling') return 'subtitle'
  return null
}

function kindMeta(kind: 'download' | 'transcribe' | 'subtitle') {
  switch (kind) {
    case 'download':
      return { icon: Download, label: '下载中', color: 'text-sky-500', bar: 'bg-sky-500' }
    case 'transcribe':
      return { icon: Mic, label: '转写中', color: 'text-violet-500', bar: 'bg-violet-500' }
    case 'subtitle':
      return { icon: Subtitles, label: '加字幕', color: 'text-primary', bar: 'bg-primary' }
  }
}

function shortName(e: InboxEntry): string {
  const raw = e.filename || e.url || e.id
  if (raw.length <= 28) return raw
  return `${raw.slice(0, 14)}…${raw.slice(-10)}`
}

function applyCancel(id: string) {
  cancelInboxJob(id)
  const e = getInboxStore().entries.find((x) => x.id === id)
  if (!e) return
  if (e.status === 'downloading') {
    // No useful partial state — drop the row
    getInboxStore().removeEntry(id)
    return
  }
  getInboxStore().updateEntry(id, {
    status: e.filename
      ? e.transcript
        ? 'transcribed'
        : 'downloaded'
      : 'failed',
    error: undefined,
    subtitleProgress: undefined,
    subtitleLabel: undefined,
    subtitlePhase: undefined,
  })
  getInboxStore().clearInflight(id)
}

export function InboxJobQueue({
  className,
  forceExpanded,
  /** Pin to top-right of viewport (below app header) instead of bottom. */
  pin = 'top',
}: {
  className?: string
  forceExpanded?: boolean
  pin?: 'top' | 'bottom'
}) {
  const entries = useInboxStore((s) => s.entries)
  const jobs = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.status === 'downloading' ||
          e.status === 'transcribing' ||
          e.status === 'subtitling',
      ),
    [entries],
  )
  const [expanded, setExpanded] = useState(Boolean(forceExpanded))
  const [open, setOpen] = useState(true)

  if (jobs.length === 0) return null

  const posClass =
    pin === 'top'
      ? 'top-[4.25rem] right-5 sm:right-6'
      : 'bottom-5 right-5 sm:right-6'

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'fixed z-40 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-background/95 px-3.5 py-2 text-xs font-semibold shadow-lg ring-1 ring-primary/10 backdrop-blur-md transition hover:border-primary/50 hover:shadow-xl',
          posClass,
          className,
        )}
        data-testid="inbox-job-queue-pill"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        {jobs.length} 个后台任务
      </button>
    )
  }

  const handleCancelAll = () => {
    cancelAllInboxJobs()
    const ids = getInboxStore()
      .entries.filter(
        (e) =>
          e.status === 'downloading' ||
          e.status === 'transcribing' ||
          e.status === 'subtitling',
      )
      .map((e) => e.id)
    for (const id of ids) applyCancel(id)
  }

  return (
    <div
      className={cn(
        'fixed z-40 w-[min(100vw-1.5rem,22.5rem)] overflow-hidden rounded-2xl border border-primary/20 bg-background/95 shadow-2xl shadow-primary/5 ring-1 ring-border/40 backdrop-blur-xl',
        posClass,
        className,
      )}
      data-testid="inbox-job-queue"
    >
      {/* Accent strip */}
      <div className="h-0.5 w-full bg-gradient-to-r from-primary via-sky-500 to-violet-500" />

      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
          <Pin className="h-3.5 w-3.5" />
        </span>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {jobs.length} 个后台任务
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <Link
          to={ROUTES.dashboard.inbox}
          className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
        >
          查看
        </Link>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
          onClick={handleCancelAll}
          title="全部取消"
        >
          全取消
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground"
          onClick={() => setOpen(false)}
          aria-label="收起队列"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && (
        <ul className="max-h-72 overflow-y-auto overscroll-contain border-t border-border/40 bg-muted/15 py-1">
          {jobs.map((e) => {
            const kind = jobKind(e)!
            const meta = kindMeta(kind)
            const Icon = meta.icon
            const pct = e.subtitleProgress
            return (
              <li
                key={e.id}
                className="mx-1.5 mb-1 flex items-start gap-2 rounded-xl border border-transparent bg-background/60 px-2.5 py-2 last:mb-1.5 hover:border-border/50"
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted',
                    meta.color,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {meta.label}
                    </span>
                    {typeof pct === 'number' && kind === 'subtitle' && (
                      <span className="tabular-nums text-[10px] text-muted-foreground">
                        {Math.round(pct)}%
                      </span>
                    )}
                    {kind === 'download' && e.startedAt && (
                      <ElapsedTiny startedAt={e.startedAt} />
                    )}
                  </div>
                  <p
                    className="truncate text-[11px] font-medium text-foreground"
                    title={e.filename || e.url}
                  >
                    {shortName(e)}
                  </p>
                  {e.subtitleLabel && kind === 'subtitle' && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {e.subtitleLabel}
                    </p>
                  )}
                  {kind === 'subtitle' && typeof pct === 'number' && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full transition-all', meta.bar)}
                        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                      />
                    </div>
                  )}
                  {kind === 'download' && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full w-2/5 animate-pulse rounded-full', meta.bar)} />
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => applyCancel(e.id)}
                >
                  取消
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {!expanded && jobs[0] && (
        <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {shortName(jobs[0])}
            {jobs[0].subtitleLabel ? ` · ${jobs[0].subtitleLabel}` : ''}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-1.5 text-[11px] hover:text-destructive"
            onClick={() => applyCancel(jobs[0].id)}
          >
            取消
          </Button>
        </div>
      )}
    </div>
  )
}

function ElapsedTiny({ startedAt }: { startedAt: number }) {
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return (
    <span className="tabular-nums text-[10px] text-muted-foreground/70">
      {m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`}
    </span>
  )
}
