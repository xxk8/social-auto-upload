import { useState, useEffect, useCallback } from 'react'
import { PlatformIcon } from '@/Components/ui/platform-icon'
import MarketingFooter from '@/Components/MarketingFooter'
import MarketingTopBar from '@/Components/MarketingTopBar'
import { RefreshCw, LayoutGrid, Sparkles, X, ExternalLink, Loader2 } from 'lucide-react'

const API_BASE = '/api/hotlist'

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

function fmt(v: number | string, isRating = false): string {
  if (!v || v === 0) return ''
  if (isRating) return String(v)
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return String(v)
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString()
}

/* ── AI 分析弹窗 ───────────────────────────────────────────────────────── */
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
          if (json.success) {
            setAnalysis(json.analysis)
          } else {
            setError(json.message || '分析失败')
          }
        }
      } catch (e) {
        if (!cancelled) setError('网络错误，请稍后重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [item.title, item.url, source.cn])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 w-full max-w-lg rounded-2xl border border-border/40 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/20 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold">AI 热点分析</h3>
              <p className="text-[11px] text-muted-foreground/50">{source.cn} · 会员功能</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Topic */}
        <div className="border-b border-border/15 px-5 py-3">
          <div className="flex items-start gap-2">
            <PlatformIcon platform={source.platform} className="mt-0.5 h-4 w-4 shrink-0" variant="light" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground leading-snug">{item.title}</p>
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-primary">
                  查看原文 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 py-4" style={{ maxHeight: 400, overflowY: 'auto' }}>
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-[12px] text-muted-foreground/50">AI 正在分析中...</span>
            </div>
          ) : error ? (
            <div className="py-6 text-center">
              <p className="text-[13px] text-destructive">{error}</p>
              <p className="mt-2 text-[11px] text-muted-foreground/40">请在设置中配置 AI API Key 后重试</p>
            </div>
          ) : (
            <div className="text-[13px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {analysis}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/15 px-5 py-3">
          <p className="text-[11px] text-muted-foreground/30">由 AI 生成，仅供参考</p>
        </div>
      </div>
    </div>
  )
}

/* ── 热榜卡片 ──────────────────────────────────────────────────────────── */
function Card({ s, items, loading, onAiAnalyze }: { s: HotSource; items: HotItem[]; loading: boolean; onAiAnalyze: (item: HotItem, source: HotSource) => void }) {
  const isRating = s.apiPath === 'douban-movie'

  return (
    <div className="rounded-xl border border-border/40 bg-card p-4 transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <PlatformIcon platform={s.platform} className="h-5 w-5" variant="light" />
        <span className="text-[13px] font-semibold text-foreground/90">{s.cn}</span>
      </div>
      {loading ? (
        <div className="flex h-[300px] items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground/30" /></div>
      ) : items.length === 0 ? (
        <div className="flex h-[300px] items-center justify-center text-[12px] text-muted-foreground/30">暂无数据</div>
      ) : (
        <div className="space-y-0">
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`group flex items-baseline gap-2 py-[6px] ${i < items.length - 1 ? 'border-b border-border/15' : ''}`}
            >
              <span className={`w-4 shrink-0 text-center text-[11px] font-bold ${
                item.rank === 1 ? 'text-[#ea444d]' : item.rank === 2 ? 'text-[#ed702d]' : item.rank === 3 ? 'text-[#f5a623]' : 'text-muted-foreground/25'
              }`}>{item.rank}</span>
              <a
                href={item.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-[13px] text-foreground/70 hover:text-foreground"
                title={item.title}
              >
                {item.title}
              </a>
              {fmt(item.hot, isRating) && <span className="shrink-0 text-[11px] text-muted-foreground/25">{fmt(item.hot, isRating)}</span>}
              <button
                type="button"
                onClick={() => onAiAnalyze(item, s)}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                title="AI 分析"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary/60 hover:text-primary" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── 主页面 ────────────────────────────────────────────────────────────── */
export default function HotListPage() {
  const [active, setActive] = useState('all')
  const [data, setData] = useState<Record<string, HotItem[]>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [aiTarget, setAiTarget] = useState<{ item: HotItem; source: HotSource } | null>(null)

  const load = useCallback(async (src: HotSource) => {
    setLoading(p => ({ ...p, [src.apiPath]: true }))
    try {
      const r = await fetch(`${API_BASE}/${src.apiPath}`)
      const j = await r.json()
      setData(p => ({
        ...p,
        [src.apiPath]: (j.data ?? []).map((it: Record<string, unknown>, i: number) => ({
          id: it.id ?? i, rank: i + 1, title: String(it.title ?? ''),
          hot: (it.hot as number | string) ?? 0, url: String(it.url ?? '#'),
        })),
      }))
    } catch {}
    setLoading(p => ({ ...p, [src.apiPath]: false }))
  }, [])

  const refresh = useCallback(() => SOURCES.forEach(load), [load])
  useEffect(() => { refresh() }, [refresh])

  const list = active === 'all' ? SOURCES : SOURCES.filter(s => s.apiPath === active)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingTopBar />
      <main className="mx-auto max-w-[1400px] px-5 py-6">
        {/* Title row */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-bold">今日热榜</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground/40">汇聚全网热点</p>
          </div>
          <button type="button" onClick={refresh} aria-label="刷新热榜" title="刷新热榜" className="flex h-8 w-8 items-center justify-center rounded-full border border-border/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="sticky top-14 z-40 -mx-5 mb-5 border-b border-border/20 bg-background/85 px-5 py-3 backdrop-blur-xl">
          <div className="flex flex-wrap gap-1.5">
            <TabChip active={active === 'all'} onClick={() => setActive('all')} ariaLabel="查看全部平台">
              <LayoutGrid className="h-3.5 w-3.5" />
              全部
            </TabChip>
            {SOURCES.map(s => (
              <TabChip key={s.apiPath} active={active === s.apiPath} onClick={() => setActive(active === s.apiPath ? 'all' : s.apiPath)} ariaLabel={`仅查看${s.cn}`}>
                <PlatformIcon platform={s.platform} className="h-3.5 w-3.5" variant="light" />
                {s.cn}
              </TabChip>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map(s => (
            <Card
              key={s.apiPath}
              s={s}
              items={data[s.apiPath] ?? []}
              loading={!!loading[s.apiPath]}
              onAiAnalyze={(item, source) => setAiTarget({ item, source })}
            />
          ))}
        </div>
      </main>
      <MarketingFooter />

      {/* AI 分析弹窗 */}
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

function TabChip({ active, onClick, ariaLabel, children }: { active: boolean; onClick: () => void; ariaLabel: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={ariaLabel} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${active ? 'border-border/60 bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'}`}>
      {children}
    </button>
  )
}
