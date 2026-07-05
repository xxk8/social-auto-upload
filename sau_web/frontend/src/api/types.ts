/**
 * 共享 API 类型 — 从 client.ts 抽取，供各领域模块使用。
 */

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

export type LogEntry = {
  ts: string
  message: string
}