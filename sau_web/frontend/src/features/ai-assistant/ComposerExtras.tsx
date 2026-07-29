/**
 * Composer accessories — one clean tool row (Doubao style) + thinking panel.
 */
import { useCallback, useRef, useState } from 'react'
import {
  ImagePlus,
  X,
  Zap,
  Layers,
  Sparkles,
  MoreHorizontal,
  HelpCircle,
  Eraser,
  ClipboardList,
  ChevronDown,
} from 'lucide-react'
import { ThreadPrimitive } from '@assistant-ui/react'
import { useAiStore } from '@/stores/useAiStore'
import { useChatStore } from '@/stores/useChatStore'
import { useToast } from '@/components/ui/toast'
import { ModelInlinePicker, AiSettingsPopover } from './AiSettingsPopover'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { PUBLISH_SKILLS } from './publishSkills'

const MAX_BYTES = 4 * 1024 * 1024

export function ComposerImageStrip() {
  const images = useAiStore((s) => s.composerImages)
  const remove = useAiStore((s) => s.removeComposerImage)
  if (images.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2 px-0.5">
      {images.map((src, i) => (
        <div
          key={`${i}-${src.slice(0, 24)}`}
          className="group relative h-12 w-12 overflow-hidden rounded-lg border border-border/50 bg-muted"
        >
          <img src={src} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => remove(i)}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/95 text-muted-foreground opacity-0 shadow group-hover:opacity-100"
            aria-label="移除图片"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ComposerAttachButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const add = useAiStore((s) => s.addComposerImage)
  const count = useAiStore((s) => s.composerImages.length)
  const { addToast } = useToast()

  const onPick = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return
      Array.from(files).forEach((file) => {
        if (!file.type.startsWith('image/')) {
          addToast('仅支持图片', 'warning')
          return
        }
        if (file.size > MAX_BYTES) {
          addToast('图片需小于 4MB', 'warning')
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') add(reader.result)
        }
        reader.readAsDataURL(file)
      })
    },
    [add, addToast],
  )

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={count >= 4}
        className={toolBtn}
        aria-label="上传图片"
        title="上传参考图"
        data-testid="ai-attach-image"
      >
        <ImagePlus className="h-3.5 w-3.5" />
      </button>
    </>
  )
}

const toolBtn = cn(
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11px] font-medium',
  'text-muted-foreground/80 transition-all duration-150',
  'hover:bg-muted/70 hover:text-foreground',
  'disabled:pointer-events-none disabled:opacity-35',
  'active:scale-[0.97]',
)

/**
 * One-row tools (must be inside ThreadPrimitive.Root):
 *   +  写文案  多平台  风格▾  ···     模型  ⚙
 */
export function ComposerToolRow() {
  const skillId = useAiStore((s) => s.activeSkillId)

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="ai-composer-tool-row"
    >
      <ComposerAttachButton />

      <ThreadPrimitive.Suggestion
        prompt={
          '根据左侧表单当前内容（若为空则自拟主题），写一版适合发布的标题、描述和 4-6 个标签。语气自然有转化力。严格按格式输出：\n标题：…\n描述：…\n标签：…'
        }
        send={true}
        className={toolBtn}
        title="根据表单写一版完整文案并自动填表"
      >
        <Zap className="h-3 w-3 text-amber-500" />
        写文案
      </ThreadPrimitive.Suggestion>

      <ThreadPrimitive.Suggestion
        prompt="/variants 根据表单主题，为抖音、小红书、快手各写一版差异化文案"
        send={true}
        className={toolBtn}
        title="多平台差异化文案"
      >
        <Layers className="h-3 w-3" />
        多平台
      </ThreadPrimitive.Suggestion>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(toolBtn, skillId && 'bg-primary/10 text-primary')}
          >
            <Sparkles className="h-3 w-3" />
            {skillId
              ? skillId.replace(/-upload$/, '').slice(0, 6)
              : '风格'}
            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1.5" sideOffset={6}>
          <p className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
            写作风格 Skill
          </p>
          {PUBLISH_SKILLS.map((s) => (
            <ThreadPrimitive.Suggestion
              key={s.id}
              prompt={`/skill ${s.id}`}
              send={true}
              className={cn(
                'flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
                'hover:bg-muted/80',
                skillId === s.id && 'bg-primary/5 ring-1 ring-primary/20',
              )}
            >
              <span className="text-[12px] font-medium text-foreground">{s.label}</span>
              <span className="mt-0.5 text-[10px] text-muted-foreground/70 leading-relaxed">
                {s.description}
              </span>
            </ThreadPrimitive.Suggestion>
          ))}
          {skillId ? (
            <ThreadPrimitive.Suggestion
              prompt="/skill clear"
              send={true}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
            >
              <Eraser className="h-3.5 w-3.5" />
              清除风格
            </ThreadPrimitive.Suggestion>
          ) : null}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={toolBtn} aria-label="更多">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1.5" sideOffset={6}>
          <ThreadPrimitive.Suggestion
            prompt="/status"
            send={true}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] transition-colors duration-150 hover:bg-muted/80"
          >
            <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
            查看表单状态
          </ThreadPrimitive.Suggestion>
          <ThreadPrimitive.Suggestion
            prompt="/help"
            send={true}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] transition-colors duration-150 hover:bg-muted/80"
          >
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            命令帮助
          </ThreadPrimitive.Suggestion>
          <ThreadPrimitive.Suggestion
            prompt="/clear"
            send={true}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] transition-colors duration-150 text-destructive hover:bg-destructive/10"
          >
            <Eraser className="h-3.5 w-3.5" />
            清空对话
          </ThreadPrimitive.Suggestion>
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
        <ModelInlinePicker />
        <AiSettingsPopover />
      </div>
    </div>
  )
}

/** Live thinking / streaming panel */
export function ThinkingPanel() {
  const jobStatus = useChatStore((s) => s.jobStatus)
  const draft = useChatStore((s) => s.streamingDraft)
  const [open, setOpen] = useState(true)

  const isEnhancing = jobStatus === 'enhancing'
  const isGenerating = jobStatus === 'generating'
  if (!isEnhancing && !isGenerating) return null

  const title = isEnhancing ? '思考中' : '生成中'
  const hint = isEnhancing ? '优化提示与上下文…' : '撰写标题、描述与标签…'
  const body = draft.trim() || hint

  return (
    <div
      className="mx-3 mb-1.5 overflow-hidden rounded-xl border border-border/30 bg-gradient-to-b from-primary/[0.04] to-transparent shadow-sm"
      data-testid="ai-thinking-panel"
      data-phase={isEnhancing ? 'enhancing' : 'generating'}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-primary/[0.02]"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-foreground/90">{title}</span>
        <span className="rounded-md bg-primary/8 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {isEnhancing ? '增强' : '文案'}
        </span>
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/20 px-3.5 py-2.5">
          <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-muted-foreground/80">
            {body}
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse rounded-full bg-primary align-middle" />
          </pre>
        </div>
      )}
    </div>
  )
}

export function ComposerFooterBar() {
  return <ComposerToolRow />
}
