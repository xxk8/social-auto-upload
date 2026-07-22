import { cn } from '@/lib/utils'
import { PlatformIcon } from './platform-icon'
import { Badge } from './badge'
import {
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
} from 'lucide-react'
import type { ReactNode } from 'react'

/* eslint-disable react-refresh/only-export-components */
// ── Types ────────────────────────────────────────────────────────────────

export type TimelineStatus = 'success' | 'failed' | 'pending'

export interface TimelineItemData {
  /** Unique identifier */
  id: string
  /** ISO date string or display label, e.g. "2026-03-15" */
  date: string
  /** Main title of the timeline entry */
  title: string
  /** Platform identifier, passed to <PlatformIcon /> */
  platform?: string
  /** Status badge */
  status?: TimelineStatus
  /** Optional external URL */
  url?: string
  /** Extra content rendered below the title */
  description?: string
}

// ── Status helpers ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TimelineStatus, {
  label: string
  icon: typeof CheckCircle2
  dot: string
  badge: string
  line: string
}> = {
  success: {
    label: '成功',
    icon: CheckCircle2,
    dot: 'bg-emerald-500 border-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    line: 'bg-emerald-300/40 dark:bg-emerald-500/25',
  },
  failed: {
    label: '失败',
    icon: XCircle,
    dot: 'bg-red-500 border-red-500',
    badge: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    line: 'bg-red-300/40 dark:bg-red-500/25',
  },
  pending: {
    label: '进行中',
    icon: Clock,
    dot: 'bg-amber-400 border-amber-400',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    line: 'bg-amber-300/40 dark:bg-amber-500/25',
  },
}

// ── Sub-components ──────────────────────────────────────────────────────

function TimelineDot({ status }: { status?: TimelineStatus }) {
  const cfg = status ? STATUS_CONFIG[status] : undefined
  const Icon = cfg?.icon ?? CheckCircle2
  return (
    <div className="relative flex flex-col items-center">
      {/* Dot */}
      <div
        className={cn(
          'z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-background',
          cfg?.dot ?? 'border-muted-foreground/30',
        )}
      >
        <Icon
          className={cn(
            'h-3 w-3',
            status === 'success' && 'text-emerald-500',
            status === 'failed' && 'text-red-500',
            status === 'pending' && 'text-amber-400',
            !status && 'text-muted-foreground/50',
          )}
        />
      </div>
    </div>
  )
}

function TimelineLine({ status }: { status?: TimelineStatus }) {
  const cfg = status ? STATUS_CONFIG[status] : undefined
  return (
    <div
      className={cn(
        'w-px flex-1',
        cfg?.line ?? 'bg-border',
      )}
      aria-hidden
    />
  )
}

// ── Root ─────────────────────────────────────────────────────────────────

interface TimelineRootProps {
  children: ReactNode
  className?: string
}

function TimelineRoot({ children, className }: TimelineRootProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col',
        '[&>*:last-child_.timeline-line]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ── Item ─────────────────────────────────────────────────────────────────

interface TimelineItemProps {
  data: TimelineItemData
  /** Whether the dot+line use the status colour (default: true) */
  colorCoded?: boolean
  className?: string
}

function TimelineItem({
  data: { date, title, platform, status, url, description },
  colorCoded = true,
  className,
}: TimelineItemProps) {
  const resolvedStatus = colorCoded ? status : undefined
  const StatusIcon = status ? STATUS_CONFIG[status].icon : null

  return (
    <div className={cn('relative flex gap-4 pb-8 last:pb-0', className)}>
      {/* Left column: dot + line */}
      <div className="flex flex-col items-center">
        <TimelineDot status={resolvedStatus} />
        <TimelineLine status={resolvedStatus} />
      </div>

      {/* Right column: content card */}
      <div className="min-w-0 flex-1 pt-0.5">
        {/* Date row */}
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground/60">
          {date}
        </span>

        {/* Title + platform + status row */}
        <div className="mt-1 flex items-start gap-2">
          <h4 className="text-sm font-medium text-foreground leading-snug break-words min-w-0">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline decoration-muted-foreground/30 underline-offset-2 inline-flex items-center gap-1"
              >
                {title}
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              </a>
            ) : (
              title
            )}
          </h4>

          {/* Platform icon */}
          {platform && (
            <PlatformIcon
              platform={platform}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
          )}

          {/* Status badge */}
          {status && (
            <Badge
              variant="outline"
              className={cn(
                'ml-auto shrink-0 gap-1 px-1.5 py-0 text-[10px] font-medium leading-normal',
                STATUS_CONFIG[status].badge,
              )}
            >
              {StatusIcon && <StatusIcon className="h-2.5 w-2.5" />}
              {STATUS_CONFIG[status].label}
            </Badge>
          )}
        </div>

        {/* Description */}
        {description && (
          <p className="mt-1 text-xs text-muted-foreground/80 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────

interface TimelineEmptyProps {
  message?: string
  className?: string
}

function TimelineEmpty({
  message = '暂无发布记录',
  className,
}: TimelineEmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className,
      )}
    >
      <Clock className="h-8 w-8 text-muted-foreground/30" />
      <p className="mt-3 text-sm text-muted-foreground/60">{message}</p>
    </div>
  )
}

// ── Export compound component ───────────────────────────────────────────

/**
 * GitHub-style vertical timeline for displaying publish history,
 * activity logs, or any chronological event list.
 *
 * @example
 * ```tsx
 * <Timeline>
 *   <Timeline.Item data={{ id:'1', date:'2026-03-15', title:'My Video',
 *     platform:'douyin', status:'success' }} />
 * </Timeline>
 * ```
 */
export const Timeline = Object.assign(TimelineRoot, {
  Item: TimelineItem,
  Empty: TimelineEmpty,
})