/**
 * 共享 API 类型 — 从 client.ts 抽取，供各领域模块使用。
 */

import type { TimelineItemData } from '@/Components/ui/timeline'

export type ApiResponse<T> = {
  success: boolean
  data: T
  message?: string
}

export type PlatformOption = {
  label: string
  value: string
  color?: string
}

export const PLATFORMS: readonly PlatformOption[] = [
  { label: '抖音', value: 'douyin', color: 'magenta' },
  { label: '快手', value: 'kuaishou', color: 'orange' },
  { label: '小红书', value: 'xiaohongshu', color: 'red' },
  { label: '视频号', value: 'tencent', color: 'green' },
  { label: 'Bilibili', value: 'bilibili', color: 'blue' },
  { label: 'TikTok', value: 'tiktok', color: 'cyan' },
  { label: '百家号', value: 'baijiahao', color: 'gold' },
] as const

export const PLATFORMS_WITH_ICONS = PLATFORMS

export const LOGIN_PLATFORMS = PLATFORMS as readonly PlatformOption[]

/** Platforms that support note/image post uploads */
export const NOTE_PLATFORMS: readonly PlatformOption[] = [
  { label: '抖音', value: 'douyin', color: 'magenta' },
  { label: '快手', value: 'kuaishou', color: 'orange' },
  { label: '小红书', value: 'xiaohongshu', color: 'red' },
  { label: 'Bilibili', value: 'bilibili', color: 'blue' },
  { label: '视频号', value: 'tencent', color: 'green' },
] as const

/** Platform-specific maximum image counts for note/image posts */
export const NOTE_PLATFORM_IMAGE_LIMITS: Record<string, number> = {
  xiaohongshu: 9,
  douyin: 30,
  kuaishou: 18,
  bilibili: 20,
  tencent: 9,
  baijiahao: 30,
}

/** Get the max image count for a given platform, or a generous default */
export function getNoteImageLimit(platform?: string): number {
  if (platform && platform in NOTE_PLATFORM_IMAGE_LIMITS) {
    return NOTE_PLATFORM_IMAGE_LIMITS[platform]
  }
  return 30
}

/** Platforms that support QR-code-based login via SSE */
export const QR_LOGIN_PLATFORMS: readonly string[] = [
  'douyin',
  'kuaishou',
  'xiaohongshu',
  'tencent',
  'tiktok',
  'baijiahao',
] as const

export type AccountItem = {
  platform: string
  account_name: string
  path: string
}

export type AccountGroup = {
  id: number
  name: string
  created: string
  authorizations: AccountAuthorization[]
}

export type AccountAuthorization = {
  id: number
  platform: string
  cookie_file: string
  valid: boolean
  reason?: string
  age_hours?: number | null
  stale?: boolean
}

export type TaskItem = {
  task_id: string
  platform?: string
  action?: string
  account?: string
  status?: string
  created?: string
  code?: number | null
  error?: string | null
  argv?: string | null
  result?: string | null
  publish_detail?: string | null
}

/**
 * Calendar-cell payload returned by `GET /api/calendar/tasks`.
 *
 * `effective_date` is the calendar pin (coincides with EITHER `scheduled_at`
 * or `created` — whichever is non-null — auto-flattened to a
 * `YYYY-MM-DD` string by the server). The Calendar grid keys off
 * this field so a row's date placement matches the UI semantic for
 * "when this event happens" regardless of whether it's planned or
 * already-past.
 *
 * Both `scheduled_at` (ISO string OR null) and `created` (ISO
 * string) are returned so the cell can render the secondary
 * metadata strip ("10:00 · work1 · 已发布") without re-fetching.
 */
export type CalendarTaskItem = {
  task_id: string
  platform: string
  account: string
  action: string | null
  status: string
  title: string
  scheduled_at: string | null
  created: string
  effective_date: string
}

/**
 * Server-side aggregation payload sent alongside the task list. Used
 * by the calendar summary footer (Phase 3 of
 * `docs/DESIGN-content-calendar.md`). The keys of `by_platform` /
 * `by_status` are dynamic — the backend encodes a `"(none)"` literal
 * for any NULL `platform` / `status` so the dashboard always renders
 * non-empty buckets.
 */
export type CalendarSummary = {
  total: number
  by_platform: Record<string, number>
  by_status: Record<string, number>
}

export type LogEntry = {
  ts: string
  message: string
}

/**
 * Operator-facing publish event row consumed by the AboutTab 发布历史
 * timeline (sau_web/frontend/src/Components/ui/timeline.tsx :: TimelineItemData).
 *
 * Sourced from `/api/publish/history` — see web_runner/routes/tasks.py ::
 * list_publish_history for the server-side mapping.
 *
 * Aliased to `TimelineItemData` (NOT redeclared) so the React `<Timeline>`
 * compound component consumes the fetched array with zero per-row cast
 * boilerplate, AND so the union literal `'success' | 'failed' | 'pending'`
 * lives in only one place. Single source of truth:
 * `Components/ui/timeline.tsx::TimelineItemData`.
 *
 * Server returns `url: null` (NOT omitted) when no upstream published URL
 * is available; `TimelineItemData.url?: string` accepts that because
 * Timeline treats `null` and `undefined` identically at render time
 * (no <ExternalLink /> is rendered when either is present).
 */
export type PublishHistoryItem = TimelineItemData
