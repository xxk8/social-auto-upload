import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
  type ReactNode,
} from 'react'
import { PlatformIcon } from '@/components/ui/platform-icon'
import MarketingFooter from '@/components/MarketingFooter'
import MarketingTopBar from '@/components/MarketingTopBar'
import { cn } from '@/lib/utils'
import {
  RefreshCw,
  LayoutGrid,
  Sparkles,
  X,
  ExternalLink,
  Flame,
  Clock,
} from 'lucide-react'

const API_BASE = '/api/hotlist'
/** Client session cache TTL — aligns with server CACHE_TTL (300s). */
const CLIENT_CACHE_TTL_MS = 90_000
/** Max rows rendered per card (enough for glance; full list still in data). */
const VISIBLE_ROWS = 12
/** First paint: only this many platform cards when viewing "全部". */
const INITIAL_PLATFORM_COUNT = 6
/** How many more platform cards to reveal per intersection. */
const PLATFORM_BATCH = 3

interface HotItem {
  id: number | string
  rank: number
  title: string
  hot: number | string
  url: string
}

interface HotSource {
  cn: string
  apiPath: string
  platform: string
}

const SOURCES: HotSource[] = [
  { cn: '抖音', apiPath: 'douyin', platform: 'douyin' },
  { cn: '快手', apiPath: 'kuaishou', platform: 'kuaishou' },
  { cn: '哔哩哔哩', apiPath: 'bilibili', platform: 'bilibili' },
  { cn: '微博', apiPath: 'weibo', platform: 'weibo' },
  { cn: '知乎', apiPath: 'zhihu', platform: 'zhihu' },
  { cn: '百度', apiPath: 'baidu', platform: 'baidu' },
  { cn: '今日头条', apiPath: 'toutiao', platform: 'toutiao' },
  { cn: '豆瓣', apiPath: 'douban-movie', platform: 'douban-movie' },
  { cn: '36氪', apiPath: '36kr', platform: '36kr' },
  { cn: '少数派', apiPath: 'sspai', platform: 'sspai' },
  { cn: 'IT之家', apiPath: 'ithome', platform: 'ithome' },
  { cn: '腾讯新闻', apiPath: 'qq-news', platform: 'qq-news' },
]

// Module-level cache survives remounts within the SPA session.
const _cache: {
  at: number
  data: Record<string, HotItem[]>
} = { at: 0, data: {} }

function mapItems(raw: unknown[]): HotItem[] {
  return (raw ?? []).slice(0, 15).map((it, i) => {
    const row = (it ?? {}) as Record<string, unknown>
    return {
      id: (row.id as string | number | undefined) ?? i,
      rank: i + 1,
      title: String(row.title ?? ''),
      hot: (row.hot as number | string) ?? 0,
      url: String(row.url ?? '#'),
    }
  })
}

function fmt(v: number | string, isRating = false): string {
  if (v === 0 || v === '0' || v === '' || v == null) return ''
  if (isRating) return String(v)
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v
  if (Number.isNaN(n)) return String(v)
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return n.toLocaleString('zh-CN')
}

function relativeTime(ts: number | null): string {
  if (!ts) return '尚未更新'
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 10) return '刚刚更新'
  if (sec < 60) return `${sec} 秒前更新`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前更新`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前更新`
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const RankBadge = memo(function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[11px] font-semibold tabular-nums bg-foreground text-background">
        {rank}
      </span>
    )
  }
  if (rank === 2 || rank === 3) {
    return (
      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[11px] font-semibold tabular-nums bg-foreground/70 text-background">
        {rank}
      </span>
    )
  }
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[11px] font-medium tabular-nums text-muted-foreground/55">
      {rank}
    </span>
  )
})

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
      <div className="flex items-center gap-2.5 border-b border-border/40 px-4 py-3">
        <div className="h-6 w-6 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-14 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-2.5 px-4 py-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
            <div className="h-2.5 flex-1 animate-pulse rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  )
}

function AiPanel({ item, source, onClose }: { item: HotItem; source: HotSource; onClose: () => void }) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.title, url: item.url, source: source.cn }),
        })
        const json = await res.json()
        if (!cancelled) {
          if (json.success) setAnalysis(json.analysis)
          else setError(json.message || '分析失败')
        }
      } catch {
        if (!cancelled) setError('网络错误，请稍后重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [item.title, item.url, source.cn])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/25 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hotlist-ai-title"
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl shadow-foreground/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 id="hotlist-ai-title" className="text-[14px] font-semibold tracking-tight">
                AI 热点分析
              </h3>
              <p className="text-[11px] text-muted-foreground">{source.cn}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border/30 bg-muted/30 px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background">
              <PlatformIcon platform={source.platform} className="h-3.5 w-3.5" variant="light" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug text-foreground">{item.title}</p>
              {item.url && item.url !== '#' && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                >
                  查看原文 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="max-h-[min(400px,50vh)] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <RefreshCw className="h-5 w-5 animate-spin text-primary/70" />
              <span className="text-[12px] text-muted-foreground">AI 正在分析中…</span>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-border/50 bg-muted/40 px-4 py-6 text-center">
              <p className="text-[13px] text-foreground/80">{error}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">请在设置中配置 AI API Key 后重试</p>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
              {analysis}
            </div>
          )}
        </div>

        <div className="border-t border-border/30 px-5 py-3">
          <p className="text-[11px] text-muted-foreground/70">由 AI 生成，仅供参考 · Esc 关闭</p>
        </div>
      </div>
    </div>
  )
}

const HotCard = memo(function HotCard({
  s,
  items,
  loading,
  onAiAnalyze,
}: {
  s: HotSource
  items: HotItem[]
  loading: boolean
  onAiAnalyze: (item: HotItem, source: HotSource) => void
}) {
  const isRating = s.apiPath === 'douban-movie'
  const visible = items.length > VISIBLE_ROWS ? items.slice(0, VISIBLE_ROWS) : items

  if (loading && items.length === 0) {
    return <CardSkeleton />
  }

  return (
    <article
      className={cn(
        'flex flex-col overflow-hidden rounded-xl',
        'border border-border/55 bg-card',
        // Skip off-screen paint work while scrolling
        '[content-visibility:auto] [contain-intrinsic-size:auto_360px]',
      )}
    >
      <header className="flex items-center gap-2.5 border-b border-border/40 px-4 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-background">
          <PlatformIcon platform={s.platform} className="h-3.5 w-3.5" variant="light" />
        </div>
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{s.cn}</h2>
        <span className="ml-auto text-[10px] font-medium tabular-nums tracking-wide text-muted-foreground/55">
          TOP {items.length || '—'}
        </span>
      </header>

      <div
        className="flex flex-col overflow-y-auto overscroll-contain py-0.5"
        style={{ maxHeight: 'var(--ui-list-max-h, 21rem)' }}
      >
        {items.length === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-[12px] text-muted-foreground">暂无数据</p>
            <p className="text-[11px] text-muted-foreground/60">稍后刷新或切换平台重试</p>
          </div>
        ) : (
          visible.map((item) => (
            <div
              key={`${s.apiPath}-${item.id}-${item.rank}`}
              className="group mx-1 flex items-center gap-2 rounded-md px-2.5 hover:bg-muted/50"
              style={{ paddingTop: 'var(--ui-row-py, 0.375rem)', paddingBottom: 'var(--ui-row-py, 0.375rem)' }}
            >
              <RankBadge rank={item.rank} />
              <a
                href={item.url && item.url !== '#' ? item.url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px] leading-snug text-foreground/80 hover:text-foreground',
                  (!item.url || item.url === '#') && 'pointer-events-none',
                )}
                title={item.title}
              >
                {item.title}
              </a>
              {fmt(item.hot, isRating) ? (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {isRating ? `★ ${fmt(item.hot, true)}` : fmt(item.hot)}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onAiAnalyze(item, s)}
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                  'text-muted-foreground/35 hover:bg-primary/10 hover:text-primary',
                  'opacity-70 group-hover:opacity-100',
                )}
                title="AI 分析"
                aria-label={`AI 分析：${item.title}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </article>
  )
})

export default function HotListPage() {
  const [active, setActive] = useState('all')
  const [data, setData] = useState<Record<string, HotItem[]>>(() =>
    Date.now() - _cache.at < CLIENT_CACHE_TTL_MS ? _cache.data : {},
  )
  const [loading, setLoading] = useState(false)
  const [aiTarget, setAiTarget] = useState<{ item: HotItem; source: HotSource } | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(() =>
    _cache.at > 0 ? _cache.at : null,
  )
  const [timeLabel, setTimeLabel] = useState(() => relativeTime(_cache.at || null))
  /** Progressive card count when active === 'all' (not data fetch — render budget). */
  const [platformLimit, setPlatformLimit] = useState(INITIAL_PLATFORM_COUNT)
  const abortRef = useRef<AbortController | null>(null)
  const moreSentinelRef = useRef<HTMLDivElement | null>(null)

  const applyData = useCallback((next: Record<string, HotItem[]>) => {
    _cache.data = next
    _cache.at = Date.now()
    setData(next)
    setUpdatedAt(_cache.at)
    setTimeLabel(relativeTime(_cache.at))
  }, [])

  const loadAll = useCallback(
    async (force = false) => {
      if (!force && Date.now() - _cache.at < CLIENT_CACHE_TTL_MS && Object.keys(_cache.data).length > 0) {
        setData(_cache.data)
        setUpdatedAt(_cache.at)
        setTimeLabel(relativeTime(_cache.at))
        return
      }

      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setLoading(true)

      try {
        // Prefer bulk endpoint — 1 round-trip instead of 12.
        const bulk = await fetch(API_BASE, { signal: ac.signal })
        if (bulk.ok) {
          const j = await bulk.json()
          const bag = (j?.data ?? {}) as Record<string, unknown[]>
          const next: Record<string, HotItem[]> = {}
          for (const s of SOURCES) {
            next[s.apiPath] = mapItems(Array.isArray(bag[s.apiPath]) ? bag[s.apiPath] : [])
          }
          if (!ac.signal.aborted) applyData(next)
          return
        }

        // Fallback: parallel per-source (still one setState at the end).
        const entries = await Promise.all(
          SOURCES.map(async (s) => {
            try {
              const r = await fetch(`${API_BASE}/${s.apiPath}`, { signal: ac.signal })
              const j = await r.json()
              return [s.apiPath, mapItems(j?.data ?? [])] as const
            } catch {
              return [s.apiPath, [] as HotItem[]] as const
            }
          }),
        )
        if (!ac.signal.aborted) {
          applyData(Object.fromEntries(entries))
        }
      } catch {
        /* aborted or network — keep previous data */
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    },
    [applyData],
  )

  useEffect(() => {
    void loadAll(false)
    return () => abortRef.current?.abort()
  }, [loadAll])

  // Cheap clock for relative-time label only — not re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTimeLabel(relativeTime(updatedAt))
    }, 30_000)
    return () => window.clearInterval(id)
  }, [updatedAt])

  // Reset progressive window when switching filter tabs.
  useEffect(() => {
    setPlatformLimit(INITIAL_PLATFORM_COUNT)
  }, [active])

  // IntersectionObserver: reveal more platform cards as user scrolls.
  useEffect(() => {
    if (active !== 'all') return
    if (platformLimit >= SOURCES.length) return
    const el = moreSentinelRef.current
    if (!el) return

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        setPlatformLimit((n) => Math.min(n + PLATFORM_BATCH, SOURCES.length))
      },
      { root: null, rootMargin: '240px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [active, platformLimit])

  const fullList = useMemo(
    () => (active === 'all' ? SOURCES : SOURCES.filter((s) => s.apiPath === active)),
    [active],
  )

  const list = useMemo(() => {
    if (active !== 'all') return fullList
    return fullList.slice(0, platformLimit)
  }, [active, fullList, platformLimit])

  const hasMorePlatforms = active === 'all' && platformLimit < SOURCES.length

  const loadedCount = useMemo(
    () => SOURCES.filter((s) => (data[s.apiPath]?.length ?? 0) > 0).length,
    [data],
  )

  const onAiAnalyze = useCallback((item: HotItem, source: HotSource) => {
    setAiTarget({ item, source })
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingTopBar />

      {/* Static hero — no animated mesh (was a major jank source) */}
      <section className="border-b border-border/40 bg-gradient-to-b from-muted/30 to-background">
        <div className="mx-auto max-w-[1400px] px-5 pb-6 pt-8 sm:pt-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2 py-0.5 font-medium">
                  <Flame className="h-3 w-3 text-primary" />
                  12 平台 · 实时
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  {timeLabel}
                </span>
                {loadedCount > 0 && (
                  <span className="tabular-nums text-muted-foreground/60">
                    {loadedCount}/{SOURCES.length} 源
                  </span>
                )}
              </div>
              <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">今日热榜</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                汇聚全网热点，发现可做成内容的选题
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadAll(true)}
              disabled={loading}
              aria-label="刷新热榜"
              className={cn(
                'inline-flex h-9 items-center gap-2 self-start rounded-lg border border-border/60',
                'bg-card px-3.5 text-[12px] font-medium text-foreground/80 shadow-sm',
                'hover:border-border hover:bg-muted/40 hover:text-foreground',
                'disabled:cursor-not-allowed disabled:opacity-55',
              )}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1400px] px-5 py-5 sm:py-6">
        {/* Sticky tabs without heavy backdrop-blur */}
        <div className="sticky top-14 z-40 -mx-5 mb-4 border-b border-border/35 bg-background/95 px-5 py-2">
          <div className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabChip
              active={active === 'all'}
              onClick={() => setActive('all')}
              ariaLabel="查看全部平台"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              全部
              <span className="tabular-nums text-[10px] opacity-70">{SOURCES.length}</span>
            </TabChip>
            {SOURCES.map((s) => {
              const n = data[s.apiPath]?.length ?? 0
              return (
                <TabChip
                  key={s.apiPath}
                  active={active === s.apiPath}
                  onClick={() => setActive(active === s.apiPath ? 'all' : s.apiPath)}
                  ariaLabel={`仅查看${s.cn}`}
                >
                  <PlatformIcon platform={s.platform} className="h-3.5 w-3.5 opacity-80" variant="light" />
                  {s.cn}
                  {n > 0 && <span className="tabular-nums text-[10px] opacity-70">{n}</span>}
                </TabChip>
              )
            })}
          </div>
        </div>

        <div
          className={cn(
            'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
            active !== 'all' && 'max-w-3xl lg:grid-cols-2 xl:grid-cols-2',
          )}
          style={{ gap: 'var(--ui-card-gap, 0.875rem)' }}
        >
          {list.map((s) => (
            <HotCard
              key={s.apiPath}
              s={s}
              items={data[s.apiPath] ?? []}
              loading={loading && !(data[s.apiPath]?.length)}
              onAiAnalyze={onAiAnalyze}
            />
          ))}
        </div>

        {hasMorePlatforms && (
          <div
            ref={moreSentinelRef}
            className="mt-6 flex flex-col items-center gap-2 py-4"
            data-testid="hotlist-load-more"
          >
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-primary/60" />
            <p className="text-[12px] text-muted-foreground">
              加载更多平台… ({platformLimit}/{SOURCES.length})
            </p>
            <button
              type="button"
              className="text-[12px] font-medium text-primary hover:underline"
              onClick={() => setPlatformLimit(SOURCES.length)}
            >
              一次显示全部
            </button>
          </div>
        )}
      </main>

      <MarketingFooter />

      {aiTarget && (
        <AiPanel
          item={aiTarget.item}
          source={aiTarget.source}
          onClose={() => setAiTarget(null)}
        />
      )}
    </div>
  )
}

function TabChip({
  active,
  onClick,
  ariaLabel,
  children,
}: {
  active: boolean
  onClick: () => void
  ariaLabel: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]',
        active
          ? 'bg-primary font-medium text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
