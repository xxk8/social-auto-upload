/* eslint-disable react-refresh/only-export-components */
/**
 * AI Assistant Panel — assistant-ui primitive-driven chat surface.
 *
 * Uses ThreadPrimitive + ComposerPrimitive from @assistant-ui/react so
 * keyboard interaction (Enter-to-send / Shift+Enter-newline), auto-scroll,
 * and the composer state are framework-managed. The panel owns:
 *   - AiRuntimeProvider (bridges useChatStore + Flask SSE → assistant-ui)
 *   - dispatchMagic (slash-command routing)
 *   - message rendering (PlatformVariantBubble for /variants, custom
 *     bubbles for regular turns, apply-to-form action bar)
 *
 * Layout (after the OPT-3F flatten pass):
 *   ┌──────────────────────────────────────────────────┐
 *   │   [empty: MagicSuggestions]                       │
 *   │   AI · 标题：xxx ...           [Copy] [应用到表单] │  ← messages
 *   │   你 · 关于美食探店...                             │
 *   ├──────────────────────────────────────────────────┤
 *   │ [一键生成] [多平台变体] [优化表达] [应用上次] [清空] │  ← inline magic bar (Chinese)
 *   ├──────────────────────────────────────────────────┤
 *   │ <textarea>                          [发送] / [取消] │  ← composer (native Enter-send)
 *   └──────────────────────────────────────────────────┘
 *
 * The brand chip + model pill + settings popover live in the outer
 * PublishAiSidebar header (P0 flatten pass). This panel only owns
 * the chat surface — viewport, messages, magic bar, composer.
 */
import { useCallback } from 'react'
import { Copy, CheckCheck, AlertCircle, SendHorizontal, StopCircle } from 'lucide-react'
import { ThreadPrimitive, ComposerPrimitive } from '@assistant-ui/react'
import { Button } from '@/Components/ui/button'
import { Badge } from '@/Components/ui/badge'
import { cn } from '@/lib/utils'
import { useChatStore, getActiveMessages } from '@/stores/useChatStore'
import { useAiStore } from '@/stores/useAiStore'
import { useToast } from '@/Components/ui/toast'
import { AiRuntimeProvider } from './AiRuntimeProvider'
import { useAiChat } from './useAiChat'
import { PlatformVariantBubble, labelFor } from './PlatformVariantBubble'
import { STREAMING_TAIL_ID } from './externalMessageConverter'
import { MagicSuggestions, InlineMagicBar } from './MagicSuggestions'
import { PLATFORMS, NOTE_PLATFORMS } from '@/api/types'
import {
  buildMagicCommandMessage,
  MAGIC_HELP_TEXT,
  type MagicCommand,
} from './magicCommands'
import { parseTags } from '@/lib/tags'
import { safeApplyAiResult } from '@/lib/chat/chatFormBridge'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import type { ChatMessage } from '@/lib/chat/types'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AiAssistantPanelProps {
  formRef: React.MutableRefObject<FormHandle | null>
  mode: 'video' | 'note'
  platform?: string
  footerExtras?: ReactNode
  /**
   * ai-sidebar-material-search §9 — slot for content that needs to
   * render BETWEEN the chat viewport and the composer. Default null
   * (legacy layout). PublishAiSidebar passes `<MaterialSection />`
   * here so the spec §"viewport → material → composer" order is
   * preserved without restructuring the AiRuntimeProvider tree.
   *
   * Invariant: the slot inherits `flex-shrink-0` so the chat viewport
   * keeps `flex-1 min-h-0` and yields space when the accordion item
   * expands (max-image=380px / max-link=240px; chat viewport's
   * `min-h-[240px]` is enforced by MaterialSection internally).
   */
  betweenViewportAndFooter?: ReactNode
}

// ── Exported helpers (consumed by PlatformVariantBubble + useAiChat) ──

export function parseAssistantResult(text: string): { title: string; desc: string; tags: string } {
  const titleMatch = text.match(/^标题[：:]\s*(.+)/m)
  const descMatch = text.match(/^描述[：:]\s*([\s\S]+?)(?=^标签[：:]|$)/m)
  const contentMatch = text.match(/^内容[：:]\s*([\s\S]+?)(?=^标签[：:]|$)/m)
  const tagsMatch = text.match(/^标签[：:]\s*(.+)/m)
  return {
    title: titleMatch?.[1]?.trim() ?? '',
    desc: (descMatch?.[1] ?? contentMatch?.[1] ?? '').trim(),
    tags: tagsMatch?.[1]?.trim() ?? '',
  }
}

// ── Internal helpers ──

/**
 * Extract plain text from a ThreadMessageLike content (string or
 * part-array). Our converter always emits `[{ type: 'text', text }]`,
 * so this is a simple find.
 */
/** Narrower type for ThreadMessageLike content parts. */
type ContentPart = { type: string; text?: string }

function extractText(content: string | readonly ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.find((p) => p.type === 'text')?.text ?? ''
}

/**
 * Structural read of a render-prop message — extracts the fields the
 * MessageRow needs without importing the internal MessageState type.
 */
function readMessage(msg: {
  id?: string
  role: string
  content: string | readonly ContentPart[]
  metadata?: { custom?: Record<string, unknown> } | undefined
}) {
  const text = extractText(msg.content)
  const custom = msg.metadata?.custom ?? {}
  return {
    id: msg.id ?? '',
    role: msg.role as ChatMessage['role'],
    text,
    platform: custom.platform as string | undefined,
    parseError: custom.parseError as boolean | undefined,
    appliedTo: custom.appliedTo as string[] | undefined,
  }
}

/**
 * Push a system-breadcrumb message into the active session. Lazily
 * creates a session if needed.
 */
function appendSystemMessage(
  store: ReturnType<typeof useChatStore.getState>,
  mode: 'video' | 'note',
  platform: string | undefined,
  content: string,
): string {
  let sid = store.activeSessionId
  if (!sid || !store.sessions[sid]) {
    sid = store.newSession(mode, platform)
  }
  store.appendSystemMessage(sid, content)
  return sid
}

// ── Component ──

export function AiAssistantPanel({
  formRef,
  mode,
  platform,
  footerExtras,
  betweenViewportAndFooter,
}: AiAssistantPanelProps) {
  const { addToast } = useToast()
  const selectedModel = useAiStore((s) => s.selectedModel)

  const chat = useAiChat({
    formRef,
    mode,
    platform,
    model: selectedModel,
    parseResponse: parseAssistantResult,
  })

  // ── Store subscriptions (for empty-state + error display) ──
  const activeMessageCount = useChatStore((s) => {
    const sid = s.activeSessionId
    if (!sid || !s.sessions[sid]) return 0
    return getActiveMessages(s.sessions[sid]!).length
  })
  const streamingDraft = useChatStore((s) => s.streamingDraft)
  const jobStatus = useChatStore((s) => s.jobStatus)
  const chatError = useChatStore((s) => s.error)
  const isRunning = jobStatus === 'generating' || jobStatus === 'enhancing'
  const showEmpty = activeMessageCount === 0 && !streamingDraft && !isRunning

  // ── Magic command dispatcher (unchanged from original) ──

  const clearSession = useCallback(() => {
    const store = useChatStore.getState()
    if (store.activeSessionId) {
      store.deleteSession(store.activeSessionId)
    }
    store.newSession(mode, platform)
  }, [mode, platform])

  const reapplyLastAssistant = useCallback(() => {
    const store = useChatStore.getState()
    const sid = store.activeSessionId
    if (!sid) return
    const active = getActiveMessages(store.sessions[sid] ?? null)
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].role === 'assistant') {
        const parsed = parseAssistantResult(active[i].content)
        const attempt = safeApplyAiResult(formRef, {
          title: parsed.title || undefined,
          desc: parsed.desc || undefined,
          tags: parsed.tags ? parseTags(parsed.tags) : undefined,
        })
        if (attempt.applied) {
          addToast('已应用上一次结果', 'success')
        } else {
          addToast('应用失败：表单未挂载', 'error')
        }
        return
      }
    }
    addToast('没有可应用的历史回复', 'warning')
  }, [formRef, addToast])

  const dispatchMagic = useCallback(
    async (command: MagicCommand) => {
      const store = useChatStore.getState()
      switch (command.kind) {
        case 'help':
          appendSystemMessage(store, mode, platform, MAGIC_HELP_TEXT)
          return
        case 'error':
          appendSystemMessage(
            store,
            mode,
            platform,
            buildMagicCommandMessage(command).content,
          )
          return
        case 'fullflow':
          appendSystemMessage(store, mode, platform, buildMagicCommandMessage(command).content)
          try {
            await chat.runFullflow(command.topic)
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            appendSystemMessage(
              store,
              mode,
              platform,
              `❌ 一键全流程失败：${err instanceof Error ? err.message : '未知错误'}`,
            )
          }
          return
        case 'variants': {
          appendSystemMessage(store, mode, platform, buildMagicCommandMessage(command).content)
          if (!command.topic.trim()) {
            appendSystemMessage(
              store,
              mode,
              platform,
              '❌ /variants 需要一个主题文本（例如 `/variants 美食探店`）',
            )
            return
          }
          const platformsList =
            mode === 'video'
              ? PLATFORMS.map((p) => p.value)
              : NOTE_PLATFORMS.map((p) => p.value)
          try {
            await chat.generateVariants(command.topic, platformsList, command.search)
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            appendSystemMessage(
              store,
              mode,
              platform,
              `❌ /variants 失败：${err instanceof Error ? err.message : '未知错误'}`,
            )
          }
          return
        }
        case 'enhance': {
          appendSystemMessage(store, mode, platform, buildMagicCommandMessage(command).content)
          try {
            await chat.enhance(command.text || '增强提示词')
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            appendSystemMessage(
              store,
              mode,
              platform,
              `❌ 提示词增强失败：${err instanceof Error ? err.message : '未知错误'}`,
            )
          }
          return
        }
        case 'apply':
          appendSystemMessage(store, mode, platform, '↩️ 已触发「应用上一次结果」')
          reapplyLastAssistant()
          return
        case 'clear':
          clearSession()
          appendSystemMessage(store, mode, platform, '🧹 会话已清空')
          return
        default: {
          const _: never = command
          void _
          appendSystemMessage(store, mode, platform, '❓ 未知的 /magic 命令')
          return
        }
      }
    },
    [appendSystemMessage, clearSession, chat, formRef, mode, platform, reapplyLastAssistant],
  )

  // ── Apply-to-form handler for regular assistant messages ──
  const handleApplyToForm = useCallback(
    (text: string) => {
      const parsed = parseAssistantResult(text)
      const hasContent = parsed.title || parsed.desc || parsed.tags
      if (!hasContent) {
        addToast('这条消息没有可应用的标题/描述/标签', 'warning')
        return
      }
      const attempt = safeApplyAiResult(formRef, {
        title: parsed.title || undefined,
        desc: parsed.desc || undefined,
        tags: parsed.tags ? parseTags(parsed.tags) : undefined,
      })
      addToast(attempt.applied ? '已应用到表单' : '表单未挂载', attempt.applied ? 'success' : 'error')
    },
    [formRef, addToast],
  )

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text)
  }, [])

  // ── Platform-variant apply handler ──
  const handleVariantApply = useCallback(
    (parsed: { title?: string; desc?: string; tags?: string[] }, platformId?: string) => {
      const attempt = safeApplyAiResult(formRef, {
        title: parsed.title || undefined,
        desc: parsed.desc || undefined,
        tags: parsed.tags && parsed.tags.length > 0 ? parsed.tags : undefined,
      })
      const platformLabel = platformId ? labelFor(platformId) : ''
      addToast(
        attempt.applied
          ? `已应用到表单（${platformLabel}）`
          : '应用失败：表单未挂载',
        attempt.applied ? 'success' : 'error',
      )
    },
    [formRef, addToast],
  )

  // ── Render ──
  return (
    <AiRuntimeProvider chatActions={chat} dispatchMagic={dispatchMagic}>
      {() => (
        <ThreadPrimitive.Root
          className="flex flex-1 min-h-0 flex-col"
          data-testid="ai-assistant-panel"
        >
          {/* ── Scrollable message area ────────────────────── */}
          <ThreadPrimitive.Viewport
            className="flex-1 min-h-0 overflow-y-auto"
            autoScroll
            data-testid="ai-messages-scroll"
          >
            {showEmpty && <MagicSuggestions />}

            {/* Inline error banner */}
            {!isRunning && chatError && (
              <div className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{chatError}</span>
              </div>
            )}

            <div className="px-4 py-3 space-y-3">
              <ThreadPrimitive.Messages>
                {({ message }) => {
                  const m = readMessage(message)

                  // Platform-variant bubble (from /variants)
                  if (m.platform) {
                    const chatMsg: ChatMessage = {
                      id: m.id,
                      role: 'assistant',
                      content: m.text,
                      createdAt: message.createdAt?.getTime() ?? Date.now(),
                      platform: m.platform,
                      parseError: m.parseError,
                      appliedTo: m.appliedTo,
                    }
                    return (
                      <PlatformVariantBubble
                        key={m.id}
                        message={chatMsg}
                        onApply={(parsed) => handleVariantApply(parsed, m.platform)}
                      />
                    )
                  }

                  // System message (magic command breadcrumbs, errors)
                  if (m.role === 'system') {
                    return (
                      <div
                        key={m.id}
                        className="flex justify-center animate-in fade-in duration-300"
                      >
                        <div className="max-w-[90%] rounded-md bg-muted/40 border border-border/40 px-3 py-2 text-[12px] leading-relaxed text-foreground">
                          <ChatMarkdown content={m.text} />
                        </div>
                      </div>
                    )
                  }

                  // User message
                  if (m.role === 'user') {
                    return (
                      <div
                        key={m.id}
                        className="flex gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200 flex-row-reverse"
                      >
                        <RoleAvatar role="user" />
                        <div className="max-w-[85%]">
                          <div className="text-[10px] font-mono text-muted-foreground/80 mb-1 tracking-wider text-right">
                            你
                          </div>
                          <div className="rounded-2xl rounded-br-sm bg-gradient-to-br from-primary to-primary/90 px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground shadow-sm">
                            <div className="whitespace-pre-wrap break-words">{m.text}</div>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  // Assistant message (regular chat / fullflow / enhance)
                  const parsed = parseAssistantResult(m.text)
                  const hasParsed = !!(parsed.title || parsed.desc || parsed.tags)
                  // Detect the streaming tail by its reserved id —
                  // ThreadPrimitive.Messages render-prop gives ThreadMessageLike
                  // which has no `isLast` field, so we can't rely on that.
                  const isStreaming = isRunning && m.id === STREAMING_TAIL_ID
                  return (
                    <div
                      key={m.id}
                      className="flex gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200"
                    >
                      <RoleAvatar role="assistant" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
                            {isStreaming ? 'AI · generating' : 'AI'}
                          </span>
                          {m.appliedTo && m.appliedTo.length > 0 && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px] border-green-200 text-green-700 dark:border-green-800 dark:text-green-400">
                              <CheckCheck className="h-2.5 w-2.5 mr-0.5" />
                              已应用
                            </Badge>
                          )}
                        </div>
                        <div className="rounded-2xl rounded-tl-md bg-muted/60 border border-border/40 px-3.5 py-2 text-[13px] leading-relaxed">
                          <ChatMarkdown content={m.text} />
                          {isStreaming && (
                            <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-full bg-primary align-middle" />
                          )}
                        </div>
                        {/* Parsed fields preview */}
                        {hasParsed && (
                          <div className="mt-1.5 text-[11px] grid gap-0.5 pl-1">
                            {parsed.title && (
                              <div className="text-muted-foreground inline-flex items-baseline gap-1">
                                <Badge variant="outline" className="text-[9px] h-4 px-1">标题</Badge>
                                <span className="text-foreground/85 truncate">{parsed.title}</span>
                              </div>
                            )}
                            {parsed.desc && (
                              <div className="text-muted-foreground inline-flex items-baseline gap-1">
                                <Badge variant="outline" className="text-[9px] h-4 px-1">描述</Badge>
                                <span className="text-foreground/85 truncate">
                                  {parsed.desc.length > 80 ? `${parsed.desc.slice(0, 80)}…` : parsed.desc}
                                </span>
                              </div>
                            )}
                            {parsed.tags && (
                              <div className="text-muted-foreground inline-flex items-baseline gap-1">
                                <Badge variant="outline" className="text-[9px] h-4 px-1">标签</Badge>
                                <span className="text-foreground/85 truncate font-mono">{parsed.tags}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {/* Action bar: copy + apply-to-form */}
                        {!isStreaming && hasParsed && (
                          <div className="mt-1.5 flex items-center gap-1.5 pl-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleApplyToForm(m.text)}
                              className="h-6 px-2 text-[10px] gap-1 text-primary"
                            >
                              <CheckCheck className="h-3 w-3" />
                              应用到表单
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopy(m.text)}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                              aria-label="复制"
                              title="复制内容"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }}
              </ThreadPrimitive.Messages>
            </div>
          </ThreadPrimitive.Viewport>

          {/* ── Inline magic bar (Chinese action buttons) ─── */}
          <InlineMagicBar />

          {/* ── ai-sidebar-material-search §9 slot ── */}
          {/* Renders between the inline magic bar and the composer
              so the user has material-search affordances directly
              above the composer (composer still anchored at bottom).
              MaterialSection manages its own internal max-height so
              chat viewport keeps ≥ 240px when expanded. */}
          {betweenViewportAndFooter}

          {/* ── Composer (native Enter-to-send) ───────────── */}
          <ComposerPrimitive.Root
            className="flex-shrink-0 border-t border-border/60 p-3"
            data-testid="ai-composer"
          >
            <div className="flex items-end gap-2">
              <ComposerPrimitive.Input
                submitMode="enter"
                rows={2}
                placeholder="输入你的需求，回车发送（输入 / 查看快捷命令）"
                className={cn(
                  'flex-1 resize-none rounded-md border border-border/60 bg-transparent px-3 py-2 text-[13px] leading-relaxed',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30',
                  'min-h-[60px] max-h-[160px]',
                )}
              />
              {isRunning ? (
                <ComposerPrimitive.Cancel
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-border/60 px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/60"
                  data-testid="ai-stop"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  取消
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send
                  className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  data-testid="ai-send"
                >
                  <SendHorizontal className="h-3.5 w-3.5" />
                  发送
                </ComposerPrimitive.Send>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground/80 font-mono">
              <span>回车发送 · Shift+回车换行 · 输入 / 用快捷命令</span>
            </div>
            {footerExtras}
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      )}
    </AiRuntimeProvider>
  )
}

// ── Internal rendering helpers ──

function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-1.5 [&_code]:text-[11px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function RoleAvatar({ role }: { role: 'user' | 'assistant' | 'system' }) {
  const classes = (() => {
    switch (role) {
      case 'user':
        return 'bg-primary/15 border-primary/30 text-primary'
      case 'assistant':
        return 'bg-primary/10 border-primary/20 text-primary'
      default:
        return 'bg-muted border-border text-muted-foreground'
    }
  })()
  const label = role === 'user' ? '你' : role === 'assistant' ? 'AI' : 'sys'
  return (
    <div className={cn(
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold',
      classes,
    )} aria-hidden>
      {label}
    </div>
  )
}
