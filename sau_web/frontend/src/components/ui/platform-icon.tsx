import { useState } from 'react'
import { cn } from '@/lib/utils'

import douyinSvg from '@/assets/brands/douyin-dark.svg'
import kuaishouSvg from '@/assets/brands/kuaishou-dark.svg'
import xiaohongshuSvg from '@/assets/brands/xiaohongshu-dark.svg'
import tencentSvg from '@/assets/brands/tencent-dark.svg'
import bilibiliSvg from '@/assets/brands/bilibili-dark.svg'
import tiktokSvg from '@/assets/brands/tiktok-dark.svg'
import baijiahaoDarkSvg from '@/assets/brands/baijiahao-dark.svg'
import youtubeSvg from '@/assets/brands/youtube-dark.svg'
import twitterSvg from '@/assets/brands/twitter-dark.svg'
import instagramSvg from '@/assets/brands/instagram-dark.svg'
import facebookSvg from '@/assets/brands/facebook-dark.svg'
import ixiguaSvg from '@/assets/brands/ixigua-dark.svg'
import dailymotionSvg from '@/assets/brands/dailymotion-dark.svg'
import rumbleSvg from '@/assets/brands/rumble-dark.svg'
import vkSvg from '@/assets/brands/vk-dark.svg'

import douyinLightSvg from '@/assets/brands/douyin.svg'
import kuaishouLightSvg from '@/assets/brands/kuaishou.svg'
import xiaohongshuLightSvg from '@/assets/brands/xiaohongshu.svg'
import tencentLightSvg from '@/assets/brands/tencent.svg'
import bilibiliLightSvg from '@/assets/brands/bilibili.svg'
import tiktokLightSvg from '@/assets/brands/tiktok.svg'

interface PlatformIconProps {
  platform: string
  className?: string
  variant?: 'dark' | 'light'
}

/** Bundled SVG brand marks (upload platforms). */
const ICON_MAP_SRC: Record<string, string> = {
  douyin: douyinSvg,
  kuaishou: kuaishouSvg,
  xiaohongshu: xiaohongshuSvg,
  tencent: tencentSvg,
  bilibili: bilibiliSvg,
  tiktok: tiktokSvg,
  baijiahao: baijiahaoDarkSvg,
  youtube: youtubeSvg,
  twitter: twitterSvg,
  instagram: instagramSvg,
  facebook: facebookSvg,
  ixigua: ixiguaSvg,
  dailymotion: dailymotionSvg,
  rumble: rumbleSvg,
  vk: vkSvg,
}

const ICON_MAP_SRC_LIGHT: Record<string, string> = {
  douyin: douyinLightSvg,
  kuaishou: kuaishouLightSvg,
  xiaohongshu: xiaohongshuLightSvg,
  tencent: tencentLightSvg,
  bilibili: bilibiliLightSvg,
  tiktok: tiktokLightSvg,
  youtube: youtubeSvg,
  twitter: twitterSvg,
  instagram: instagramSvg,
  facebook: facebookSvg,
  ixigua: ixiguaSvg,
  dailymotion: dailymotionSvg,
  rumble: rumbleSvg,
  vk: vkSvg,
  baijiahao: baijiahaoDarkSvg,
}

/**
 * Hotlist / crawl platforms without SVG in assets/brands — served from
 * `public/logo/*.png` (Vite static). Keep keys in sync with HotListPage SOURCES.
 */
const PUBLIC_LOGO: Record<string, string> = {
  weibo: '/logo/weibo.png',
  zhihu: '/logo/zhihu.png',
  baidu: '/logo/baidu.png',
  toutiao: '/logo/toutiao.png',
  'douban-movie': '/logo/douban-movie.png',
  '36kr': '/logo/36kr.png',
  sspai: '/logo/sspai.png',
  ithome: '/logo/ithome.png',
  'qq-news': '/logo/qq-news.png',
  // also allow png fallbacks for main brands if svg fails
  douyin: '/logo/douyin.png',
  kuaishou: '/logo/kuaishou.png',
  bilibili: '/logo/bilibili.png',
}

/** Short label for glyph fallback when no asset loads. */
const FALLBACK_GLYPH: Record<string, string> = {
  douyin: '抖',
  kuaishou: '快',
  bilibili: 'B',
  weibo: '微',
  zhihu: '知',
  baidu: '百',
  toutiao: '头',
  'douban-movie': '豆',
  '36kr': '氪',
  sspai: '少',
  ithome: 'IT',
  'qq-news': '腾',
  xiaohongshu: '红',
  tencent: '视',
  baijiahao: '百',
}

function resolveSrc(platform: string, variant: 'dark' | 'light'): string | undefined {
  const map = variant === 'light' ? ICON_MAP_SRC_LIGHT : ICON_MAP_SRC
  return map[platform] ?? PUBLIC_LOGO[platform]
}

function GlyphFallback({ platform, className }: { platform: string; className?: string }) {
  const glyph = FALLBACK_GLYPH[platform] ?? (platform.slice(0, 1).toUpperCase() || '?')
  return (
    <span
      role="img"
      aria-label={platform}
      className={cn(
        'inline-flex items-center justify-center rounded-[3px] bg-muted text-[9px] font-bold leading-none text-muted-foreground',
        className,
      )}
    >
      {glyph}
    </span>
  )
}

export function PlatformIcon({ platform, className = 'h-5 w-5', variant = 'dark' }: PlatformIconProps) {
  const [failed, setFailed] = useState(false)
  const src = resolveSrc(platform, variant)

  if (!src || failed) {
    return <GlyphFallback platform={platform} className={className} />
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('object-contain', className)}
      onError={() => setFailed(true)}
    />
  )
}
