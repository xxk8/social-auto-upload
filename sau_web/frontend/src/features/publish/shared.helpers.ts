// ──────────────────────────────────────────────────────────────────────────
// publish/shared.helpers.ts — `react-refresh/only-export-components` allow-list.
//
// Companion to `publish/shared.tsx`. Every non-component TOP-level export
// from the original `.tsx` would trip the Vite Fast Refresh rule, so all
// callable helpers, constants, and formatters live here in a `.ts`
// sibling. The `.tsx` keeps only React components (today: `SectionHeader`).
//
// Consumers split:
//   - `SectionHeader` (component) stays imported from `@/features/publish/shared`
//   - helpers (`PLATFORM_TAG_LIMITS`, `effectiveMaxTags`, `platformTagLabel`,
//     `formatTaskId`) are imported from `@/features/publish/shared.helpers`
// ──────────────────────────────────────────────────────────────────────────

import { PLATFORMS } from '../../api/client'

/**
 * Per-platform tag-count limits (XHS caps at 10; most others at 5).
 * Used to cap the TagInput and to surface a contextual hint.
 */
export const PLATFORM_TAG_LIMITS: Record<string, number | undefined> = {
  xiaohongshu: 10,
  bilibili: 5,
  baijiahao: 5,
  douyin: 5,
  kuaishou: 5,
  tencent: 5,
  tiktok: 5,
}

export function effectiveMaxTags(platforms: string[]): number | undefined {
  const limits = platforms
    .map((p) => PLATFORM_TAG_LIMITS[p])
    .filter((l): l is number => l !== undefined)
  if (limits.length === 0) return undefined
  return Math.min(...limits)
}

export function platformTagLabel(platforms: string[]): string {
  const limit = effectiveMaxTags(platforms)
  if (limit === undefined) return '无限制'
  const matched = platforms.find((p) => PLATFORM_TAG_LIMITS[p] === limit)
  const label = matched ? PLATFORMS.find((p) => p.value === matched)?.label || matched : ''
  return label ? `${label}最多 ${limit} 个` : `最多 ${limit} 个`
}

/**
 * Used by PublishStatsBar to compactly render recently submitted task IDs.
 * Long IDs are shortened to the last 10 chars preceded by an ellipsis.
 *
 * Note: this is the publish-specific simple-elide form. The cross-page
 * hyphen-aware compactor is `shortenId` in `@/lib/features`.
 */
export function formatTaskId(value?: string): string {
  if (!value) return '-'
  return value.length > 14 ? `...${value.slice(-10)}` : value
}
