/**
 * Settings chrome extracted from the old AiSidebar.
 *
 *   1. Header strip — model picker (delegates to the in-tree
 *      ModelSelector) + status badge.
 *   2. Settings popover — API Key management flow (single key add,
 *      batch import, key viewer with rate-limited chips, delete).
 *
 * Templates + history: templates are surfaced as Composer-level
 * shortcuts via `MagicSuggestions` upstream; history is no longer a
 * separate panel — chat sessions in `useChatStore` ARE the history.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Lock,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Type, ImageIcon, Video, Mic, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useToast } from '@/components/ui/toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { api } from '@/api/client'
import { useAiConfig, useAiKeys, useSetAiConfig, useDeleteAiConfig } from '@/hooks/useAiConfig'
import { useAiModels } from '@/hooks/useAiGeneration'
import { useAiStore } from '@/stores/useAiStore'
import { useAuth } from '@/features/auth/useAuth'

// ── AiKey shape (the backend returns this; we keep the local copy
//    here so we don't have to add an explicit export to `@/api/ai` —
//    keeping the surface narrow during the assistant-ui migration.) ──
export interface AiKey {
  id: number
  masked: string
  rate_limited: boolean
  created?: string
}

/* ── Header ─────────────────────────────────────────────────────────── */

interface AiSettingsHeaderProps {
  /** "Is the AI service configured?" — rendered as a status dot. */
  configured: boolean
  /** "Initial fetch still in flight?" — shows shimmer gate. */
  loading: boolean
}

export function AiSettingsHeader({ configured, loading }: AiSettingsHeaderProps) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
      {loading ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>加载中</span>
        </>
      ) : (
        <Badge
          variant="outline"
          className={cn(
            'h-4 shrink-0 px-1 text-[9px] tabular-nums',
            configured ? 'border-green-200 text-green-700 dark:border-green-800 dark:text-green-400' : 'border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-400',
          )}
        >
          {configured ? '已配置' : '未配置'}
        </Badge>
      )}
    </div>
  )
}

/* ── Popover trigger ────────────────────────────────────────────────── */

export function AiSettingsPopover() {
  const [open, setOpen] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [showList, setShowList] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [batchInput, setBatchInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeMsg, setProbeMsg] = useState<string | null>(null)
  const [probingId, setProbingId] = useState<number | null>(null)
  const [dismissRateLimit, setDismissRateLimit] = useState(false)
  /** When non-null, the popover is in "delete confirmation" mode. */
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'all' } | { type: 'single'; id: number; masked: string } | null>(null)

  // Founder gate for key management. Local shell / unauthenticated
  // sessions still allow manage so devs can paste OpenRouter keys.
  const { user } = useAuth()
  const isFounder = Boolean(user?.is_founder)
  const canManageKeys = isFounder || user == null

  const { data: aiConfig, isLoading: configLoading } = useAiConfig()
  const { data: aiKeys, isLoading: keysLoading, refetch: refetchKeys } = useAiKeys(canManageKeys)
  const setKeyMutation = useSetAiConfig()
  const deleteKeyMutation = useDeleteAiConfig()
  const { addToast } = useToast()

  const loading = configLoading || keysLoading
  const configured = aiConfig?.configured ?? false
  const safeKeys: AiKey[] = Array.isArray(aiKeys) ? aiKeys : []
  const rateLimited = safeKeys.filter((k) => k.rate_limited)

  /** 快捷测活 — does not store the key. */
  const handleProbeInput = async () => {
    const key = keyInput.trim()
    if (!key) return
    setProbeBusy(true)
    setProbeMsg(null)
    try {
      const res = await api.validateAiKey({ api_key: key })
      if (res.success) {
        const label = res.data?.label ? `（${res.data.label}）` : ''
        setProbeMsg(`有效 ${label}`.trim())
        addToast(`Key 测活通过 ${label}`.trim(), 'success')
      } else {
        setProbeMsg(res.message || '无效')
        addToast(res.message || 'Key 无效', 'error')
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '测活失败'
      setProbeMsg(msg)
      addToast(msg, 'error')
    } finally {
      setProbeBusy(false)
    }
  }

  const handleProbeStored = async (keyId: number) => {
    setProbingId(keyId)
    try {
      const res = await api.validateAiKey({ key_id: keyId })
      if (res.success) {
        addToast('Key 有效，已清除限流标记', 'success')
        await refetchKeys()
      } else {
        addToast(res.message || 'Key 无效', 'error')
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '测活失败'
      addToast(msg, 'error')
    } finally {
      setProbingId(null)
    }
  }

  /** Save after server-side validate (default). */
  const handleSaveSingle = async () => {
    if (!keyInput.trim()) return
    setProbeMsg(null)
    try {
      const res = await setKeyMutation.mutateAsync(keyInput.trim())
      if (res.success) {
        addToast('Key 已校验并添加（限流时自动轮询切换）', 'success')
        setKeyInput('')
        setShowInput(false)
        setProbeMsg(null)
      } else {
        addToast(res.message || '保存失败', 'error')
        setProbeMsg(res.message || '保存失败')
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '保存失败（可能已存在或测活未通过）'
      addToast(msg, 'error')
      setProbeMsg(msg)
    }
  }

  const handleBatchImport = async () => {
    const lines = batchInput.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    setBatchBusy(true)
    try {
      const res = await api.batchAddKeys(lines)
      if (res.success) {
        const { added, skipped, invalid } = res.data as {
          added: number
          skipped: number
          invalid?: Array<{ masked: string; message: string }>
        }
        const inv = invalid?.length ?? 0
        addToast(
          inv > 0
            ? `导入完成：新增 ${added}，跳过 ${skipped}（含 ${inv} 个无效）`
            : `导入完成：新增 ${added}，跳过 ${skipped}`,
          added > 0 ? 'success' : 'warning',
        )
        if (inv > 0) {
          const detail = invalid!
            .slice(0, 3)
            .map((x) => `${x.masked}: ${x.message}`)
            .join('；')
          addToast(`无效 Key：${detail}`, 'error')
        }
        setBatchInput('')
        setShowBatch(false)
        await refetchKeys()
      } else {
        addToast(res.message || '批量导入失败', 'error')
      }
    } catch {
      addToast('批量导入失败', 'error')
    } finally {
      setBatchBusy(false)
    }
  }

  /**
   * Confirm delete — drives from `deleteTarget`. The original
   * `DeleteApiKeyConfirm` slice (in `@/features/confirmDialog`) carries
   * its own copy-state, which is overkill for this surface; we
   * inline a 2-button confirm UI for both single and bulk paths.
   */
  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      // `mutateAsync` has signature `(keyId?: number)` — pass the
      // concrete id for single mode, `undefined` for bulk.
      await deleteKeyMutation.mutateAsync(deleteTarget.type === 'single' ? deleteTarget.id : undefined)
      addToast(deleteTarget.type === 'all' ? '已删除全部 Key' : 'API Key 已删除', 'success')
    } catch {
      addToast('删除失败', 'error')
    } finally {
      setDeleteTarget(null)
    }
  }

  /* Status dot for the trigger aria-label. */
  const statusDot = (() => {
    if (loading) return 'bg-muted-foreground/40 animate-pulse'
    if (!configured) return 'bg-red-500'
    if (rateLimited.length > 0 && rateLimited.length === safeKeys.length) return 'bg-amber-500'
    return 'bg-green-500'
  })()

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setDeleteTarget(null) }}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-lg p-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-[0.95] transition-all duration-150"
            aria-label={configured ? '管理 API Key' : '设置 API Key'}
            data-testid="ai-settings-trigger"
          >
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className={cn('h-2 w-2 rounded-full', statusDot)} />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2" sideOffset={6}>
          <div className="space-y-1" role="menu" aria-label="API Key 管理">
            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium text-foreground border-b border-border/60">
              <Key className="h-3.5 w-3.5 shrink-0" />
              <span>API Key 管理</span>
              {configured && (
                <Badge variant="outline" className="ml-auto h-4 px-1 text-[9px] font-normal">
                  {aiConfig?.key_count ?? 0} 个
                </Badge>
              )}
            </div>

            {!canManageKeys && (
              <div
                className="flex items-start gap-2 px-2 py-2 rounded bg-muted/40 text-[11px] leading-snug"
                data-testid="ai-settings-not-founder"
              >
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">
                  AI API Key 由项目创始人管理。如需添加或更换 Key，请联系创始人。
                </span>
              </div>
            )}

            {!showInput && !showBatch && !deleteTarget && canManageKeys && (
              <>
                <p className="px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground/70">
                导入前会向 OpenRouter 测活；多 Key 限流时自动轮询切换。
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setShowInput(true); setShowBatch(false); setShowList(false); setProbeMsg(null) }}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-all duration-150 hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 text-left"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="flex-1">{configured ? '添加 Key' : '设置 Key'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setShowBatch(true); setShowInput(false); setShowList(false) }}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-all duration-150 hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 text-left"
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="flex-1">批量导入（校验后入库）</span>
              </button>
              {configured && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowList((v) => !v); setShowInput(false); setShowBatch(false) }}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-all duration-150 hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 text-left"
                >
                  {showList ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  <span className="flex-1">Key 列表 / 测活</span>
                  <Badge variant="outline" className="ml-auto h-4 px-1 text-[9px]">{safeKeys.length}</Badge>
                </button>
              )}
              {configured && (
                <>
                  <div className="my-1.5 h-px bg-border/40" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setDeleteTarget({ type: 'all' })}
                    className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-all duration-150 text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 text-left"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="flex-1">删除全部 Key</span>
                  </button>
                </>
              )}
              </>
            )}

            {showInput && canManageKeys && (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      placeholder="sk-or-v1-xxxxxxxxxxxxxxxx"
                      value={keyInput}
                      onChange={(e) => { setKeyInput(e.target.value); setProbeMsg(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveSingle() }}
                      className="h-7 text-xs pr-7 font-mono tracking-tight"
                    />
                    <button
                      type="button"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowKey(!showKey)}
                      aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[10px]"
                    onClick={() => void handleProbeInput()}
                    disabled={probeBusy || !keyInput.trim()}
                    title="向 OpenRouter 测活，不入库"
                  >
                    {probeBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                    测活
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => void handleSaveSingle()}
                    disabled={setKeyMutation.isPending || !keyInput.trim()}
                    title="测活通过后入库"
                  >
                    {setKeyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowInput(false); setKeyInput(''); setProbeMsg(null) }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {probeMsg && (
                  <p className="text-[10px] text-muted-foreground leading-tight px-0.5">{probeMsg}</p>
                )}
                <p className="text-[10px] text-muted-foreground leading-tight">
                  保存前会校验有效性。多 Key 限流时自动切换。获取：
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" className="font-medium underline underline-offset-2 hover:text-primary"> openrouter.ai/keys</a>
                </p>
              </div>
            )}

            {showBatch && canManageKeys && (
              <div className="space-y-1.5">
                <Textarea
                  placeholder={"多行 Key，每行一个或逗号分隔：\nsk-or-v1-aaa...\nsk-or-v1-bbb..."}
                  value={batchInput}
                  onChange={(e) => setBatchInput(e.target.value)}
                  rows={4}
                  className="resize-none text-[11px] font-mono"
                />
                <div className="flex items-center gap-1.5">
                  <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void handleBatchImport()} disabled={batchBusy || !batchInput.trim()}>
                    {batchBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                    {batchBusy ? '校验导入中…' : '测活并导入'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setShowBatch(false); setBatchInput('') }}>
                    取消
                  </Button>
                  <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                    {batchInput.split(/[\n,]+/).filter((l) => l.trim()).length} 个
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">仅入库测活通过的 Key；无效会跳过并提示。</p>
              </div>
            )}

            {canManageKeys && showList && configured && safeKeys.length > 0 && (
              <div className="space-y-1 max-h-44 overflow-y-auto" data-testid="ai-settings-key-list">
                {safeKeys.map((k, idx) => (
                  <div key={k.id} className="group/keyrow flex items-center justify-between rounded bg-background/80 px-2 py-1.5 hover:bg-background">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 shrink-0 text-center text-[9px] text-muted-foreground/60 font-mono">#{idx + 1}</span>
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', k.rate_limited ? 'bg-amber-500' : 'bg-green-500')} />
                      <span className="truncate text-[11px] font-mono">{k.masked}</span>
                      {k.rate_limited && (
                        <Badge variant="outline" className="h-4 shrink-0 border-amber-200 bg-amber-50 px-1 text-[8px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                          限速
                        </Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        aria-label={`测活 Key #${idx + 1}`}
                        title="测活"
                        disabled={probingId === k.id}
                        onClick={() => void handleProbeStored(k.id)}
                      >
                        {probingId === k.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Activity className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover/keyrow:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`删除 Key #${idx + 1}`}
                        onClick={() => setDeleteTarget({ type: 'single', id: k.id, masked: k.masked })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {deleteTarget && (
              <div className="space-y-2 p-2 rounded-md border border-destructive/30 bg-destructive/5">
                <div className="flex items-center gap-2 text-[11px] text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium">
                    {deleteTarget.type === 'all' ? '删除全部 Key？' : `删除 Key ${deleteTarget.masked}？`}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  删除后下次生成会失败，直到添加新 Key。
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void confirmDelete()}
                  >
                    确认删除
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setDeleteTarget(null)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Rate-limit warning sits BELOW the popover trigger (lives in
          the page chrome, not nested inside the popover) so it stays
          visible while the popover is closed. */}
      {rateLimited.length > 0 && rateLimited.length === safeKeys.length && !dismissRateLimit && (
        <Alert className="mt-2 py-2 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 relative">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-[11px] text-amber-700 dark:text-amber-300 truncate flex-1 min-w-0">
              所有 Key 均已触发限速，请等待冷却后重试
            </AlertDescription>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 h-6 w-6 p-0 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/50"
              onClick={() => setDismissRateLimit(true)}
              aria-label="关闭告警"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </Alert>
      )}
    </div>
  )
}

/* ── Inline status pill (sidebar header companion) ──────────────────── */

/**
 * Standalone status pill importing the same data sources as the
 * popover. Mount this in the page chrome (header strip) so the
 * operator sees model + configured status at a glance.
 */
export function AiStatusPill() {
  // Founder-gated: `useAiKeys` short-circuits for non-founders so
  // the status pill still renders without burning retries on 403.
  const { user } = useAuth()
  const isFounder = Boolean(user?.is_founder)
  const { data: aiConfig, isLoading: loading } = useAiConfig()
  const { data: aiKeys } = useAiKeys(isFounder)
  const configured = aiConfig?.configured ?? false
  const keys: AiKey[] = Array.isArray(aiKeys) ? aiKeys : []
  const rateLimitedCount = keys.filter((k) => k.rate_limited).length
  const label = loading
    ? '加载中'
    : !configured
      ? '未配置 Key'
      : rateLimitedCount > 0 && rateLimitedCount === keys.length
        ? '所有 Key 限速'
        : keys.length > 0
          ? `${keys.length} Keys`
          : '已配置'
  const dot = (() => {
    if (loading) return 'bg-muted-foreground/40 animate-pulse'
    if (!configured) return 'bg-red-500'
    if (rateLimitedCount > 0 && rateLimitedCount === keys.length) return 'bg-amber-500'
    if (keys.length === 0) return 'bg-green-500'
    if (rateLimitedCount > 0) return 'bg-amber-500'
    return 'bg-green-500'
  })()
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
      <SettingsIcon className="h-3 w-3" />
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

/* ── Inline model picker (assistant-panel header companion) ───── */

interface ModelItem {
  id: string
  name?: string
  tags?: string[]
}

const TAG_ICONS: Record<string, { icon: typeof Type; label: string; color: string }> = {
  text: { icon: Type, label: '文字', color: 'text-blue-500' },
  image: { icon: ImageIcon, label: '图片', color: 'text-green-500' },
  video: { icon: Video, label: '视频', color: 'text-purple-500' },
  audio: { icon: Mic, label: '音频', color: 'text-orange-500' },
  file: { icon: FileText, label: '文件', color: 'text-gray-500' },
}

/**
 * Compact model picker for the assistant-panel header strip
 * (44px height). Renders a slim shadcn `Select` trigger showing the
 * SECOND HALF of the selected model id (`gpt-4o-mini` rather than
 * `openai/gpt-4o-mini`) + `SelectValue` chevron — minimizes width
 * so the surrounding mono dot-separators, the AI 助手 label, and
 * `AiSettingsHeader` all fit on one row at common desktop widths.
 *
 * Different from the full {@link ModelSelector} at
 * `@/components/AiSidebar/ModelSelector`: NO `AI 模型` label, NO
 * source-status row (live/offline `Models: N`), NO support-tags
 * footer — just the trigger + dropdown. The full variant lives
 * inside the legacy sidebar; this surface is the inline variant
 * used by the assistant-panel chrome.
 *
 * Falls back to `加载中…` placeholder before models arrive. The
 * underlying `useAiModels` query handles refetch + error states
 * itself; we surface only loading here. Disabled state matches
 * `useAiModels.isLoading` to prevent race-condition intermediate
 * selections while the model list is in flight.
 */
export function ModelInlinePicker() {
  const { data, isLoading } = useAiModels()
  const models: ModelItem[] = useMemo(
    () => (data?.models ?? []) as ModelItem[],
    [data?.models],
  )
  const selectedModel = useAiStore((s) => s.selectedModel)
  const setSelectedModel = useAiStore((s) => s.setSelectedModel)
  const setModelTags = useAiStore((s) => s.setModelTags)

  // Mirror the legacy `ModelSelector`'s invariants to keep the
  // inline variant coherent on the data layer (reviewer ⚠️C):
  //   (1) when the live models list arrives and the persisted
  //       selectedModel isn't in it (rate-limited free model
  //       rotates out, etc.), fall back to models[0].id.
  //   (2) keep `useAiStore.modelTags` in lockstep with the
  //       selected model's capabilities so downstream consumers
  //       (chat-panel capability chips etc.) show correct caps.
  // Belt-and-suspenders ⚠️C-round-2: short-circuit when
  // selectedModel is undefined, AND prefer `models.find(...)` over
  // `models[0]` so a lead array element with a missing id doesn't
  // leak `undefined` into the store.
  useEffect(() => {
    if (
      models.length > 0 &&
      selectedModel &&
      !models.some((m) => m.id === selectedModel)
    ) {
      const fallback = models.find((m) => Boolean(m.id))
      if (fallback) setSelectedModel(fallback.id)
    }
  }, [models, selectedModel, setSelectedModel])

  useEffect(() => {
    const tags = models.find((m) => m.id === selectedModel)?.tags ?? ['text']
    setModelTags(tags)
  }, [models, selectedModel, setModelTags])

  // Belt-and-suspenders ⚠️C-round-2: normalize before splitting
  // so a future undefined write can't throw
  //   "Cannot read properties of undefined (reading 'split')"
  // — the same shape the user just hit on `AiSettingsHeader`
  // before the prop-name fix landed. Reviewed by reviewer-minimax.
  const safeModel = selectedModel ?? ''
  const tail = (safeModel.split('/').pop() || safeModel).replace(/:free$/i, '')
  const displayTail = tail
    ? tail.length > 18
      ? `${tail.slice(0, 16)}…`
      : tail
    : '—'

  return (
    <Select
      value={safeModel}
      onValueChange={setSelectedModel}
      disabled={isLoading}
    >
      <SelectTrigger
        className={cn(
          'h-8 min-w-0 max-w-[200px] shrink gap-1.5 rounded-full border-border/50',
          'bg-muted/40 px-3 text-[12px] font-medium text-foreground shadow-none',
          'hover:bg-muted/70 focus:ring-1 focus:ring-primary/20',
        )}
        aria-label="选择模型"
        data-testid="model-inline-picker"
      >
        <span className="truncate">
          {isLoading ? '加载模型…' : displayTail || '选择模型'}
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-72 min-w-[220px]">
        {models.map((m) => {
          const mTail = (m.id?.split('/').pop() || m.id || '').replace(/:free$/i, '')
          return (
            <SelectItem key={m.id} value={m.id} className="text-[12px]">
              <div className="flex items-center gap-1.5">
                <span className="truncate">{m.name || mTail}</span>
                {m.tags && m.tags.length > 0 && (
                  <span className="flex items-center gap-0.5 shrink-0">
                    {m.tags.map((tag) => {
                      const cfg = TAG_ICONS[tag]
                      if (!cfg) return null
                      const Icon = cfg.icon
                      return (
                        <span key={tag} className={`${cfg.color}`} title={cfg.label}>
                          <Icon className="h-2.5 w-2.5" />
                        </span>
                      )
                    })}
                  </span>
                )}
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

// Re-export `Label` is used by the legacy ModelSelector import chain —
// not used by this file directly, but kept as a barrel-compatible
// shape for AiAssistantPanel (which previously imported it from
// `@/components/AiSidebar/AiSidebar`).
export { Label as ModelPickerLabel } from '@/components/ui/label'
