// ──────────────────────────────────────────────────────────────────────────
// ui/platform-icon.helpers.ts — `react-refresh/only-export-components` allow-list.
//
// Companion to `ui/platform-icon.tsx`. The original file shipped two
// `Record<string,string>` constants (`PLATFORM_COLORS`, `PLATFORM_BORDER_LEFT`)
// as top-level value exports alongside the `<PlatformIcon>` component. Both
// are value exports (not types) and break Vite Fast Refresh. They now live
// here.
//
// Consumers split:
//   - `<PlatformIcon>` from `@/Components/ui/platform-icon`
//   - `{ PLATFORM_COLORS, PLATFORM_BORDER_LEFT }` from
//     `@/Components/ui/platform-icon.helpers`
// ──────────────────────────────────────────────────────────────────────────

/**
 * Brand swatches used by tone-style chips (e.g., the account-row icon background).
 * Hex literals are kept here as Tailwind-v4 literal classes so the JIT scanner
 * emits the rules. Keep in sync with PLATFORM_BORDER_LEFT below — both share
 * the same brand palette; the split exists only because Tailwind does not
 * allow runtime brand-color composition via `var(--brand)`.
 */
export const PLATFORM_COLORS: Record<string, string> = {
  douyin: 'bg-black',
  kuaishou: 'bg-[#FF4906]',
  xiaohongshu: 'bg-[#FE2C55]',
  tencent: 'bg-[#07C160]',
  bilibili: 'bg-[#00A1D6]',
  tiktok: 'bg-black',
  baijiahao: 'bg-[#D7000F]',
}

/**
 * 3px left-border mud-tint class used by GroupPublishSelector rows.
 * Douyin / TikTok legitimately use a neutral brand (their logos are
 * monochrome) so we don't drift them onto the colorful palette — preserve
 * the legacy neutral-800/300 pair.
 *
 * SSoT pairing: each entry corresponds 1:1 with the brand color in
 * `PLATFORM_COLORS`. Update both together when rebranding.
 *
 * Migration note (OPT-1B): previously inlined in `GroupPublishSelector.tsx`;
 * moved here as part of the design-token migration. The `.light-mode-override`
 * style above now reads this map rather than its own local constant.
 */
export const PLATFORM_BORDER_LEFT: Record<string, string> = {
  douyin: 'border-l-neutral-800 dark:border-l-neutral-300',
  kuaishou: 'border-l-[#FF4906]/70',
  xiaohongshu: 'border-l-[#FE2C55]/70',
  tencent: 'border-l-[#07C160]/70',
  bilibili: 'border-l-[#00A1D6]/70',
  tiktok: 'border-l-neutral-800 dark:border-l-neutral-300',
  baijiahao: 'border-l-[#D7000F]/70',
}

/**
 * Hex brand values (`#RRGGBB`) — `PLATFORM_COLORS` exposes Tailwind
 * class strings for chip-style surfaces, but the calendar
 * (Features/calendar/CalendarEvent.tsx) needs HARDCODED hex to drive
 * `react-big-calendar`'s `eventPropGetter.style.backgroundColor`.
 * Tailwind JIT won't compile runtime-generated class names, so
 * the calendar can't reuse `bg-[#FF4906]`; we materialise the
 * brand hex here as a sibling constant.
 *
 * SSoT pairing: each entry corresponds to the `bg-[#XXXXXX]`
 * literal in `PLATFORM_COLORS`. Update both together when
 * rebranding. Douyin + TikTok deliberately stay neutral `#000`
 * to match the monochrome-logo convention encoded in
 * `PLATFORM_COLORS`.
 */
export const PLATFORM_HEX: Record<string, string> = {
  douyin: '#000000',
  kuaishou: '#FF4906',
  xiaohongshu: '#FE2C55',
  tencent: '#07C160',
  bilibili: '#00A1D6',
  tiktok: '#000000',
  baijiahao: '#D7000F',
}

/**
 * Resolve a brand hex for any platform key. Known platforms use the
 * curated `PLATFORM_HEX` swatch; unknown platforms (e.g. youtube /
 * twitter / weibo) get a deterministic HSL derived from the key so the
 * calendar never falls back to a flat gray cell that reads as "broken"
 * next to the colored ones.
 */
export function platformHex(platform: string): string {
  const known = PLATFORM_HEX[platform]
  if (known) return known
  let h = 0
  for (let i = 0; i < platform.length; i++) {
    h = (h * 31 + platform.charCodeAt(i)) >>> 0
  }
  return `hsl(${h % 360} 60% 45%)`
}
