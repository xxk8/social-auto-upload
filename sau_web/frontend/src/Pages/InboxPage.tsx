import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/Components/ui/button'
import { Card, CardContent } from '@/Components/ui/card'
import { Input } from '@/Components/ui/input'
import { Badge } from '@/Components/ui/badge'
import { BrandGlyph } from '@/Components/ui/brand-glyph'
import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
import { PlatformChipStrip, type PlatformKey } from '@/Components/ui/platform-chip-strip'
import { PLATFORMS } from '@/Components/ui/platform-chip-strip.constants'
import { useToast } from '@/Components/ui/toast.helpers'
import {
  AlertCircle,
  Check,
  CheckSquare,
  ChevronDown,
  Clipboard,
  Copy,
  Download as DownloadIcon,
  FileText,
  FolderOpen,
  GripVertical,
  Inbox,
  Loader2,
  Mic,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  XCircle,
  X,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '@/lib/utils'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { arrayMove } from '@dnd-kit/helpers'
import { useInboxStore, getInboxStore, type InboxEntry, type InboxStatus, type StatusFilter } from '@/stores/inboxStore'


import { ROUTES } from '@/routes'
// Ponytail: status is a flat union — the four-state visual progression
// (download → transcribe) maps 1:1 onto the four client-visible Badge
// variants. A `waiting` state isn't needed because the only async step
// is gated by `busy` (URL input) for downloads and the per-row
// `transcribing`-badge for streaming transcription.

const newEntryId = () =>
  `entry_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

function isCookieStalenessError(error: string | undefined): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return (
    (lower.includes('cookies are') && lower.includes('h old') && lower.includes('anti-bot')) ||
    lower.includes('fresh cookies (not necessarily logged in) are needed')
  )
}

// `PlatformKey` / `PLATFORMS` are imported from
// `@/Components/ui/platform-chip-strip` so the chip strip stays the
// single source of truth for the supported-platform roster.
// The auto-detect strip below uses `PLATFORMS.find(...)` for the
// chip label + engine tag; the chip strip itself takes
// `activeKey={detectedPlatform}` directly.

// Module-level manifest pattern (AppShell / STATUS_META exemplar):
// `labelKey + labelFallback` keeps the manifest React-free so a
// future i18n audit can grep for hardcoded strings without
// importing the component. The `t(key, fallback)` call at render
// time is what surfaces the translated label, with the fallback
// keeping `tsc -b` clean even if the i18n bundle hasn't loaded.
const FILTER_OPTIONS: ReadonlyArray<{
  key: StatusFilter
  labelKey: string
  labelFallback: string
}> = [
  { key: 'all', labelKey: 'inbox.filters.all', labelFallback: '全部' },
  { key: 'downloading', labelKey: 'inbox.filters.downloading', labelFallback: '下载中' },
  { key: 'downloaded', labelKey: 'inbox.filters.downloaded', labelFallback: '已下载' },
  { key: 'failed', labelKey: 'inbox.filters.failed', labelFallback: '失败' },
  { key: 'transcribing', labelKey: 'inbox.filters.transcribing', labelFallback: '转写中' },
  { key: 'transcribed', labelKey: 'inbox.filters.transcribed', labelFallback: '已转写' },
]

// Status group display order (in-progress → attention → completed)
const STATUS_ORDER: InboxStatus[] = [
  'downloading',
  'transcribing',
  'failed',
  'downloaded',
  'transcribed',
]

const STATUS_LABEL_META: Record<
  InboxStatus,
  { labelKey: string; labelFallback: string }
> = {
  downloading: { labelKey: 'inbox.row.badge.downloading', labelFallback: '下载中' },
  downloaded: { labelKey: 'inbox.row.badge.downloaded', labelFallback: '已下载' },
  failed: { labelKey: 'inbox.row.badge.failed', labelFallback: '失败' },
  transcribing: { labelKey: 'inbox.row.badge.transcribing', labelFallback: '转写中' },
  transcribed: { labelKey: 'inbox.row.badge.transcribed', labelFallback: '已转写' },
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

// BrandGlyph sourced from `@/Components/ui/brand-glyph` (single source
// of truth). The previous inlined copy was the 5th duplicate of the
// canonical `>_` glyph across Pages/ — landed here so the visitor
// surfaces (`LandingPage` / `PricingPage` / `AboutPage` / `LoginPage` /
// `LoginAuthPage`) and the dashboard all share one definition. The
// URL auto-detect strip is **locked** (NOT URL/platform-customizable):
// it cannot be swapped against a per-platform logo (`<PlatformIcon
// platform={…}>`, 🌐 emoji fallback, etc.) — the canonical website
// mark is the only glyph rendered here.

export default function InboxPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [detectedPlatform, setDetectedPlatform] = useState<PlatformKey | null>(null)

  const handleCookieReauthorize = useCallback(() => {
    navigate(ROUTES.public.landing)
    addToast('请在账号管理页面重新授权对应的平台', 'info')
  }, [navigate, addToast])

  // ── Store-backed state ──────────────────────────────────────────────
  //
  // All download/selection/filter state lives in the Zustand
  // `inboxStore` (module-level singleton), NOT in useState. This is
  // the fix for the "download lost on page switch" bug: when the user
  // navigates away from /dashboard/inbox, React Router unmounts this
  // component. If state lived in useState, the in-flight
  // `api.inboxDownload()` promises' `.then()` / `.catch()` / `.finally()`
  // callbacks would call dead state setters (no-ops) → the download
  // result is silently lost + the inflight chip is stuck.
  //
  // With the store, async callbacks use `getInboxStore()` (store.getState())
  // to call actions that work regardless of mount status. When the user
  // navigates back, the component re-mounts, reads the store, and the
  // in-flight entries are still there.
  const entries = useInboxStore((s) => s.entries)
  const inflightEntryIds = useInboxStore((s) => s.inflightEntryIds)
  const batchBusy = useInboxStore((s) => s.batchBusy)
  const selectedIds = useInboxStore((s) => s.selectedIds)
  const filterStatus = useInboxStore((s) => s.filterStatus)
  const collapsedGroups = useInboxStore((s) => s.collapsedGroups)
  const searchQuery = useInboxStore((s) => s.searchQuery)

  // Store actions (stable references — safe in useCallback deps)
  const {
    addEntry,
    updateEntry,
    removeEntry,
    clearAll: storeClearAll,
    markInflight,
    setBatchBusy,
    toggleSelect,
    selectAll: storeSelectAll,
    clearSelection,
    setFilterStatus: storeSetFilterStatus,
    toggleCollapse,
    setCollapsedGroups,
    setSearchQuery,
  } = useInboxStore()

  const inFlightCount = inflightEntryIds.size

  const filteredEntries = useMemo(() => {
    const byStatus = filterStatus === 'all'
      ? entries
      : entries.filter((e) => e.status === filterStatus)
    if (!searchQuery.trim()) return byStatus
    const q = searchQuery.toLowerCase()
    return byStatus.filter(
      (e) =>
        e.url.toLowerCase().includes(q) ||
        (e.filename?.toLowerCase().includes(q)) ||
        (e.engine?.toLowerCase().includes(q)),
    )
  }, [entries, filterStatus, searchQuery])

  // Group entries by status for the "全部" view (respects search)
  const groupedEntries = useMemo(() => {
    const base = searchQuery.trim()
      ? entries.filter(
          (e) =>
            e.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (e.filename?.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (e.engine?.toLowerCase().includes(searchQuery.toLowerCase())),
        )
      : entries
    const groups: Record<string, InboxEntry[]> = {}
    for (const status of STATUS_ORDER) {
      groups[status] = base.filter((e) => e.status === status)
    }
    return groups as Record<InboxStatus, InboxEntry[]>
  }, [entries, searchQuery])

  // Collapse/expand state (must live AFTER groupedEntries to avoid TDZ)
  const allCollapsed = useMemo(
    () => STATUS_ORDER.every((s) => groupedEntries[s].length === 0 || collapsedGroups.has(s)),
    [collapsedGroups, groupedEntries],
  )

  const handleToggleCollapse = useCallback((status: InboxStatus) => {
    toggleCollapse(status)
  }, [toggleCollapse])

  const handleToggleAll = useCallback(() => {
    const store = getInboxStore()
    const { collapsedGroups: prev } = store
    // Re-derive groupedEntries locally since the store doesn't hold it
    const localGroups: Record<string, InboxEntry[]> = {}
    for (const s of STATUS_ORDER) {
      localGroups[s] = store.entries.filter((e) => e.status === s)
    }
    if (STATUS_ORDER.every((s) => localGroups[s].length === 0 || prev.has(s))) {
      setCollapsedGroups(new Set())
    } else {
      const next = new Set(prev)
      for (const status of STATUS_ORDER) {
        if (localGroups[status].length > 0) {
          next.add(status)
        }
      }
      setCollapsedGroups(next)
    }
  }, [setCollapsedGroups])

  const detectedInfo = useMemo(
    () => PLATFORMS.find((p) => p.key === detectedPlatform) ?? null,
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
    // Use store actions so the entry survives component unmount.
    // The addEntry + markInflight are synchronous (no await), so they
    // commit to the store immediately even if the component unmounts
    // before the api.inboxDownload promise resolves.
    addEntry({ id, url: target, status: 'downloading', startedAt: Date.now() })
    setUrl('')
    setDetectedPlatform(null)
    markInflight(id)
    try {
      // Round-15 fix: pass `target` (extracted URL when the input was
      // an app-share blob), NOT `trimmed` (the original blob). The
      // entry field above already uses `target` so the URL display is
      // consistent end-to-end. Sending `trimmed` to the backend would
      // 400 the request via the backend's startswith('http(s)://')
      // gate, defeating the whole point of front-end extraction.
      const res = await api.inboxDownload(target)
      // Use getInboxStore() so this callback works even if the
      // component was unmounted during the await (user navigated to
      // another page). The store action updates the entry regardless
      // of mount status; when the user returns to /dashboard/inbox, the
      // entry is already updated.
      const store = getInboxStore()
      if (res.success && res.filename) {
        store.updateEntry(id, {
          status: 'downloaded',
          filename: res.filename,
          dir: res.dir,
          engine: res.engine,
        })
        addToast(`已下载 ${res.filename}${res.dir ? `\n${res.dir}` : ''}\n下一步：点击「转写」提取文案`, 'success')
      } else {
        store.updateEntry(id, { status: 'failed', error: res.message ?? '下载失败' })
        addToast(res.message ?? '下载失败', 'error')
      }
    } catch (err) {
      getInboxStore().updateEntry(id, {
        status: 'failed',
        error: err instanceof Error ? err.message : '请求失败',
      })
      addToast('请求失败，请检查后端连接', 'error')
    } finally {
      getInboxStore().clearInflight(id)
    }
  }, [url, addToast, addEntry, markInflight])

  const handleTranscribe = useCallback(
    async (id: string) => {
      // Read from the store (not the hook closure) so this works
      // even if called after a re-mount where the closure's `entries`
      // is stale.
      const target = getInboxStore().entries.find((e) => e.id === id)
      if (!target?.filename) return
      updateEntry(id, { status: 'transcribing', transcript: undefined, error: undefined })
      try {
        await api.inboxTranscribeStream(
          { filename: target.filename },
          (chunk) => getInboxStore().appendTranscript(id, chunk),
          () => getInboxStore().updateEntry(id, { status: 'transcribed' }),
          (msg) => {
            getInboxStore().updateEntry(id, { status: 'failed', error: msg })
            addToast(`转写失败：${msg}`, 'error')
          },
        )
      } catch (err) {
        getInboxStore().updateEntry(id, {
          status: 'failed',
          error: err instanceof Error ? err.message : '请求失败',
        })
        addToast('转写请求失败', 'error')
      }
    },
    [updateEntry, addToast],
  )

  const handleCopyTranscript = useCallback(
    async (id: string) => {
      const target = getInboxStore().entries.find((e) => e.id === id)
      if (!target?.transcript) return
      try {
        await navigator.clipboard.writeText(target.transcript)
        addToast('文案已复制', 'success')
      } catch {
        addToast('复制失败，请手动复制', 'error')
      }
    },
    [addToast],
  )

  const handleRemove = useCallback((id: string) => {
    // removeEntry handles entries + selectedIds + inflightEntryIds
    // in a single store commit. UI-only cancellation — backend
    // downloads continue per the inbox 24h auto-cleanup policy.
    removeEntry(id)
  }, [removeEntry])

  const handleClearAll = useCallback(() => {
    const store = getInboxStore()
    if (store.entries.length === 0) return
    // Issue 1 fix part 3: clear ALL in-flight ids in one atomic
    // update so the chip disappears in a single React commit.
    // UI-only cancellation — backend downloads continue per the
    // inbox 24h auto-cleanup policy.
    storeClearAll()
    addToast('已清除全部记录', 'info')
  }, [storeClearAll, addToast])

  const handleSelectAll = useCallback(() => {
    const store = getInboxStore()
    if (store.selectedIds.size === store.entries.length) {
      clearSelection()
    } else {
      storeSelectAll()
    }
  }, [storeSelectAll, clearSelection])

  const handleBatchRemove = useCallback(() => {
    const store = getInboxStore()
    if (store.selectedIds.size === 0) return
    // Issue 1 fix part 2: per-id clearInflight for each selected
    // entry BEFORE the entries update commits. UI-only
    // cancellation: backend downloads continue per inbox 24h
    // auto-cleanup policy.
    for (const id of store.selectedIds) {
      store.clearInflight(id)
    }
    store.setEntries(store.entries.filter((e) => !store.selectedIds.has(e.id)))
    addToast(`已移除 ${store.selectedIds.size} 条记录`, 'info')
    store.clearSelection()
  }, [addToast])

  const handleGroupDragEnd = useCallback(
    (status: InboxStatus) =>
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

        const store = getInboxStore()
        const prev = store.entries
        // Find indices in the full entries array
        const sourceIndex = prev.findIndex((e) => e.id === sourceId)
        const targetIndex = prev.findIndex((e) => e.id === targetId)
        if (sourceIndex === -1 || targetIndex === -1) return

        // Both entries must belong to the target status group
        if (prev[sourceIndex].status !== status) return
        if (prev[targetIndex].status !== status) return

        store.setEntries(arrayMove(prev, sourceIndex, targetIndex))
      },
    [],
  )

  const handleBatchRetry = useCallback(async () => {
    const store = getInboxStore()
    // Filter on (status === 'failed' && !inflight). The latter is
    // critical: if a previous batch loop is still draining and the
    // user clicks 重试选中 again on a re-selected entry, we MUST
    // skip it — otherwise two parallel `await api.inboxDownload`
    // calls race on the same entry id.
    const toRetry = store.entries.filter(
      (e) =>
        store.selectedIds.has(e.id) &&
        e.status === 'failed' &&
        e.url &&
        !store.inflightEntryIds.has(e.id),
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
        // !inflightEntryIds.has() check above.
        getInboxStore().updateEntry(entry.id, { status: 'downloading' as InboxStatus, error: undefined, startedAt: Date.now() })
        getInboxStore().markInflight(entry.id)
        try {
          const res = await api.inboxDownload(entry.url)
          const s = getInboxStore()
          if (res.success && res.filename) {
            s.updateEntry(entry.id, { status: 'downloaded' as InboxStatus, filename: res.filename, engine: res.engine })
          } else {
            s.updateEntry(entry.id, { status: 'failed' as InboxStatus, error: res.message ?? '下载失败' })
          }
          if (res.success) successCount++
        } catch {
          getInboxStore().updateEntry(entry.id, { status: 'failed' as InboxStatus, error: '重试请求失败' })
        } finally {
          // Per-entry clear so the in-flight header chip decrements
          // live as the loop drains.
          getInboxStore().clearInflight(entry.id)
        }
      }
      addToast(`重试完成：${successCount}/${toRetry.length} 成功`, successCount === toRetry.length ? 'success' : 'info')
      getInboxStore().clearSelection()
    } finally {
      // Defensive: even if a future refactor throws between
      // setBatchBusy(true) and the for-loop end, the batch flag
      // must NOT stay stuck.
      setBatchBusy(false)
    }
  }, [addToast, setBatchBusy])

  const handleBatchTranscribe = useCallback(async () => {
    const store = getInboxStore()
    const toTranscribe = store.entries.filter(
      (e) =>
        store.selectedIds.has(e.id) &&
        e.status === 'downloaded' &&
        e.filename,
    )
    if (toTranscribe.length === 0) {
      addToast('选中的条目中没有已下载的视频', 'warning')
      return
    }
    setBatchBusy(true)
    let successCount = 0
    try {
      for (const entry of toTranscribe) {
        getInboxStore().updateEntry(entry.id, { status: 'transcribing' as InboxStatus, transcript: undefined, error: undefined })
        try {
          await api.inboxTranscribeStream(
            { filename: entry.filename! },
            (chunk) => getInboxStore().appendTranscript(entry.id, chunk),
            () => {
              getInboxStore().updateEntry(entry.id, { status: 'transcribed' as InboxStatus })
              successCount++
            },
            (msg) => {
              getInboxStore().updateEntry(entry.id, { status: 'failed' as InboxStatus, error: msg })
            },
          )
        } catch {
          getInboxStore().updateEntry(entry.id, { status: 'failed' as InboxStatus, error: '转写请求失败' })
        }
      }
      addToast(`转写完成：${successCount}/${toTranscribe.length} 成功`, successCount === toTranscribe.length ? 'success' : 'info')
      getInboxStore().clearSelection()
    } finally {
      setBatchBusy(false)
    }
  }, [addToast, setBatchBusy])

  const handleExportTranscript = useCallback(
    (id: string) => {
      const target = getInboxStore().entries.find((e) => e.id === id)
      if (!target?.transcript) return
      const blob = new Blob([target.transcript], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${target.filename?.replace(/\.[^.]+$/, '') ?? 'transcript'}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      addToast('文案已导出', 'success')
    },
    [addToast],
  )

  const handleRetry = useCallback(
    async (id: string) => {
      const target = getInboxStore().entries.find((e) => e.id === id)
      if (!target?.url) return
      getInboxStore().updateEntry(id, { status: 'downloading' as InboxStatus, error: undefined, startedAt: Date.now() })
      // Per-entry in-flight tracking. ONLY this row's 重试 button is
      // disabled while this retry runs (via the InboxRow `inflight`
      // prop, which the parent computes from inflightEntryIds.has()).
      getInboxStore().markInflight(id)
      try {
        const res = await api.inboxDownload(target.url)
        const s = getInboxStore()
        if (res.success && res.filename) {
          s.updateEntry(id, {
            status: 'downloaded' as InboxStatus,
            filename: res.filename,
            dir: res.dir,
            engine: res.engine,
          })
          addToast(`已下载 ${res.filename}`, 'success')
        } else {
          s.updateEntry(id, { status: 'failed' as InboxStatus, error: res.message ?? '下载失败' })
          addToast(res.message ?? '下载失败', 'error')
        }
      } catch (err) {
        getInboxStore().updateEntry(id, {
          status: 'failed' as InboxStatus,
          error: err instanceof Error ? err.message : '请求失败',
        })
        addToast('重试失败', 'error')
      } finally {
        getInboxStore().clearInflight(id)
      }
    },
    [addToast],
  )

  return (
    <PageWrapper>
      <PageHeader
        title="下载中心"
        description="从分享链接下载到本地，再转写音视频文案"
        icon={<BrandGlyph className="h-5 w-5 text-[14px]" />}
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
            <div
              data-testid="inbox-detected"
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/60 border border-border/50 animate-in fade-in slide-in-from-top-1 duration-150"
            >
              <BrandGlyph className="h-4 w-4" />
              <span className="text-sm font-medium text-foreground">{detectedInfo.name}</span>
              <span className="text-xs text-muted-foreground/80 font-mono tabular-nums">{detectedInfo.engine}</span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            yt-dlp 优先；不支持回落 patchright 浏览器抓取。拒绝私有/回环
            IP（含 DNS 解析层）。数据归属您，24h 后自动清理。
          </p>

          <PlatformChipStrip activeKey={detectedPlatform} />
        </CardContent>
      </Card>

      <Card className="card-refined">
        <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
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
                  {allCollapsed ? t('inbox.batch.expand_all', '全部展开') : t('inbox.batch.collapse_all', '全部收起')}
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

          {/* Search + Status filter bar */}
          {entries.length > 0 && (
            <>
              <div className="relative mb-3" data-testid="inbox-search">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <Input
                  placeholder="搜索 URL / 文件名 / 引擎..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 pr-8 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 mb-3 flex-wrap" data-testid="inbox-filter-bar">
              {FILTER_OPTIONS.map((opt) => {
                const count = opt.key === 'all'
                  ? entries.length
                  : entries.filter((e) => e.status === opt.key).length
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => storeSetFilterStatus(opt.key)}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-all duration-150 ${
                      filterStatus === opt.key
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/30 font-medium'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {t(opt.labelKey, opt.labelFallback)}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                )
              })}
              </div>
            </>
          )}
          {entries.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center rounded-lg bg-muted/40 border border-dashed animate-in fade-in-0 slide-in-from-top-2 duration-300">
              <div className="text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50 animate-pulse" />
                <p className="text-sm font-medium text-foreground/70 mb-4">暂无下载记录，粘贴分享链接开始下载</p>
                <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
                  <kbd className="px-2 py-1 rounded bg-muted/60 border border-border/40 font-mono">1. 粘贴 URL</kbd>
                  <span className="text-muted-foreground/40">→</span>
                  <kbd className="px-2 py-1 rounded bg-muted/60 border border-border/40 font-mono">2. 下载</kbd>
                  <span className="text-muted-foreground/40">→</span>
                  <kbd className="px-2 py-1 rounded bg-muted/60 border border-border/40 font-mono">3. 转写文案</kbd>
                </div>
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
                    {selectedIds.size === entries.length
                      ? t('inbox.batch.unselect_all', '取消全选')
                      : t('inbox.batch.select_all', '全选')}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t('inbox.batch.selected_count', '已选 {{count}} 项', { count: selectedIds.size })}
                  </span>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchRemove}
                    className="text-xs"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    {t('inbox.batch.remove_selected', '清除选中')}
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
                    {t('inbox.batch.retry_selected', '重试选中')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleBatchTranscribe()}
                    disabled={
                      batchBusy ||
                      !entries.some(
                        (e) => selectedIds.has(e.id) && e.status === 'downloaded',
                      )
                    }
                    className="text-xs"
                  >
                    <Mic className="h-3 w-3 mr-1" />
                    {t('inbox.batch.transcribe_selected', '转写选中')}
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
                            {t(STATUS_LABEL_META[status].labelKey, STATUS_LABEL_META[status].labelFallback)}
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
                                onToggleSelect={() => toggleSelect(entry.id)}
                                onTranscribe={() => void handleTranscribe(entry.id)}
                                onCopyTranscript={() => void handleCopyTranscript(entry.id)}
                                onExportTranscript={() => handleExportTranscript(entry.id)}
                                onRetry={() => void handleRetry(entry.id)}
                                onRemove={() => handleRemove(entry.id)}
                                onCookieReauthorize={handleCookieReauthorize}
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
                    <p>{t('inbox.filter_empty.title', '暂无匹配记录')}</p>
                    <button
                      type="button"
                      onClick={() => storeSetFilterStatus('all')}
                      className="mt-2 text-xs underline underline-offset-4 hover:text-foreground transition-colors"
                    >
                      {t('inbox.filter_empty.clear', '清除筛选')}
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
                        onToggleSelect={() => toggleSelect(e.id)}
                        onTranscribe={() => void handleTranscribe(e.id)}
                        onCopyTranscript={() => void handleCopyTranscript(e.id)}
                        onExportTranscript={() => handleExportTranscript(e.id)}
                        onRetry={() => void handleRetry(e.id)}
                        onRemove={() => handleRemove(e.id)}
                        onCookieReauthorize={handleCookieReauthorize}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageWrapper>
  )
}

// ── VideoThumbnail ────────────────────────────────────────────────────────
// Renders a small thumbnail from the first frame of a downloaded video file.
// Falls back to a film icon when the video can't be loaded.

function VideoThumbnail({ filename }: { filename: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!filename) return
    const baseURL =
      (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
      (import.meta.env.DEV ? '' : 'http://localhost:6001')
    const videoEl = document.createElement('video')
    videoEl.preload = 'metadata'
    videoEl.muted = true
    videoEl.playsInline = true
    videoEl.src = `${baseURL}/api/inbox/file/${encodeURIComponent(filename)}`
    videoEl.currentTime = 0.5
    const onLoaded = () => {
      try {
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = videoEl.videoWidth || 160
        canvas.height = videoEl.videoHeight || 90
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
          setSrc(canvas.toDataURL('image/jpeg', 0.5))
        }
      } catch {
        // CORS or security error — fall back to icon
      }
    }
    videoEl.addEventListener('loadeddata', onLoaded)
    return () => {
      videoEl.removeEventListener('loadeddata', onLoaded)
      videoEl.src = ''
    }
  }, [filename])

  if (!src) {
    return (
      <div className="h-12 w-16 rounded bg-muted/60 border border-border/30 flex items-center justify-center flex-shrink-0">
        <DownloadIcon className="h-4 w-4 text-muted-foreground/30" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt="视频缩略图"
      className="h-12 w-16 rounded object-cover border border-border/30 flex-shrink-0"
    />
  )
}

// ── ElapsedTimer ──────────────────────────────────────────────────────────
// Shows elapsed time since download started. Auto-updates every second.

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000))
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const min = Math.floor(elapsed / 60)
  const sec = elapsed % 60
  return (
    <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
      {min > 0 ? `${min}m${String(sec).padStart(2, '0')}s` : `${sec}s`}
    </span>
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
  onExportTranscript: () => void
  onRetry: () => void
  onRemove: () => void
  onCookieReauthorize?: () => void
}

function SortableGroupEntry({
  entry,
  index,
  selected,
  onToggleSelect,
  onTranscribe,
  onCopyTranscript,
  onExportTranscript,
  onRetry,
  onRemove,
  onCookieReauthorize,
}: Omit<SortableGroupEntryProps, 'enableDrag' | 'dragHandleRef'>) {
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
          onExportTranscript={onExportTranscript}
          onRetry={onRetry}
          onRemove={onRemove}
          onCookieReauthorize={onCookieReauthorize}
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
  onExportTranscript: () => void
  onRetry: () => void
  onRemove: () => void
  onCookieReauthorize?: () => void
}

function InboxRow({
  entry,
  selected,
  enableDrag,
  dragHandleRef,
  onToggleSelect,
  onTranscribe,
  onCopyTranscript,
  onExportTranscript,
  onRetry,
  onRemove,
  onCookieReauthorize,
}: InboxRowProps) {
  const { status } = entry
  const { t } = useTranslation()

  const badge = (() => {
    switch (status) {
      case 'downloading':
        return (
          <Badge variant="secondary">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            {t('inbox.row.badge.downloading', '下载中')}
          </Badge>
        )
      case 'downloaded':
        return (
          <Badge>
            <Check className="h-3 w-3 mr-1" />
            {t('inbox.row.badge.downloaded', '已下载')}
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            {t('inbox.row.badge.failed', '失败')}
          </Badge>
        )
      case 'transcribing':
        return (
          <Badge variant="secondary">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            {t('inbox.row.badge.transcribing', '转写中')}
          </Badge>
        )
      case 'transcribed':
        return (
          <Badge>
            <Sparkles className="h-3 w-3 mr-1" />
            {t('inbox.row.badge.transcribed', '已转写')}
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
          aria-label={selected ? t('inbox.row.unselect_aria', '取消选择') : t('inbox.row.select_aria', '选择')}
        >
          {selected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
        {/* Single canonical BrandGlyph across all rows — locked,
         *  identical to the chip strip + PageHeader + auto-detect
         *  strip on the same page. Per-platform identity is already
         *  carried by the URL caption (mono font) + the engine tag
         *  (browser(patchright), yt-dlp, etc.) directly below, so
         *  dropping the per-row platform logo removes duplicate
         *  emphasis + the rainbow-of-platform-colors reading. */}
        <BrandGlyph className="h-5 w-5 flex-shrink-0 mt-0.5 text-[14px]" />
        {entry.filename && entry.status !== 'downloading' && (
          <VideoThumbnail filename={entry.filename} />
        )}
        {entry.status === 'downloading' && (
          <div className="h-12 w-16 rounded bg-muted/60 border border-border/30 flex items-center justify-center flex-shrink-0">
            <Loader2 className="h-4 w-4 text-muted-foreground/40 animate-spin" />
          </div>
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
          {(() => {
            const cookieExpired = isCookieStalenessError(entry.error)
            if (!entry.error) return null
            return (
              <div className="mt-1 space-y-1.5">
                {cookieExpired && onCookieReauthorize && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-warning">{t('inbox.row.cookie_expired.title', '平台授权已过期，请重新登录')}</p>
                      <p className="mt-0.5 text-[11px] text-warning/70">
                        {t('inbox.row.cookie_expired.description', 'Cookie 过期可能导致下载失败，回到账号管理页重新授权即可恢复。')}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1.5 h-7 text-[11px] border-warning/40 text-warning hover:bg-warning/20"
                        onClick={(e) => {
                          e.stopPropagation()
                          onCookieReauthorize()
                        }}
                      >
                        {t('inbox.row.cookie_expired.cta', '去账号管理重新授权')}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="text-xs text-destructive">{entry.error}</div>
              </div>
            )
          })()}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {badge}
          {status === 'downloading' && entry.startedAt && (
            <ElapsedTimer startedAt={entry.startedAt} />
          )}
          {status === 'downloaded' && (
            <Button
              size="sm"
              variant="outline"
              onClick={onTranscribe}
              data-testid="inbox-transcribe"
            >
              <Mic className="h-3 w-3 mr-1" />
              {t('inbox.row.transcribe', '转写')}
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
                {t('inbox.row.copy', '复制')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onExportTranscript}
                data-testid="inbox-export"
              >
                <FileText className="h-3 w-3 mr-1" />
                {t('inbox.row.export', '导出')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onTranscribe}
              >
                <Mic className="h-3 w-3 mr-1" />
                {t('inbox.row.retranscribe', '再转写')}
              </Button>
            </>
          )}
          {status === 'transcribing' && (
            <Button size="sm" variant="ghost" disabled>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              {t('inbox.row.transcribing', '转写中')}
            </Button>
          )}
          {status === 'failed' && !entry.filename && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              data-testid="inbox-download-retry"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t('inbox.row.retry', '重试')}
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
              {t('inbox.row.retry_transcribe', '再试转写')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={t('inbox.row.remove_aria', '移除')}
            data-testid="inbox-remove"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {entry.transcript !== undefined && (
        <div className="border-t pt-2 mt-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1">
            {t('inbox.row.transcript_label', '文案 · 实时')}
          </div>
          <pre
            className="text-xs leading-relaxed whitespace-pre-wrap font-mono max-h-64 overflow-auto bg-muted/40 rounded-md p-2"
            data-testid="inbox-transcript"
          >
            {entry.transcript ||
              (status === 'transcribing'
                ? t('inbox.row.transcript_streaming', '正在转写…')
                : t('inbox.row.transcript_empty', '(空)'))}
          </pre>
        </div>
      )}
    </div>
  )
}
