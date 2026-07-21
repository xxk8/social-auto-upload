// Module-private constants extracted to satisfy react-refresh Fast Refresh.
// Imported by platform-chip-strip.tsx and test files that lock the
// platform set / active-state behavior.

export type PlatformKey =
  | 'douyin' | 'kuaishou' | 'xiaohongshu' | 'bilibili'
  | 'youtube' | 'tiktok' | 'twitter' | 'instagram' | 'facebook'
  | 'tencent' | 'ixigua' | 'dailymotion' | 'rumble' | 'vk'
  | 'general'

export interface Platform {
  key: PlatformKey
  name: string
  engine: string
  src: string | null
}

// Hostnames intentionally distinct from InboxPage's `HOST_TO_PLATFORM`
// (short-link detection hosts vs canonical homepage hosts); do not merge.
export const PLATFORM_URLS: Record<string, string> = {
  douyin: 'https://www.douyin.com',
  kuaishou: 'https://www.kuaishou.com',
  xiaohongshu: 'https://www.xiaohongshu.com',
  bilibili: 'https://www.bilibili.com',
  youtube: 'https://www.youtube.com',
  tiktok: 'https://www.tiktok.com',
  twitter: 'https://x.com',
  instagram: 'https://www.instagram.com',
  facebook: 'https://www.facebook.com',
  tencent: 'https://channels.weixin.qq.com',
  ixigua: 'https://www.ixigua.com',
  dailymotion: 'https://www.dailymotion.com',
  rumble: 'https://rumble.com',
  vk: 'https://vk.com',
}

// Engine legend (mirrored from the historical `InboxPage` block):
//   • yt-dlp — general-purpose extractor (~1500 sites).
//   • browser(patchright) — anti-bot-heavy platforms where yt-dlp
//     extractors are unreliable (Douyin / Kuaishou / Xiaohongshu).
//   • yt-dlp / BBDown — Bilibili primary path (BBDown gives TV-API
//     watermark-free output). Both engines are kept in chip label
//     for transparency about which one fired per request.
//
// See scripts/test_platform_downloads.py for the full test matrix.
export const PLATFORMS: ReadonlyArray<Platform> = [
  // Browser-first (patchright)
  { key: 'douyin', name: '抖音', engine: 'browser(patchright)', src: '/brands/douyin.svg' },
  { key: 'kuaishou', name: '快手', engine: 'browser(patchright)', src: '/brands/kuaishou.svg' },
  { key: 'xiaohongshu', name: '小红书', engine: 'browser(patchright)', src: '/brands/xiaohongshu.svg' },
  // yt-dlp + dedicated engines
  { key: 'bilibili', name: 'B站', engine: 'yt-dlp / BBDown', src: '/brands/bilibili.svg' },
  { key: 'youtube', name: 'YouTube', engine: 'yt-dlp', src: '/brands/youtube.svg' },
  { key: 'tiktok', name: 'TikTok', engine: 'yt-dlp', src: '/brands/tiktok.svg' },
  { key: 'twitter', name: 'X (Twitter)', engine: 'yt-dlp', src: '/brands/twitter.svg' },
  { key: 'instagram', name: 'Instagram', engine: 'yt-dlp', src: '/brands/instagram.svg' },
  { key: 'facebook', name: 'Facebook', engine: 'yt-dlp', src: '/brands/facebook.svg' },
  { key: 'tencent', name: '视频号', engine: 'yt-dlp', src: '/brands/tencent.svg' },
  { key: 'ixigua', name: '西瓜视频', engine: 'yt-dlp', src: '/brands/ixigua.svg' },
  { key: 'dailymotion', name: 'Dailymotion', engine: 'yt-dlp', src: '/brands/dailymotion.svg' },
  { key: 'rumble', name: 'Rumble', engine: 'yt-dlp', src: '/brands/rumble.svg' },
  { key: 'vk', name: 'VK', engine: 'yt-dlp', src: '/brands/vk.svg' },
  // Catch-all for the rest (皮皮虾, 微视, 秒拍, etc.)
  { key: 'general', name: '其他·通用', engine: 'yt-dlp', src: null },
]