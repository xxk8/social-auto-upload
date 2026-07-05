/**
 * Empty-state suggestion chips + inline quick-action bar.
 *
 * Uses assistant-ui's ThreadPrimitive.Suggestion primitive so chip clicks
 * route through the runtime's onNew → parseMagicCommand pipeline natively.
 * No manual onSend callback — the runtime owns the dispatch.
 *
 * MUST be rendered inside <ThreadPrimitive.Root> (the Suggestion primitive
 * reads thread context to send the prompt).
 */
/* eslint-disable react-refresh/only-export-components */
import { Sparkles, Zap, Palette, Edit3, RotateCcw, Trash2 } from 'lucide-react'
import { ThreadPrimitive } from '@assistant-ui/react'
import type { ThreadSuggestion } from '@assistant-ui/react'

/**
 * Build assistant-ui's suggestion-shape for the empty thread.
 * Kept for backward compat (barrel export + any callers that read
 * the shape directly).
 */
export function buildSuggestions(): ThreadSuggestion[] {
  return [
    { prompt: '/fullflow 生成一份美食探店的文案' },
    { prompt: '/variants' },
    { prompt: '/enhance 写一段短视频开场' },
    { prompt: '写一份小红书风格的种草文案' },
  ]
}

/**
 * Empty-state suggestion grid. Rendered inside <ThreadPrimitive.Empty>.
 * Chips use ThreadPrimitive.Suggestion → runtime onNew → parseMagicCommand.
 * No onSend prop — the framework routes clicks natively.
 */
export function MagicSuggestions() {
  const items: ReadonlyArray<{
    icon: typeof Sparkles
    label: string
    blurb: string
    prompt: string
  }> = [
    { icon: Zap, label: '一键全流程', blurb: '增强 → 生成 → 应用', prompt: '/fullflow' },
    { icon: Palette, label: '多平台变体', blurb: '各平台并行生成', prompt: '/variants' },
    { icon: Edit3, label: '优化表达', blurb: '只跑提示词优化', prompt: '/enhance' },
    { icon: Sparkles, label: '自由对话', blurb: '聊天式打磨', prompt: '写一份抖音短视频文案' },
  ]

  return (
    <div
      className="space-y-3 px-4 py-6 text-center animate-in fade-in slide-in-from-bottom-1 duration-300"
      data-testid="ai-suggestions"
    >
      <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono tabular-nums">
        <Sparkles className="h-3 w-3 text-primary" />
        <span>选一个动作开始</span>
      </div>
      <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <ThreadPrimitive.Suggestion
              key={item.label}
              prompt={item.prompt}
              send={true}
              className="flex h-auto flex-col items-start gap-0.5 rounded-md border border-dashed border-border/60 px-3 py-2.5 text-left text-[11px] transition-all hover:border-solid hover:bg-primary/5 dark:hover:bg-primary/10 group"
            >
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                {item.label}
              </span>
              <span className="text-[10px] text-muted-foreground font-normal leading-snug">
                {item.blurb}
              </span>
            </ThreadPrimitive.Suggestion>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Inline quick-action bar — always visible above the composer.
 * Chinese action buttons replacing the old `/fullflow /variants ...`
 * developer-style slash-command bar. Clicks route through
 * ThreadPrimitive.Suggestion → runtime onNew → parseMagicCommand.
 *
 * MUST be rendered inside <ThreadPrimitive.Root>.
 */
export function InlineMagicBar() {
  const items: ReadonlyArray<{
    icon: typeof Sparkles
    label: string
    prompt: string
  }> = [
    { icon: Zap, label: '一键生成', prompt: '/fullflow' },
    { icon: Palette, label: '多平台变体', prompt: '/variants' },
    { icon: Edit3, label: '优化表达', prompt: '/enhance' },
    { icon: RotateCcw, label: '应用上次', prompt: '/apply' },
    { icon: Trash2, label: '清空', prompt: '/clear' },
  ]

  return (
    <div
      className="flex flex-wrap gap-1 px-3 py-2 border-t border-border/40 bg-muted/20"
      data-testid="ai-inline-magic-bar"
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <ThreadPrimitive.Suggestion
            key={item.label}
            prompt={item.prompt}
            send={true}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Icon className="h-3 w-3" />
            {item.label}
          </ThreadPrimitive.Suggestion>
        )
      })}
    </div>
  )
}
