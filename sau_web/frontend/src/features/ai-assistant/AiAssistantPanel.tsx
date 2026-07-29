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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useChatStore, getActiveMessages } from '@/stores/useChatStore'
import { useAiStore } from '@/stores/useAiStore'
import { useToast } from '@/components/ui/toast'
import { AiRuntimeProvider } from './AiRuntimeProvider'
import { useAiChat } from './useAiChat'
import { PlatformVariantBubble, labelFor } from './PlatformVariantBubble'
import { STREAMING_TAIL_ID } from './externalMessageConverter'
import { MagicSuggestions } from './MagicSuggestions'
import { PLATFORMS, NOTE_PLATFORMS } from '@/api/types'
import {
  buildMagicCommandMessage,
  MAGIC_HELP_TEXT,
  parseScheduleWhen,
  type MagicCommand,
} from './magicCommands'
import { parseTags } from '@/lib/tags'
import { safeApplyAiResult } from '@/lib/chat/chatFormBridge'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import type { PublishAiActions } from './publishActions'
import {
  findGroupByQuery,
  formatStatus,
  resolvePlatformIds,
  selectionFromGroup,
} from './publishActions'
import { clearActiveSkill, setActiveSkill } from './activeSkill'
import { findSkill, formatSkillsHelp } from './publishSkills'
import { SlashCommandMenu } from './SlashCommandMenu'
import {
  ComposerImageStrip,
  ComposerToolRow,
  ThinkingPanel,
} from './ComposerExtras'
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
   * Optional page-level actions (mode / group / submit) so slash commands
   * and natural language can drive the publish UI beyond title/desc/tags.
   */
  publishActions?: PublishAiActions | null
  /**
   * ai-sidebar-material-search §9 — slot for content that needs to
   * render BETWEEN the chat viewport and the composer.
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
  publishActions,
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
    onAutoApplied: (fields) => {
      const map: Record<string, string> = {
        title: '标题',
        desc: '描述',
        tags: '标签',
      }
      addToast(
        `已自动填表：${fields.map((f) => map[f] ?? f).join('、')}`,
        'success',
      )
    },
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

  const clearSession = useCallback(() => {
    const store = useChatStore.getState()
    if (store.activeSessionId) {
      store.deleteSession(store.activeSessionId)
    }
    clearActiveSkill()
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
      const sys = (content: string) =>
        appendSystemMessage(store, mode, platform, content)
      const actions = publishActions

      switch (command.kind) {
        case 'help':
          sys(MAGIC_HELP_TEXT)
          return
        case 'error':
          sys(buildMagicCommandMessage(command).content)
          return
        case 'fullflow':
          sys(buildMagicCommandMessage(command).content)
          try {
            await chat.runFullflow(command.topic)
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            sys(`❌ 一键全流程失败：${err instanceof Error ? err.message : '未知错误'}`)
          }
          return
        case 'variants': {
          sys(buildMagicCommandMessage(command).content)
          if (!command.topic.trim()) {
            sys('❌ /variants 需要主题，例如 /variants 美食探店')
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
            sys(`❌ /variants 失败：${err instanceof Error ? err.message : '未知错误'}`)
          }
          return
        }
        case 'enhance': {
          sys(buildMagicCommandMessage(command).content)
          try {
            await chat.enhance(command.text || '增强提示词')
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            sys(`❌ 提示词增强失败：${err instanceof Error ? err.message : '未知错误'}`)
          }
          return
        }
        case 'apply':
          sys('↩️ 已触发「应用上一次结果」')
          reapplyLastAssistant()
          return
        case 'clear':
          clearSession()
          sys('🧹 会话已清空（skill 也已卸下）')
          return
        case 'title': {
          const attempt = safeApplyAiResult(formRef, { title: command.text })
          sys(attempt.applied ? `✏️ 标题已写入：**${command.text}**` : '❌ 表单未挂载')
          if (attempt.applied) addToast('标题已更新', 'success')
          return
        }
        case 'desc': {
          const attempt = safeApplyAiResult(formRef, { desc: command.text })
          sys(attempt.applied ? '✏️ 描述已写入表单' : '❌ 表单未挂载')
          if (attempt.applied) addToast('描述已更新', 'success')
          return
        }
        case 'tags': {
          const attempt = safeApplyAiResult(formRef, {
            tags: parseTags(command.text),
          })
          sys(attempt.applied ? '🏷️ 标签 → ' + command.text : '❌ 表单未挂载')
          if (attempt.applied) addToast('标签已更新', 'success')
          return
        }
        case 'mode': {
          if (!actions) {
            sys('❌ 无法切换模式（页面未接入）')
            return
          }
          actions.setMode(command.mode)
          sys(`🔀 已切换到 **${command.mode === 'video' ? '视频' : '图文'}** 模式`)
          addToast(command.mode === 'video' ? '已切到视频' : '已切到图文', 'success')
          return
        }
        case 'group': {
          if (!actions) {
            sys('❌ 无法选分组（页面未接入）')
            return
          }
          const g = findGroupByQuery(actions.groups, command.query)
          if (!g) {
            sys(
              `❌ 未找到分组「${command.query}」\n可用：${actions.groups.map((x) => x.name).slice(0, 12).join('、') || '（无）'}`,
            )
            return
          }
          const sel = selectionFromGroup(g, actions.mode)
          if (!sel) {
            sys(`❌ 分组「${g.name}」在当前模式下没有可用平台授权`)
            return
          }
          actions.setSelection(sel)
          sys(`👥 已选择分组 **${g.name}**（${sel.platforms.join(', ')}）`)
          addToast(`已选择分组：${g.name}`, 'success')
          return
        }
        case 'platform': {
          if (!actions) {
            sys('❌ 无法筛平台（页面未接入）')
            return
          }
          const ids = resolvePlatformIds(command.raw)
          if (ids.length === 0) {
            sys(`❌ 无法识别平台：${command.raw}`)
            return
          }
          if (!actions.selection) {
            sys('❌ 请先 /group <名称> 选择分组，再筛平台')
            return
          }
          const g = actions.groups.find((x) => x.id === actions.selection!.groupId)
          if (!g) {
            sys('❌ 当前分组已失效，请重新选择')
            return
          }
          const sel = selectionFromGroup(g, actions.mode, ids)
          if (!sel) {
            sys(`❌ 分组内没有这些平台：${ids.join(', ')}`)
            return
          }
          actions.setSelection(sel)
          sys(`📱 平台已设为：${sel.platforms.join(', ')}`)
          addToast('平台已更新', 'success')
          return
        }
        case 'schedule': {
          const parsed = parseScheduleWhen(command.when)
          if (!parsed) {
            sys('❌ 无法解析时间。试试：`明天 18:00` / `now` / `2026-07-28 15:00`')
            return
          }
          const fn = formRef.current?.setSchedule
          if (!fn) {
            sys('❌ 表单不支持定时（未挂载）')
            return
          }
          fn(parsed)
          sys('⏰ 定时已设为 ' + parsed.replace('T', ' '))
          addToast('定时已更新', 'success')
          return
        }
        case 'status': {
          if (!actions) {
            const snap = formRef.current?.getFormSnapshot()
            sys(
              snap
                ? `标题：${snap.title || '（空）'}\n描述：${snap.desc || '（空）'}\n标签：${snap.tags?.join(', ') || '（空）'}`
                : '❌ 无法读取状态',
            )
            return
          }
          sys(formatStatus(actions))
          return
        }
        case 'publish': {
          const submit = formRef.current?.submit
          if (!submit) {
            sys('❌ 无法提交（表单未挂载）')
            return
          }
          sys('🚀 正在触发表单提交…')
          try {
            await Promise.resolve(submit())
          } catch (err) {
            sys(`❌ 提交失败：${err instanceof Error ? err.message : '未知错误'}`)
          }
          return
        }
        case 'skills':
          sys(formatSkillsHelp())
          return
        case 'skill': {
          if (/^(clear|none|off|清空|关闭)$/i.test(command.query)) {
            clearActiveSkill()
            sys('🧩 已卸下 skill')
            return
          }
          const skill = findSkill(command.query)
          if (!skill) {
            sys(`❌ 未找到 skill「${command.query}」\n\n${formatSkillsHelp()}`)
            return
          }
          setActiveSkill(skill.id, skill.systemPrompt)
          sys(
            '🧩 已加载 **' +
              skill.label +
              '** (' +
              skill.id +
              ')\n\n后续生成将遵循该 skill 规范。\n\n> ' +
              skill.description,
          )
          addToast(`Skill：${skill.label}`, 'success')
          return
        }
        default: {
          sys('❓ 未知命令，输入 /help 查看')
          return
        }
      }
    },
    [
      chat,
      clearSession,
      formRef,
      mode,
      platform,
      publishActions,
      reapplyLastAssistant,
      addToast,
    ],
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
              <div className="mx-3 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{chatError}</span>
              </div>
            )}

            <div className="px-3 py-3 space-y-3.5">
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

                  // User message — ChatGPT-like right bubble, no avatar clutter
                  if (m.role === 'user') {
                    return (
                      <div
                        key={m.id}
                        className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-200"
                      >
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground shadow-sm">
                          <div className="whitespace-pre-wrap break-words">{m.text}</div>
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
                      className="flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200"
                    >
                      <RoleAvatar role="assistant" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {m.appliedTo && m.appliedTo.length > 0 && (
                          <Badge variant="outline" className="h-4 border-green-200 px-1 text-[9px] text-green-700 dark:border-green-800 dark:text-green-400">
                            <CheckCheck className="mr-0.5 h-2.5 w-2.5" />
                            已应用
                          </Badge>
                        )}
                        <div className="rounded-2xl rounded-tl-md border border-border/40 bg-muted/40 px-3.5 py-2.5 text-[13.5px] leading-relaxed">
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

          {/* Live thinking / streaming panel (enhance + generate) */}
          <ThinkingPanel />

          {/* Optional extras (material search etc.) */}
          {betweenViewportAndFooter}

          {/*
            Doubao / ChatGPT-style composer:
              [  placeholder / input                     ]
              [ + | 一键生成 | 多平台 | Skill | 更多 | 模型  ⚙ | 发送 ]
          */}
          <ComposerPrimitive.Root
            className="flex-shrink-0 border-t border-border/30 bg-gradient-to-t from-background via-background/95 to-background/80 px-3 pb-3 pt-2"
            data-testid="ai-composer"
          >
            <SlashCommandMenu />
            <div
              className={cn(
                'rounded-[22px] border border-border/50 bg-background px-2.5 py-2 shadow-[0_2px_12px_-4px_oklch(0_0_0_/_0.08)]',
                'focus-within:border-primary/25 focus-within:shadow-[0_4px_20px_-6px_oklch(0.45_0.16_264_/_0.18)]',
                'transition-[border-color,box-shadow] duration-200',
              )}
            >
              <ComposerImageStrip />
              <div className="flex items-end gap-1.5">
                <ComposerPrimitive.Input
                  submitMode="enter"
                  rows={1}
                  placeholder="发消息，或输入 / 使用命令…"
                  className={cn(
                    'flex-1 resize-none bg-transparent px-1.5 py-2 text-[14px] leading-relaxed',
                    'placeholder:text-muted-foreground/45',
                    'focus-visible:outline-none',
                    'min-h-[40px] max-h-[160px]',
                  )}
                />
                {isRunning ? (
                  <ComposerPrimitive.Cancel
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/50 text-muted-foreground transition-colors hover:bg-muted"
                    data-testid="ai-stop"
                    aria-label="停止生成"
                  >
                    <StopCircle className="h-4 w-4" />
                  </ComposerPrimitive.Cancel>
                ) : (
                  <ComposerPrimitive.Send
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-35"
                    data-testid="ai-send"
                    aria-label="发送"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </ComposerPrimitive.Send>
                )}
              </div>
              {/* One toolbar row: + tools model settings */}
              <ComposerToolRow />
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
