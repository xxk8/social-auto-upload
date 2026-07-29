/**
 * Pure helper functions extracted from InboxPage.tsx for testability.
 * All functions are side-effect-free and suitable for unit testing.
 */

import type { PlatformKey } from '@/components/ui/platform-chip-strip'

// ── Entry ID generation ──────────────────────────────────────────────

export const newEntryId = () =>
  `entry_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

// ── Cookie staleness detection ──────────────────────────────────────

export function isCookieStalenessError(error: string | undefined): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return (
    (lower.includes('cookies are') && lower.includes('h old') && lower.includes('anti-bot')) ||
    lower.includes('fresh cookies (not necessarily logged in) are needed')
  )
}

// ── Friendly error messages ─────────────────────────────────────────

/** Check if the error indicates authentication is needed (e.g. YouTube login). */
export function isAuthRequiredError(
  error: string | undefined,
  response?: { auth_required?: boolean; platform?: string },
): boolean {
  // Backend now returns a structured auth_required flag for YouTube.
  if (response?.auth_required) return true
  if (!error) return false
  const lower = error.toLowerCase()
  return (
    lower.includes('sign in to confirm') ||
    lower.includes('需要登录验证') ||
    lower.includes('登录验证才能下载') ||
    lower.includes('请先前往「账号管理」')
  )
}

/** Get the platform that requires auth. */
export function authRequiredPlatform(
  response?: { auth_required?: boolean; platform?: string },
): string | null {
  if (response?.auth_required && response?.platform) {
    return response.platform
  }
  return null
}

/** Strip tool names / install hints so the UI stays product-facing. */
export function friendlyErrorMessage(error: string | undefined): string | undefined {
  if (!error) return error
  const lower = error.toLowerCase()
  if (lower.includes('yt-dlp not installed') || lower.includes('pip install yt-dlp')) {
    return '下载服务暂不可用，请稍后重试或联系管理员'
  }
  if (lower.includes('extractor returned empty') || lower.includes('unsupported url')) {
    return '无法识别该链接，请确认平台是否支持，或换一条分享链接'
  }
  // Auth-required errors already have user-friendly messages from backend.
  if (isAuthRequiredError(error)) {
    return error  // Keep the Chinese message from backend as-is.
  }
  // Hide raw engine names while keeping the rest of the message readable.
  return error
    .replace(/\byt-dlp\b/gi, '下载服务')
    .replace(/\bpatchright\b/gi, '浏览器')
    .replace(/\bbbdown\b/gi, '下载服务')
    .replace(/\bplaywright\b/gi, '浏览器')
}

// ── Transcribe failure detection ────────────────────────────────────

/** Backend may stream a failure line after HTTP 200 — treat as error, not transcript. */
export function isStreamedTranscribeFailure(text: string | undefined): boolean {
  if (!text) return false
  const t = text.trim()
  return (
    t.startsWith('转写失败') ||
    t.startsWith('转写功能需要') ||
    t.includes('转写服务未就绪')
  )
}

// ── URL extraction from share text ───────────────────────────────────

const SHARE_URL_RE = /https?:\/\/[^\s]+/i
const TRAILING_CN_PUNCT_RE = /[，。！？、；：「」『』]+$/

/** Extract the first http(s) URL from a string, stripping trailing CJK punctuation. */
export function extractFirstUrl(input: string): string | null {
  const match = SHARE_URL_RE.exec(input)
  return match ? match[0].replace(TRAILING_CN_PUNCT_RE, '') : null
}

// ── Platform detection ───────────────────────────────────────────────

// URL hostname → platform key (mirrors web_runner/routes/inbox.py _URL_HOST_TO_PLATFORM)
// + extended with yt-dlp-supported platforms for frontend auto-detection.
export const HOST_TO_PLATFORM: Record<string, PlatformKey> = {
  // Browser-first (patchright)
  'douyin.com': 'douyin',
  'www.douyin.com': 'douyin',
  'v.douyin.com': 'douyin',
  'kuaishou.com': 'kuaishou',
  'www.kuaishou.com': 'kuaishou',
  'v.kuaishou.com': 'kuaishou',
  'xiaohongshu.com': 'xiaohongshu',
  'www.xiaohongshu.com': 'xiaohongshu',
  'xhslink.com': 'xiaohongshu',
  'www.xhslink.com': 'xiaohongshu',
  // yt-dlp / BBDown
  'bilibili.com': 'bilibili',
  'www.bilibili.com': 'bilibili',
  'b23.tv': 'bilibili',
  // yt-dlp (视频号 / 腾讯视频)
  'v.qq.com': 'tencent',
  'channels.weixin.qq.com': 'tencent',
  // yt-dlp (general video)
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'm.youtube.com': 'youtube',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'm.tiktok.com': 'tiktok',
  'twitter.com': 'twitter',
  'www.twitter.com': 'twitter',
  'x.com': 'twitter',
  't.co': 'twitter',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'fb.watch': 'facebook',
  'm.facebook.com': 'facebook',
  // yt-dlp (西瓜视频 / 国内综合)
  'ixigua.com': 'ixigua',
  'www.ixigua.com': 'ixigua',
  'm.ixigua.com': 'ixigua',
  // yt-dlp (海外视频)
  'dailymotion.com': 'dailymotion',
  'www.dailymotion.com': 'dailymotion',
  'dai.ly': 'dailymotion',
  'rumble.com': 'rumble',
  'www.rumble.com': 'rumble',
  'vk.com': 'vk',
  'www.vk.com': 'vk',
  'vkvideo.ru': 'vk',
  // 皮皮虾 / 微视 / 秒拍 — covered by 'general' fallback.
}

/** Detect the platform from a URL or share text string. */
export function detectPlatform(input: string): PlatformKey | null {
  const urlStr = extractFirstUrl(input)
  if (!urlStr) return null
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase()
    for (const [domain, platform] of Object.entries(HOST_TO_PLATFORM)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return platform
      }
    }
    // Recognizable http(s) URL that didn't match any known platform → general
    return 'general'
  } catch {
    return null
  }
}

// ── Byte formatting ─────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ── Status / Filter constants ────────────────────────────────────────

export type StatusFilter = import('@/stores/inboxStore').StatusFilter
export type InboxStatus = import('@/stores/inboxStore').InboxStatus
export type SubtitleMode = import('@/stores/inboxStore').SubtitleMode

export const FILTER_OPTIONS: ReadonlyArray<{
  key: StatusFilter
  labelKey: string
  labelFallback: string
}> = [
  { key: 'all', labelKey: 'inbox.filters.all', labelFallback: '全部' },
  { key: 'downloading', labelKey: 'inbox.filters.downloading', labelFallback: '下载中' },
  { key: 'downloaded', labelKey: 'inbox.filters.downloaded', labelFallback: '已下载' },
  { key: 'failed', labelKey: 'inbox.filters.failed', labelFallback: '失败' },
  { key: 'transcribing', labelKey: 'inbox.filters.transcribing', labelFallback: '转写中' },
  { key: 'transcribed', labelKey: 'inbox.filters.transcribed', labelFallback: '已转写' },
  { key: 'subtitling', labelKey: 'inbox.filters.subtitling', labelFallback: '加字幕中' },
]

export const STATUS_ORDER: InboxStatus[] = [
  'downloading',
  'transcribing',
  'subtitling',
  'failed',
  'downloaded',
  'transcribed',
]

export const STATUS_LABEL_META: Record<
  InboxStatus,
  { labelKey: string; labelFallback: string }
> = {
  downloading: { labelKey: 'inbox.row.badge.downloading', labelFallback: '下载中' },
  downloaded: { labelKey: 'inbox.row.badge.downloaded', labelFallback: '已下载' },
  failed: { labelKey: 'inbox.row.badge.failed', labelFallback: '失败' },
  transcribing: { labelKey: 'inbox.row.badge.transcribing', labelFallback: '转写中' },
  transcribed: { labelKey: 'inbox.row.badge.transcribed', labelFallback: '已转写' },
  subtitling: { labelKey: 'inbox.row.badge.subtitling', labelFallback: '加字幕中' },
}

export const SUBTITLE_MODE_OPTIONS: ReadonlyArray<{
  value: SubtitleMode
  label: string
  description: string
}> = [
  {
    value: 'bilingual',
    label: '中英双语',
    description: '原文 + 中文对照，阅读理解最方便（推荐）',
  },
  {
    value: 'zh',
    label: '中文字幕',
    description: '识别后译成中文，适合看外文视频',
  },
  {
    value: 'en',
    label: '英文字幕',
    description: '识别后译成英文（Whisper 内置翻译）',
  },
  {
    value: 'source',
    label: '原语言',
    description: '按视频原始语言生成字幕，不翻译',
  },
]
