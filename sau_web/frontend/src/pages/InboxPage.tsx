import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
import { PlatformChipStrip, type PlatformKey } from '@/components/ui/platform-chip-strip'
import { PLATFORMS } from '@/components/ui/platform-chip-strip.constants'
import { PlatformIcon } from '@/components/ui/platform-icon'
import { useToast } from '@/components/ui/toast.helpers'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  AlertCircle,
  Captions,
  Check,
  CheckSquare,
  ChevronDown,
  Clipboard,
  Copy,
  Download as DownloadIcon,
  ExternalLink,
  FileText,
  FolderOpen,
  GripVertical,
  Inbox,
  Link2,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Subtitles,
  Trash2,
  XCircle,
  X,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api/client'
import { cn } from '@/lib/utils'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { arrayMove } from '@dnd-kit/helpers'
import {
  useInboxStore,
  getInboxStore,
  type InboxEntry,
  type InboxStatus,
  type SubtitleMode,
} from '@/stores/inboxStore'
import { beginInboxJob, endInboxJob, cancelInboxJob } from '@/stores/inboxJobRegistry'
import {
  loadInboxPrefs,
  saveInboxPrefs,
  type InboxDensityPref,
} from '@/stores/inboxPrefs'
import { InboxJobQueue } from '@/components/InboxJobQueue'
import { ROUTES } from '@/routes'
// Ponytail: status is a flat union — the four-state visual progression
// (download → transcribe) maps 1:1 onto the four client-visible Badge
// variants. A `waiting` state isn't needed because the only async step
// is gated by `busy` (URL input) for downloads and the per-row
// `transcribing`-badge for streaming transcription.

import {
  newEntryId,
  isCookieStalenessError,
  isAuthRequiredError,
  authRequiredPlatform,
  friendlyErrorMessage,
  isStreamedTranscribeFailure,
  extractFirstUrl,
  detectPlatform,
  formatBytes,
  FILTER_OPTIONS,
  STATUS_ORDER,
  STATUS_LABEL_META,
  SUBTITLE_MODE_OPTIONS,
} from '@/lib/inbox-helpers'

export default function InboxPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [detectedPlatform, setDetectedPlatform] = useState<PlatformKey | null>(null)
  const [prefs, setPrefs] = useState(() => loadInboxPrefs())
  const [subtitleTarget, setSubtitleTarget] = useState<InboxEntry | null>(null)
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>(() => loadInboxPrefs().subtitleMode)
  /** none = SRT only; hard/soft/auto write a new video file */
  const [subtitleWrite, setSubtitleWrite] = useState<'hard' | 'soft' | 'auto' | 'none'>(
    () => loadInboxPrefs().subtitleWrite,
  )
  const [subtitleQuality, setSubtitleQuality] = useState<'original' | '1080' | '720'>(
    () => loadInboxPrefs().subtitleQuality,
  )
  const [preview, setPreview] = useState<{ filename: string; title: string } | null>(null)
  const density = prefs.density
  const isCompact = density === 'compact'
  const [deleteConfirm, setDeleteConfirm] = useState<
    null | { kind: 'one'; id: string } | { kind: 'batch' } | { kind: 'all' }
  >(null)
  const [editSrt, setEditSrt] = useState<InboxEntry | null>(null)
  const [editSrtText, setEditSrtText] = useState('')
  const [editSrtBusy, setEditSrtBusy] = useState(false)
  const [storage, setStorage] = useState<{
    total_bytes: number
    inbox: { bytes: number; count: number }
  } | null>(null)
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const handleCookieReauthorize = useCallback(() => {
    navigate({ to: ROUTES.public.landing as never })
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
    mergeDiskFiles,
  } = useInboxStore()

  // ── Disk history sync ───────────────────────────────────────────────
  const [diskSyncing, setDiskSyncing] = useState(false)
  const refreshStorage = useCallback(() => {
    void api.inboxStorage().then((res) => {
      if (res.success && res.data) {
        setStorage({
          total_bytes: res.data.total_bytes,
          inbox: res.data.inbox,
        })
      }
    }).catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    let cancelled = false
    setDiskSyncing(true)
    void api
      .inboxList()
      .then((res: { success?: boolean; data?: Array<{ filename: string; size?: number; mtime?: string }> }) => {
        if (cancelled) return
        const files = res?.data ?? []
        if (Array.isArray(files) && files.length > 0) {
          mergeDiskFiles(files)
        }
      })
      .catch(() => { /* offline */ })
      .finally(() => {
        if (!cancelled) setDiskSyncing(false)
      })
    refreshStorage()
    return () => {
      cancelled = true
    }
  }, [mergeDiskFiles, refreshStorage])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // Keyboard shortcuts when not typing in an input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          e.preventDefault()
          setDeleteConfirm({ kind: 'batch' })
        }
      }
      if (e.key === 's' || e.key === 'S') {
        const first = entries.find(
          (x) => selectedIds.has(x.id) && x.filename && x.status !== 'downloading',
        )
        if (first) {
          e.preventDefault()
          setSubtitleMode('bilingual')
          setSubtitleWrite('hard')
          setSubtitleTarget(first)
        }
      }
      if (e.key === 'p' || e.key === 'P') {
        const first = entries.find((x) => selectedIds.has(x.id) && x.filename)
        if (first?.filename) {
          e.preventDefault()
          setPreview({
            filename: first.filename,
            title: first.filename,
          })
        }
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const root = document.querySelector('[data-testid="inbox-search"]')
        const input =
          root?.querySelector?.('input') ??
          document.querySelector<HTMLInputElement>('[data-testid="inbox-search"] input')
        input?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedIds, entries])

  // Edit SRT event from row buttons
  useEffect(() => {
    const onEdit = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (!id) return
      const entry = getInboxStore().entries.find((x) => x.id === id)
      if (!entry) return
      setEditSrt(entry)
      setEditSrtText(entry.subtitleSrtText || '')
      // If text not in store, fetch from srt_url
      if (!entry.subtitleSrtText && entry.subtitleSrtUrl) {
        void fetch(entry.subtitleSrtUrl, { credentials: 'include' })
          .then((r) => r.text())
          .then((txt) => setEditSrtText(txt))
          .catch(() => { /* keep empty */ })
      }
    }
    window.addEventListener('inbox-edit-srt', onEdit)
    return () => window.removeEventListener('inbox-edit-srt', onEdit)
  }, [])

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
        (e.filename?.toLowerCase().includes(q) ?? false),
    )
  }, [entries, filterStatus, searchQuery])

  // Group entries by status for the "全部" view (respects search)
  const groupedEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const base = q
      ? entries.filter(
          (e) =>
            e.url.toLowerCase().includes(q) ||
            (e.filename?.toLowerCase().includes(q) ?? false),
        )
      : entries
    const groups: Record<string, InboxEntry[]> = {}
    for (const status of STATUS_ORDER) {
      groups[status] = base.filter((e) => e.status === status)
    }
    return groups as Record<InboxStatus, InboxEntry[]>
  }, [entries, searchQuery])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    for (const s of STATUS_ORDER) {
      counts[s] = entries.filter((e) => e.status === s).length
    }
    return counts
  }, [entries])

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
    const signal = beginInboxJob(id)
    try {
      // Round-15 fix: pass `target` (extracted URL when the input was
      // an app-share blob), NOT `trimmed` (the original blob). The
      // entry field above already uses `target` so the URL display is
      // consistent end-to-end. Sending `trimmed` to the backend would
      // 400 the request via the backend's startswith('http(s)://')
      // gate, defeating the whole point of front-end extraction.
      const res = await api.inboxDownload(target, signal)
      if (signal.aborted) return
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
        addToast(`已下载 ${res.filename} · 可点「添加字幕」或「转写文案」`, 'success')
      } else {
        const msg = friendlyErrorMessage(res.message) ?? '下载失败'
        store.updateEntry(id, { status: 'failed', error: msg })
        // Show a more prominent action toast when auth is required
        if (isAuthRequiredError(res.message, res)) {
          const plat = authRequiredPlatform(res) ?? ''
          const platName = plat === 'youtube' ? 'YouTube' : plat === 'bilibili' ? 'Bilibili' : plat
          addToast(
            `${platName} 需要登录验证。请前往「账号管理」配置 ${platName} 授权后再试。`,
            'warning',
          )
        } else {
          addToast(msg, 'error')
        }
      }
    } catch (err) {
      const aborted =
        signal.aborted ||
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ERR_CANCELED')
      if (aborted) {
        // User cancelled — remove the row entirely (no partial file to keep).
        getInboxStore().removeEntry(id)
        addToast('已取消下载', 'info')
        return
      }
      getInboxStore().updateEntry(id, {
        status: 'failed',
        error: err instanceof Error ? err.message : '请求失败',
      })
      addToast('请求失败，请检查后端连接', 'error')
    } finally {
      endInboxJob(id, signal)
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
          (fullText) => {
            if (isStreamedTranscribeFailure(fullText)) {
              getInboxStore().updateEntry(id, {
                status: 'failed',
                error: fullText.trim(),
                transcript: undefined,
              })
              addToast(fullText.trim().split('\n')[0] || '转写失败', 'error')
              return
            }
            getInboxStore().updateEntry(id, { status: 'transcribed' })
            addToast('转写完成', 'success')
          },
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

  const openSubtitleDialog = useCallback((entry: InboxEntry) => {
    if (!entry.filename) {
      addToast('请先完成下载再添加字幕', 'warning')
      return
    }
    // Restore last-used prefs so daily friction stays low.
    const p = loadInboxPrefs()
    setSubtitleMode(p.subtitleMode)
    setSubtitleWrite(p.subtitleWrite)
    setSubtitleQuality(p.subtitleQuality)
    setSubtitleTarget(entry)
  }, [addToast])

  const persistSubtitlePrefs = useCallback(
    (patch: {
      mode?: SubtitleMode
      write?: 'hard' | 'soft' | 'none'
      quality?: 'original' | '1080' | '720'
    }) => {
      const next = saveInboxPrefs({
        subtitleMode: patch.mode,
        subtitleWrite: patch.write,
        subtitleQuality: patch.quality,
      })
      setPrefs(next)
    },
    [],
  )

  const toggleDensity = useCallback(() => {
    const nextD: InboxDensityPref = density === 'compact' ? 'comfortable' : 'compact'
    const next = saveInboxPrefs({
      density: nextD,
      collapseTranscript: nextD === 'compact',
    })
    setPrefs(next)
  }, [density])

  const runSubtitleJob = useCallback(
    async (
      entry: InboxEntry,
      opts: {
        mode: SubtitleMode
        write: 'hard' | 'soft' | 'auto' | 'none'
        quality: 'original' | '1080' | '720'
      },
    ) => {
      if (!entry.filename) throw new Error('请先完成下载再添加字幕')
      const id = entry.id
      const prevStatus = entry.status
      const signal = beginInboxJob(id)
      updateEntry(id, {
        status: 'subtitling',
        error: undefined,
        subtitleProgress: 0,
        subtitleLabel: '准备中…',
        subtitlePhase: 'start',
      })
      markInflight(id)
      const burn = opts.write !== 'none'
      type DoneData = {
        srt_filename: string
        srt_url: string
        srt_text: string
        burned_filename?: string | null
        burned_url?: string | null
        burn_method?: 'hard' | 'soft' | null
      }
      const holder: { data: DoneData | null } = { data: null }
      try {
        await api.inboxSubtitleStream(
          {
            filename: entry.filename,
            mode: opts.mode,
            burn,
            burn_style: burn ? (opts.write === 'none' ? 'auto' : opts.write) : 'soft',
            quality: opts.quality,
          },
          (ev) => {
            if (signal.aborted) return
            if (ev.type === 'progress') {
              getInboxStore().updateEntry(id, {
                subtitleProgress: ev.pct,
                subtitlePhase: ev.phase,
                subtitleLabel: ev.label,
              })
            } else if (ev.type === 'done') {
              holder.data = ev.data as DoneData
            } else if (ev.type === 'error') {
              throw new Error(ev.message)
            }
          },
          (msg) => {
            throw new Error(msg)
          },
          signal,
        )
        if (signal.aborted) {
          const err = new DOMException('已取消', 'AbortError')
          throw err
        }
        if (!holder.data) throw new Error('字幕任务未返回结果')
        const data = holder.data
        const nextStatus: InboxStatus =
          prevStatus === 'transcribed' || entry.transcript ? 'transcribed' : 'downloaded'
        getInboxStore().updateEntry(id, {
          status: nextStatus,
          subtitleMode: opts.mode,
          subtitleSrtFilename: data.srt_filename,
          subtitleSrtUrl: data.srt_url,
          subtitleSrtText: data.srt_text,
          subtitleBurnedFilename: data.burned_filename ?? undefined,
          subtitleBurnedUrl: data.burned_url ?? undefined,
          subtitleProgress: undefined,
          subtitleLabel: undefined,
          subtitlePhase: undefined,
          error: undefined,
        })
        if (data.burned_filename) {
          const exists = getInboxStore().entries.some((e) => e.filename === data.burned_filename)
          if (!exists) {
            getInboxStore().addEntry({
              id: newEntryId(),
              url: entry.url || '',
              filename: data.burned_filename,
              status: 'downloaded',
              startedAt: Date.now(),
              subtitleMode: opts.mode,
              subtitleSrtFilename: data.srt_filename,
              subtitleSrtUrl: data.srt_url,
            })
          }
        }
        return data
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === 'AbortError') ||
          signal.aborted ||
          (err instanceof Error && /abort|取消/i.test(err.message))
        if (aborted) {
          getInboxStore().updateEntry(id, {
            status: entry.transcript ? 'transcribed' : 'downloaded',
            error: undefined,
            subtitleProgress: undefined,
            subtitleLabel: undefined,
            subtitlePhase: undefined,
          })
          throw new DOMException('已取消', 'AbortError')
        }
        const msg = err instanceof Error ? err.message : '添加字幕失败'
        getInboxStore().updateEntry(id, {
          status: prevStatus === 'subtitling' ? 'downloaded' : prevStatus,
          error: friendlyErrorMessage(msg) ?? msg,
          subtitleProgress: undefined,
          subtitleLabel: undefined,
        })
        throw err
      } finally {
        endInboxJob(id, signal)
        getInboxStore().clearInflight(id)
      }
    },
    [updateEntry, markInflight],
  )

  const handleConfirmSubtitle = useCallback(() => {
    const target = subtitleTarget
    if (!target?.filename) return
    // Snapshot options then close dialog immediately — job continues in the
    // module-level store so the user can navigate anywhere.
    const opts = {
      mode: subtitleMode,
      write: subtitleWrite,
      quality: subtitleQuality,
    }
    persistSubtitlePrefs({
      mode: opts.mode,
      write: opts.write === 'auto' ? 'hard' : opts.write,
      quality: opts.quality,
    })
    const modeLabel =
      SUBTITLE_MODE_OPTIONS.find((m) => m.value === opts.mode)?.label ?? opts.mode
    setSubtitleTarget(null)
    addToast(`已开始后台添加字幕（${modeLabel}），可继续其他操作`, 'info')

    void (async () => {
      try {
        const data = await runSubtitleJob(target, opts)
        let toastMsg = `字幕文件已生成（${modeLabel}）`
        if (data.burned_filename) {
          toastMsg =
            data.burn_method === 'soft'
              ? `字幕已嵌入视频（软字幕轨）· ${modeLabel}`
              : `字幕已烧录进画面（${modeLabel}）`
        }
        addToast(toastMsg, 'success')
        refreshStorage()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          addToast('已取消字幕任务', 'info')
          return
        }
        addToast(err instanceof Error ? err.message : '添加字幕失败', 'error')
      }
    })()
  }, [
    persistSubtitlePrefs,
    subtitleTarget,
    subtitleMode,
    subtitleWrite,
    subtitleQuality,
    runSubtitleJob,
    addToast,
    refreshStorage,
  ])

  const handleBatchSubtitle = useCallback(() => {
    const store = getInboxStore()
    const targets = store.entries.filter(
      (e) =>
        store.selectedIds.has(e.id) &&
        e.filename &&
        e.status !== 'downloading' &&
        e.status !== 'subtitling',
    )
    if (targets.length === 0) {
      addToast('请先选择已下载的视频', 'warning')
      return
    }
    const snapshot = [...targets]
    store.clearSelection()
    addToast(`已开始后台批量加字幕（${snapshot.length} 项），可继续其他操作`, 'info')
    setBatchBusy(true)

    void (async () => {
      let ok = 0
      let cancelled = 0
      // Serial queue — one job at a time to protect CPU
      for (const entry of snapshot) {
        try {
          await runSubtitleJob(entry, {
            mode: loadInboxPrefs().subtitleMode,
            write: 'soft',
            quality: loadInboxPrefs().subtitleQuality,
          })
          ok++
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') cancelled++
        }
      }
      setBatchBusy(false)
      if (cancelled && ok === 0) {
        addToast('批量字幕已取消', 'info')
      } else {
        addToast(
          `批量字幕完成：${ok}/${snapshot.length}${cancelled ? `（取消 ${cancelled}）` : ''}`,
          ok === snapshot.length ? 'success' : 'info',
        )
      }
      refreshStorage()
    })()
  }, [addToast, runSubtitleJob, setBatchBusy, refreshStorage])

  const handleBatchOrganize = useCallback(() => {
    const store = getInboxStore()
    const targets = store.entries.filter(
      (e) =>
        store.selectedIds.has(e.id) &&
        e.filename &&
        e.status !== 'downloading',
    )
    if (targets.length === 0) {
      addToast('请先选择已下载的文件', 'warning')
      return
    }
    const filenames: string[] = []
    const seen = new Set<string>()
    for (const e of targets) {
      if (e.filename && !seen.has(e.filename)) {
        seen.add(e.filename)
        filenames.push(e.filename)
      }
    }
    if (filenames.length === 0) {
      addToast('没有可归档的文件', 'warning')
      return
    }
    setBatchBusy(true)
    void api
      .inboxOrganize(filenames)
      .then((res) => {
        if (res.success && res.data) {
          addToast(
            `已归档 ${res.data.count} 个文件到 ${res.data.dirname}`,
            'success',
          )
        } else {
          addToast(res.message || '归档失败', 'error')
        }
      })
      .catch((err: Error) => {
        addToast(`归档失败：${err.message || '未知错误'}`, 'error')
      })
      .finally(() => {
        setBatchBusy(false)
        getInboxStore().clearSelection()
      })
  }, [addToast, setBatchBusy])

  /** Collect on-disk names tied to an entry (source + burned + srt). */
  const collectEntryFiles = useCallback((entry: InboxEntry) => {
    const filenames: string[] = []
    const srt_filenames: string[] = []
    if (entry.filename) filenames.push(entry.filename)
    if (entry.subtitleBurnedFilename) filenames.push(entry.subtitleBurnedFilename)
    if (entry.subtitleSrtFilename) srt_filenames.push(entry.subtitleSrtFilename)
    return { filenames, srt_filenames }
  }, [])

  const executeDelete = useCallback(async () => {
    const conf = deleteConfirm
    if (!conf) return
    setDeleteConfirm(null)
    if (conf.kind === 'one') {
      const store = getInboxStore()
      const entry = store.entries.find((e) => e.id === conf.id)
      removeEntry(conf.id)
      if (!entry) return
      const { filenames, srt_filenames } = collectEntryFiles(entry)
      if (filenames.length === 0 && srt_filenames.length === 0) return
      try {
        const res = await api.inboxDelete({ filenames, srt_filenames })
        addToast(res.success ? '已彻底删除（含本地文件）' : res.message || '删除失败', res.success ? 'success' : 'warning')
        refreshStorage()
      } catch {
        addToast('删除本地文件失败，列表项已移除', 'warning')
      }
      return
    }
    if (conf.kind === 'all') {
      storeClearAll()
      try {
        const res = await api.inboxClear()
        addToast(res.message || '已清空下载目录', 'success')
        refreshStorage()
      } catch {
        addToast('清空本地文件失败，列表已清空', 'warning')
      }
      return
    }
    // batch
    const store = getInboxStore()
    const selected = store.entries.filter((e) => store.selectedIds.has(e.id))
    const count = selected.length
    const filenames: string[] = []
    const srt_filenames: string[] = []
    for (const entry of selected) {
      const files = collectEntryFiles(entry)
      filenames.push(...files.filenames)
      srt_filenames.push(...files.srt_filenames)
      store.clearInflight(entry.id)
    }
    store.setEntries(store.entries.filter((e) => !store.selectedIds.has(e.id)))
    store.clearSelection()
    try {
      const res = await api.inboxDelete({ filenames, srt_filenames })
      addToast(
        res.success ? `已彻底删除 ${count} 项` : res.message || `已移除 ${count} 条`,
        res.success ? 'success' : 'warning',
      )
      refreshStorage()
    } catch {
      addToast(`已移除 ${count} 条，本地文件可能未删干净`, 'warning')
    }
  }, [deleteConfirm, removeEntry, collectEntryFiles, addToast, storeClearAll, refreshStorage])

  const handleRemove = useCallback((id: string) => {
    setDeleteConfirm({ kind: 'one', id })
  }, [])

  const handleClearAll = useCallback(() => {
    if (getInboxStore().entries.length === 0) return
    setDeleteConfirm({ kind: 'all' })
  }, [])

  const handleSelectAll = useCallback(() => {
    const store = getInboxStore()
    if (store.selectedIds.size === store.entries.length) {
      clearSelection()
    } else {
      storeSelectAll()
    }
  }, [storeSelectAll, clearSelection])

  const handleBatchRemove = useCallback(() => {
    if (getInboxStore().selectedIds.size === 0) return
    setDeleteConfirm({ kind: 'batch' })
  }, [])

  const handleCleanupOld = useCallback(async () => {
    try {
      const res = await api.inboxCleanup({ older_than_days: 7, keep_subtitled: true })
      addToast(res.message || '清理完成', 'success')
      // re-sync list
      const list = await api.inboxList()
      if (list?.data) mergeDiskFiles(list.data)
      // drop entries whose files no longer exist — simplest: clear and remerge
      refreshStorage()
    } catch {
      addToast('清理失败', 'error')
    }
  }, [addToast, mergeDiskFiles, refreshStorage])

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
        const signal = beginInboxJob(entry.id)
        try {
          const res = await api.inboxDownload(entry.url, signal)
          if (signal.aborted) continue
          const s = getInboxStore()
          if (res.success && res.filename) {
            s.updateEntry(entry.id, { status: 'downloaded' as InboxStatus, filename: res.filename, engine: res.engine })
          } else {
            s.updateEntry(entry.id, {
              status: 'failed' as InboxStatus,
              error: friendlyErrorMessage(res.message) ?? '下载失败',
            })
          }
          if (res.success) successCount++
        } catch (err) {
          const aborted =
            signal.aborted ||
            (err instanceof DOMException && err.name === 'AbortError') ||
            (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ERR_CANCELED')
          if (aborted) {
            getInboxStore().removeEntry(entry.id)
            continue
          }
          getInboxStore().updateEntry(entry.id, { status: 'failed' as InboxStatus, error: '重试请求失败' })
        } finally {
          endInboxJob(entry.id, signal)
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
            (fullText) => {
              if (isStreamedTranscribeFailure(fullText)) {
                getInboxStore().updateEntry(entry.id, {
                  status: 'failed' as InboxStatus,
                  error: fullText.trim(),
                  transcript: undefined,
                })
                return
              }
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
      const signal = beginInboxJob(id)
      try {
        const res = await api.inboxDownload(target.url, signal)
        if (signal.aborted) return
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
          const msg = friendlyErrorMessage(res.message) ?? '下载失败'
          s.updateEntry(id, { status: 'failed' as InboxStatus, error: msg })
          addToast(msg, 'error')
        }
      } catch (err) {
        const aborted =
          signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ERR_CANCELED')
        if (aborted) {
          getInboxStore().removeEntry(id)
          addToast('已取消下载', 'info')
          return
        }
        getInboxStore().updateEntry(id, {
          status: 'failed' as InboxStatus,
          error: err instanceof Error ? err.message : '请求失败',
        })
        addToast('重试失败', 'error')
      } finally {
        endInboxJob(id, signal)
        getInboxStore().clearInflight(id)
      }
    },
    [addToast],
  )

  return (
    <PageWrapper>
      <PageHeader
        title="下载中心"
        description="粘贴链接下载视频，转写文案或添加中英字幕"
        icon={<Inbox className="h-5 w-5" />}
      />

      {!online && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs text-warning">
          当前离线：下载与原语言识别仍可用；中英翻译可能失败。恢复网络后重试。
        </div>
      )}

      {storage && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/25 px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            本地占用 <span className="font-semibold text-foreground">{formatBytes(storage.total_bytes)}</span>
            <span className="mx-1.5 text-border">·</span>
            {storage.inbox.count} 个文件
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => void handleCleanupOld()}
          >
            清理 7 天前（保留成片）
          </Button>
        </div>
      )}

      {/* ── Download form ─────────────────────────────────────────────── */}
      <Card className="card-refined overflow-hidden">
        <CardContent className="p-0">
          <div className="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-primary/[0.08] via-primary/[0.03] to-transparent"
              aria-hidden
            />
            <div className="relative space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <label
                    htmlFor="inbox-url-input"
                    className="text-base font-semibold tracking-tight text-foreground"
                  >
                    粘贴分享链接
                  </label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    支持抖音、小红书、B 站、YouTube 等主流平台，可直接粘贴 App 分享文案
                  </p>
                </div>
                <ol className="hidden sm:flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  {[
                    { icon: Link2, label: '粘贴' },
                    { icon: DownloadIcon, label: '下载' },
                    { icon: Subtitles, label: '字幕' },
                    { icon: Mic, label: '转写' },
                  ].map((step, i) => (
                    <li key={step.label} className="flex items-center gap-1">
                      {i > 0 && <span className="mx-0.5 text-muted-foreground/35">→</span>}
                      <span className="inline-flex items-center gap-1 rounded-full bg-background/80 px-2.5 py-1 ring-1 ring-border/50 shadow-sm">
                        <step.icon className="h-3 w-3 text-primary/80" aria-hidden />
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <div className="relative min-w-0 flex-1">
                  <Link2
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/45"
                    aria-hidden
                  />
                  <Input
                    id="inbox-url-input"
                    name="url"
                    placeholder="粘贴视频分享链接，或从 App 复制的整段文字"
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
                    className="h-11 pl-9 text-sm"
                  />
                </div>
                <div className="flex gap-2 sm:shrink-0">
                  {/* Paste-from-clipboard. Sits BETWEEN the URL input and the
                      下载 CTA so the natural left-to-right reading order walks
                      user intent:  type / paste → 下载. */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handlePaste()}
                    aria-label="从剪切板粘贴分享链接"
                    title="从剪切板粘贴"
                    data-testid="inbox-paste"
                    className="h-11 px-3 sm:px-4"
                  >
                    <Clipboard className="h-4 w-4 sm:mr-1.5" aria-hidden />
                    <span className="hidden sm:inline">粘贴</span>
                  </Button>
                  <Button
                    onClick={() => void handleDownload()}
                    data-testid="inbox-download"
                    className="h-11 flex-1 px-5 sm:flex-none"
                  >
                    <DownloadIcon className="h-4 w-4 mr-1.5" />
                    开始下载
                  </Button>
                </div>
              </div>

              {detectedInfo && (
                <div
                  data-testid="inbox-detected"
                  className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  {detectedInfo.src ? (
                    <PlatformIcon
                      platform={detectedInfo.key}
                      className="h-4 w-4 shrink-0"
                    />
                  ) : (
                    <Link2 className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <span className="text-sm text-foreground">
                    已识别平台：
                    <span className="ml-1 font-medium">{detectedInfo.name}</span>
                  </span>
                  <Badge variant="info" className="ml-auto text-[10px] font-normal">
                    可下载
                  </Badge>
                </div>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                可直接粘贴 App 内分享的整段文字，系统会自动提取链接。文件保存在本地，24 小时后自动清理。
              </p>
            </div>
          </div>

          <div className="border-t border-border/40 bg-muted/20 px-5 py-3.5 sm:px-6">
            <PlatformChipStrip
              activeKey={detectedPlatform}
              label="支持平台"
              className="border-0 pt-0"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Download history ──────────────────────────────────────────── */}
      <Card className="card-refined overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/45 px-5 py-4 sm:px-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                下载记录
              </h2>
              <span
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold tabular-nums text-muted-foreground"
                data-testid="inbox-entry-count"
              >
                {entries.length}
              </span>
              {diskSyncing && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  同步本地文件…
                </span>
              )}
              {inFlightCount > 0 && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.08] px-2.5 py-1 text-xs font-medium text-primary"
                  data-testid="inbox-inflight-count"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {inFlightCount} 个后台进行中
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleDensity}
                className="h-8 text-xs text-muted-foreground"
                title={isCompact ? '切换为舒适密度' : '切换为紧凑密度'}
              >
                {isCompact ? '舒适' : '紧凑'}
              </Button>
              {entries.length > 0 && filterStatus === 'all' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleToggleAll}
                  className="h-8 text-xs text-muted-foreground"
                >
                  <ChevronDown className={cn('mr-1 h-3.5 w-3.5 transition-transform', allCollapsed && '-rotate-90')} />
                  {allCollapsed ? t('inbox.batch.expand_all', '全部展开') : t('inbox.batch.collapse_all', '全部收起')}
                </Button>
              )}
              {entries.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearAll}
                  className="h-8 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  全部清除
                </Button>
              )}
            </div>
          </div>

          <div className="px-5 py-4 sm:px-6">
          {/* Search + Status filter bar */}
          {entries.length > 0 && (
            <div className="mb-4 space-y-3">
              <div className="relative" data-testid="inbox-search">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/45" />
                <Input
                  placeholder="搜索链接或文件名…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 rounded-xl border-border/60 bg-muted/20 pl-10 pr-9 text-sm"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="清除搜索"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="inbox-filter-bar">
                {FILTER_OPTIONS.map((opt) => {
                  const count = statusCounts[opt.key] ?? 0
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => storeSetFilterStatus(opt.key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all duration-150',
                        filterStatus === opt.key
                          ? 'bg-primary/10 font-semibold text-primary ring-1 ring-primary/30'
                          : 'bg-muted/55 text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {t(opt.labelKey, opt.labelFallback)}
                      <span
                        className={cn(
                          'tabular-nums',
                          filterStatus === opt.key ? 'opacity-85' : 'opacity-55',
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {entries.length === 0 && diskSyncing ? (
            <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载下载历史…
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 animate-in fade-in-0 slide-in-from-top-2 duration-300">
              <EmptyState
                icon={<Inbox className="h-6 w-6 text-muted-foreground/50" />}
                title="还没有下载记录"
                description="在上方粘贴分享链接，即可开始下载并转写文案"
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">1</span>
                      粘贴链接
                    </span>
                    <span className="text-muted-foreground/35">→</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">2</span>
                      下载视频
                    </span>
                    <span className="text-muted-foreground/35">→</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">3</span>
                      转写文案
                    </span>
                  </div>
                }
                className="py-14"
              />
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/15 bg-primary/[0.04] px-3 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSelectAll}
                    className="h-8 text-xs"
                  >
                    {selectedIds.size === entries.length ? (
                      <CheckSquare className="h-3.5 w-3.5 mr-1" />
                    ) : (
                      <Square className="h-3.5 w-3.5 mr-1" />
                    )}
                    {selectedIds.size === entries.length
                      ? t('inbox.batch.unselect_all', '取消全选')
                      : t('inbox.batch.select_all', '全选')}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t('inbox.batch.selected_count', '已选 {{count}} 项', { count: selectedIds.size })}
                  </span>
                  <div className="flex-1" />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => void handleBatchSubtitle()}
                      disabled={batchBusy}
                      className="h-8 text-xs"
                    >
                      <Subtitles className="mr-1 h-3.5 w-3.5" />
                      {batchBusy ? '批量进行中…' : '批量加字幕'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBatchOrganize}
                      disabled={batchBusy}
                      className="h-8 text-xs"
                    >
                      <FolderOpen className="mr-1 h-3.5 w-3.5" />
                      {t('inbox.batch.organize_selected', '归档分组')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBatchRemove}
                      className="h-8 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
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
                      className="h-8 text-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
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
                      className="h-8 text-xs"
                    >
                      <Mic className="h-3.5 w-3.5 mr-1" />
                      {t('inbox.batch.transcribe_selected', '转写选中')}
                    </Button>
                  </div>
                </div>
              )}
              {filterStatus === 'all' ? (
                <div data-testid="inbox-entries" className="space-y-5">
                  {STATUS_ORDER.map((status) => {
                    const group = groupedEntries[status]
                    if (group.length === 0) return null
                    return (
                      <div key={status}>
                        {/* Section header — clickable to collapse/expand */}
                        <button
                          type="button"
                          onClick={() => handleToggleCollapse(status)}
                          className="group mb-2.5 flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-muted/40"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150',
                              collapsedGroups.has(status) && '-rotate-90',
                            )}
                          />
                          <span className="text-xs font-semibold tracking-wide text-foreground/85">
                            {t(STATUS_LABEL_META[status].labelKey, STATUS_LABEL_META[status].labelFallback)}
                          </span>
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                            {group.length}
                          </span>
                          <div className="h-px flex-1 bg-border/40" />
                        </button>
                        {!collapsedGroups.has(status) && (
                          <DragDropProvider onDragEnd={handleGroupDragEnd(status)}>
                            <div className="space-y-2.5">
                              {group.map((entry, index) => (
                              <SortableGroupEntry
                                key={entry.id}
                                entry={entry}
                                index={index}
                                selected={selectedIds.has(entry.id)}
                                onToggleSelect={() => toggleSelect(entry.id)}
                                onTranscribe={() => void handleTranscribe(entry.id)}
                                onAddSubtitle={() => openSubtitleDialog(entry)}
                                onCopyTranscript={() => void handleCopyTranscript(entry.id)}
                                onExportTranscript={() => handleExportTranscript(entry.id)}
                                onRetry={() => void handleRetry(entry.id)}
                                onRemove={() => handleRemove(entry.id)}
                                onCookieReauthorize={handleCookieReauthorize}
                                onPreview={(filename, title) => setPreview({ filename, title })}
                                compact={isCompact}
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
                  className="rounded-xl border border-dashed border-border/60 bg-muted/20 animate-in fade-in-0 slide-in-from-top-2 duration-300"
                  data-testid="inbox-filter-empty"
                >
                  <EmptyState
                    icon={<Search className="h-6 w-6 text-muted-foreground/50" />}
                    title={t('inbox.filter_empty.title', '暂无匹配记录')}
                    description="试试其他筛选条件，或清除搜索关键词"
                    action={
                      <button
                        type="button"
                        onClick={() => {
                          storeSetFilterStatus('all')
                          setSearchQuery('')
                        }}
                        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {t('inbox.filter_empty.clear', '清除筛选')}
                      </button>
                    }
                    className="py-12"
                  />
                </div>
              ) : (
                <ul className="space-y-2.5" data-testid="inbox-entries">
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
                        onAddSubtitle={() => openSubtitleDialog(e)}
                        onCopyTranscript={() => void handleCopyTranscript(e.id)}
                        onExportTranscript={() => handleExportTranscript(e.id)}
                        onRetry={() => void handleRetry(e.id)}
                        onRemove={() => handleRemove(e.id)}
                        onCookieReauthorize={handleCookieReauthorize}
                        onPreview={(filename, title) => setPreview({ filename, title })}
                        compact={isCompact}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          </div>
        </CardContent>
      </Card>

      {/* ── Add subtitle dialog ───────────────────────────────────────── */}
      <Dialog
        open={Boolean(subtitleTarget)}
        onOpenChange={(open) => {
          // Always allow closing — jobs run in background via store.
          if (!open) setSubtitleTarget(null)
        }}
      >
        <DialogContent
          className={cn(
            // Flex column + max-height so body scrolls and footer stays visible
            'flex max-h-[min(90dvh,720px)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0',
          )}
          data-testid="inbox-subtitle-dialog"
        >
          {/* Sticky header */}
          <div className="shrink-0 border-b border-border/50 bg-gradient-to-br from-primary/[0.07] to-transparent px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
            <DialogHeader className="space-y-1.5 pr-8 text-left">
              <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 sm:h-9 sm:w-9">
                  <Subtitles className="h-4 w-4" />
                </span>
                添加字幕
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed sm:text-sm">
                识别语音并生成字幕，支持中英双语，可烧录进画面或导出 SRT
              </DialogDescription>
            </DialogHeader>
            {subtitleTarget?.filename && (
              <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="min-w-0 truncate text-xs text-muted-foreground" title={subtitleTarget.filename}>
                  {subtitleTarget.filename}
                </p>
              </div>
            )}
          </div>

          {/* Scrollable body — this was missing, so tall content got clipped */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">
            <div className="space-y-4 sm:space-y-5">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  1 · 字幕语言
                </Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUBTITLE_MODE_OPTIONS.map((opt) => {
                    const active = subtitleMode === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSubtitleMode(opt.value)}
                        className={cn(
                          'relative rounded-xl border px-3 py-2.5 text-left transition-all sm:px-3.5 sm:py-3',
                          active
                            ? 'border-primary/45 bg-primary/[0.08] shadow-sm ring-1 ring-primary/20'
                            : 'border-border/60 bg-card hover:border-border hover:bg-muted/40',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/35',
                            )}
                          >
                            {active && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span className="text-sm font-semibold">{opt.label}</span>
                          {opt.value === 'bilingual' && (
                            <Badge variant="info" className="h-5 px-1.5 text-[10px] font-medium">
                              推荐
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground sm:pl-6">
                          {opt.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {subtitleWrite === 'hard' && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  画质（硬烧录）
                </Label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: 'original' as const, label: '原分辨率' },
                      { value: '1080' as const, label: '1080p' },
                      { value: '720' as const, label: '720p' },
                    ] as const
                  ).map((q) => (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => setSubtitleQuality(q.value)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                        subtitleQuality === q.value
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/60 text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  2 · 输出方式
                </Label>
                <div className="grid gap-2">
                  {(
                    [
                      {
                        value: 'hard' as const,
                        icon: Captions,
                        label: '硬烧录到画面',
                        desc: '字幕印在视频上，适合发平台；4K 自动缩到 1080p',
                        tip: '推荐',
                      },
                      {
                        value: 'soft' as const,
                        icon: Subtitles,
                        label: '嵌入软字幕轨',
                        desc: '不重编码、秒出片，播放器里可开关字幕',
                        tip: '更快',
                      },
                      {
                        value: 'none' as const,
                        icon: FileText,
                        label: '仅导出 SRT 文件',
                        desc: '只生成字幕文件，不生成新视频',
                        tip: null,
                      },
                    ] as const
                  ).map((opt) => {
                    const active = subtitleWrite === opt.value
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSubtitleWrite(opt.value)}
                        className={cn(
                          'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all sm:gap-3 sm:px-3.5 sm:py-3',
                          active
                            ? 'border-primary/45 bg-primary/[0.08] shadow-sm ring-1 ring-primary/20'
                            : 'border-border/60 bg-card hover:border-border hover:bg-muted/40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                            active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{opt.label}</span>
                            {opt.tip && (
                              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {opt.tip}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                            {opt.desc}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/35',
                          )}
                        >
                          {active && <Check className="h-2.5 w-2.5" />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-border/40 bg-muted/30 px-3 py-2.5">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  点击「开始后台添加」后弹窗会立即关闭，任务在后台执行；列表显示进度，可任意切换页面。
                </p>
              </div>
            </div>
          </div>

          {/* Sticky footer — always visible */}
          <DialogFooter className="shrink-0 gap-2 border-t border-border/50 bg-background/95 px-5 py-3 backdrop-blur-sm sm:gap-2 sm:px-6 sm:py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSubtitleTarget(null)}
              className="h-10"
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => handleConfirmSubtitle()}
              data-testid="inbox-subtitle-confirm"
              className="h-10 min-w-[9.5rem]"
            >
              <Captions className="mr-1.5 h-4 w-4" />
              开始后台添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pinned top-right job queue on inbox page */}
      <InboxJobQueue forceExpanded pin="top" />

      <VideoPreviewDialog
        open={Boolean(preview)}
        filename={preview?.filename ?? null}
        title={preview?.title}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      />

      {/* Delete confirmation */}
      <Dialog open={Boolean(deleteConfirm)} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              {deleteConfirm?.kind === 'all'
                ? '将清空下载目录中的全部本地文件（含字幕），且不可恢复。'
                : deleteConfirm?.kind === 'batch'
                  ? `将彻底删除选中的 ${selectedIds.size} 项及本地文件，不可恢复。`
                  : '将彻底删除该记录及本地视频/字幕文件，不可恢复。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void executeDelete()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SRT editor */}
      <Dialog open={Boolean(editSrt)} onOpenChange={(o) => !o && setEditSrt(null)}>
        <DialogContent className="flex max-h-[min(90dvh,800px)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <div className="border-b px-5 py-4">
            <DialogTitle>编辑字幕</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              修改 SRT 后可重新烧录到视频
            </DialogDescription>
          </div>
          <textarea
            className="min-h-[280px] flex-1 resize-none border-0 bg-muted/20 px-5 py-3 font-mono text-xs leading-relaxed outline-none"
            value={editSrtText}
            onChange={(e) => setEditSrtText(e.target.value)}
            spellCheck={false}
          />
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="outline" disabled={editSrtBusy} onClick={() => setEditSrt(null)}>取消</Button>
            <Button
              disabled={editSrtBusy || !editSrt?.filename}
              onClick={() => {
                if (!editSrt?.filename) return
                setEditSrtBusy(true)
                void api
                  .inboxSubtitleSave({
                    filename: editSrt.filename,
                    srt_text: editSrtText,
                    burn: true,
                    burn_style: 'hard',
                    quality: '1080',
                    mode: editSrt.subtitleMode || 'source',
                  })
                  .then((res) => {
                    if (!res.success || !res.data) throw new Error(res.message || '保存失败')
                    updateEntry(editSrt.id, {
                      subtitleSrtFilename: res.data.srt_filename,
                      subtitleSrtUrl: res.data.srt_url,
                      subtitleSrtText: res.data.srt_text,
                      subtitleBurnedFilename: res.data.burned_filename ?? undefined,
                      subtitleBurnedUrl: res.data.burned_url ?? undefined,
                    })
                    addToast('字幕已保存并重新写入视频', 'success')
                    setEditSrt(null)
                    refreshStorage()
                  })
                  .catch((e) => addToast(e instanceof Error ? e.message : '保存失败', 'error'))
                  .finally(() => setEditSrtBusy(false))
              }}
            >
              {editSrtBusy ? '处理中…' : '保存并烧录'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  )
}

// ── Inbox media helpers ───────────────────────────────────────────────────

function inboxMediaBaseURL(): string {
  return (
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    (import.meta.env.DEV ? '' : 'http://localhost:6001')
  )
}

function inboxFileUrl(filename: string): string {
  return `${inboxMediaBaseURL()}/api/inbox/file/${encodeURIComponent(filename)}`
}



/** In-memory thumbnail cache so list re-renders don't re-decode every video. */
const thumbCache = new Map<string, string>()

// ── VideoThumbnail ────────────────────────────────────────────────────────
// Capture a frame via an offscreen <video> + <canvas> (no DOM canvas ref —
// the previous implementation used canvasRef.current which was never mounted,
// so thumbnails always fell back to the empty icon).

function VideoThumbnail({
  filename,
  title,
  onPreview,
}: {
  filename: string
  title?: string
  onPreview?: () => void
}) {
  const [src, setSrc] = useState<string | null>(() => thumbCache.get(filename) ?? null)
  const [loading, setLoading] = useState(() => !thumbCache.has(filename))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!filename) return
    const cached = thumbCache.get(filename)
    if (cached) {
      setSrc(cached)
      setLoading(false)
      setFailed(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setFailed(false)
    setSrc(null)

    // Prefer server-generated JPEG cover (fast, no canvas CORS issues).
    const serverThumb = api.inboxThumbUrl(filename)
    const probe = new Image()
    probe.onload = () => {
      if (cancelled) return
      thumbCache.set(filename, serverThumb)
      setSrc(serverThumb)
      setLoading(false)
    }
    probe.onerror = () => {
      if (cancelled) return
      // Fall through to client-side frame capture
      startClientCapture()
    }
    probe.src = serverThumb

    const startClientCapture = () => {
    const videoEl = document.createElement('video')
    videoEl.preload = 'auto'
    videoEl.muted = true
    videoEl.playsInline = true
    videoEl.crossOrigin = 'anonymous'
    // Hint browsers that we only need a still; full decode still happens.
    videoEl.setAttribute('playsinline', 'true')

    let captured = false
    let seekTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (seekTimer) {
        clearTimeout(seekTimer)
        seekTimer = null
      }
      videoEl.removeEventListener('loadedmetadata', onMetaSafe)
      videoEl.removeEventListener('seeked', onSeekedSafe)
      videoEl.removeEventListener('error', onError)
      videoEl.pause()
      videoEl.removeAttribute('src')
      try {
        videoEl.load()
      } catch {
        /* ignore */
      }
    }

    const capture = () => {
      if (cancelled) return
      try {
        const w = videoEl.videoWidth || 320
        const h = videoEl.videoHeight || 180
        if (w < 2 || h < 2) {
          setFailed(true)
          setLoading(false)
          return
        }
        // Downscale for list thumbs — keeps data URLs small.
        const maxW = 320
        const scale = Math.min(1, maxW / w)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          setFailed(true)
          setLoading(false)
          return
        }
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
        thumbCache.set(filename, dataUrl)
        if (!cancelled) {
          setSrc(dataUrl)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setFailed(true)
          setLoading(false)
        }
      } finally {
        cleanup()
      }
    }

    const safeCapture = () => {
      if (captured || cancelled) return
      captured = true
      capture()
    }
    const onSeekedSafe = () => safeCapture()
    const onMetaSafe = () => {
      const dur = Number.isFinite(videoEl.duration) ? videoEl.duration : 0
      const t =
        dur > 0
          ? Math.min(Math.max(dur * 0.08, 0.15), Math.min(dur - 0.05, 2))
          : 0.25
      try {
        videoEl.currentTime = t
      } catch {
        safeCapture()
        return
      }
      // Some environments never fire `seeked` — force capture after a short wait.
      seekTimer = setTimeout(() => {
        if (!captured && videoEl.readyState >= 2) safeCapture()
      }, 800)
    }
    const onError = () => {
      if (!cancelled) {
        setFailed(true)
        setLoading(false)
      }
      cleanup()
    }

    videoEl.addEventListener('loadedmetadata', onMetaSafe)
    videoEl.addEventListener('seeked', onSeekedSafe)
    videoEl.addEventListener('error', onError)
    videoEl.src = inboxFileUrl(filename)

    return () => {
      cancelled = true
      cleanup()
    }
    }

    return () => {
      cancelled = true
    }
  }, [filename])

  const shellClass =
    'group/thumb relative h-16 w-[5.5rem] flex-shrink-0 overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-muted/80 to-muted/40 shadow-sm transition-all hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

  const inner = loading ? (
    <Skeleton className="h-full w-full rounded-md" />
  ) : src && !failed ? (
    <>
      <img src={src} alt={title ? `${title} 封面` : '视频封面'} className="h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent opacity-80" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-md ring-1 ring-white/20 transition-transform group-hover/thumb:scale-110">
          <Play className="h-3.5 w-3.5 fill-current pl-0.5" />
        </span>
      </div>
    </>
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-0.5">
      <Play className="h-4 w-4 text-muted-foreground/40" />
      <span className="text-[9px] text-muted-foreground/50">预览</span>
    </div>
  )

  if (onPreview) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onPreview()
        }}
        className={shellClass}
        title="点击预览视频"
        aria-label={title ? `预览 ${title}` : '预览视频'}
        data-testid="inbox-thumb-preview"
      >
        {inner}
      </button>
    )
  }

  return <div className={shellClass}>{inner}</div>
}

// ── VideoPreviewDialog ────────────────────────────────────────────────────
// Lightweight modal player for quick review of an inbox video.

function VideoPreviewDialog({
  open,
  filename,
  title,
  onOpenChange,
}: {
  open: boolean
  filename: string | null
  title?: string
  onOpenChange: (open: boolean) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!open) {
      const el = videoRef.current
      if (el) {
        el.pause()
      }
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(92dvh,900px)] w-[calc(100vw-1.25rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        data-testid="inbox-video-preview"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/50 px-5 py-3.5 pr-12">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base font-semibold">
              {title || filename || '视频预览'}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              快速预览 · 可全屏播放
            </DialogDescription>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
          {filename ? (
            <video
              ref={videoRef}
              key={filename}
              src={inboxFileUrl(filename)}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="max-h-[min(70dvh,720px)] w-full object-contain"
            />
          ) : (
            <p className="p-8 text-sm text-muted-foreground">无可预览文件</p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/50 bg-muted/20 px-5 py-3">
          <p className="min-w-0 truncate text-[11px] text-muted-foreground" title={filename ?? undefined}>
            {filename}
          </p>
          <div className="flex shrink-0 gap-2">
            {filename && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => void api.inboxReveal(filename)}
              >
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                打开文件夹
              </Button>
            )}
            <Button type="button" size="sm" variant="default" className="h-8" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
    <span className="text-[11px] tabular-nums text-muted-foreground/70">
      已用时 {min > 0 ? `${min} 分 ${String(sec).padStart(2, '0')} 秒` : `${sec} 秒`}
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
  onAddSubtitle: () => void
  onCopyTranscript: () => void
  onExportTranscript: () => void
  onRetry: () => void
  onRemove: () => void
  onCookieReauthorize?: () => void
  onPreview?: (filename: string, title: string) => void
  compact?: boolean
}

function SortableGroupEntry({
  entry,
  index,
  selected,
  onToggleSelect,
  onTranscribe,
  onAddSubtitle,
  onCopyTranscript,
  onExportTranscript,
  onRetry,
  onRemove,
  onCookieReauthorize,
  onPreview,
  compact,
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
          onAddSubtitle={onAddSubtitle}
          onCopyTranscript={onCopyTranscript}
          onExportTranscript={onExportTranscript}
          onRetry={onRetry}
          onRemove={onRemove}
          onCookieReauthorize={onCookieReauthorize}
          onPreview={onPreview}
          compact={compact}
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
  onAddSubtitle: () => void
  onCopyTranscript: () => void
  onExportTranscript: () => void
  onRetry: () => void
  onRemove: () => void
  onCookieReauthorize?: () => void
  onPreview?: (filename: string, title: string) => void
  compact?: boolean
}

function InboxRow({
  entry,
  selected,
  enableDrag,
  dragHandleRef,
  onToggleSelect,
  onTranscribe,
  onAddSubtitle,
  onCopyTranscript,
  onExportTranscript,
  onRetry,
  onRemove,
  onCookieReauthorize,
  onPreview,
  compact = false,
}: InboxRowProps) {
  const { status } = entry
  const { t } = useTranslation()
  const platformKey = detectPlatform(entry.url)
  const platformMeta = platformKey
    ? PLATFORMS.find((p) => p.key === platformKey)
    : null
  const canSubtitle =
    Boolean(entry.filename) &&
    status !== 'downloading' &&
    status !== 'subtitling' &&
    status !== 'transcribing'

  const badge = (() => {
    switch (status) {
      case 'downloading':
        return (
          <Badge variant="info" className="font-medium">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            {t('inbox.row.badge.downloading', '下载中')}
          </Badge>
        )
      case 'downloaded':
        return (
          <Badge variant="success" className="font-medium">
            <Check className="mr-1 h-3 w-3" />
            {t('inbox.row.badge.downloaded', '已下载')}
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="error" className="font-medium">
            <XCircle className="mr-1 h-3 w-3" />
            {t('inbox.row.badge.failed', '失败')}
          </Badge>
        )
      case 'transcribing':
        return (
          <Badge variant="info" className="font-medium">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            {t('inbox.row.badge.transcribing', '转写中')}
          </Badge>
        )
      case 'transcribed':
        return (
          <Badge variant="success" className="font-medium">
            <Sparkles className="mr-1 h-3 w-3" />
            {t('inbox.row.badge.transcribed', '已转写')}
          </Badge>
        )
      case 'subtitling':
        return (
          <Badge variant="info" className="font-medium">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            {t('inbox.row.badge.subtitling', '加字幕中')}
          </Badge>
        )
    }
  })()

  const title = entry.filename || entry.url || '未知文件'
  const showUrlUnderTitle = Boolean(entry.filename && entry.url)
  const hasSubtitle = Boolean(entry.subtitleSrtUrl || entry.subtitleBurnedFilename)
  const modeLabel = entry.subtitleMode
    ? SUBTITLE_MODE_OPTIONS.find((m) => m.value === entry.subtitleMode)?.label
    : null

  return (
    <div
      className={cn(
        'group/row overflow-hidden border bg-card transition-all duration-200',
        compact ? 'rounded-xl' : 'rounded-2xl',
        selected
          ? 'border-primary/40 bg-primary/[0.03] shadow-[0_0_0_1px] shadow-primary/15'
          : 'border-border/55 hover:border-border hover:shadow-sm',
      )}
    >
      <div
        className={cn(
          'flex items-start',
          compact ? 'gap-2.5 p-2.5 sm:p-3' : 'gap-3 p-3.5 sm:gap-3.5 sm:p-4',
        )}
      >
        {enableDrag && dragHandleRef && (
          <div
            ref={dragHandleRef}
            className="mt-5 flex-shrink-0 cursor-grab rounded-md p-1 text-muted-foreground/25 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        <button
          type="button"
          onClick={onToggleSelect}
          className="mt-5 flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={selected ? t('inbox.row.unselect_aria', '取消选择') : t('inbox.row.select_aria', '选择')}
        >
          {selected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>

        {/* Thumbnail — click opens quick preview */}
        {entry.filename && status !== 'downloading' ? (
          <VideoThumbnail
            filename={entry.filename}
            title={title}
            onPreview={
              onPreview
                ? () => onPreview(entry.filename!, title)
                : undefined
            }
          />
        ) : status === 'downloading' ? (
          <div className="flex h-16 w-[5.5rem] flex-shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.06]">
            <Loader2 className="h-5 w-5 animate-spin text-primary/75" />
          </div>
        ) : (
          <div className="flex h-16 w-[5.5rem] flex-shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/40">
            {platformMeta?.src && platformKey ? (
              <PlatformIcon platform={platformKey} className="h-6 w-6 opacity-85" />
            ) : (
              <Link2 className="h-5 w-5 text-muted-foreground/40" />
            )}
          </div>
        )}

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                {platformMeta?.src && platformKey && entry.filename && (
                  <PlatformIcon platform={platformKey} className="h-4 w-4 shrink-0 opacity-75" />
                )}
                <h3 className="truncate text-[13px] font-semibold leading-snug tracking-tight text-foreground sm:text-sm">
                  {title}
                </h3>
                {entry.filename && (
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover/row:opacity-100"
                    title="在文件夹中打开"
                    onClick={() => void api.inboxReveal(entry.filename)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {platformMeta && (
                  <span className="font-medium text-muted-foreground/90">{platformMeta.name}</span>
                )}
                {platformMeta && showUrlUnderTitle && (
                  <span className="text-border">·</span>
                )}
                {showUrlUnderTitle && (
                  <span className="max-w-[min(100%,28rem)] truncate" title={entry.url}>
                    {entry.url}
                  </span>
                )}
                {status === 'downloading' && entry.startedAt && (
                  <>
                    <span className="text-border">·</span>
                    <ElapsedTimer startedAt={entry.startedAt} />
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0">{badge}</div>
          </div>

          {(() => {
            const cookieExpired = isCookieStalenessError(entry.error)
            const displayError = friendlyErrorMessage(entry.error)
            if (!displayError) return null
            return (
              <div className="mt-2.5 space-y-1.5">
                {cookieExpired && onCookieReauthorize && (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-warning">
                        {t('inbox.row.cookie_expired.title', '平台授权已过期，请重新登录')}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-warning/70">
                        {t(
                          'inbox.row.cookie_expired.description',
                          '授权失效可能导致下载失败，回到账号管理页重新登录即可恢复。',
                        )}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 border-warning/40 text-[11px] text-warning hover:bg-warning/20"
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
                <p className="rounded-lg bg-destructive/5 px-2.5 py-1.5 text-xs leading-relaxed text-destructive">
                  {displayError}
                </p>
              </div>
            )
          })()}

          {/* In-progress progress + cancel (download / subtitle / transcribe) */}
          {(status === 'subtitling' || status === 'downloading' || status === 'transcribing') && (
            <div className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate font-medium text-primary">
                  {status === 'subtitling'
                    ? (entry.subtitleLabel || '加字幕中…')
                    : status === 'downloading'
                      ? '下载中…'
                      : '转写中…'}
                </span>
                {status === 'subtitling' && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {Math.round(entry.subtitleProgress ?? 0)}%
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    cancelInboxJob(entry.id)
                    if (status === 'downloading') {
                      getInboxStore().removeEntry(entry.id)
                    } else {
                      getInboxStore().updateEntry(entry.id, {
                        status: entry.filename
                          ? entry.transcript
                            ? 'transcribed'
                            : 'downloaded'
                          : 'failed',
                        error: undefined,
                        subtitleProgress: undefined,
                        subtitleLabel: undefined,
                        subtitlePhase: undefined,
                      })
                    }
                    getInboxStore().clearInflight(entry.id)
                  }}
                >
                  取消
                </Button>
              </div>
              {status === 'subtitling' && (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(2, entry.subtitleProgress ?? 2))}%` }}
                  />
                </div>
              )}
              {status === 'downloading' && (
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500/80" />
                </div>
              )}
            </div>
          )}

          {/* Action toolbar */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {entry.filename && (
                <a
                  href={inboxFileUrl(entry.filename)}
                  download={entry.filename}
                  data-testid="inbox-download-file"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/[0.04] hover:text-primary"
                  title={t('inbox.row.download_aria', '下载文件到本地')}
                  aria-label={t('inbox.row.download_aria', '下载文件到本地')}
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {t('inbox.row.download', '下载文件')}
                </a>
              )}
              {canSubtitle && (
                <Button
                  size="sm"
                  onClick={onAddSubtitle}
                  data-testid="inbox-add-subtitle"
                  className="h-8 gap-1.5 rounded-lg px-3 shadow-sm"
                >
                  <Subtitles className="h-3.5 w-3.5" />
                  {hasSubtitle
                    ? t('inbox.row.subtitle_again', '重新加字幕')
                    : t('inbox.row.subtitle', '添加字幕')}
                </Button>
              )}
              {(status === 'downloaded' || status === 'transcribed') && entry.filename && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onTranscribe}
                  data-testid="inbox-transcribe"
                  className="h-8 gap-1.5 rounded-lg px-3"
                >
                  <Mic className="h-3.5 w-3.5" />
                  {status === 'transcribed'
                    ? t('inbox.row.retranscribe', '再转写')
                    : t('inbox.row.transcribe', '转写文案')}
                </Button>
              )}
              {status === 'transcribed' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onCopyTranscript}
                    data-testid="inbox-copy"
                    className="h-8 gap-1.5 rounded-lg px-3"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t('inbox.row.copy', '复制')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onExportTranscript}
                    data-testid="inbox-export"
                    className="h-8 gap-1.5 rounded-lg px-3"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {t('inbox.row.export', '导出')}
                  </Button>
                </>
              )}
              {status === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={entry.filename && entry.url ? onRetry : entry.filename ? onTranscribe : onRetry}
                  data-testid="inbox-download-retry"
                  className="h-8 gap-1.5 rounded-lg px-3"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {entry.filename && !entry.url
                    ? t('inbox.row.retry_transcribe', '再试转写')
                    : t('inbox.row.retry', '重试')}
                </Button>
              )}
              {status === 'downloaded' && entry.filename && !hasSubtitle && (
                <span className="hidden text-[10px] text-muted-foreground sm:inline">
                  下一步：添加字幕或转写
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRemove}
              aria-label={t('inbox.row.remove_aria', '移除')}
              data-testid="inbox-remove"
              className="ml-auto h-8 w-8 rounded-lg p-0 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Subtitle result panel */}
      {hasSubtitle && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/45 bg-gradient-to-r from-primary/[0.04] to-transparent px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            <Captions className="h-3 w-3" />
            字幕已就绪
            {modeLabel ? ` · ${modeLabel}` : ''}
          </span>
          {entry.subtitleSrtUrl && (
            <a
              href={entry.subtitleSrtUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.04] hover:text-primary"
              data-testid="inbox-srt-link"
            >
              <FileText className="h-3 w-3" />
              下载 SRT
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          )}
          {(entry.subtitleSrtText || entry.subtitleSrtUrl) && (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 text-[11px] font-medium hover:border-primary/30 hover:text-primary"
              onClick={() => {
                // open editor via custom event bubble — parent listens through window
                window.dispatchEvent(
                  new CustomEvent('inbox-edit-srt', { detail: { id: entry.id } }),
                )
              }}
            >
              编辑字幕
            </button>
          )}
          {entry.subtitleBurnedFilename && (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.04] hover:text-primary"
              title="在文件夹中打开带字幕视频"
              onClick={() => void api.inboxReveal(entry.subtitleBurnedFilename)}
            >
              <Subtitles className="h-3 w-3" />
              打开带字幕视频
            </button>
          )}
          {(entry.subtitleBurnedFilename || entry.filename) && (
            <a
              href={ROUTES.dashboard.publish}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/10"
            >
              去发布
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          )}
        </div>
      )}

      {/* Transcript — collapsed by default in compact density */}
      {entry.transcript !== undefined && !(compact && status === 'transcribed' && !entry.transcript) && (
        <div className={cn('border-t border-border/45', compact ? 'px-3 py-2' : 'px-4 py-3')}>
          {compact && status === 'transcribed' ? (
            <details className="group/tr">
              <summary className="cursor-pointer list-none text-[11px] font-semibold text-muted-foreground marker:content-none">
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  {t('inbox.row.transcript_label', '转写文案')}
                  <span className="font-normal text-muted-foreground/70">（点击展开）</span>
                </span>
              </summary>
              <pre
                className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                data-testid="inbox-transcript"
              >
                {entry.transcript || t('inbox.row.transcript_empty', '（暂无文案）')}
              </pre>
            </details>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
                <FileText className="h-3 w-3" />
                {t('inbox.row.transcript_label', '转写文案')}
                {status === 'transcribing' && (
                  <Loader2 className="ml-0.5 h-3 w-3 animate-spin text-primary/70" />
                )}
              </div>
              <pre
                className={cn(
                  'overflow-auto whitespace-pre-wrap rounded-xl border border-border/40 bg-muted/25 text-xs leading-relaxed text-foreground/90',
                  compact ? 'max-h-36 px-3 py-2' : 'max-h-56 px-3.5 py-3',
                )}
                data-testid="inbox-transcript"
              >
                {entry.transcript ||
                  (status === 'transcribing'
                    ? t('inbox.row.transcript_streaming', '正在转写…')
                    : t('inbox.row.transcript_empty', '（暂无文案）'))}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
