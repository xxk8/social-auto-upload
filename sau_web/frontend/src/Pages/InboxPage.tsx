import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/Components/ui/button'
import { Card, CardContent } from '@/Components/ui/card'
import { Input } from '@/Components/ui/input'
import { Badge } from '@/Components/ui/badge'
import { PageHeader } from '@/Components/ui/page-header'
import { PlatformIcon, PlatformIconChip, PLATFORM_CHIP_COLORS } from '@/Components/ui/platform-icon'
import { useToast } from '@/Components/ui/toast.helpers'
import {
  Check,
  CheckSquare,
  ChevronDown,
  Clipboard,
  Copy,
  Download as DownloadIcon,
  FileVideo,
  FolderOpen,
  GripVertical,
  Inbox,
  Loader2,
  Mic,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '@/lib/utils'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { arrayMove } from '@dnd-kit/helpers'


// Ponytail: status is a flat union — the four-state visual progression
// (download → transcribe) maps 1:1 onto the four client-visible Badge
// variants. A `waiting` state isn't needed because the only async step
// is gated by `busy` (URL input) for downloads and the per-row
// `transcribing`-badge for streaming transcription.
type Status = 'downloading' | 'downloaded' | 'failed' | 'transcribing' | 'transcribed'

interface InboxEntry {
  id: string
  url: string
  filename?: string
  dir?: string
  engine?: 'yt-dlp' | 'patchright' | 'bbdown'
  status: Status
  error?: string
  transcript?: string
}

const newEntryId = () =>
  `entry_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

type PlatformKey = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'bilibili'
  | 'youtube' | 'tiktok' | 'twitter' | 'instagram' | 'facebook'
  | 'tencent' | 'ixigua' | 'dailymotion' | 'rumble' | 'vk'
  | 'general'

// ── Supported download platforms (tested via yt-dlp / patchright) ───────
//
// Engine legend:
//   • yt-dlp — general-purpose, supports 1000+ sites (YouTube, Bilibili,
//     TikTok, Twitter/X, Instagram, Facebook, Dailymotion, Rumble, VK,
//     西瓜视频, 微视, 秒拍, etc.)
//   • patchright — browser fallback for anti-bot-heavy platforms where
//     yt-dlp extractors are unreliable (Douyin, Kuaishou, Xiaohongshu)
//   • BBDown — dedicated Bilibili TV-API downloader (watermark-free)
//
// See scripts/test_platform_downloads.py for the full test matrix.
const DOWNLOAD_PLATFORMS: ReadonlyArray<{
  key: PlatformKey
  name: string
  engine: string
}> = [
  // Browser-first (patchright)
  { key: 'douyin', name: '抖音', engine: 'browser(patchright)' },
  { key: 'kuaishou', name: '快手', engine: 'browser(patchright)' },
  { key: 'xiaohongshu', name: '小红书', engine: 'browser(patchright)' },
  // yt-dlp + dedicated engines
  { key: 'bilibili', name: 'B站', engine: 'yt-dlp / BBDown' },
  { key: 'youtube', name: 'YouTube', engine: 'yt-dlp' },
  { key: 'tiktok', name: 'TikTok', engine: 'yt-dlp' },
  { key: 'twitter', name: 'X (Twitter)', engine: 'yt-dlp' },
  { key: 'instagram', name: 'Instagram', engine: 'yt-dlp' },
  { key: 'facebook', name: 'Facebook', engine: 'yt-dlp' },
  { key: 'tencent', name: '视频号', engine: 'yt-dlp' },
  { key: 'ixigua', name: '西瓜视频', engine: 'yt-dlp' },
  { key: 'dailymotion', name: 'Dailymotion', engine: 'yt-dlp' },
  { key: 'rumble', name: 'Rumble', engine: 'yt-dlp' },
  { key: 'vk', name: 'VK', engine: 'yt-dlp' },
  // Catch-all for the rest (皮皮虾, 微视, 秒拍, etc.)
  { key: 'general', name: '其他·通用', engine: 'yt-dlp' },
]

// Platform → website URL (clickable chips)
const PLATFORM_URLS: Record<string, string> = {
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

type StatusFilter = Status | 'all'

const FILTER_OPTIONS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'downloading', label: '下载中' },
  { key: 'downloaded', label: '已下载' },
  { key: 'failed', label: '失败' },
  { key: 'transcribing', label: '转写中' },
  { key: 'transcribed', label: '已转写' },
]

// Status group display order (in-progress → attention → completed)
const STATUS_ORDER: Status[] = [
  'downloading',
  'transcribing',
  'failed',
  'downloaded',
  'transcribed',
]

const STATUS_LABELS: Record<Status, string> = {
  downloading: '下载中',
  downloaded: '已下载',
  failed: '失败',
  transcribing: '转写中',
  transcribed: '已转写',
}

// URL hostname → platform key (mirrors web_runner/routes/inbox.py _URL_HOST_TO_PLATFORM)
// + extended with yt-dlp-supported platforms for frontend auto-detection.
const HOST_TO_PLATFORM: Record<string, PlatformKey> = {
  // Browser-first (patchright)
  'douyin.com': 'douyin',
  'www.douyin.com': 'douyin',
  'v.douyin.com': 'douyin',
  'kuaishou.com': 'kuaishou',
  'www.kuaishou.com': 'kuaishou',
  'v.kuaishou.com': 'kuaishou',
  'xiaohongshu.com': 'xiaohongshu',
  'www.xiaohongshu.com': 'xiaohongshu',
  'xhslink.com': 'xiaohongshu',
  'www.xhslink.com': 'xiaohongshu',
  // yt-dlp / BBDown
  'bilibili.com': 'bilibili',
  'www.bilibili.com': 'bilibili',
  // yt-dlp (视频号 / 腾讯视频)
  'v.qq.com': 'tencent',
  'channels.weixin.qq.com': 'tencent',
  // yt-dlp (general video)
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'm.youtube.com': 'youtube',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'm.tiktok.com': 'tiktok',
  'twitter.com': 'twitter',
  'www.twitter.com': 'twitter',
  'x.com': 'twitter',
  't.co': 'twitter',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'fb.watch': 'facebook',
  'm.facebook.com': 'facebook',
  // yt-dlp (西瓜视频 / 国内综合)
  'ixigua.com': 'ixigua',
  'www.ixigua.com': 'ixigua',
  'm.ixigua.com': 'ixigua',
  // yt-dlp (海外视频)
  'dailymotion.com': 'dailymotion',
  'www.dailymotion.com': 'dailymotion',
  'dai.ly': 'dailymotion',
  'rumble.com': 'rumble',
  'www.rumble.com': 'rumble',
  'vk.com': 'vk',
  'www.vk.com': 'vk',
  'vkvideo.ru': 'vk',
  // 皮皮虾 / 微视 / 秒拍 — covered by 'general' fallback.
}

function detectPlatform(input: string): PlatformKey | null {
  const urlStr = extractFirstUrl(input)
  if (!urlStr) return null
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase()
    for (const [domain, platform] of Object.entries(HOST_TO_PLATFORM)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return platform
      }
    }
    // Recognizable http(s) URL that didn't match any known platform → general
    return 'general'
  } catch {
    return null
  }
}

// App-share text (Douyin / Xiaohongshu / Kuaishou clipboard blobs
// like "4.66 xfo:/ :4pm 08/23 ... # 情感 # 对象 ... https://v.douyin.com/X 复制
// 此链接...") carries prefix garbage. The pattern from each app varies —
// python-prefix, song metadata, hashtags, the URL itself, and a CN suffix
// ("复制此链接，打开Dou音搜索，直接观看视频！") — but the SHARED invariant
// is a contiguous `https?://...` URL somewhere in the string. We extract
// the first match and shed any trailing Chinese full-width punctuation
// (the suffix text often begins with `，` `。` `！` glued to the URL).
const SHARE_URL_RE = /https?:\/\/[^\s]+/i
const TRAILING_CN_PUNCT_RE = /[，。！？、；：「」『』]+$/

function extractFirstUrl(input: string): string | null {
  const match = SHARE_URL_RE.exec(input)
  return match ? match[0].replace(TRAILING_CN_PUNCT_RE, '') : null
}

export default function InboxPage() {
  const { addToast } = useToast()
  const [url, setUrl] = useState('')
  // Per-entry in-flight tracking. The previous design used a single
  // `busy` boolean that disabled the URL input / paste / download
  // button / every row's retry button for the duration of any single
  // download — which the user reported as "after one download the
  // rest of the page is locked". Switching to a Set of in-flight
  // entry IDs lets the page host N parallel downloads: the top-level
  // controls are never blocked, the per-row retry button is only
  // disabled for the entry whose retry is currently in flight, and
  // the header chip counts how many downloads are running.
  const [inflightEntryIds, setInflightEntryIds] = useState<Set<string>>(
    () => new Set(),
  )
  // `batchBusy` is a separate debounce for the batch-retry loop only.
  // It exists so two clicks of "重试选中" can't fire two parallel
  // sequential loops that re-process the same entries. The per-entry
  // set handles every other case.
  const [batchBusy, setBatchBusy] = useState(false)
  const inFlightCount = inflightEntryIds.size
  // Per-entry add/remove helpers. useCallback-wrapped so the
  // downstream useCallback deps (handleDownload / handleRetry /
  // handleBatchRetry) don't churn on every render — that would
  // re-derive `onRetry` props on every row and re-render the
  // sortable wrapper unnecessarily. Empty deps are correct: the
  // setter is stable, and the functional form `setInflightEntryIds
  // ((prev) => …)` re-reads the latest Set so closure staleness
  // can't happen.
  const markInflight = useCallback((id: string) => {
    setInflightEntryIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])
  const clearInflight = useCallback((id: string) => {
    setInflightEntryIds((prev) => {
      // No-op short-circuit: if the id wasn't tracked, return
      // the same Set reference so React can bail out of the
      // commit. Otherwise we'd allocate a new Set per
      // handleRemove / handleBatchRemove call even when the
      // entry was already terminal (downloaded / failed), which
      // would re-render rows unnecessarily. Recent switched
      // entries are the common path where the chip is already
      // 0 and we're pruning ids that never went through
      // markInflight.
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])
  const [entries, setEntries] = useState<InboxEntry[]>([])
  const [detectedPlatform, setDetectedPlatform] = useState<PlatformKey | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<Status>>(new Set())

  const filteredEntries = useMemo(
    () =>
      filterStatus === 'all'
        ? entries
        : entries.filter((e) => e.status === filterStatus),
    [entries, filterStatus],
  )

  // Group entries by status for the "全部" view
  const groupedEntries = useMemo(() => {
    const groups: Record<string, InboxEntry[]> = {}
    for (const status of STATUS_ORDER) {
      groups[status] = entries.filter((e) => e.status === status)
    }
    return groups as Record<Status, InboxEntry[]>
  }, [entries])

  // Collapse/expand state (must live AFTER groupedEntries to avoid TDZ)
  const allCollapsed = useMemo(
    () => STATUS_ORDER.every((s) => groupedEntries[s].length === 0 || collapsedGroups.has(s)),
    [collapsedGroups, groupedEntries],
  )

  const handleToggleCollapse = useCallback((status: Status) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }, [])

  const handleToggleAll = useCallback(() => {
    setCollapsedGroups((prev) => {
      if (STATUS_ORDER.every((s) => groupedEntries[s].length === 0 || prev.has(s))) {
        // All non-empty groups are collapsed → expand all
        return new Set()
      }
      // Collapse all non-empty groups
      const next = new Set(prev)
      for (const status of STATUS_ORDER) {
        if (groupedEntries[status].length > 0) {
          next.add(status)
        }
      }
      return next
    })
  }, [groupedEntries])

  const detectedInfo = useMemo(
    () => DOWNLOAD_PLATFORMS.find((p) => p.key === detectedPlatform) ?? null,
    [detectedPlatform],
  )

  // Round-paste UX: one-tap clipboard → URL input. Worst-case
  // (`navigator.clipboard.readText` rejects on a non-secure context
  // or when the user denies permission) falls back to a toast so the
  // user knows to long-press the input + paste manually. We DON'T
  // synthesize fake clipboard contents — pasting the wrong URL into
  // the URL field would silently 400 the backend request.
  //
  // No busy-guard here: pasting a fresh URL into the input does NOT
  // touch the in-flight request (the URL was captured into `target`
  // synchronously in handleDownload, before the await). Letting the
  // user paste while downloads are running is the whole point of the
  // concurrent-downloads refactor.
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setUrl(text)
        setDetectedPlatform(detectPlatform(text))
        addToast('已粘贴剪切板内容', 'success')
      }
    } catch {
      addToast(
        '无法读取剪切板：请检查浏览器权限（非 HTTPS / 非授权站点）',
        'error',
      )
    }
  }, [addToast])

  const handleDownload = useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      addToast('请粘贴分享链接', 'warning')
      return
    }
    // Direct http(s) first, then app-share regex extraction as
    // fallback. Extracted URL replaces `url` so the entry's display
    // shows the clean URL, not the noise (better scan-back later).
    let target = trimmed
    // Round-19 sec fix (sec-2 mirror): tighten the early startswith
    // check to require no-whitespace at end. Without this,
    // `'https://example.com/x.mp4 复制此链接'` passes the loose
    // `/^https?:\/\//i` gate and is sent verbatim to the backend —
    // bypassing the regex cleanup we run for non-http inputs. The
    // regex-extract helper is the single source of truth for URL
    // cleanup, irrespective of whether the input happened to start
    // with http(s)://. Mirrors backend `inbox.py::dl()` force-extract.
    if (!/^https?:\/\/[^\s]+$/i.test(target)) {
      const extracted = extractFirstUrl(trimmed)
      if (!extracted) {
        addToast('未找到 http(s) 链接', 'error')
        return
      }
      addToast(`已从分享文本提取链接：${extracted}`, 'info')
      target = extracted
    }
    const id = newEntryId()
    setEntries((prev) => [{ id, url: target, status: 'downloading' }, ...prev])
    setUrl('')
    setDetectedPlatform(null)
    // Per-entry in-flight tracking. Does NOT block the top-level UI
    // (URL input / paste / download button) — the user can fire
    // another handleDownload() while this one is in flight, which
    // will be tracked independently via its own entry id.
    markInflight(id)
    try {
      // Round-15 fix: pass `target` (extracted URL when the input was
      // an app-share blob), NOT `trimmed` (the original blob). The
      // entry field above already uses `target` so the URL display is
      // consistent end-to-end. Sending `trimmed` to the backend would
      // 400 the request via the backend's startswith('http(s)://')
      // gate, defeating the whole point of front-end extraction.
      const res = await api.inboxDownload(target)
      setEntries((prev) =>
        prev.map((e) =>
          e.id !== id
            ? e
            : res.success && res.filename
              ? {
                  ...e,
                  status: 'downloaded',
                  filename: res.filename,
                  dir: res.dir,
                  engine: res.engine,
                }
              : { ...e, status: 'failed', error: res.message ?? '下载失败' },
        ),
      )
      if (res.success && res.filename) {
        addToast(`已下载 ${res.filename}${res.dir ? `\n${res.dir}` : ''}`, 'success')
      } else {
        addToast(res.message ?? '下载失败', 'error')
      }
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id !== id
            ? e
            : {
                ...e,
                status: 'failed',
                error: err instanceof Error ? err.message : '请求失败',
              },
        ),
      )
      addToast('请求失败，请检查后端连接', 'error')
    } finally {
      clearInflight(id)
    }
  }, [url, addToast, markInflight, clearInflight])

  const handleTranscribe = useCallback(
    async (id: string) => {
      const target = entries.find((e) => e.id === id)
      if (!target?.filename) return
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, status: 'transcribing', transcript: undefined, error: undefined }
            : e,
        ),
      )
      try {
        await api.inboxTranscribeStream(
          { filename: target.filename },
          (chunk) =>
            setEntries((prev) =>
              prev.map((e) =>
                e.id === id
                  ? { ...e, transcript: (e.transcript ?? '') + chunk }
                  : e,
              ),
            ),
          () =>
            setEntries((prev) =>
              prev.map((e) =>
                e.id === id ? { ...e, status: 'transcribed' } : e,
              ),
            ),
          (msg) => {
            setEntries((prev) =>
              prev.map((e) =>
                e.id === id ? { ...e, status: 'failed', error: msg } : e,
              ),
            )
            addToast(`转写失败：${msg}`, 'error')
          },
        )
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: 'failed',
                  error: err instanceof Error ? err.message : '请求失败',
                }
              : e,
          ),
        )
        addToast('转写请求失败', 'error')
      }
    },
    [entries, addToast],
  )

  const handleCopyTranscript = useCallback(
    async (id: string) => {
      const target = entries.find((e) => e.id === id)
      if (!target?.transcript) return
      try {
        await navigator.clipboard.writeText(target.transcript)
        addToast('文案已复制', 'success')
      } catch {
        addToast('复制失败，请手动复制', 'error')
      }
    },
    [entries, addToast],
  )

  const handleRemove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    // Issue 1 fix: drop the entry from in-flight tracking if it
    // was actively downloading — otherwise the in-flight count
    // chip would carry a stale id and only decrement when the
    // underlying api.inboxDownload promise resolves seconds
    // later. Backend download itself is NOT cancelled here:
    // the server-side download continues per the inbox 24h
    // auto-cleanup policy. clearInflight no-ops if the id
    // wasn't tracked, so this stays safe for already-terminal
    // entries (downloaded / failed).
    clearInflight(id)
  }, [clearInflight])

  const handleClearAll = useCallback(() => {
    if (entries.length === 0) return
    // Issue 1 fix part 3: clear ALL in-flight ids in one atomic
    // update so the chip disappears in a single React commit.
    // UI-only cancellation — backend downloads continue per the
    // inbox 24h auto-cleanup policy. We bypass the per-id
    // clearInflight helper here because we want a single
    // commit, not N sequential commits — N would mean the chip
    // reads `1 then 0` flicker through as React commits each
    // individual id-cleanup. Wrapped in the functional-set form
    // so `prev.size === 0` short-circuits to the same reference
    // when nothing is in flight (bail-out).
    setInflightEntryIds((prev) => (prev.size === 0 ? prev : new Set()))
    setEntries([])
    setSelectedIds(new Set())
    addToast('已清除全部记录', 'info')
  }, [entries.length, addToast])

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === entries.length) return new Set() // deselect all
      return new Set(entries.map((e) => e.id))
    })
  }, [entries])

  const handleBatchRemove = useCallback(() => {
    if (selectedIds.size === 0) return
    // Issue 1 fix part 2: per-id clearInflight for each selected
    // entry BEFORE the entries update commits. UI-only
    // cancellation: backend downloads continue per inbox 24h
    // auto-cleanup policy. The loop uses the helper rather than
    // a single bulk setState so future helper behaviour
    // (logging, abort hooks, etc.) is picked up automatically.
    // Each clearInflight is a stable hook reference, and the
    // early-return inside the helper means ids that aren't
    // actually in flight are zero-cost.
    for (const id of selectedIds) {
      clearInflight(id)
    }
    setEntries((prev) => prev.filter((e) => !selectedIds.has(e.id)))
    addToast(`已移除 ${selectedIds.size} 条记录`, 'info')
    setSelectedIds(new Set())
  }, [selectedIds, addToast, clearInflight])

  const handleGroupDragEnd = useCallback(
    (status: Status) =>
      (event: {
        operation: {
          target: { id: string | number } | null
          source: { id: string | number } | null
        }
      }) => {
        const { target, source } = event.operation
        if (!target || !source || source.id === target.id) return

        const sourceId = String(source.id)
        const targetId = String(target.id)

        setEntries((prev) => {
          // Find indices in the full entries array
          const sourceIndex = prev.findIndex((e) => e.id === sourceId)
          const targetIndex = prev.findIndex((e) => e.id === targetId)
          if (sourceIndex === -1 || targetIndex === -1) return prev

          // Both entries must belong to the target status group
          if (prev[sourceIndex].status !== status) return prev
          if (prev[targetIndex].status !== status) return prev

          return arrayMove(prev, sourceIndex, targetIndex)
        })
      },
    [],
  )

  const handleBatchRetry = useCallback(async () => {
    // Filter on (status === 'failed' && !inflight). The latter is
    // critical: if a previous batch loop is still draining and the
    // user clicks 重试选中 again on a re-selected entry, we MUST
    // skip it — otherwise two parallel `await api.inboxDownload`
    // calls race on the same entry id. The inflight check uses the
    // functional `setInflightEntryIds` flow below to also stay in
    // sync as concurrent batches interleave.
    const toRetry = entries.filter(
      (e) =>
        selectedIds.has(e.id) &&
        e.status === 'failed' &&
        e.url &&
        !inflightEntryIds.has(e.id),
    )
    if (toRetry.length === 0) {
      addToast('选中的条目中没有可重试的失败记录', 'warning')
      return
    }
    setBatchBusy(true)
    let successCount = 0
    try {
      for (const entry of toRetry) {
        // Mark this entry 'downloading' BEFORE the await so the row
        // re-renders as in-progress (Badge switches to 下载中) and
        // any subsequent batch retry filters it out via the
        // !inflightEntryIds.has() check above. Mirrors the per-row
        // handleRetry status flip; the previous handleBatchRetry
        // skipped this flip, which was the root cause of a
        // double-retry race.
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id
              ? { ...e, status: 'downloading' as Status, error: undefined }
              : e,
          ),
        )
        markInflight(entry.id)
        try {
          const res = await api.inboxDownload(entry.url)
          setEntries((prev) =>
            prev.map((e) =>
              e.id !== entry.id
                ? e
                : res.success && res.filename
                  ? { ...e, status: 'downloaded' as Status, filename: res.filename, engine: res.engine }
                  : { ...e, status: 'failed' as Status, error: res.message ?? '下载失败' },
            ),
          )
          if (res.success) successCount++
        } catch {
          setEntries((prev) =>
            prev.map((e) =>
              e.id === entry.id ? { ...e, status: 'failed' as Status, error: '重试请求失败' } : e,
            ),
          )
        } finally {
          // Per-entry clear so the in-flight header chip decrements
          // live as the loop drains. The batchBusy wrapper around
          // the loop is the second debounce layer (prevents two
          // parallel batch loops), but per-entry tracking drives
          // the UI.
          clearInflight(entry.id)
        }
      }
      addToast(`重试完成：${successCount}/${toRetry.length} 成功`, successCount === toRetry.length ? 'success' : 'info')
      setSelectedIds(new Set())
    } finally {
      // Defensive: even if a future refactor throws between
      // setBatchBusy(true) and the for-loop end, the batch flag
      // must NOT stay stuck — that would freeze the 重试选中
      // button. Per-entry inflightEntryIds is independently cleaned
      // by the inner finally above.
      setBatchBusy(false)
    }
  }, [entries, selectedIds, addToast, inflightEntryIds, markInflight, clearInflight])

  const handleRetry = useCallback(
    async (id: string) => {
      const target = entries.find((e) => e.id === id)
      if (!target?.url) return
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, status: 'downloading' as Status, error: undefined }
            : e,
        ),
      )
      // Per-entry in-flight tracking. ONLY this row's 重试 button is
      // disabled while this retry runs (via the InboxRow `inflight`
      // prop, which the parent computes from inflightEntryIds.has()).
      // Other rows' retry buttons stay clickable, so a user can fire
      // parallel retries across multiple failed entries.
      markInflight(id)
      try {
        const res = await api.inboxDownload(target.url)
        setEntries((prev) =>
          prev.map((e) =>
            e.id !== id
              ? e
              : res.success && res.filename
                ? {
                    ...e,
                    status: 'downloaded' as Status,
                    filename: res.filename,
                    dir: res.dir,
                    engine: res.engine,
                  }
                : { ...e, status: 'failed' as Status, error: res.message ?? '下载失败' },
          ),
        )
        if (res.success && res.filename) {
          addToast(`已下载 ${res.filename}`, 'success')
        } else {
          addToast(res.message ?? '下载失败', 'error')
        }
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: 'failed' as Status,
                  error: err instanceof Error ? err.message : '请求失败',
                }
              : e,
          ),
        )
        addToast('重试失败', 'error')
      } finally {
        clearInflight(id)
      }
    },
    [entries, addToast, markInflight, clearInflight],
  )

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="素材收件箱"
        description="从分享链接下载到本地，再转写音视频文案"
        icon={<Inbox className="h-5 w-5 text-muted-foreground" />}
      />

      <Card className="card-refined">
        <CardContent className="pt-6 space-y-3">
          <label
            htmlFor="inbox-url-input"
            className="text-sm font-medium"
          >
            视频分享链接
          </label>
          <div className="flex gap-2">
            <Input
              id="inbox-url-input"
              name="url"
              placeholder="https://www.youtube.com/watch?v=... 或抖音/小红书分享链接"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setDetectedPlatform(detectPlatform(e.target.value))
              }}
              onKeyDown={(e) => {
                // Enter triggers download regardless of in-flight
                // count — the URL is captured synchronously inside
                // handleDownload (extracted into `target` before the
                // await), so concurrent in-flight requests don't
                // interfere with each other.
                if (e.key === 'Enter') {
                  void handleDownload()
                }
              }}
            />
            {/* Paste-from-clipboard. Sits BETWEEN the URL input and the
                下载 CTA so the natural left-to-right reading order walks
                user intent:  type / paste → 下载. icon-only on lg+ to keep
                the row's curl-quotient readable; sm shows the label too
                because touch targets benefit from explicit text. */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void handlePaste()}
              aria-label="从剪切板粘贴分享链接"
              title="从剪切板粘贴"
              data-testid="inbox-paste"
              className="h-9 w-9 sm:w-auto sm:px-3"
            >
              <Clipboard className="h-4 w-4 sm:mr-1" aria-hidden />
              <span className="hidden sm:inline">粘贴</span>
            </Button>
            <Button
              onClick={() => void handleDownload()}
              data-testid="inbox-download"
            >
              <DownloadIcon className="h-4 w-4 mr-1" />
              下载
            </Button>
          </div>

          {detectedInfo && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/60 border border-border/50 animate-in fade-in slide-in-from-top-1 duration-150">
              {detectedInfo.key === 'general' ? (
                <span className="h-4 w-4 flex items-center justify-center text-xs">🌐</span>
              ) : (
                <PlatformIcon platform={detectedInfo.key} variant="light" className="h-4 w-4" />
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            yt-dlp 优先；不支持回落 patchright 浏览器抓取。拒绝私有/回环
            IP（含 DNS 解析层）。数据归属您，24h 后自动清理。
          </p>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-3 border-t border-border/40">
            <span className="text-xs text-muted-foreground">支持下载</span>
            {DOWNLOAD_PLATFORMS.map((p) => {
              const url = PLATFORM_URLS[p.key]
              const platformColor = PLATFORM_CHIP_COLORS[p.key] ?? ''
              const chip = (
                <span
                  key={p.key}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-all duration-150 ${
                    detectedPlatform === p.key
                      ? 'bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/30'
                      : 'bg-muted/50 dark:bg-white/10'
                  } ${url ? 'cursor-pointer hover:bg-muted/80 dark:hover:bg-white/15' : ''} ${platformColor}`}
                  title={p.name}
                >
                  {p.key === 'general' ? (
                    <span className="h-3.5 w-3.5 flex items-center justify-center text-[10px]">🌐</span>
                  ) : (
                    <PlatformIconChip platform={p.key} />
                  )}
                  <span>{p.name}</span>
                </span>
              )
              return url ? (
                <a
                  key={p.key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="no-underline"
                  title={`打开 ${p.name} 网站`}
                >
                  {chip}
                </a>
              ) : (
                chip
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="card-refined">
        <CardContent className="pt-6">            <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">
                下载记录{' '}
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="inbox-entry-count"
                >
                  {entries.length}
                </span>
              </h2>
              {/* In-flight count chip — engineering-tool aggregate
                  state. Mono font + hairline border, NO block-fill on
                  primary (single sodium-amber accent reserved for
                  active state per DESIGN.md). Mirrors the metadata
                  pill pattern used on the publish wizard top
                  breadcrumb. */}
              {inFlightCount > 0 && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-[11px] font-mono text-muted-foreground"
                  data-testid="inbox-inflight-count"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {inFlightCount} in-flight
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {entries.length > 0 && filterStatus === 'all' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleToggleAll}
                  className="text-xs text-muted-foreground"
                >
                  <ChevronDown className={cn('h-3 w-3 mr-1 transition-transform', allCollapsed && '-rotate-90')} />
                  {allCollapsed ? '全部展开' : '全部收起'}
                </Button>
              )}
              {entries.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearAll}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  全部清除
                </Button>
              )}
            </div>
          </div>

          {/* Status filter bar */}
          {entries.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3 flex-wrap" data-testid="inbox-filter-bar">
              {FILTER_OPTIONS.map((opt) => {
                const count = opt.key === 'all'
                  ? entries.length
                  : entries.filter((e) => e.status === opt.key).length
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setFilterStatus(opt.key)}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-all duration-150 ${
                      filterStatus === opt.key
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/30 font-medium'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {opt.label}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>
          )}
          {entries.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center rounded-lg bg-muted/40 border border-dashed animate-in fade-in-0 slide-in-from-top-2 duration-300">
              <div className="text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                暂无下载记录，粘贴分享链接开始
              </div>
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSelectAll}
                    className="text-xs"
                  >
                    {selectedIds.size === entries.length ? (
                      <CheckSquare className="h-3 w-3 mr-1" />
                    ) : (
                      <Square className="h-3 w-3 mr-1" />
                    )}
                    {selectedIds.size === entries.length ? '取消全选' : '全选'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    已选 {selectedIds.size} 项
                  </span>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchRemove}
                    className="text-xs"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    清除选中
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchRetry}
                    disabled={
                      batchBusy ||
                      !entries.some(
                        (e) => selectedIds.has(e.id) && e.status === 'failed',
                      )
                    }
                    className="text-xs"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    重试选中
                  </Button>
                </div>
              )}
              {filterStatus === 'all' ? (
                <div data-testid="inbox-entries" className="space-y-4">
                  {STATUS_ORDER.map((status) => {
                    const group = groupedEntries[status]
                    if (group.length === 0) return null
                    return (
                      <div key={status}>
                        {/* Section header — clickable to collapse/expand */}
                        <button
                          type="button"
                          onClick={() => handleToggleCollapse(status)}
                          className="flex items-center gap-2 w-full px-1 py-1.5 mb-2 group"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-muted-foreground/40 transition-transform duration-150',
                              collapsedGroups.has(status) && '-rotate-90',
                            )}
                          />
                          <span className="text-xs font-semibold text-foreground/80">
                            {STATUS_LABELS[status]}
                          </span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {group.length}
                          </span>
                          <div className="flex-1 border-t border-border/30" />
                        </button>
                        {!collapsedGroups.has(status) && (
                          <DragDropProvider onDragEnd={handleGroupDragEnd(status)}>
                            <div className="space-y-2">
                              {group.map((entry, index) => (
                              <SortableGroupEntry
                                key={entry.id}
                                entry={entry}
                                index={index}
                                selected={selectedIds.has(entry.id)}
                                onToggleSelect={() => {
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(entry.id)) next.delete(entry.id)
                                    else next.add(entry.id)
                                    return next
                                  })
                                }}
                                onTranscribe={() => void handleTranscribe(entry.id)}
                                onCopyTranscript={() => void handleCopyTranscript(entry.id)}
                                onRetry={() => void handleRetry(entry.id)}
                                onRemove={() => void handleRemove(entry.id)}
                              />
                              ))}
                            </div>
                          </DragDropProvider>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : filteredEntries.length === 0 ? (
                <div
                  className="flex h-[200px] items-center justify-center rounded-lg bg-muted/40 border border-dashed animate-in fade-in-0 slide-in-from-top-2 duration-300"
                  data-testid="inbox-filter-empty"
                >
                  <div className="text-center text-sm text-muted-foreground">
                    <Inbox className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p>暂无匹配记录</p>
                    <button
                      type="button"
                      onClick={() => setFilterStatus('all')}
                      className="mt-2 text-xs underline underline-offset-4 hover:text-foreground transition-colors"
                    >
                      清除筛选
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="space-y-2" data-testid="inbox-entries">
                  {filteredEntries.map((e) => (
                    <li
                      key={e.id}
                      data-testid="inbox-entry"
                      data-status={e.status}
                    >
                      <InboxRow
                        entry={e}
                        enableDrag={false}
                        selected={selectedIds.has(e.id)}
                        onToggleSelect={() => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(e.id)) next.delete(e.id)
                            else next.add(e.id)
                            return next
                          })
                        }}
                        onTranscribe={() => void handleTranscribe(e.id)}
                        onCopyTranscript={() => void handleCopyTranscript(e.id)}
                        onRetry={() => void handleRetry(e.id)}
                        onRemove={() => void handleRemove(e.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── SortableGroupEntry wrapper ───────────────────────────────────────────
// Handles dnd-kit sortable plumbing for within-group drag. Each status
// group in the grouped view gets its own DragDropProvider + SortableGroupEntry
// children, so drag-and-drop only operates within a single status group.

interface SortableGroupEntryProps {
  entry: InboxEntry
  index: number
  selected: boolean
  onToggleSelect: () => void
  onTranscribe: () => void
  onCopyTranscript: () => void
  onRetry: () => void
  onRemove: () => void
  // No per-row `inflight` prop — see InboxRowProps for the
  // rationale. In-flight state lives at the page level and is
  // cleared through the row's Trash icon (handleRemove →
  // clearInflight).
}

function SortableGroupEntry({
  entry,
  index,
  selected,
  onToggleSelect,
  onTranscribe,
  onCopyTranscript,
  onRetry,
  onRemove,
}: SortableGroupEntryProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: entry.id,
    index,
  })

  return (
    <div
      ref={ref}
      data-testid="inbox-entry"
      data-status={entry.status}
      data-dragging={isDragging || undefined}
    >
      <div
        className={cn(
          'transition-opacity duration-150',
          isDragging && 'opacity-50',
        )}
      >
        <InboxRow
          entry={entry}
          selected={selected}
          enableDrag
          dragHandleRef={handleRef}
          onToggleSelect={onToggleSelect}
          onTranscribe={onTranscribe}
          onCopyTranscript={onCopyTranscript}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      </div>
    </div>
  )
}

// ── InboxRow (content layout) ─────────────────────────────────────────────
// Renders the visual card for a single download entry. Does NOT handle
// dnd-kit sortable plumbing — that lives in SortableGroupEntry above.

interface InboxRowProps {
  entry: InboxEntry
  selected: boolean
  enableDrag: boolean
  dragHandleRef?: (element: Element | null) => void
  onToggleSelect: () => void
  onTranscribe: () => void
  onCopyTranscript: () => void
  onRetry: () => void
  onRemove: () => void
  // No per-row `inflight` prop: the row's retry button is only
  // rendered when status === 'failed' && !entry.filename, which
  // is mutually exclusive with the moment `inflightEntryIds.has
  // (id)` is true (handleRetry flips status to 'downloading'
  // BEFORE its markInflight commit). So `disabled={inflight}` on
  // the retry button is dead code — the button is already gone
  // from the DOM by the time inflight is set. In-flight state
  // lives at the page level: `inflightEntryIds` drives the chip
  // count, and removal is wired through handleRemove →
  // clearInflight so the chip doesn't show a phantom entry.
}

function InboxRow({
  entry,
  selected,
  enableDrag,
  dragHandleRef,
  onToggleSelect,
  onTranscribe,
  onCopyTranscript,
  onRetry,
  onRemove,
}: InboxRowProps) {
  const { status, url } = entry
  const platformKey = detectPlatform(url)
  const platformInfo = platformKey
    ? DOWNLOAD_PLATFORMS.find((p) => p.key === platformKey) ?? null
    : null

  const badge = (() => {
    switch (status) {
      case 'downloading':
        return (
          <Badge variant="secondary">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            下载中
          </Badge>
        )
      case 'downloaded':
        return (
          <Badge>
            <Check className="h-3 w-3 mr-1" />
            已下载
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            失败
          </Badge>
        )
      case 'transcribing':
        return (
          <Badge variant="secondary">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            转写中
          </Badge>
        )
      case 'transcribed':
        return (
          <Badge>
            <Sparkles className="h-3 w-3 mr-1" />
            已转写
          </Badge>
        )
    }
  })()

  return (
    <div className={`rounded-lg border bg-card p-3 space-y-2 transition-colors duration-150 ${selected ? 'border-primary/30 bg-primary/[0.03]' : ''}`}>
      <div className="flex items-start gap-2">
        {/* Drag handle — only rendered when enableDrag is true */}
        {enableDrag && dragHandleRef && (
          <div
            ref={dragHandleRef}
            className="mt-1 flex-shrink-0 cursor-grab active:cursor-grabbing p-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        <button
          type="button"
          onClick={onToggleSelect}
          className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={selected ? '取消选择' : '选择'}
        >
          {selected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
        {platformInfo && platformInfo.key !== 'general' ? (
          <PlatformIcon
            platform={platformInfo.key}
            className="h-5 w-5 flex-shrink-0 mt-0.5"
          />
        ) : (
          <FileVideo
            className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0"
            aria-hidden
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground/70 font-mono truncate">
            {entry.url}
          </div>
          {entry.filename && (
            <div className="text-sm font-medium truncate flex items-center gap-2">
              <span>{entry.filename}</span>
              {entry.engine && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {entry.engine}
                </span>
              )}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={entry.dir ? `在 Finder 中打开: ${entry.dir}` : '在 Finder 中打开'}
                onClick={() => void api.inboxReveal(entry.filename)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {entry.dir && entry.filename && (
            <div className="text-[11px] text-muted-foreground/60 font-mono truncate">
              {entry.dir}
            </div>
          )}
          {entry.error && (
            <div className="text-xs text-destructive mt-1">{entry.error}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {badge}
          {status === 'downloaded' && (
            <Button
              size="sm"
              variant="outline"
              onClick={onTranscribe}
              data-testid="inbox-transcribe"
            >
              <Mic className="h-3 w-3 mr-1" />
              转写
            </Button>
          )}
          {status === 'transcribed' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onCopyTranscript}
                data-testid="inbox-copy"
              >
                <Copy className="h-3 w-3 mr-1" />
                复制
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onTranscribe}
              >
                <Mic className="h-3 w-3 mr-1" />
                再转写
              </Button>
            </>
          )}
          {status === 'transcribing' && (
            <Button size="sm" variant="ghost" disabled>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              转写中
            </Button>
          )}
          {status === 'failed' && !entry.filename && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              // No `disabled` prop: handleRetry's status flip to
              // 'downloading' unmounts this button before any
              // `inflight` set-state could matter (and parallel
              // retries across rows are already unlocked since
              // each one tracks its own inflight entry id). See
              // InboxRowProps for the full reasoning.
              data-testid="inbox-download-retry"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              重试
            </Button>
          )}
          {status === 'failed' && entry.filename && (
            <Button
              size="sm"
              variant="outline"
              onClick={onTranscribe}
              data-testid="inbox-transcribe-retry"
            >
              <Mic className="h-3 w-3 mr-1" />
              再试转写
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label="移除"
            data-testid="inbox-remove"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {entry.transcript !== undefined && (
        <div className="border-t pt-2 mt-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1">
            文案 · 实时
          </div>
          <pre
            className="text-xs leading-relaxed whitespace-pre-wrap font-mono max-h-64 overflow-auto bg-muted/40 rounded-md p-2"
            data-testid="inbox-transcript"
          >
            {entry.transcript ||
              (status === 'transcribing' ? '正在转写…' : '(空)')}
          </pre>
        </div>
      )}
    </div>
  )
}
