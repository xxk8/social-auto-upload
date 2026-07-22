import { useMemo } from 'react'
import { Sparkles, Loader2, User, Bot, CheckCheck, AlertCircle, Wand2, Tags, PenLine, Zap, ArrowRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '@/stores/useChatStore'
import type { ChatMessage } from '@/lib/chat/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const MarkdownContent = ({ content }: { content: string }) => (
  <div className="prose prose-sm max-w-none dark:prose-invert [&_p]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-2 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-[11px] [&_pre]:text-[11px]">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  </div>
)

interface ChatAreaProps {
  /** Optional extra className for the scroll container. */
  className?: string
  /** Current mode for context-aware command suggestions */
  mode?: 'video' | 'note'
  /** Called when the user taps a quick-command chip. */
  onQuickCommand?: (prompt: string) => void
}

type OperationStatus = 'thinking' | 'analyzing' | 'generating' | 'filling' | 'done' | 'error'

interface OperationIndicator {
  status: OperationStatus
  step?: string
}

const QUICK_COMMANDS = [
  { id: 'generate', label: '生成文案', icon: Wand2, prompt: '请根据我的描述生成一份完整的发布文案' },
  { id: 'optimize', label: '优化表达', icon: PenLine, prompt: '请帮我优化文案的表达方式' },
  { id: 'tags', label: '添加标签', icon: Tags, prompt: '为我的内容生成一些热门标签' },
  { id: 'fullflow', label: '一键全流程', icon: Zap, prompt: '请帮我一键全流程：增强提示词、生成文案、自动填写表单' },
] as const

function getStatusIcon(status: OperationStatus) {
  switch (status) {
    case 'thinking': return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    case 'analyzing': return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
    case 'generating': return <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
    case 'filling': return <CheckCheck className="h-3.5 w-3.5 text-green-500" />
    case 'done': return <CheckCheck className="h-3.5 w-3.5 text-green-600" />
    case 'error': return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  }
}

function getStatusLabel(status: OperationStatus): string {
  switch (status) {
    case 'thinking': return '思考中...'
    case 'analyzing': return '分析上下文...'
    case 'generating': return '生成文案...'
    case 'filling': return '填写表单...'
    case 'done': return '完成'
    case 'error': return '出错'
  }
}

function getStatusColor(status: OperationStatus): string {
  switch (status) {
    case 'thinking': return 'bg-primary/10 text-primary border-primary/20'
    case 'analyzing': return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800'
    case 'generating': return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800'
    case 'filling': return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800'
    case 'done': return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800'
    case 'error': return 'bg-destructive/10 text-destructive border-destructive/20'
  }
}

/**
 * Read-only view of the current chat session + in-flight stream.
 *
 * Renders directly from `useChatStore` — no props other than styling.
 * Lives below the input / generate controls in the AI sidebar so users
 * can see their turns alongside the AI's drafts.
 *
 * Empty state: when there is no active session OR no messages yet, show
 * a single inviting hint. The user creates the first session implicitly
 * by clicking "一键生成" / "一键全流程".
 */
export function ChatArea({ className, mode, onQuickCommand }: ChatAreaProps) {
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const session = useChatStore((s) => (activeSessionId ? s.sessions[activeSessionId] : null))
  const messages = session?.messages
  const streamingDraft = useChatStore((s) => s.streamingDraft)
  const jobStatus = useChatStore((s) => s.jobStatus)
  const error = useChatStore((s) => s.error)

  const isStreaming = jobStatus === 'generating' && streamingDraft.length > 0

  const empty = useMemo(
    () => !messages || messages.length === 0,
    [messages],
  )

  // Derive current operation status for visualization
  const currentOperation: OperationIndicator | null = useMemo(() => {
    if (jobStatus === 'error') return { status: 'error' }
    if (isStreaming) {
      // Try to guess phase from last messages or always show generating
      return { status: 'generating', step: '正在生成文案...' }
    }
    // If last message is recent and streaming just ended, could still be "filling"
    return null
  }, [jobStatus, isStreaming])

  const handleQuickCommand = (prompt: string) => {
    onQuickCommand?.(prompt)
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {error && jobStatus === 'error' && (
        <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[11px] text-destructive flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{error}</span>
        </div>
      )}

      {/* Command suggestions - shown only when empty */}
      {empty && !isStreaming && (
        <div className="mb-3 space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>选择命令快速开始</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_COMMANDS.map((cmd) => (
              <TooltipProvider key={cmd.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto w-full flex-col items-center gap-1.5 px-3 py-2.5 text-[11px] border-dashed hover:border-solid hover:bg-primary/5 dark:hover:bg-primary/10 transition-all group"
                      onClick={() => handleQuickCommand(cmd.prompt)}
                    >
                      <cmd.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="font-medium">{cmd.label}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px] max-w-[200px]">
                    <p>{cmd.prompt}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      )}

      {/* Messages list */}
      <div className="flex-1 space-y-3">
        {messages?.map((m) => (
          <ChatBubble key={m.id} message={m} mode={mode} />
        ))}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="rounded-2xl rounded-tl-md bg-muted/80 border border-border/50 px-3.5 py-2.5 shadow-sm">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI 助手</span>
                  <span className="text-[9px] text-muted-foreground">正在输入</span>
                </div>
                <div className="text-[12px] leading-relaxed text-foreground/90">
                  <MarkdownContent content={streamingDraft} />
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-full bg-primary align-middle" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Operation thinking indicator */}
        {currentOperation && !isStreaming && (
          <div className={cn(
            "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[11px]",
            getStatusColor(currentOperation.status)
          )}>
            {getStatusIcon(currentOperation.status)}
            <span className="font-medium">{getStatusLabel(currentOperation.status)}</span>
            {currentOperation.step && (
              <span className="text-[10px] opacity-80">· {currentOperation.step}</span>
            )}
            <ArrowRight className="h-3 w-3 ml-auto animate-pulse" />
          </div>
        )}
      </div>
    </div>
  )
}

function ChatBubble({ message, mode }: { message: ChatMessage; mode?: 'video' | 'note' }) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center animate-in fade-in duration-300">
        <div className="rounded-full bg-muted/60 px-3 py-1.5 text-[10px] italic leading-relaxed text-muted-foreground border border-border/50">
          {message.content}
        </div>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex justify-end items-end gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-br from-primary to-primary/90 px-3.5 py-2.5 text-[12px] leading-relaxed text-primary-foreground shadow-md">
          <div className="whitespace-pre-wrap break-words font-medium">{message.content}</div>
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {message.attachments.map((att, i) => (
                <Badge key={i} variant="secondary" className="text-[9px] bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30">
                  {att.type.split('/')[1]?.toUpperCase() || 'FILE'}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/20">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="flex justify-start items-start gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="max-w-[85%] space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI 助手</span>
          {message.appliedTo && message.appliedTo.length > 0 && (
            <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-green-200 text-green-700 dark:border-green-800 dark:text-green-400">
              <CheckCheck className="h-2.5 w-2.5 mr-0.5" />
              已应用
            </Badge>
          )}
        </div>
        <div className="rounded-2xl rounded-tl-md bg-muted/80 border border-border/50 px-3.5 py-2.5 shadow-sm">
          <div className="text-[12px] leading-relaxed text-foreground/90">
            {isAssistant ? <MarkdownContent content={message.content} /> : message.content}
          </div>
          {message.appliedTo && message.appliedTo.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground border-t border-border/50 pt-2">
              <span>已应用到:</span>
              <div className="flex flex-wrap gap-1">
                {message.appliedTo.map((field) => (
                  <Badge key={field} variant="secondary" className="h-4 px-1.5 text-[9px]">
                    {field === 'title' ? '标题' : field === 'desc' ? (mode === 'video' ? '描述' : '内容') : '标签'}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}