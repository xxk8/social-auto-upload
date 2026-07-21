/**
 * CrawlPage — Web Shell's dashboard tab for the 7-platform crawler
 * (openspec/changes/mediacrawler-integration).
 *
 * Visual design (polished):
 *   • Hero banner: gradient bg + decorative blur blobs + feature pill
 *     row showing which 5 crawler capabilities are loaded into the
 *     page at a glance
 *   • Health stats strip (content count, comment count, API status)
 *     — gradient-tinted icon containers + brand-color number tint
 *   • Sentiment distribution visual bar (proportional colored segments)
 *     + donut chart + brand-color legend
 *   • Platform picker: brand-colored cards with brand-color chip dot
 *     and gradient active-state highlight
 *   • Structured content cards (extracted title/desc/author from
 *     raw_payload — no more raw JSON dumps)
 *   • Animated task cards with status icons + live pulse
 *   • Sentiment-colored comment cards with left-border accent
 *   • Tab strip: icon + label + animated underline + hover background
 *
 * Lazy-load: this page is mounted only when the user visits
 * ``/dashboard/crawl``, so chart helpers are NOT pulled into the
 * initial app shell.
 */
import { useEffect, useState, useMemo, useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Button } from '@/Components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/Components/ui/card'
import { Input } from '@/Components/ui/input'
import { ScrollArea } from '@/Components/ui/scroll-area'
import { Badge } from '@/Components/ui/badge'
import { Skeleton } from '@/Components/ui/skeleton'
import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
import { cn } from '@/lib/utils'
import { CHART_TOOLTIP_STYLE, CHART_SLICE_GAP, SENTIMENT_COLORS } from '@/lib/recharts-theme'
import { StackedBarChart } from '@/lib/StackedBarChart'
import { api } from '@/api/client'
import type { AccountGroup } from '@/api/types'
import type {
  CrawledCommentItem,
  CrawledContentItem,
  CrawlTaskStartResponse,
  CrawlHealth,
  SentimentBucket,
} from '@/api/crawl'
import {
  Search,
  FileText,
  MessageSquare,
  Activity,
  Database,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  Copy,
  Eye,
  ListTodo,
  Layers,
  Tag,
} from 'lucide-react'

/* Map of feature pill color → Tailwind utility trio
 * (background / text / ring). Centralizing here keeps the
 * `<FeaturePill>` lines below visually consistent and lets a
 * future palette refactor land in one place. */
const PILL_TONE: Record<
  'blue' | 'violet' | 'amber' | 'emerald' | 'rose',
  { bg: string; text: string; ring: string }
> = {
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-300', ring: 'ring-blue-500/20' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-700 dark:text-violet-300', ring: 'ring-violet-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-500/20' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/20' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-700 dark:text-rose-300', ring: 'ring-rose-500/20' },
}

/** Compact capability tag — used in the hero banner to enumerate the
 *  5 crawler capabilities in one glance. Kept module-local so future
 *  CrawlPage polish tweaks don't need a new component file. */
function FeaturePill({
  color,
  icon,
  children,
}: {
  color: 'blue' | 'violet' | 'amber' | 'emerald' | 'rose'
  icon: ReactNode
  children: ReactNode
}) {
  const tone = PILL_TONE[color]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        tone.bg,
        tone.text,
        tone.ring,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

const ALL_PLATFORMS = ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu'] as const

/** Map crawler short platform names to the account-authorization platform names. */
const CRAWL_PLATFORM_TO_ACCOUNT_PLATFORM: Record<PlatformKey, string> = {
  xhs: 'xiaohongshu',
  dy: 'douyin',
  ks: 'kuaishou',
  bili: 'bilibili',
  wb: 'weibo',
  tieba: 'tieba',
  zhihu: 'zhihu',
}

type PlatformKey = (typeof ALL_PLATFORMS)[number]

type TabKey = 'tasks' | 'content' | 'comments'
type CrawlKind = 'search' | 'detail' | 'comments'

const TAB_LABELS: Record<TabKey, string> = {
  tasks: '任务',
  content: '已采集内容',
  comments: '评论与情感',
}

const PLATFORM_LABEL: Record<PlatformKey, string> = {
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: 'B站',
  wb: '微博',
  tieba: '贴吧',
  zhihu: '知乎',
}

/** Brand colors for platform dots — hex to match platform identity. */
const PLATFORM_DOT_COLOR: Record<PlatformKey, string> = {
  xhs: '#FF2442',
  dy: '#000000',
  ks: '#FF7A00',
  bili: '#00A1D6',
  wb: '#E6162D',
  tieba: '#4E6EF2',
  zhihu: '#0084FF',
}

type SentimentKey = 'positive' | 'negative' | 'neutral' | null

function sentimentLabel(key: SentimentKey): string {
  switch (key) {
    case 'positive':
      return '正面'
    case 'negative':
      return '负面'
    case 'neutral':
      return '中性'
    default:
      return '待分析'
  }
}

function sentimentColorClass(key: SentimentKey): string {
  switch (key) {
    case 'positive':
      return 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30'
    case 'negative':
      return 'bg-rose-500/15 text-rose-700 ring-rose-500/30'
    case 'neutral':
      return 'bg-slate-500/15 text-slate-700 ring-slate-500/30'
    default:
      return 'bg-amber-500/15 text-amber-700 ring-amber-500/30'
  }
}

/** Sentiment bar segment colors — now sourced from the shared
 *  recharts-theme palette so all sentiment charts stay in lockstep. */
function sentimentBarColor(key: SentimentKey): string {
  switch (key) {
    case 'positive':
      return SENTIMENT_COLORS.positive
    case 'negative':
      return SENTIMENT_COLORS.negative
    case 'neutral':
      return SENTIMENT_COLORS.neutral
    default:
      return SENTIMENT_COLORS.pending
  }
}

/** Sentiment left-border accent for comment cards. */
function sentimentBorderClass(key: SentimentKey): string {
  switch (key) {
    case 'positive':
      return 'border-l-emerald-500'
    case 'negative':
      return 'border-l-rose-500'
    case 'neutral':
      return 'border-l-slate-400'
    default:
      return 'border-l-amber-500'
  }
}

/** Per-kind text used in the input label + placeholder. */
const INPUT_LABELS: Record<CrawlKind, { label: string; placeholder: string }> = {
  search: { label: '关键词', placeholder: '比如：美食，旅游' },
  detail: { label: 'post_id', placeholder: '比如：abc123, def456' },
  comments: { label: 'post_id', placeholder: '比如：BV1abc, mid123' },
}

/** Inner functional page — re-exported as the module default below. */
function CrawlDashboardPage() {
  const [tab, setTab] = useState<TabKey>('tasks')
  const [platform, setPlatform] = useState<PlatformKey>('xhs')
  // Bumps whenever a streaming search finishes so ContentTab re-fetches
  // persisted rows without requiring the user to switch tabs.
  const [contentRefreshKey, setContentRefreshKey] = useState(0)

  return (
    <PageWrapper>
      {/* Polished Hero — gradient backdrop + decorative blur blobs +
          feature pill row enumerating the 5 crawler capabilities at a
          glance. The original <PageHeader> stays inside so any test
          that scopes by `getByRole('heading', { name: '数据采集 / 评论监控' })`
          keeps passing without role rename. */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative overflow-hidden rounded-2xl border border-border/30 bg-gradient-to-br from-violet-500/[0.07] via-blue-500/[0.05] to-emerald-500/[0.05] shadow-sm"
      >
        {/* Decorative blur blobs — purely visual, aria-hidden so they
            don't show up in screen reader / accessibility tree. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-violet-500/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-10 -left-10 h-28 w-28 rounded-full bg-blue-500/15 blur-3xl"
        />
        <div className="relative px-4 sm:px-6 pt-4 pb-3 sm:pt-5 sm:pb-4">
          <PageHeader
            title="数据采集 / 评论监控"
            description="7 个平台的关键词搜索 · 帖子详情 · 评论树 · AI 情感分析 + 自动回复建议"
            icon={
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-md shadow-violet-500/25">
                <Search className="h-5 w-5" />
              </div>
            }
            actions={<PlatformPicker value={platform} onChange={setPlatform} />}
          />
          {/* Capability pill row — 5 features, one glance */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <FeaturePill color="blue" icon={<Search className="h-2.5 w-2.5" />}>
              关键词搜索
            </FeaturePill>
            <FeaturePill color="violet" icon={<FileText className="h-2.5 w-2.5" />}>
              帖子详情
            </FeaturePill>
            <FeaturePill color="amber" icon={<MessageSquare className="h-2.5 w-2.5" />}>
              二级评论
            </FeaturePill>
            <FeaturePill color="emerald" icon={<Sparkles className="h-2.5 w-2.5" />}>
              AI 情感
            </FeaturePill>
            <FeaturePill color="rose" icon={<Copy className="h-2.5 w-2.5" />}>
              回复建议
            </FeaturePill>
          </div>
        </div>
      </motion.div>

      {/* Health stats strip — 3 mini stat cards */}
      <HealthStatsStrip platform={platform} />

      {/* Sentiment distribution visual bar */}
      <SentimentDistributionBar platform={platform} />

      <Tabs current={tab} onChange={setTab} />

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'tasks' && <TasksTab platform={platform} onStreamDone={() => setContentRefreshKey((k) => k + 1)} />}
          {tab === 'content' && <ContentTab platform={platform} refreshKey={contentRefreshKey} />}
          {tab === 'comments' && <CommentsTab platform={platform} />}
        </motion.div>
      </AnimatePresence>
    </PageWrapper>
  )
}

/* ──────────── Health Stats Strip ──────────── */

function HealthStatsStrip({ platform: _platform }: { platform: PlatformKey }) {
  const [health, setHealth] = useState<CrawlHealth | null>(null)
  const [loading, setLoading] = useState(true)

  // health() is a global endpoint (no platform param) — fetch once on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.crawl
      .health()
      .then((h) => {
        if (!cancelled) setHealth(h ?? null)
      })
      .catch(() => {
        if (!cancelled) setHealth(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stats = [
    {
      label: '内容总数',
      value: health?.crawled_content_rows ?? 0,
      icon: Database,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-500/10',
      ring: 'ring-blue-500/20',
    },
    {
      label: '评论总数',
      value: health?.crawled_comments_rows ?? 0,
      icon: MessageSquare,
      color: 'text-violet-600 dark:text-violet-400',
      bg: 'bg-violet-500/10',
      ring: 'ring-violet-500/20',
    },
    {
      label: 'API 状态',
      value: health?.ok ? '正常' : '—',
      icon: Activity,
      color: health?.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
      bg: health?.ok ? 'bg-emerald-500/10' : 'bg-muted/30',
      ring: health?.ok ? 'ring-emerald-500/20' : 'ring-border/30',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {stats.map((s, idx) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: idx * 0.05 }}
        >
          <Card className="group relative overflow-hidden border-border/40 ring-1 ring-inset hover:ring-foreground/10 transition-all hover:shadow-md hover:-translate-y-0.5 duration-200">
            {/* Subtle gradient accent — each card tinted with its
                brand color so at a glance you can tell what kind of
                metric you're looking at without reading the label. */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 opacity-50 group-hover:opacity-80 transition-opacity',
                idx === 0 && 'bg-gradient-to-br from-blue-500/[0.06] to-transparent',
                idx === 1 && 'bg-gradient-to-br from-violet-500/[0.06] to-transparent',
                idx === 2 && (health?.ok
                  ? 'bg-gradient-to-br from-emerald-500/[0.06] to-transparent'
                  : 'bg-gradient-to-br from-muted/30 to-transparent'),
              )}
            />
            <CardContent className="relative flex items-center gap-3 py-4 px-4">
              <div
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ring-1 ring-inset transition-transform group-hover:scale-105',
                  s.bg,
                  s.color,
                  s.ring,
                )}
              >
                {loading ? (
                  <Loader2 className={cn('h-5 w-5 animate-spin', s.color)} />
                ) : (
                  <s.icon className={cn('h-5 w-5', s.color)} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-bold leading-none tabular-nums tracking-tight">
                  {loading ? <Skeleton className="h-7 w-16 mt-1" /> : s.value}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5 truncate">
                  {s.label}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}

/* ──────────── Sentiment Distribution Bar ──────────── */

function SentimentDistributionBar({ platform }: { platform: PlatformKey }) {
  const [bucket, setBucket] = useState<SentimentBucket | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.crawl
      .sentimentSummary({ platform })
      .then((b) => {
        if (!cancelled) setBucket(b)
      })
      .catch(() => {
        if (!cancelled) setBucket(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [platform])

  if (loading) {
    return (
      <Card className="border-border/40 bg-gradient-to-br from-background to-muted/20">
        <CardContent className="py-4">
          <Skeleton className="h-16 w-full rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  if (!bucket) return null

  const total = bucket.positive + bucket.negative + bucket.neutral + bucket.pending
  const segments: Array<{ kind: 'positive' | 'negative' | 'neutral' | null; count: number }> = [
    { kind: 'positive', count: bucket.positive },
    { kind: 'negative', count: bucket.negative },
    { kind: 'neutral', count: bucket.neutral },
    { kind: null, count: bucket.pending },
  ]

  // Donut chart data — only non-zero segments to keep the pie clean
  const pieData = segments
    .filter((s) => s.count > 0)
    .map((s) => ({
      name: sentimentLabel(s.kind),
      value: s.count,
      color: sentimentBarColor(s.kind),
      key: String(s.kind),
    }))

  return (
    <Card className="border-border/40 bg-gradient-to-br from-background to-muted/20 overflow-hidden">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            情感分布（{PLATFORM_LABEL[platform]}，共 {total} 条）
          </span>
        </div>

        {/* Stacked bar chart — recharts BarChart via the shared
            StackedBarChart component, no axes, just stacked segments
            with Tooltip. Replaces the hand-written div + motion.span
            proportional bar. */}
        {total > 0 ? (
          <div className="h-10 w-full">
            <StackedBarChart
              segments={segments
                .filter((s) => s.count > 0)
                .map((s) => ({ key: String(s.kind), count: s.count, color: sentimentBarColor(s.kind) }))}
              name="sentiment"
              tooltipFormatter={(value, nameOrKey) => {
                const key = String(nameOrKey)
                const seg = segments.find((s) => String(s.kind) === key)
                if (seg) {
                  const pct = total > 0 ? (seg.count / total) * 100 : 0
                  return [`${sentimentLabel(seg.kind)} · ${value} 条 (${pct.toFixed(0)}%)`, '']
                }
                return [`${value}`, '']
              }}
            />
          </div>
        ) : (
          <div className="flex h-7 w-full items-center justify-center rounded-lg bg-muted/40 text-xs text-muted-foreground">
            暂无情感分析数据
          </div>
        )}

        {/* Donut chart + legend side-by-side */}
        {total > 0 ? (
          <div className="mt-4 flex items-center gap-4">
            {/* Donut */}
            <div className="relative h-[120px] w-[120px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={34}
                    outerRadius={54}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {pieData.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={entry.color}
                        stroke={CHART_SLICE_GAP}
                        strokeWidth={1.5}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value, name) => {
                      const num = typeof value === 'number' ? value : Number(value) || 0
                      return [`${num} 条 (${total > 0 ? ((num / total) * 100).toFixed(0) : 0}%)`, name]
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center label — total count */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold leading-none tabular-nums">{total}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">总评论</span>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-col gap-2">
              {segments.map((seg) => {
                const pct = total > 0 ? (seg.count / total) * 100 : 0
                return (
                  <div key={String(seg.kind)} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: sentimentBarColor(seg.kind) }}
                    />
                    <span className="text-xs text-muted-foreground">{sentimentLabel(seg.kind)}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums">{seg.count}</span>
                    {seg.count > 0 && (
                      <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
                        {pct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Legend-only fallback when total is 0 (preserves test contract) */
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {segments.map((seg) => (
              <div key={String(seg.kind)} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: sentimentBarColor(seg.kind) }}
                />
                <span className="text-xs text-muted-foreground">{sentimentLabel(seg.kind)}</span>
                <span className="font-mono text-sm font-semibold tabular-nums">{seg.count}</span>
              </div>
            ))}
          </div>
        )}

      </CardContent>
    </Card>
  )
}

/* ──────────── Platform Picker ──────────── */

function PlatformPicker({
  value,
  onChange,
}: {
  value: PlatformKey
  onChange: (v: PlatformKey) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="platform-picker"
      className="flex items-center gap-1 rounded-xl border border-border/40 bg-background/80 backdrop-blur-sm p-1 text-xs shadow-sm"
    >
      {ALL_PLATFORMS.map((p) => {
        const active = p === value
        return (
          <button
            key={p}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all duration-150',
              active
                ? // Active chip — primary background + brand-color dot.
                  // Keeps `bg-primary` className suffix so the test contract
                  // `className.toContain('bg-primary')` survives verbatim.
                  'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:scale-[1.02]',
            )}
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full shrink-0 ring-2 ring-background/40"
              style={{
                backgroundColor: active ? '#ffffff' : PLATFORM_DOT_COLOR[p],
              }}
            />
            {PLATFORM_LABEL[p]}
          </button>
        )
      })}
    </div>
  )
}

/* ──────────── Tabs ──────────── */

function Tabs({
  current,
  onChange,
}: {
  current: TabKey
  onChange: (t: TabKey) => void
}) {
  // Each tab gets a matching icon so the navigation feels at-a-glance
  // scannable. `Tasks` ↔ ListTodo, `Content` ↔ Database, `Comments`
  // ↔ MessageSquare. Kept module-local so future tabs inherit. */
  const tabIcons: Record<TabKey, typeof Search> = {
    tasks: ListTodo,
    content: Layers,
    comments: Tag,
  }
  return (
    <div role="tablist" aria-label="crawl-tabs" className="flex items-center gap-1 border-b border-border/40">
      {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => {
        const Icon = tabIcons[k]
        return (
          <button
            key={k}
            role="tab"
            aria-selected={k === current}
            onClick={() => onChange(k)}
            className={cn(
              'group relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors rounded-t-md',
              k === current
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
            )}
          >
            <Icon
              className={cn(
                'h-3.5 w-3.5 transition-colors',
                k === current ? 'text-primary' : 'text-muted-foreground/60 group-hover:text-foreground/70',
              )}
            />
            {TAB_LABELS[k]}
            {k === current && (
              <motion.span
                layoutId="crawl-tab-indicator"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ──────────── Tasks tab ──────────── */

function TasksTab({
  platform,
  onStreamDone,
}: {
  platform: PlatformKey
  onStreamDone?: () => void
}) {
  const [kind, setKind] = useState<CrawlKind>('search')
  const [keyword, setKeyword] = useState('')
  const [postIds, setPostIds] = useState('')
  const [maxCount, setMaxCount] = useState(20)
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [tasks, setTasks] = useState<
    Array<{
      id: string
      kind: CrawlKind
      label: string
      status: string
    }>
  >([])
  const [streamResults, setStreamResults] = useState<CrawledContentItem[]>([])
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const streamRowKeyRef = useRef(0)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // Fetch available account groups so the user can pick which saved
  // cookie to use for authenticated crawl platforms (e.g. Douyin).
  //
  // NOTE: `api.accounts.getAccountGroups()` is unreachable at runtime —
  // the @/api/client.ts barrel exposes `getAccountGroups` FLAT at the
  // top level (matches the convention used by `useAccountGroups` and
  // `BatchRefreshDialog`). The earlier nested call crashed the page
  // with "Cannot read properties of undefined (reading 'getAccountGroups')"
  // the moment the search-kind account dropdown tried to mount.
  useEffect(() => {
    let cancelled = false
    setAccountsLoading(true)
    api
      .getAccountGroups()
      .then((res) => {
        if (!cancelled) setAccountGroups(res?.data ?? [])
      })
      .catch(() => {
        if (!cancelled) setAccountGroups([])
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const accountPlatform = CRAWL_PLATFORM_TO_ACCOUNT_PLATFORM[platform]
  const availableAccounts = useMemo(() => {
    return accountGroups
      .filter((group) =>
        group.authorizations.some((auth) => auth.platform === accountPlatform),
      )
      .map((group) => ({
        groupName: group.name,
        auth: group.authorizations.find((auth) => auth.platform === accountPlatform)!,
      }))
  }, [accountGroups, accountPlatform])

  // Auto-pick the first available account for `kind === 'search'`
  // so the button isn't disabled by default. Reruns on platform +
  // account-list changes; React's useState bails on equal values
  // so re-running with the same pick is a no-op. `kind` is
  // intentionally NOT in the deps — including it would silently
  // overwrite a user's explicit account pick when they toggle
  // search→detail→search.
  // Auto-pick the first available account when platform/accounts change.
  // `kind` is intentionally NOT in the deps so toggling search↔detail
  // preserves the user's manual account pick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (kind === 'search' && availableAccounts.length > 0) {
      setSelectedAccount(availableAccounts[0].groupName)
    }
  }, [platform, availableAccounts])

  const inputValue = kind === 'search' ? keyword : postIds
  const setInputValue = (v: string) => {
    if (kind === 'search') setKeyword(v)
    else setPostIds(v)
  }
  // search requires an authorized account (backend /api/crawl/
  // search-stream returns 401 missing_account otherwise).  detail
  // + comments don't have this gate — their task-queue endpoints
  // don't currently pass account through.
  const canSubmit =
    (kind === 'search' ? keyword : postIds).trim().length > 0 &&
    (kind !== 'search' || selectedAccount.length > 0)

  const start = async () => {
    const label =
      kind === 'search'
        ? `搜索「${keyword}」`
        : `${kind === 'detail' ? '详情' : '评论'} ${postIds}`

    if (kind === 'search') {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const taskId = `stream-${Date.now()}`
      setStreaming(true)
      setStreamResults([])
      setTasks((prev) => [
        ...prev,
        { id: taskId, kind, label, status: 'running' },
      ])
      try {
        await api.crawl.searchStream(
          {
            platform,
            keyword,
            max_count: maxCount,
            account: selectedAccount || undefined,
          },
          {
            onPlatformResult: (data) => {
              const row = data as CrawledContentItem
              streamRowKeyRef.current += 1
              setStreamResults((prev) => [
                { ...row, id: row.id ?? -streamRowKeyRef.current },
                ...prev,
              ])
            },
            onError: (message) => {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId ? { ...t, status: 'error', label: `${t.label} (失败: ${message})` } : t,
                ),
              )
            },
            onDone: () => {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId ? { ...t, status: 'completed' } : t,
                ),
              )
              onStreamDone?.()
            },
          },
          controller.signal,
        )
      } catch (err) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, status: 'error', label: `${t.label} (失败: ${String((err as Error)?.message ?? err)})` }
              : t,
          ),
        )
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
      return
    }

    try {
      let resp: CrawlTaskStartResponse
      if (kind === 'detail') {
        resp = await api.crawl.detail({ platform, post_id: postIds })
      } else {
        resp = await api.crawl.comments({
          platform,
          post_id: postIds,
          max_count: maxCount,
        })
      }
      setTasks((prev) => [
        ...prev,
        { id: resp.task_id, kind, label, status: resp.status },
      ])
    } catch (err) {
      setTasks((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          kind,
          label: `请求失败: ${String((err as Error)?.message ?? err)}`,
          status: 'error',
        },
      ])
    }
  }

  const kindIcons: Record<CrawlKind, typeof Search> = {
    search: Search,
    detail: FileText,
    comments: MessageSquare,
  }

  return (
    <Card className="border-border/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          启动新的爬虫任务
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Kind picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">任务类型</span>
          <div className="flex items-center gap-1 rounded-md border border-border/40 p-0.5 text-xs">
            {(['search', 'detail', 'comments'] as CrawlKind[]).map((k) => {
              const KindIcon = kindIcons[k]
              return (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex items-center gap-1 rounded-sm px-2 py-1 transition-all',
                    k === kind
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  <KindIcon className="h-3 w-3" />
                  {k === 'search' ? '搜索' : k === 'detail' ? '详情' : '评论'}
                </button>
              )
            })}
          </div>
        </div>

        {/* Primary input row */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{INPUT_LABELS[kind].label}</label>
            <Input
              placeholder={INPUT_LABELS[kind].placeholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">数量上限</label>
            <Input
              type="number"
              value={maxCount}
              min={1}
              max={500}
              onChange={(e) => setMaxCount(Number(e.target.value) || 20)}
            />
          </div>
          {kind === 'search' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">使用账号</label>
              {accountsLoading ? (
                <div className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  加载账号…
                </div>
              ) : availableAccounts.length > 0 ? (
                <select
                  data-testid="crawl-account-select"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {/* Hide the "auto" option for search kind — the
                      auto-pick useEffect above makes it unselectable
                      (it'd be immediately overwritten on next render),
                      which is a UX trap.  detail + comments don't
                      require an account, so the "auto" option is
                      still useful there. */}
                  {kind !== 'search' && (
                    <option value="">自动（不使用保存的 Cookie）</option>
                  )}
                  {availableAccounts.map((acc) => (
                    <option key={acc.groupName} value={acc.groupName}>
                      {acc.groupName}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-muted-foreground">
                  暂无 {PLATFORM_LABEL[platform]} 授权账号
                </div>
              )}
            </div>
          )}
          <div className="flex items-end">
            <Button onClick={start} disabled={!canSubmit} className="w-full gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {kind === 'search' ? '启动搜索' : kind === 'detail' ? '拉取详情' : '拉取评论'}
            </Button>
          </div>
        </div>

        {/* Task list */}
        <ScrollArea className="h-72 rounded-md border border-border/40 bg-muted/20 p-3">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50 mb-3">
                <Activity className="h-5 w-5 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                还没有启动过任务。输入关键词后点击「启动」开始。
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {tasks.slice().reverse().map((t) => (
                  <motion.li
                    key={t.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      'flex items-center justify-between rounded-lg bg-background px-3 py-2.5 text-sm shadow-sm ring-1 ring-foreground/5',
                      t.status === 'error' && 'bg-rose-500/5 ring-rose-500/20',
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <TaskStatusIcon status={t.status} />
                      <span className="truncate">{t.label}</span>
                    </div>
                    <Badge
                      variant={t.status === 'error' ? 'error' : 'secondary'}
                      className="font-mono text-xs shrink-0"
                    >
                      {t.status}
                    </Badge>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </ScrollArea>

        {/* Live streaming results */}
        {streamResults.length > 0 && (
          <div className="rounded-md border border-border/40 bg-muted/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-medium">实时结果</h4>
              {streaming && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {streamResults.map((row, idx) => {
                  const extracted = extractContent(row.raw_payload)
                  return (
                    <motion.li
                      key={row.id ?? idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className="rounded-lg bg-background px-3 py-2 text-sm shadow-sm ring-1 ring-foreground/5"
                    >
                      {extracted.title && (
                        <p className="font-medium line-clamp-1">{extracted.title}</p>
                      )}
                      {extracted.author && (
                        <p className="text-xs text-muted-foreground mt-0.5">{extracted.author}</p>
                      )}
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'error') return <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
  if (status === 'completed' || status === 'done')
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
  if (status === 'pending' || status === 'running')
    return <Loader2 className="h-4 w-4 text-amber-500 animate-spin shrink-0" />
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
}

/* ──────────── Content tab ──────────── */

function ContentTab({
  platform,
  refreshKey,
}: {
  platform: PlatformKey
  refreshKey?: number
}) {
  const [rows, setRows] = useState<CrawledContentItem[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    api.crawl
      .data({ platform, limit: 50 })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [platform, refreshKey])

  return (
    <Card className="border-border/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
            <Database className="h-4 w-4 text-blue-500" />
          </div>
          最近 50 条内容（{PLATFORM_LABEL[platform]}）
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50 mb-3">
              <Database className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              暂无数据。启动一次搜索爬虫后会出现在这里。
            </p>
          </div>
        ) : (
          <ul className="grid gap-2.5">
            <AnimatePresence initial={false}>
              {rows.map((row, idx) => {
                const extracted = extractContent(row.raw_payload)
                return (
                  <motion.li
                    key={row.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: Math.min(idx * 0.02, 0.2) }}
                    className="group rounded-lg border border-border/40 bg-background p-3 hover:border-border/70 hover:shadow-sm transition-all"
                  >
                    {/* Metadata line — preserves #ID and post_id=VALUE for test contract */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{row.id}
                        {row.post_id && <span className="ml-2">post_id={row.post_id}</span>}
                        {row.crawled_at && (
                          <span className="ml-2 flex items-center gap-0.5 inline-flex">
                            <Clock className="h-2.5 w-2.5" />
                            {formatTime(row.crawled_at)}
                          </span>
                        )}
                      </span>
                    </div>
                    {/* Structured content card */}
                    {extracted.title && (
                      <p className="text-sm font-medium text-foreground line-clamp-1 mb-0.5">
                        {extracted.title}
                      </p>
                    )}
                    {extracted.desc && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {extracted.desc}
                      </p>
                    )}
                    {extracted.author && (
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                        <span className="font-medium">{extracted.author}</span>
                      </div>
                    )}
                    {/* Collapsible raw payload for debugging */}
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors inline-flex items-center gap-0.5">
                        <Eye className="h-2.5 w-2.5" />
                        原始数据
                      </summary>
                      <code className="mt-1 block text-[10px] text-muted-foreground/60 break-all">
                        {JSON.stringify(row.raw_payload).slice(0, 500)}
                      </code>
                    </details>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ──────────── Comments tab ──────────── */

function CommentsTab({ platform }: { platform: PlatformKey }) {
  const [rows, setRows] = useState<CrawledCommentItem[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    api.crawl
      .commentsList({ platform, limit: 50 })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [platform])

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Silent — UI feedback is the toast caller's responsibility.
    }
  }

  // Sentiment summary for the header
  const sentimentCounts = useMemo(() => {
    let positive = 0,
      negative = 0,
      neutral = 0,
      pending = 0
    for (const row of rows) {
      if (row.ai_sentiment === 'positive') positive++
      else if (row.ai_sentiment === 'negative') negative++
      else if (row.ai_sentiment === 'neutral') neutral++
      else pending++
    }
    return { positive, negative, neutral, pending }
  }, [rows])

  return (
    <Card className="border-border/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10">
            <MessageSquare className="h-4 w-4 text-violet-500" />
          </div>
          最近 50 条评论（{PLATFORM_LABEL[platform]}）
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50 mb-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              暂无评论。启动一次评论爬虫后会出现在这里。
            </p>
          </div>
        ) : (
          <>
            {/* Mini sentiment chart — recharts stacked BarChart +
                inline legend, replacing the flat icon+text summary
                row. Same visual weight (single-line compact card) but
                now shows proportional bars for at-a-glance scanning. */}
            <div className="mb-4 rounded-lg bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-3">
                {/* Stacked bar — 8px tall, full width of the flex row */}
                <div className="h-2 flex-1 min-w-[120px]">
                  {(() => {
                    const cmtTotal =
                      sentimentCounts.positive +
                      sentimentCounts.negative +
                      sentimentCounts.neutral +
                      sentimentCounts.pending
                    if (cmtTotal === 0) {
                      return (
                        <div className="h-full w-full rounded-full bg-muted/50" />
                      )
                    }
                    const cmtSegs = [
                      { key: 'positive', label: '正面', count: sentimentCounts.positive, color: sentimentBarColor('positive') },
                      { key: 'negative', label: '负面', count: sentimentCounts.negative, color: sentimentBarColor('negative') },
                      { key: 'neutral', label: '中性', count: sentimentCounts.neutral, color: sentimentBarColor('neutral') },
                      { key: 'null', label: '待分析', count: sentimentCounts.pending, color: sentimentBarColor(null) },
                    ].filter((s) => s.count > 0)
                    return (
                      <StackedBarChart
                        segments={cmtSegs.map((s) => ({ key: s.key, count: s.count, color: s.color }))}
                        name="cmt"
                        animationDuration={400}
                        tooltipFormatter={(value, key) => {
                          const seg = cmtSegs.find((s) => s.key === key)
                          if (seg) {
                            const pct = cmtTotal > 0 ? (seg.count / cmtTotal) * 100 : 0
                            return [`${seg.label} · ${value} 条 (${pct.toFixed(0)}%)`, '']
                          }
                          return [`${value}`, '']
                        }}
                      />
                    )
                  })()}
                </div>

                {/* Inline legend with counts — same data as the bar */}
                <div className="flex items-center gap-3 shrink-0">
                  {(
                    [
                      { label: '正面', count: sentimentCounts.positive, icon: TrendingUp, color: 'text-emerald-500', dot: sentimentBarColor('positive') },
                      { label: '负面', count: sentimentCounts.negative, icon: TrendingDown, color: 'text-rose-500', dot: sentimentBarColor('negative') },
                      { label: '中性', count: sentimentCounts.neutral, icon: Minus, color: 'text-slate-500', dot: sentimentBarColor('neutral') },
                      { label: '待分析', count: sentimentCounts.pending, icon: Clock, color: 'text-amber-500', dot: sentimentBarColor(null) },
                    ] as const
                  ).map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: s.dot }}
                      />
                      <s.icon className={cn('h-3.5 w-3.5', s.color)} />
                      <span className="text-xs text-muted-foreground">{s.label}</span>
                      <span className="font-mono text-sm font-semibold tabular-nums">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ul className="grid gap-2.5">
              <AnimatePresence initial={false}>
                {rows.map((row, idx) => {
                  const sentimentKey = (row.ai_sentiment ?? null) as
                    | 'positive'
                    | 'negative'
                    | 'neutral'
                    | null
                  return (
                    <motion.li
                      key={row.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: Math.min(idx * 0.02, 0.2) }}
                      className={cn(
                        'rounded-lg border border-border/40 border-l-4 bg-background p-3 hover:shadow-sm transition-all',
                        sentimentBorderClass(sentimentKey),
                      )}
                    >
                      {/* Header: sentiment badge + confidence + time */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge className={cn('ring-1 ring-inset', sentimentColorClass(sentimentKey))}>
                          {sentimentLabel(sentimentKey)}
                        </Badge>
                        {typeof row.ai_sentiment_confidence === 'number' && (
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {(row.ai_sentiment_confidence * 100).toFixed(0)}%
                          </span>
                        )}
                        <span className="ml-auto font-mono text-xs text-muted-foreground/70">
                          {row.crawled_at ? formatTime(row.crawled_at) : ''}
                        </span>
                      </div>
                      {/* Comment text */}
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {rawText(row.raw_payload)}
                      </p>
                      {/* AI reply suggestion */}
                      {row.ai_reply_suggestion && (
                        <div className="mt-2 flex items-start gap-2 rounded-md bg-gradient-to-br from-violet-500/5 to-blue-500/5 p-2.5 ring-1 ring-violet-500/10">
                          <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium text-muted-foreground block mb-0.5">
                              AI 建议:
                            </span>
                            <span className="text-sm">{row.ai_reply_suggestion}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(row.ai_reply_suggestion!)}
                            className="shrink-0 gap-1"
                          >
                            <Copy className="h-3 w-3" />
                            复制
                          </Button>
                        </div>
                      )}
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ──────────── Helpers ──────────── */

/** Extract structured content from raw_payload for display. */
function extractContent(
  payload: CrawledContentItem['raw_payload'],
): { title?: string; desc?: string; author?: string } {
  if (!payload || typeof payload === 'string') return {}
  const p = payload as Record<string, unknown>
  const titleKeys = ['title', 'desc', 'note', 'content', 'text', 'subject']
  const descKeys = ['desc', 'description', 'summary', 'abstract', 'content', 'note', 'text']
  const authorKeys = ['author', 'user', 'nickname', 'author_name', 'creator', 'user_name']

  let title: string | undefined
  for (const k of titleKeys) {
    const v = p[k]
    if (typeof v === 'string' && v.trim()) {
      title = v.trim().slice(0, 120)
      break
    }
  }

  let desc: string | undefined
  for (const k of descKeys) {
    const v = p[k]
    if (typeof v === 'string' && v.trim() && v !== title) {
      desc = v.trim().slice(0, 200)
      break
    }
  }

  let author: string | undefined
  for (const k of authorKeys) {
    const v = p[k]
    if (typeof v === 'string' && v.trim()) {
      author = v.trim().slice(0, 50)
      break
    } else if (v && typeof v === 'object') {
      const nested = v as Record<string, unknown>
      for (const nk of ['name', 'nickname', 'screen_name']) {
        const nv = nested[nk]
        if (typeof nv === 'string' && nv.trim()) {
          author = nv.trim().slice(0, 50)
          break
        }
      }
      if (author) break
    }
  }

  return { title, desc, author }
}

/** Format ISO timestamp to readable zh-CN time. */
function formatTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Best-effort extract of comment text from the various raw_payload shapes. */
function rawText(payload: CrawledCommentItem['raw_payload']): string {
  if (!payload) return '(空)'
  if (typeof payload === 'string') return payload
  const keys = ['text', 'content', 'comment', 'message', 'msg']
  for (const k of keys) {
    const v = payload[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return JSON.stringify(payload).slice(0, 200)
}

/**
 * Default export consumed by AppShell via `lazy(() => import('./Pages/CrawlPage'))`.
 * Must be a plain component — do NOT wrap in React.lazy() here, otherwise the
 * module is double-lazy-wrapped and React throws "Element type is invalid.
 * Received a promise that resolves to: default."
 */
export default function CrawlPage() {
  return <CrawlDashboardPage />
}
