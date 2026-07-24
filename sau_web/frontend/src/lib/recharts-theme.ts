// ─────────────────────────────────────────────────────────────────────
// recharts-theme — unified visual configuration for all recharts
// charts in the project.
//
// Before this module, 5 files each defined their own `tooltipStyle`
// constant with the exact same 5 fields. Axis tick configs
// (`{ fontSize: 11, fill: 'var(--muted-foreground)' }`) were also
// duplicated across FailureReasonChart, VolumeTrendChart, and
// SuccessRateTrendChart. CrawlPage and PlatformDistribution had
// inline tooltip style objects too.
//
// This module is the single source of truth. Every recharts consumer
// imports from here so a future palette or font-size change is a
// 1-file edit, not a 7-file find-and-replace.
//
// Design tokens: all colours reference CSS custom properties defined
// in `src/index.css` (--popover, --border, --muted-foreground, etc.)
// so light/dark theme switching is automatic.
//
// Module exports ONLY constants and types — no React components — so
// Fast Refresh stays happy (`react-refresh/only-export-components`).
// ─────────────────────────────────────────────────────────────────────

/**
 * Unified Tooltip `contentStyle` — passed to recharts `<Tooltip>`
 * via `contentStyle={CHART_TOOLTIP_STYLE}`.
 *
 * Used by: PlatformPieChart, FailureReasonChart, VolumeTrendChart,
 * SuccessRateTrendChart, PlatformDistribution, CrawlPage (×3).
 */
export const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--popover-foreground)',
} as const

/**
 * Unified axis tick style — passed to recharts `<XAxis>` / `<YAxis>`
 * via `tick={CHART_TICK_STYLE}`.
 *
 * Font size 11px matches the eyebrow / meta text used across the
 * dashboard card components. Colour tracks the muted-foreground
 * token so it adapts to dark mode.
 */
export const CHART_TICK_STYLE = {
  fontSize: 11,
  fill: 'var(--muted-foreground)',
} as const

/**
 * Unified axis line style — passed via `axisLine={{ stroke: ... }}`.
 * Uses the border token so axis lines match card hairline borders.
 */
export const CHART_AXIS_LINE = {
  stroke: 'var(--border)',
} as const

/**
 * Unified CartesianGrid stroke — passed via `stroke="..."` on
 * `<CartesianGrid>`. Uses border token at 50% opacity for a subtle
 * grid that doesn't compete with the data.
 */
export const CHART_GRID_STROKE = 'var(--border)'

/**
 * Unified gap between pie slices — uses the background token so
 * slices appear to "float" on the card surface in both themes.
 * Passed via `stroke="var(--background)"` on `<Cell>`.
 */
export const CHART_SLICE_GAP = 'var(--background)'

/**
 * Unified animation duration (ms) for bar / line enter animations.
 * Kept short (500ms) so chart data swaps feel snappy rather than
 * theatrical. Sparkline uses `isAnimationActive={false}` and is
 * exempt — it's a static mini indicator, not an interactive chart.
 */
export const CHART_ANIMATION_DURATION = 500

/**
 * Sentiment colour palette — hex values used as recharts `<Cell fill>`.
 * Shared between CrawlPage's sentiment BarChart, donut PieChart, and
 * the CommentsTab mini chart so all three stay in lockstep.
 *
 * Exported here (rather than staying inside CrawlPage) so a future
 * sentiment chart on another page can reuse the same palette without
 * duplicating the constant.
 */
export const SENTIMENT_COLORS = {
  positive: '#10b981',
  negative: '#f43f5e',
  neutral: '#64748b',
  pending: '#f59e0b',
} as const

/**
 * Platform brand colour palette — hex values for recharts `<Cell fill>`.
 * These are platform identity colours that should NOT change with
 * theme switching (Douyin magenta, Bilibili blue, etc.).
 *
 * Source of truth: mirrors `PLATFORM_COLORS` in PlatformPieChart.tsx.
 * That file keeps its local copy for now (to avoid a cross-feature
 * import), but new charts should import from here.
 */
export const PLATFORM_COLORS: Record<string, string> = {
  douyin: '#ff0050',
  kuaishou: '#ff7a00',
  xiaohongshu: '#ff2442',
  tencent: '#07c160',
  bilibili: '#00a1d6',
  tiktok: '#00f2ea',
  baijiahao: '#f5a623',
}

/**
 * Generic 8-colour palette for categorical data that doesn't have
 * brand identity (e.g. PlatformDistribution's hash-based assignment).
 * HSL values chosen for perceptual uniformity across hue families.
 *
 * Exported as a plain array so consumers can index by `hash % length`.
 */
export const CHART_PALETTE: ReadonlyArray<string> = [
  'hsl(220 60% 55%)',
  'hsl(330 60% 60%)',
  'hsl(15 70% 60%)',
  'hsl(45 75% 55%)',
  'hsl(165 55% 50%)',
  'hsl(265 55% 60%)',
  'hsl(195 60% 50%)',
  'hsl(105 50% 50%)',
]
