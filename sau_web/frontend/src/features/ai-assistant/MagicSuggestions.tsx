/**
 * Empty-state — short, useful starters (no slash-command spam).
 */
/* eslint-disable react-refresh/only-export-components */
import { SectionIcon } from '@/components/ui/section-header'
import { Sparkles, FileText, Feather, RefreshCw, Share2 } from 'lucide-react'
import { ThreadPrimitive } from '@assistant-ui/react'
import type { ThreadSuggestion } from '@assistant-ui/react'

export function buildSuggestions(): ThreadSuggestion[] {
  return NATURAL_PROMPTS.map((p) => ({ prompt: p.prompt }))
}

const NATURAL_PROMPTS: ReadonlyArray<{
  label: string
  hint: string
  prompt: string
  icon: typeof Sparkles
}> = [
  {
    label: '写完整发布文案',
    hint: '标题 + 描述 + 标签，自动填表',
    icon: FileText,
    prompt:
      '根据左侧表单（若为空请自拟「周末探店」主题），写一版适合短视频发布的文案。要求：标题抓人、描述口语有转化、标签 4-6 个。严格输出：\n标题：…\n描述：…\n标签：…',
  },
  {
    label: '小红书种草风',
    hint: '真诚分点 · 不硬广',
    icon: Feather,
    prompt:
      '用小红书种草风格写图文文案，主题周末探店。标题带情绪，正文分 3 点，标签含场景词。严格输出：\n标题：…\n描述：…\n标签：…',
  },
  {
    label: '优化现有内容',
    hint: '基于表单已有字段改写',
    icon: RefreshCw,
    prompt:
      '请读取表单已有标题与描述，改写得更吸引人、转化更强，并给出更准的标签。严格输出：\n标题：…\n描述：…\n标签：…',
  },
  {
    label: '多平台各一版',
    hint: '抖音 / 小红书 / 快手',
    icon: Share2,
    prompt: '/variants 根据表单主题，为抖音、小红书、快手各写一版差异化文案',
  },
]

export function MagicSuggestions() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-7 px-4 py-8 text-center animate-in fade-in duration-300"
      data-testid="ai-suggestions"
    >
      <div className="flex flex-col items-center gap-3">
        <SectionIcon size="lg"><Sparkles className="h-5 w-5" strokeWidth={1.75} /></SectionIcon>
        <div className="space-y-1.5">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
            有什么可以帮你的？
          </h3>
          <p className="max-w-[240px] text-[12px] leading-relaxed text-muted-foreground/70">
            直接说需求，生成后会自动写入左侧表单。
          </p>
        </div>
      </div>

      <div className="grid w-full max-w-xs grid-cols-1 gap-2.5">
        {NATURAL_PROMPTS.map((item) => {
          const Icon = item.icon
          return (
            <ThreadPrimitive.Suggestion
              key={item.label}
              prompt={item.prompt}
              send={true}
              className="group flex items-start gap-3 rounded-xl border border-border/40 bg-card px-4 py-3 text-left shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-primary/[0.03] hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 text-primary/70 ring-1 ring-primary/10 transition-colors group-hover:from-primary/15 group-hover:to-primary/5 group-hover:text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-foreground leading-snug">{item.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/60">{item.hint}</span>
              </div>
            </ThreadPrimitive.Suggestion>
          )
        })}
      </div>
    </div>
  )
}

/** @deprecated tools live in ComposerToolRow */
export function InlineMagicBar() {
  return null
}
