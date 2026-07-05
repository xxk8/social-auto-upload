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
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/Components/ui/button'
import { Input } from '@/Components/ui/input'
import { Textarea } from '@/Components/ui/textarea'
import { Badge } from '@/Components/ui/badge'
import { Alert, AlertDescription } from '@/Components/ui/alert'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/Components/ui/popover'
import { useToast } from '@/Components/ui/toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/Components/ui/select'
import { cn } from '@/lib/utils'
import { api } from '@/api/client'
import { useAiConfig, useAiKeys, useSetAiConfig, useDeleteAiConfig } from '@/hooks/useAiConfig'
import { useAiModels } from '@/hooks/useAiGeneration'
import { useAiStore } from '@/stores/useAiStore'

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
  /** The currently selected model id (used for the model chip). */
  selectedModel: string
  /** "Is the AI service configured?" — rendered as a status dot. */
  configured: boolean
  /** "Initial fetch still in flight?" — shows shimmer gate. */
  loading: boolean
}

export function AiSettingsHeader({ selectedModel, configured, loading }: AiSettingsHeaderProps) {
  // Belt-and-suspenders (reviewer ⚠️C-round-2): the prop-name fix
  // on AiAssistantPanel resolves the original symptom, but make
  // this component survive a future regression where the prop
  // drops to undefined — normalize before splitting.
  const safeModel = selectedModel ?? ''
  const tail = safeModel.split('/').pop() || safeModel
  const displayTail = tail.length > 26 ? `${tail.slice(0, 24)}…` : tail
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
      {loading ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>加载中</span>
        </>
      ) : (
        <span className="truncate max-w-[120px]" title={selectedModel}>
          {displayTail || '未选择模型'}
        </span>
      )}
      <Badge
        variant="outline"
        className={cn(
          'h-4 shrink-0 px-1 text-[9px] tabular-nums',
          configured ? 'border-green-200 text-green-700 dark:border-green-800 dark:text-green-400' : 'border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-400',
        )}
      >
        {configured ? '已配置' : '未配置'}
      </Badge>
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
  const [dismissRateLimit, setDismissRateLimit] = useState(false)
  /** When non-null, the popover is in "delete confirmation" mode. */
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'all' } | { type: 'single'; id: number; masked: string } | null>(null)

  const { data: aiConfig, isLoading: configLoading } = useAiConfig()
  const { data: aiKeys, isLoading: keysLoading, refetch: refetchKeys } = useAiKeys()
  const setKeyMutation = useSetAiConfig()
  const deleteKeyMutation = useDeleteAiConfig()
  const { addToast } = useToast()

  const loading = configLoading || keysLoading
  const configured = aiConfig?.configured ?? false
  const safeKeys: AiKey[] = Array.isArray(aiKeys) ? aiKeys : []
  const rateLimited = safeKeys.filter((k) => k.rate_limited)

  const handleSaveSingle = async () => {
    if (!keyInput.trim()) return
    try {
      const res = await setKeyMutation.mutateAsync(keyInput.trim())
      if (res.success) {
        addToast('API Key 已添加', 'success')
        setKeyInput('')
        setShowInput(false)
      } else {
        addToast(res.message || '保存失败', 'error')
      }
    } catch {
      addToast('保存失败', 'error')
    }
  }

  const handleBatchImport = async () => {
    const lines = batchInput.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    setBatchBusy(true)
    try {
      const res = await api.batchAddKeys(lines)
      if (res.success) {
        const { added, skipped } = res.data!
        addToast(`批量导入完成：新增 ${added} 个，跳过 ${skipped} 个`, 'success')
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
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
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

            {/* ── Menu entries — mutually exclusive modes ── */}
            {!showInput && !showBatch && !showList && !deleteTarget && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowInput(true); setShowBatch(false); setShowList(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted focus-visible:bg-muted focus-visible:outline-none transition-colors text-left"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="flex-1">{configured ? '添加 Key' : '设置 Key'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowBatch(true); setShowInput(false); setShowList(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted focus-visible:bg-muted focus-visible:outline-none transition-colors text-left"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span className="flex-1">批量导入</span>
                </button>
                {configured && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setShowList(!showList); setShowInput(false); setShowBatch(false) }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted focus-visible:bg-muted focus-visible:outline-none transition-colors text-left"
                  >
                    {showList ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span className="flex-1">查看 Key 列表</span>
                    <Badge variant="outline" className="ml-auto h-4 px-1 text-[9px]">{safeKeys.length}</Badge>
                  </button>
                )}
                {configured && (
                  <>
                    <div className="my-1 h-px bg-border/60" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setDeleteTarget({ type: 'all' })}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded text-destructive hover:bg-destructive/10 transition-colors text-left"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="flex-1">删除全部 Key</span>
                    </button>
                  </>
                )}
              </>
            )}

            {showInput && (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      placeholder="sk-or-v1-xxxxxxxxxxxxxxxx"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
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
                  <Button size="sm" className="h-7 w-7 p-0" onClick={() => void handleSaveSingle()} disabled={setKeyMutation.isPending}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowInput(false); setKeyInput('') }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  从 <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" className="font-medium underline underline-offset-2 hover:text-primary">openrouter.ai/keys</a> 免费获取
                </p>
              </div>
            )}

            {showBatch && (
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
                    {batchBusy ? '导入中…' : '导入'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setShowBatch(false); setBatchInput('') }}>
                    取消
                  </Button>
                  <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                    {batchInput.split(/[\n,]+/).filter((l) => l.trim()).length} 个
                  </span>
                </div>
              </div>
            )}

            {showList && configured && safeKeys.length > 0 && (
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover/keyrow:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`删除 Key #${idx + 1}`}
                      onClick={() => setDeleteTarget({ type: 'single', id: k.id, masked: k.masked })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
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
  const { data: aiConfig, isLoading: loading } = useAiConfig()
  const { data: aiKeys } = useAiKeys()
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
 * `@/Components/AiSidebar/ModelSelector`: NO `AI 模型` label, NO
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
  const tail = safeModel.split('/').pop() || safeModel
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
        className="h-7 px-2 text-[11px] font-mono tabular-nums gap-1 border-border/60 bg-transparent hover:bg-muted/30 min-w-0 shrink"
        aria-label="选择模型"
        data-testid="model-inline-picker"
      >
        <SelectValue placeholder={isLoading ? '加载中…' : displayTail} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {models.map((m) => {
          const mTail = m.id?.split('/').pop() || m.id || ''
          return (
            <SelectItem key={m.id} value={m.id} className="text-[11px]">
              <span className="truncate font-mono">{mTail}</span>
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
// `@/Components/AiSidebar/AiSidebar`).
export { Label as ModelPickerLabel } from '@/Components/ui/label'
