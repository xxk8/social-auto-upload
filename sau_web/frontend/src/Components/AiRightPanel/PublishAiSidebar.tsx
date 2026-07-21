import type { RefObject } from 'react'
import { Suspense, useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  Image as ImageIcon,
  MessageSquare,
  Send,
  Loader2,
  Lock,
} from 'lucide-react'
import { Button } from '@/Components/ui/button'
import { Input } from '@/Components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/Components/ui/popover'
import { useToast } from '@/Components/ui/toast'
import { cn } from '@/lib/utils'
import { AiAssistantPanel } from '@/features/ai-assistant/AiAssistantPanel'
import {
  AiSettingsHeader,
  AiSettingsPopover,
  ModelInlinePicker,
} from '@/features/ai-assistant/AiSettingsPopover'
import { useAiStore } from '@/stores/useAiStore'
import { useAiConfig } from '@/hooks/useAiConfig'
import { shortModel } from '@/lib/ai/modelDisplay'
import { api } from '@/api/client'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import type { NormalizedImage } from '@/api/ai'
import { MaterialSection } from './MaterialSection'
import { useMaterialPanelStore } from '@/stores/materialPanelStore'
import { AiPaywallBanner } from './AiPaywallBanner'
import { TierBlockGate } from './TierBlockGate'
import { AiChatSkeleton } from './AiChatSkeleton'
import type { AiQuotaResponse } from './TierBlockGate'

interface PublishAiSidebarProps {
  mode: 'video' | 'note'
  platform?: string
  formRef: RefObject<FormHandle | null>
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

/**
 * Right-side AI assistant panel for the publish page.
 *
 * Two layout shapes (OPT-3F):
 *
 *   Full panel (`collapsed === false`):
 *   ┃ [Sparkles] AI 助手 · ai-status · model-picker [⚙] [×]
 *   ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┃
 *   ┃  AiAssistantPanel (chat + composer)     ┃
 *   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┃
 *
 *   Rail (`collapsed === true`):
 *   ┃               ┃
 *   ┃   ✨          ┃  ← brand + model name + status dot
 *   ┃  gpt-4o      ┃
 *   ┃    ●         ┃
 *   ┃               ┃
 *   ┃  [🖼️]       ┃  ← material image search (popover)
 *   ┃  [💬]        ┃  ← quick send (popover)
 *   ┃               ┃
 *   ┃  [◀]         ┃  ← expand button
 *   ┃               ┃
 */
export function PublishAiSidebar({
  mode,
  platform,
  formRef,
  collapsed = false,
  onToggleCollapsed,
}: PublishAiSidebarProps) {
  const selectedModel = useAiStore((s) => s.selectedModel)
  const { data: aiConfig, isLoading: configLoading } = useAiConfig()

  // round-AI-paywall-v1 (FIXED in v2): surface the paywall banner when
  // the user's tier is gated from the AI surface (`/api/usage/quota`
  // reports `required_tier: 'pro'` on the `ai_generate` quota entry
  // for free tier). Inline useQuery keeps `/api/usage/quota` calls
  // scoped to the sidebar mount — no global store needed for a
  // single-floor boolean. Skips retry on 401 so the auth-redirect
  // interceptor fires once on bad sessions instead of burning retries.
  //
  // v2 bugfix: `api.usage.quota()` is ALREADY unwrapped by client.ts
  // (`request.get(...).then((res) => res.data)`), so the previous
  // `return res?.data ?? null` pattern double-unwrapped and always
  // resolved to `null`, dropping the entire `data.quotas` payload.
  // The queryFn now returns the quota envelope directly so
  // `tierBlockQuery.data?.quotas?.ai_generate?.required_tier` is
  // actually populated for free-tier users in production.
  const tierBlockQuery = useQuery({
    queryKey: ['usage-quota', 'tier'],
    // Explicit return type so `tierBlockQuery.data?.quotas?
    // .ai_generate?.required_tier` is type-checked end-to-end
    // against TierBlockGate's `AiQuotaResponse` (no longer an
    // unparameterized AxiosResponse['data'] = `unknown`), and so
    // the silent queryFn-return-type inference cannot regress.
    queryFn: async (): Promise<AiQuotaResponse | null> => api.usage.quota(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      const status = (
        error as { response?: { status?: number } } | null
      )?.response?.status
      if (status === 401) return false
      return failureCount < 2
    },
  })
  const aiTierRequired =
    tierBlockQuery.data?.quotas?.ai_generate?.required_tier === 'pro' ? 'pro' : null

  if (collapsed) {
    return (
      <div
        className="flex h-full w-full flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/50 px-1.5 py-3 shadow-sm"
        data-state="collapsed"
        data-testid="publish-ai-sidebar"
      >
        {/* ── Brand + model + status ── */}
        <RailBrandSection
          selectedModel={selectedModel}
          configured={aiConfig?.configured ?? false}
        />

        {/* ── Action buttons (free tier shows paywall inside popovers) ── */}
        <RailActionsSection formRef={formRef} mode={mode} tierBlock={aiTierRequired} />

        {/* ── Expand button (bottom) ── */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapsed}
          aria-label="打开 AI 助手"
          aria-expanded={false}
          className="mt-auto h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  // Unified expanded-mode layout (round-AI-paywall-v2): the chat surface
  // is gated by <TierBlockGate> inside a <Suspense> boundary so a free
  // user never sees the chat composer flash before the paywall loads.
  // The header chrome swaps based on `aiTierRequired` post-fetch; only
  // the chat-area is what determines the visible flash.
  return (
    <div
      className="h-full flex flex-col rounded-xl border border-border/60 bg-card/50 shadow-sm"
      id="publish-ai-panel-region"
      data-state="expanded"
      data-tier-required={aiTierRequired === 'pro' ? 'pro' : undefined}
      data-testid="publish-ai-sidebar"
    >
      <div className="flex-shrink-0 flex items-center gap-2 px-4 h-11 border-b border-border/40">
        <div className="flex items-center gap-1.5 text-foreground shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[13px] font-semibold tracking-tight">AI 助手</span>
        </div>
        <span className="text-border/60" aria-hidden="true">·</span>

        {aiTierRequired === 'pro' ? (
          <>
            <span
              data-testid="publish-ai-sidebar-tier-badge"
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 h-5 text-[10px] font-medium uppercase tracking-wider text-primary"
            >
              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
              专业版功能
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              当前为免费版
            </span>
          </>
        ) : (
          <>
            <AiSettingsHeader
              configured={aiConfig?.configured ?? false}
              loading={configLoading}
            />
            <span className="text-border/60" aria-hidden="true">·</span>
            <ModelInlinePicker />
            <AiSettingsPopover />
          </>
        )}

        {onToggleCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapsed}
            aria-label="收起 AI 助手"
            aria-expanded={true}
            aria-controls="publish-ai-panel-region"
            className={cn(
              'h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0',
              aiTierRequired !== 'pro' && 'ml-auto',
            )}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div
        data-testid="publish-ai-chat-surface"
        data-gate-state={
          !tierBlockQuery.isFetched
            ? 'loading'
            : aiTierRequired === 'pro'
              ? 'paywall'
              : 'chat'
        }
        className="flex-1 min-h-0 flex flex-col px-4 py-4 overflow-hidden"
      >
        <Suspense fallback={<AiChatSkeleton />}>
          <TierBlockGate query={tierBlockQuery}>
            <AiAssistantPanel
              mode={mode}
              platform={platform}
              formRef={formRef}
              betweenViewportAndFooter={<MaterialSection formMode={mode} formRef={formRef} />}
            />
          </TierBlockGate>
        </Suspense>
      </div>
    </div>
  )
}

// ── Collapsed-rail helpers ──────────────────────────────────────────────

/** Sparkles + model name + config status dot */
function RailBrandSection({
  selectedModel,
  configured,
}: {
  selectedModel: string
  configured: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary',
          'select-none',
        )}
        aria-hidden="true"
      >
        <Sparkles className="h-4 w-4" />
      </div>
      <span
        className="text-[8px] font-mono leading-tight text-muted-foreground/70 text-center truncate max-w-[52px]"
        title={selectedModel}
      >
        {shortModel(selectedModel)}
      </span>
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          configured ? 'bg-emerald-500' : 'bg-muted-foreground/30',
        )}
        aria-label={configured ? 'AI 已配置' : 'AI 未配置'}
        title={configured ? 'AI 已配置' : 'AI 未配置'}
      />
    </div>
  )
}

/** Action buttons: image search + quick send (both in popovers). */
function RailActionsSection({
  formRef,
  mode,
  tierBlock,
}: {
  formRef: RefObject<FormHandle | null>
  mode: 'video' | 'note'
  /**
   * round-AI-paywall-v1: when `tierBlock === 'pro'`, both popovers
   * render the compact paywall banner instead of their interactive
   * forms so the button still feels present (intentional Teaser-Lock)
   * but the form fields stay gated behind a single upgrade CTA.
   */
  tierBlock?: 'pro' | null
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            aria-label={tierBlock === 'pro' ? '图片素材 (需升级)' : '图片素材'}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="left" align="center" className="w-72 p-3">
          {tierBlock === 'pro' ? (
            <AiPaywallBanner variant="compact" />
          ) : (
            <RailMaterialSearch formRef={formRef} mode={mode} />
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            aria-label={tierBlock === 'pro' ? '快捷发送 (需升级)' : '快捷发送'}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="left" align="center" className="w-72 p-3">
          {tierBlock === 'pro' ? (
            <AiPaywallBanner variant="compact" />
          ) : (
            <RailQuickSend formRef={formRef} />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Material image search popover — search + clickable 3×2 thumbnails */
function RailMaterialSearch({
  formRef,
  mode,
}: {
  formRef: RefObject<FormHandle | null>
  mode: 'video' | 'note'
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NormalizedImage[]>([])
  const [loading, setLoading] = useState(false)
  const { addToast } = useToast()
  const searchImages = useMaterialPanelStore((s) => s.searchImages)
  const addImageToForm = useMaterialPanelStore((s) => s.addImageToForm)

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed) return
    setLoading(true)
    await searchImages(trimmed)
    const store = useMaterialPanelStore.getState()
    setResults(store.imageResults)
    if (store.imageError) {
      addToast(store.imageError, 'error')
    }
    setLoading(false)
  }, [query, searchImages, addToast])

  const handleAdd = useCallback(
    async (img: NormalizedImage) => {
      const attempt = await addImageToForm(img, formRef, mode)
      if (attempt.applied) addToast('已添加到表单', 'success')
    },
    [formRef, mode, addImageToForm, addToast],
  )

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-muted-foreground">图片素材</p>
      <div className="flex gap-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="关键词搜索图片..."
          className="h-7 text-[11px]"
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
        />
        <Button
          size="sm"
          className="h-7 text-[11px] px-2 shrink-0"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '搜索'}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {results.slice(0, 6).map((img) => (
            <button
              key={img.id}
              type="button"
              className="aspect-square rounded overflow-hidden border border-border/60 hover:ring-1 hover:ring-primary transition-all"
              onClick={() => void handleAdd(img)}
              title={img.alt || '添加图片到表单'}
            >
              <img
                src={img.thumb}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {!loading && query.trim() && results.length === 0 && (
        <p className="text-[11px] text-muted-foreground/60 text-center py-2">无结果</p>
      )}
    </div>
  )
}

/** Quick send popover — textarea + send button */
function RailQuickSend({
  formRef,
}: {
  formRef: RefObject<FormHandle | null>
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const { addToast } = useToast()

  const handleSend = useCallback(async () => {
    const trimmed = message.trim()
    if (!trimmed) return
    setSending(true)
    try {
      const systemPrompt =
        '你是一个 AI 内容创作助手。根据用户指令直接生成内容，只返回结果不要解释。'
      let response = ''
      await api.generateMessagesStream(
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: trimmed },
          ],
          model: 'google/gemma-3-1b-it:free',
        },
        (chunk) => {
          response += chunk
        },
        (final) => {
          const result = (final || response).trim()
          if (result) {
            formRef.current?.applyAiResult({ title: result, desc: result, tags: [] })
            addToast('已应用 AI 结果', 'success')
          }
          setSending(false)
          setMessage('')
        },
        (err) => {
          addToast(err || '请求失败', 'error')
          setSending(false)
        },
      )
    } catch {
      setSending(false)
      addToast('请求失败', 'error')
    }
  }, [message, formRef, addToast])

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-muted-foreground">快捷指令</p>
      <textarea
        className="w-full min-h-[56px] rounded-md border border-input bg-transparent px-2 py-1.5 text-[13px] resize-none outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        placeholder="输入指令，如：优化标题、写简介..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void handleSend()
          }
        }}
      />
      <Button
        size="sm"
        className="w-full h-7 text-xs gap-1"
        onClick={() => void handleSend()}
        disabled={sending || !message.trim()}
      >
        {sending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Send className="h-3 w-3" />
        )}
        {sending ? '生成中...' : '发送'}
      </Button>
    </div>
  )
}
