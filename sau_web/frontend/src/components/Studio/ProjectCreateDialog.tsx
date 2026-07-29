import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SectionIcon } from '@/components/ui/section-header'
import { Button } from '@/components/ui/button'

import { Clapperboard } from 'lucide-react'

export interface ProjectCreateInput {
  title: string
  synopsis: string
  style: string | null
}

interface ProjectCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: ProjectCreateInput) => void
  /** When true, disables submit and shows in-flight label. */
  isPending?: boolean
  /** Optional error from the parent mutation. */
  errorMessage?: string | null
}

const STYLE_PRESETS = [
  { label: '水墨武侠 9:16', value: '水墨武侠风格,9:16竖屏' },
  { label: '都市剧 16:9', value: '现代都市剧风格,16:9横屏' },
  { label: '古风短剧 9:16', value: '古风短剧风格,9:16竖屏' },
  { label: '赛博朋克', value: '赛博朋克风格,霓虹色调' },
  { label: '自定义', value: '' },
] as const

/**
 * Create-project dialog. Three fields:
 *   * ``title``    — required, max 80 chars
 *   * ``synopsis`` — required, max 500 chars
 *   * ``style``    — optional preset OR freeform override
 *
 * Live character-count warnings; submit is disabled while the
 * patched validators fail. Submission is delegated to the parent
 * mutation hook so error states flow through the same envelope
 * the rest of StudioPage handles.
 */
export function ProjectCreateDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending = false,
  errorMessage,
}: ProjectCreateDialogProps) {
  const [title, setTitle] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [stylePreset, setStylePreset] = useState<string>(STYLE_PRESETS[0].value)
  const [styleCustom, setStyleCustom] = useState('')

  // Re-entrancy guard: blocks synchronous double submission (e.g. a
  // click + Enter firing in the same tick before `isPending` flips).
  const submittingRef = useRef(false)

  // Reset form on close.
  useEffect(() => {
    if (!open) {
      setTitle('')
      setSynopsis('')
      setStylePreset(STYLE_PRESETS[0].value)
      setStyleCustom('')
      submittingRef.current = false
    }
  }, [open])

  // Clear re-entrancy guard when the parent mutation settles so a failed
  // create can be retried without closing the dialog.
  useEffect(() => {
    if (!isPending) submittingRef.current = false
  }, [isPending])

  const style =
    stylePreset === '' /* Custom branch */
      ? styleCustom.trim() || null
      : stylePreset

  const titleTrim = title.trim()
  const synopsisTrim = synopsis.trim()
  const isValid =
    titleTrim.length > 0 &&
    titleTrim.length <= 80 &&
    synopsisTrim.length > 0 &&
    synopsisTrim.length <= 500

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || isPending || submittingRef.current) return
    submittingRef.current = true
    onSubmit({ title: titleTrim, synopsis: synopsisTrim, style })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SectionIcon size="sm"><Clapperboard className="h-3.5 w-3.5" /></SectionIcon>
            新建剧本题材
          </DialogTitle>
          <DialogDescription>
            输入一句话灵感,后续可以围绕这一句话生成多集剧本与时间轴分镜。
          </DialogDescription>
        </DialogHeader>

        <form id="studio-project-create-form" onSubmit={handleSubmit} className="space-y-5 pt-1">
          <div className="space-y-1.5">
            <label
              htmlFor="studio-project-title"
              className="text-[12px] font-medium text-foreground/80"
            >
              标题 <span className="text-destructive">*</span>
            </label>
            <input
              id="studio-project-title"
              autoFocus
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：灰烬"
              className="w-full rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[14px] text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            <p className="text-[10px] text-muted-foreground/50 tabular-nums">
              {titleTrim.length}/80
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="studio-project-synopsis"
              className="text-[12px] font-medium text-foreground/80"
            >
              一句话灵感 <span className="text-destructive">*</span>
            </label>
            <textarea
              id="studio-project-synopsis"
              rows={4}
              maxLength={500}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="例：少年剑客风雪山神庙,一夜顿悟,十年恩怨从此揭开。"
              className="w-full resize-none rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[13px] text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            <p className="text-[10px] text-muted-foreground/50 tabular-nums">
              {synopsisTrim.length}/500
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="studio-project-style-preset"
              className="text-[12px] font-medium text-foreground/80"
            >
              风格预设 <span className="text-muted-foreground/60 font-normal">（可选）</span>
            </label>
            <select
              id="studio-project-style-preset"
              value={stylePreset}
              onChange={(e) => setStylePreset(e.target.value)}
              className="w-full rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[13px] text-foreground outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              {STYLE_PRESETS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {stylePreset === '' && (
              <input
                value={styleCustom}
                onChange={(e) => setStyleCustom(e.target.value)}
                placeholder="输入自定义风格,例如：赛博朋克,湿漉漉的霓虹反射"
                className="w-full rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[13px] text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            )}
          </div>

          {errorMessage && (
            <p className="text-[12px] text-destructive" role="alert">
              {errorMessage}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}

          >
            取消
          </Button>
          <Button
            type="submit"
            form="studio-project-create-form"
            disabled={!isValid || isPending}

          >
            {isPending ? '创建中…' : '创建项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
