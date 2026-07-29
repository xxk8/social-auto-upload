import type { RefObject } from 'react'
import { Suspense, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  Lock,
  SquarePen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AiAssistantPanel } from '@/features/ai-assistant/AiAssistantPanel'
import { useAiStore } from '@/stores/useAiStore'
import { useAiConfig } from '@/hooks/useAiConfig'
import { shortModel } from '@/lib/ai/modelDisplay'
import { api } from '@/api/client'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import { SectionIcon } from '@/components/ui/section-header'
import { AiPaywallBanner } from './AiPaywallBanner'
import { TierBlockGate } from './TierBlockGate'
import { AiChatSkeleton } from './AiChatSkeleton'
import type { AiQuotaResponse } from './TierBlockGate'
import type { FormPreviewData } from '@/features/publish/previewTypes'
import type { PublishAiActions } from '@/features/ai-assistant/publishActions'
import { useChatStore } from '@/stores/useChatStore'

interface PublishAiSidebarProps {
  mode: 'video' | 'note'
  platform?: string
  formRef: RefObject<FormHandle | null>
  collapsed?: boolean
  onToggleCollapsed?: () => void
  /** Kept for API compat; preview lives on the form, not the chat pane. */
  previewData?: FormPreviewData
  publishActions?: PublishAiActions | null
}

/**
 * Pure chat sidebar — no material library / preview footer clutter.
 * Layout: header → messages → thinking → composer (tools in one row).
 */
export function PublishAiSidebar({
  mode,
  platform,
  formRef,
  collapsed = false,
  onToggleCollapsed,
  publishActions = null,
}: PublishAiSidebarProps) {
  const selectedModel = useAiStore((s) => s.selectedModel)
  const { data: aiConfig } = useAiConfig()

  const tierBlockQuery = useQuery({
    queryKey: ['usage-quota', 'tier'],
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

  const handleNewChat = useCallback(() => {
    const store = useChatStore.getState()
    if (store.activeSessionId) store.deleteSession(store.activeSessionId)
    store.newSession(mode, platform)
  }, [mode, platform])

  if (collapsed) {
    return (
      <div
        className="flex h-full w-full flex-col items-center gap-4 card-refined px-1.5 py-5"
        data-state="collapsed"
        data-testid="publish-ai-sidebar"
      >
        <div className="flex flex-col items-center gap-1.5">
          <SectionIcon size="lg"><Sparkles className="h-4 w-4" /></SectionIcon>
          <span className="max-w-[52px] truncate text-center text-[9px] text-muted-foreground/60">
            {shortModel(selectedModel, 8)}
          </span>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              aiConfig?.configured ? 'bg-emerald-500' : 'bg-muted-foreground/30',
            )}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapsed}
          aria-label="打开 AI 助手"
          className="mt-auto h-9 w-9 rounded-xl p-0 text-muted-foreground hover:text-primary hover:bg-primary/5"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden card-refined"
      id="publish-ai-panel-region"
      data-state="expanded"
      data-tier-required={aiTierRequired === 'pro' ? 'pro' : undefined}
      data-testid="publish-ai-sidebar"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/30 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SectionIcon size="sm"><Sparkles className="h-4 w-4" /></SectionIcon>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-tight text-foreground">
              SAU 助手
            </div>
            <div className="truncate text-[10px] text-muted-foreground/55">
              {aiTierRequired === 'pro' ? '专业版功能' : '写文案 · 自动填表 · 发命令'}
            </div>
          </div>
        </div>

        {aiTierRequired === 'pro' ? (
          <span
            data-testid="publish-ai-sidebar-tier-badge"
            className="inline-flex h-5 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary"
          >
            <Lock className="h-2.5 w-2.5" aria-hidden />
            Pro
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60"
            aria-label="新对话"
          >
            <SquarePen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">新对话</span>
          </Button>
        )}

        {onToggleCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapsed}
            aria-label="收起 AI 助手"
            className="h-8 w-8 shrink-0 rounded-lg p-0 text-muted-foreground hover:text-foreground hover:bg-muted/60"
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
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {aiTierRequired === 'pro' ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <AiPaywallBanner />
          </div>
        ) : (
          <Suspense fallback={<AiChatSkeleton />}>
            <TierBlockGate query={tierBlockQuery}>
              <AiAssistantPanel
                mode={mode}
                platform={platform}
                formRef={formRef}
                publishActions={publishActions}
              />
            </TierBlockGate>
          </Suspense>
        )}
      </div>
    </div>
  )
}
