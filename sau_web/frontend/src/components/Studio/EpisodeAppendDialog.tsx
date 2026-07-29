import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
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
import type {
  StudioAct,
  StudioEpisodeCreateInput,
} from '@/api/studio'

/**
 * Dropdown rows are kept alphabetically on the ``act`` key (all four
 * are 1-char Chinese so order is meaningful for the user — 起 should
 * come first as 「first scene / 开端」). The label adds the
 * Chinese-meaning gloss so non-native readers (or a future i18n
 * locale) can decode it.
 */
const ACT_OPTIONS: ReadonlyArray<{ value: StudioAct; label: string }> = [
  { value: '起', label: '起 · 开端' },
  { value: '承', label: '承 · 递进' },
  { value: '转', label: '转 · 转折' },
  { value: '合', label: '合 · 收束' },
]

const TITLE_MAX = 200

interface EpisodeAppendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: StudioEpisodeCreateInput) => void
  /** Disables submit + swaps label to "保存中…". */
  isPending?: boolean
  /** Optional error from the parent mutation (server 400, network, …). */
  errorMessage?: string | null
}

/**
 * Append-one-episode dialog. Mirrors `ProjectCreateDialog`'s structure
 * (Radix Dialog primitives + uncontrolled initial state + re-entrancy
 * guard via `submittingRef`) so the two surface visually consistent
 * affordances. The differences:
 *
 *   * ``act`` is a fixed 4-value dropdown (matches the
 *     ``_VALID_ACTS = {起, 承, 转, 合}`` whitelist); the picker
 *     also defaults to ``起`` so a "click → Submit" flow on a fresh
 *     session lands at the canonical opening scene.
 *   * ``title`` is OPTIONAL (server allows ``NULL`` because
 *     ``studio_episodes.title`` is the nullable column); we
 *     cap it at ``TITLE_MAX = 200`` to mirror the backend's
 *     ``_EPISODE_TITLE_MAX_LEN``.
 *   * ``scenes_json`` / ``dialogues_json``: the backend's
 *     ``_validate_create_episode_item`` accepts EITHER a
 *     list-of-dicts OR a pre-stringified JSON string. UI parses the
 *     textarea into ``list-of-strings`` (one per non-blank line) —
 *     downstream ``_build_scenes_for_render`` does ``"\n".join(...)``
 *     on the list, so non-empty lines become render-ready body
 *     paragraphs without forcing the user to hand-write JSON. If
 *     the user wants richer dicts (e.g. Pexels-tagged shots from
 *     v0.3's `EpisodeEditor`), they can switch to the JSON-string
 *     mode via a future expansion; for v0.1's 「add one scene in
 *     plaintext」 activation funnel, splitting by ``\n`` is the
 *     lowest-friction default.
 */
export function EpisodeAppendDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending = false,
  errorMessage,
}: EpisodeAppendDialogProps) {
  const [title, setTitle] = useState('')
  const [act, setAct] = useState<StudioAct>('起')
  const [scenes, setScenes] = useState('')
  const [dialogues, setDialogues] = useState('')

  // Re-entrancy guard — see ``ProjectCreateDialog`` for the
  // sym-typed rationale: a click + Enter firing in the same tick
  // before ``isPending`` flips can fire onSubmit twice; the ref
  // blocks the second one synchronously.
  const submittingRef = useRef(false)

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setTitle('')
      setAct('起')
      setScenes('')
      setDialogues('')
      submittingRef.current = false
    }
  }, [open])

  // Allow retry after a failed mutation without closing the dialog.
  useEffect(() => {
    if (!isPending) submittingRef.current = false
  }, [isPending])

  const titleTrim = title.trim()
  const titleValid = titleTrim.length <= TITLE_MAX
  // Backend contract: ``act`` is the only required key (string in
  // _VALID_ACTS). The dropdown guarantees a valid value; the
  // ``act`` state is up-front plural-typed so we don't need a
  // runtime check here.
  const isValid = titleValid

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || isPending || submittingRef.current) return
    submittingRef.current = true

    const scenesArr = scenes
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const dialoguesArr = dialogues
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    const input: StudioEpisodeCreateInput = {
      act,
      scenes_json: scenesArr,
      dialogues_json: dialoguesArr,
    }
    if (titleTrim) input.title = titleTrim

    onSubmit(input)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SectionIcon size="sm"><Sparkles className="h-3.5 w-3.5" /></SectionIcon>
            添加 1 集
          </DialogTitle>
          <DialogDescription>
            为这个项目添加一集剧情。act 必填，title / scenes /
            dialogues 可选。后续可以反复添加 4 幕（起 / 承 / 转 /
            合），最后点「渲染成片」一键出 MP4。
          </DialogDescription>
        </DialogHeader>

        <form
          id="studio-episode-append-form"
          onSubmit={handleSubmit}
          className="space-y-5 pt-1"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="studio-episode-act"
              className="text-[12px] font-medium text-foreground/80"
            >
              幕 <span className="text-destructive">*</span>
            </label>
            <select
              id="studio-episode-act"
              value={act}
              onChange={(e) => setAct(e.target.value as StudioAct)}
              className="w-full rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[14px] text-foreground outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              {ACT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="studio-episode-title"
              className="text-[12px] font-medium text-foreground/80"
            >
              标题{' '}
              <span className="text-muted-foreground/60 font-normal">
                （可选,≤{TITLE_MAX} 字）
              </span>
            </label>
            <input
              id="studio-episode-title"
              autoFocus
              maxLength={TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：风雪山神庙"
              className="w-full rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[14px] text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            <p className="text-[10px] text-muted-foreground/50 tabular-nums">
              {titleTrim.length}/{TITLE_MAX}
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="studio-episode-scenes"
              className="text-[12px] font-medium text-foreground/80"
            >
              场景{' '}
              <span className="text-muted-foreground/60 font-normal">
                （可选,每行一个）
              </span>
            </label>
            <textarea
              id="studio-episode-scenes"
              rows={4}
              value={scenes}
              onChange={(e) => setScenes(e.target.value)}
              placeholder={'例：\n江边小镇·黄昏\n客栈内·夜\n山神庙·雪夜'}
              className="w-full resize-none rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[13px] font-mono text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="studio-episode-dialogues"
              className="text-[12px] font-medium text-foreground/80"
            >
              对白{' '}
              <span className="text-muted-foreground/60 font-normal">
                （可选,每行一条）
              </span>
            </label>
            <textarea
              id="studio-episode-dialogues"
              rows={3}
              value={dialogues}
              onChange={(e) => setDialogues(e.target.value)}
              placeholder={
                '例：\n林冲：英雄末路,竟至于此。\n陆谦：师兄,你今日之祸,皆因从前不忍。'
              }
              className="w-full resize-none rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[13px] font-mono text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
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
            form="studio-episode-append-form"
            disabled={!isValid || isPending}
            className="gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            {isPending ? '保存中…' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
