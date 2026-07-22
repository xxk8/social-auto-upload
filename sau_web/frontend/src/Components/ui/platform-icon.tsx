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
  // PNG logos (public/logo/)
  weibo: '/logo/weibo.png',
  zhihu: '/logo/zhihu.png',
  baidu: '/logo/baidu.png',
  toutiao: '/logo/toutiao.png',
  'douban-movie': '/logo/douban-movie.png',
  '36kr': '/logo/36kr.png',
  sspai: '/logo/sspai.png',
  ithome: '/logo/ithome.png',
  'qq-news': '/logo/qq-news.png',
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
  weibo: '/logo/weibo.png',
  zhihu: '/logo/zhihu.png',
  baidu: '/logo/baidu.png',
  toutiao: '/logo/toutiao.png',
  'douban-movie': '/logo/douban-movie.png',
  '36kr': '/logo/36kr.png',
  sspai: '/logo/sspai.png',
  ithome: '/logo/ithome.png',
  'qq-news': '/logo/qq-news.png',
}

export function PlatformIcon({ platform, className = 'h-5 w-5', variant = 'dark' }: PlatformIconProps) {
  const map = variant === 'light' ? ICON_MAP_SRC_LIGHT : ICON_MAP_SRC
  const src = map[platform]
  if (!src) return null

  return (
    <img src={src} alt={platform} className={className} />
  )
}
