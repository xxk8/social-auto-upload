import { useChatStore } from '@/stores/useChatStore'
import { AlertCircle } from 'lucide-react'

export function AssistantChat({ mode: _mode = 'video' }: { mode?: 'video' | 'note' } = {}) {
  // _mode reserved for future context-aware behavior
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const session = useChatStore((s) => (activeSessionId ? s.sessions[activeSessionId] : null))
  const messages = session?.messages || []
  const streamingDraft = useChatStore((s) => s.streamingDraft)
  const jobStatus = useChatStore((s) => s.jobStatus)
  const error = useChatStore((s) => s.error)
  const isStreaming = jobStatus === 'generating' && streamingDraft.length > 0

  return (
    <div className="flex flex-col h-full">
      {error && jobStatus === 'error' && (
        <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[11px] text-destructive flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 px-1">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300 ${
              m.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                m.role === 'user' ? 'bg-primary/15 border-primary/20' : 'bg-primary/10 border-primary/20'
              }`}
            >
              <span className="text-[10px] font-bold text-primary">{m.role === 'user' ? '你' : 'AI'}</span>
            </div>

            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                m.role === 'user'
                  ? 'bg-gradient-to-br from-primary to-primary/90 text-primary-foreground'
                  : 'bg-muted/80 border border-border/50'
              }`}
            >
              <div className={`text-[12px] leading-relaxed ${m.role === 'user' ? 'font-medium' : 'text-foreground/90'}`}>
                {m.content}
              </div>
            </div>
          </div>
        ))}

        {isStreaming && streamingDraft && (
          <div className="flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
              <span className="text-[10px] font-bold text-primary">AI</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="rounded-2xl rounded-tl-md bg-muted/80 border border-border/50 px-3.5 py-2.5 shadow-sm">
                <div className="text-[12px] leading-relaxed text-foreground/90">
                  {streamingDraft}
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-full bg-primary align-middle" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto pt-3 border-t">
        <div className="text-[10px] text-muted-foreground text-center">
          使用左侧输入区发送消息 · 已采用 assistant 风格
        </div>
      </div>
    </div>
  )
}