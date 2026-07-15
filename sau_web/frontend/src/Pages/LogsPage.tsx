import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Button } from '@/Components/ui/button'
import { Card, CardContent } from '@/Components/ui/card'
import { Input } from '@/Components/ui/input'
import { Label } from '@/Components/ui/label'
import { Checkbox } from '@/Components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/Components/ui/select'
import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
import { cn } from '@/lib/utils'
import { api, type LogEntry } from '../api/client'
import { useToast } from '@/Components/ui/toast'
import {
  AlertCircle,
  Download,
  Info,
  Loader2,
  RefreshCw,
  Search,
  AlertTriangle,
  FileText,
  Activity,
} from 'lucide-react'
import { ChipBar, type ChipBarVariant } from '@/Components/ui/chip-bar'
import { toneFillBgClass, toneTextClass, type Tone } from '@/lib/tone'

type Level = 'all' | 'info' | 'warn' | 'error'
type ResolvedLevel = Exclude<Level, 'all'>

function classifyLevel(message: string): ResolvedLevel {
  if (/error|失败|ERROR|Exception/.test(message)) return 'error'
  if (/warn|警告|WARN|注意/.test(message)) return 'warn'
  return 'info'
}

// Syslog-style channel naming diverges from the project's `Tone` vocabulary
// (ResLevel `warn` ↦ Tone `warning`). Adapter kept LOCAL here so the API
// contract stays syslog-shaped while the rendering tier talks `Tone`.
// Single source of truth for status colors stays in `@/lib/tone`.
function levelToTone(level: ResolvedLevel): Tone {
  return level === 'warn' ? 'warning' : level
}

// Linear DESIGN.md — semantic dot replaces the prior emoji prefix (🔴🟡).
// Colored via the status palette composed through `@/lib/tone` so it tracks
// the design system in both themes (and shares vocabulary with Badge / Alert
// / Toast / ValidityBadge). Records route through `levelToTone()` so the
// syslog→Tone rename happens once here, not at every call site.
const LEVEL_DOT_CLASS: Record<ResolvedLevel, string> = {
  info: toneFillBgClass(levelToTone('info')),
  warn: toneFillBgClass(levelToTone('warn')),
  error: toneFillBgClass(levelToTone('error')),
}

const LEVEL_TEXT_CLASS: Record<ResolvedLevel, string> = {
  // `info` channels stay neutral — they aren't a status warning, they're the
  // baseline log voice, so `text-foreground` (compared to the colored
  // `warning` / `error` text) is intentional.
  info: 'text-foreground',
  warn: toneTextClass(levelToTone('warn')),
  error: toneTextClass(levelToTone('error')),
}

/** Left-side color bar width (px) for warn / error rows.
 *  Info rows get no bar — they're the baseline and would be noisy
 *  if every line carried a stripe. */
const LEVEL_BORDER_L: Record<ResolvedLevel, string> = {
  info: '',
  warn: 'border-l-[3px] border-l-amber-500/70',
  error: 'border-l-[3px] border-l-rose-500/80',
}

/** Gradient background per level — error gets the strongest wash so it
 *  jumps out when scanning a dense log pane. Warn gets a subtler amber
 *  tint. Info stays transparent. Opacity kept low (5–8%) so the
 *  monospace text contrast isn't degraded. */
const LEVEL_ROW_BG: Record<ResolvedLevel, string> = {
  info: '',
  warn: 'bg-gradient-to-r from-amber-500/8 to-transparent',
  error: 'bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent',
}

const LEVEL_CHIPS: ReadonlyArray<{
  value: Level
  label: string
  icon: ReactNode
  variant: ChipBarVariant
}> = [
  { value: 'all', label: '全部', icon: <FileText className="h-3.5 w-3.5" />, variant: 'neutral' },
  { value: 'info', label: '信息', icon: <Info className="h-3.5 w-3.5" />, variant: 'info' },
  { value: 'warn', label: '警告', icon: <AlertTriangle className="h-3.5 w-3.5" />, variant: 'warning' },
  { value: 'error', label: '错误', icon: <AlertCircle className="h-3.5 w-3.5" />, variant: 'error' },
]

function parseDate(ts: string) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN', { hour12: false })
}

function extractTaskId(message: string): string | null {
  const match = message.match(/^\[([^\]]+)\]/)
  return match ? match[1] : null
}

function LogsPage() {
  const qc = useQueryClient()
  const { addToast } = useToast()
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [level, setLevel] = useState<Level>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedKeyword(keyword)
    }, 300)
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [keyword])

  const { data: logs = [] } = useQuery<LogEntry[]>({
    queryKey: ['logs'],
    queryFn: async () => {
      const res = await api.getLogs()
      return res.data ?? []
    },
    refetchInterval: 2000,
  })

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const taskIdOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of logs) {
      const tid = extractTaskId(entry.message)
      if (tid) ids.add(tid)
    }
    return Array.from(ids).sort()
  }, [logs])

  const filteredLogs = useMemo(() => {
    let result = logs

    if (level !== 'all') {
      result = result.filter((item) => classifyLevel(item.message) === level)
    }

    if (selectedTaskId) {
      const prefix = `[${selectedTaskId}]`
      result = result.filter((item) => item.message.startsWith(prefix))
    }

    const kw = debouncedKeyword.trim().toLowerCase()
    if (kw) {
      result = result.filter((item) => item.message.toLowerCase().includes(kw))
    }

    return result
  }, [logs, debouncedKeyword, level, selectedTaskId])

  const summary = useMemo(() => {
    let info = 0
    let warn = 0
    let error = 0
    for (const item of logs) {
      const lv = classifyLevel(item.message)
      if (lv === 'info') info += 1
      else if (lv === 'warn') warn += 1
      else error += 1
    }
    return { all: logs.length, info, warn, error }
  }, [logs])

  const exportText = useMemo(() => {
    return filteredLogs.map((item) => `${item.ts} | ${item.message}`).join('\n')
  }, [filteredLogs])

  const handleExport = () => {
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${new Date().toISOString().replace(/[: ]/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
    addToast('日志导出完成', 'success')
  }

  const handleReset = () => {
    qc.invalidateQueries({ queryKey: ['logs'] })
  }

  return (
    <PageWrapper spacing="sm">
      <PageHeader
        title="运行日志"
        description="实时查看系统运行日志"
        icon={<FileText className="h-5 w-5 text-muted-foreground" />}
        actions={
          <div className="flex items-center gap-2">
            {/* Live indicator — pulse dot + text */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="hidden sm:inline">实时</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredLogs.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              导出日志
            </Button>
          </div>
        }
      />

      {/* ── Summary stats strip — 4 mini stat cards ─────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <LogStatCard
          label="总条目"
          value={summary.all}
          icon={Activity}
          color="text-blue-500"
          bg="bg-blue-500/10"
          active={level === 'all'}
          onClick={() => setLevel('all')}
        />
        <LogStatCard
          label="信息"
          value={summary.info}
          icon={Info}
          color="text-sky-500"
          bg="bg-sky-500/10"
          active={level === 'info'}
          onClick={() => setLevel('info')}
        />
        <LogStatCard
          label="警告"
          value={summary.warn}
          icon={AlertTriangle}
          color="text-amber-500"
          bg="bg-amber-500/10"
          active={level === 'warn'}
          onClick={() => setLevel('warn')}
        />
        <LogStatCard
          label="错误"
          value={summary.error}
          icon={AlertCircle}
          color="text-rose-500"
          bg="bg-rose-500/10"
          active={level === 'error'}
          onClick={() => setLevel('error')}
        />
      </div>

      <ChipBar
        options={LEVEL_CHIPS.map((c) => ({ ...c, count: summary[c.value] }))}
        value={level}
        onChange={(v) => setLevel(v as Level)}
        className="mb-2"
      />

      <Card className="card-refined">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="logs-search-keyword"
                  name="search"
                  placeholder="搜索日志内容..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="pl-8"
                  autoComplete="off"
                  data-search-input
                />
              </div>
            </div>
            <Select value={selectedTaskId ?? ''} onValueChange={(v) => setSelectedTaskId(v || null)}>
              <SelectTrigger id="logs-task-filter" className="w-[180px]" aria-label="按任务筛选">
                <SelectValue placeholder="按任务筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部任务</SelectItem>
                {taskIdOptions.map((id) => (
                  <SelectItem key={id} value={id}>
                    <code className="text-xs">{id.length > 20 ? `${id.slice(0, 10)}...${id.slice(-8)}` : id}</code>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-scroll"
                  checked={autoScroll}
                  onCheckedChange={(checked) => setAutoScroll(checked === true)}
                />
                <Label htmlFor="auto-scroll" className="text-sm">自动滚动</Label>
              </div>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RefreshCw className="h-4 w-4 mr-1" />
                重置
              </Button>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="flex h-[520px] items-center justify-center rounded-lg bg-muted">
              <p className="text-sm text-muted-foreground">
                {logs.length === 0 ? '等待日志...' : '无匹配日志'}
              </p>
            </div>
          ) : (
            <div
              ref={containerRef}
              className="h-[520px] overflow-y-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed"
            >
              {filteredLogs.map((entry, idx) => {
                const lv = classifyLevel(entry.message)
                return (
                  <div
                    key={`${entry.ts}-${idx}`}
                    className={cn(
                      'flex items-start gap-2 mb-0.5 rounded-sm px-2 py-0.5 transition-colors',
                      LEVEL_BORDER_L[lv],
                      LEVEL_ROW_BG[lv],
                      lv !== 'info' && 'hover:bg-foreground/[0.03]',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full',
                        LEVEL_DOT_CLASS[lv],
                      )}
                      aria-hidden
                    />
                    <span className="mr-1 select-none whitespace-nowrap text-muted-foreground/60 font-mono tabular-nums">
                      {parseDate(entry.ts)}
                    </span>
                    <span className={LEVEL_TEXT_CLASS[lv]}>{entry.message}</span>
                  </div>
                )
              })}
              <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-[11px]">实时接收中...</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageWrapper>
  )
}

/** Mini stat card for the summary strip — clickable to filter by level. */
function LogStatCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
  active,
  onClick,
}: {
  label: string
  value: number
  icon: typeof Activity
  color: string
  bg: string
  active: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className={cn(
        'text-left rounded-xl bg-card ring-1 transition-all overflow-hidden',
        active ? 'ring-foreground/20 shadow-sm' : 'ring-foreground/5 hover:ring-foreground/10',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg shrink-0', bg)}>
          <Icon className={cn('h-4 w-4', color)} />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}</p>
        </div>
      </div>
    </motion.button>
  )
}

export default LogsPage
