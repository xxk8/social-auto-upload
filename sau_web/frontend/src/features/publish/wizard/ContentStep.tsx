import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Textarea,
} from '@/Components/ui/index'
import { TagInput } from '@/Components/ui/tag-input'
import { useToast } from '@/Components/ui/toast'
import {
  FileText,
  Wand2,
  Loader2,
  Settings,
  Tags,
} from 'lucide-react'
import { PlatformIcon } from '@/Components/ui/platform-icon'
import { cn } from '@/lib/utils'
import { SectionHeader, effectiveMaxTags, platformTagLabel } from '../shared'
import { cardVariants } from '../animations'
import { SchedulePicker } from '../SchedulePicker'
import { Tip } from '@/lib/tip'
import { usePublishWizardStore } from '@/stores/publishWizardStore'
import { api } from '@/api/client'
import { useTagRecommendation } from '@/hooks/useTagRecommendation'
import { TagChipGroup } from '@/Components/TagRecommendation/TagChipGroup'
import type {
  GroupSelection,
  PlatformSpecificSection,
} from '../GroupPublishSelector'
import type { FormPreviewData } from '../previewTypes'

/**
 * §11.4 — ContentStep (Step 2 of the Publish Wizard).
 *
 * Shows title, description (video) or content (note), tags, and schedule.
 * All field values are synced to `usePublishWizardStore.content` so the
 * ReviewStep can render a preview without re-querying the form.
 *
 * The AI enhance buttons (Wand2 icon) call the OpenRouter optimize model
 * to polish the title or description inline — extracted from VideoForm's
 * existing `enhanceField` logic.
 */

interface ContentStepProps {
  groupSelection: GroupSelection | null
  onFormChange?: (data: Partial<FormPreviewData>) => void
  /**
   * OPT-3G (wizard port): controlled accordion state, owned by
   * PublishWizard so GroupPublishSelector's "N 项平台专属待配置"
   * chip can drive the Accordion from outside the form. Default
   * false keeps prior behaviour for any caller that doesn't opt in.
   */
  advancedOpen: boolean
  /**
   * Fired whenever the user toggles the advanced accordion inside
   * ContentStep (manual click on the trigger). Keeps PublishWizard's
   * `advancedOpen` state in sync with the form's local intent so future
   * cross-component affordances stay accurate.
   */
  onAdvancedChange: (open: boolean) => void
  /**
   * OPT-3G (wizard port): which platform-specific section (if any)
   * should surface with a `ring-2 ring-primary` ring inside the
   * expanded accordion. Cleared by the parent's intent; ContentStep
   * just reads it. Three platforms are supported because those are
   * the only ones with conditional gen-fields here: 抖音 / Bilibili /
   * 视频号.
   */
  highlightedSection: PlatformSpecificSection | null
}

export const ContentStep = memo(function ContentStep({
  groupSelection,
  onFormChange,
  advancedOpen,
  onAdvancedChange,
  highlightedSection,
}: ContentStepProps) {
  const { addToast } = useToast()
  const mode = usePublishWizardStore((s) => s.mode)
  const content = usePublishWizardStore((s) => s.content)
  const setContent = usePublishWizardStore((s) => s.setContent)

  // Path C: read `content.tags` directly — Zustand's strict-equality
  // selector means subscribers only re-render when the array reference
  // actually changes (mutator calls). Title / Notes / Schedule
  // keystrokes no longer trigger this component.
  const tags = usePublishWizardStore((s) => s.content.tags)
  const toggleTag = usePublishWizardStore((s) => s.toggleTag)
  const setTags = usePublishWizardStore((s) => s.setTags)

  const [enhancingField, setEnhancingField] = useState<'title' | 'desc' | null>(null)
  const { tags: recommendedTags, loading: tagLoading, recommend, clear: clearTags } = useTagRecommendation()

  const handleToggleRecommendedTag = useCallback(
    (tag: string) => {
      // Strip any leading `#` the recommend chip might render so the
      // action receives a raw text token. `toggleTag` re-normalizes
      // inside the store, which is idempotent if already canonical.
      toggleTag(tag.replace(/^#/, ''))
    },
    [toggleTag],
  )

  const activePlatforms = groupSelection?.platforms ?? []
  // OPT-3G (wizard port): conditional gen-field visibility for the
  // three platform-specific sections below. The Set is constructed
  // inline — with ≤ ~6 platforms during a publish session, the per-
  // render allocation cost is negligible, and memoising on
  // `activePlatforms` would be a no-op anyway (the `?? []` above
  // produces a fresh empty-array reference on every render when
  // `groupSelection` is null).
  const hasDouyin = activePlatforms.includes('douyin')
  const hasBilibili = activePlatforms.includes('bilibili')
  const hasTencent = activePlatforms.includes('tencent')
  const hasAnyPlatformSpecific = hasDouyin || hasBilibili || hasTencent
  // 衍生计数, 驱动触发行 badge. 当三个平台任一勾选时,
  // 行尾显示 `· 3 项专属` mono 计数; 琥珀点仍是 active cue 本身.
  const pendingPlatformConfigsCount =
    (hasDouyin ? 1 : 0) + (hasBilibili ? 1 : 0) + (hasTencent ? 1 : 0)

  const handleRecommendTags = useCallback(() => {
    if (!content.title.trim()) return
    recommend({
      title: content.title,
      description: mode === 'video' ? content.desc : content.note,
      platform: activePlatforms[0],
    })
  }, [content.title, content.desc, content.note, mode, activePlatforms, recommend])

  // ── Report content changes upward for live preview ─────────────────
  const onFormChangeRef = useRef(onFormChange)
  useEffect(() => {
    onFormChangeRef.current = onFormChange
  }, [onFormChange])

  useEffect(() => {
    const handler = onFormChangeRef.current
    if (!handler) return
    handler({
      title: content.title.trim(),
      desc: (mode === 'video' ? content.desc : content.note).trim(),
      tags,
    })
  }, [content.title, content.desc, content.note, tags, mode])

  // ── AI enhance (inline polish) ──────────────────────────────────────
  const OPTIMIZE_MODEL = 'google/gemma-3-1b-it:free'

  const enhanceField = useCallback(
    async (field: 'title' | 'desc') => {
      const value = field === 'title' ? content.title : mode === 'video' ? content.desc : content.note
      if (!value.trim()) return
      setEnhancingField(field)
      const partName = field === 'title' ? '标题' : mode === 'video' ? '视频简介' : '图文正文'
      const systemPrompt = `你是一个文案优化助手。请对用户提供的${partName}进行润色优化。

严格规则：
1. 只基于原文优化，不得添加原文中没有的新信息、新观点或新内容
2. 可以优化：用词精准度、语句流畅度、排版格式、标点符号
3. 不得改变原文的核心含义和关键信息
4. 去除明显的 AI 生成痕迹，使文案读起来像人工撰写
5. 只返回优化后的${partName}内容，不要添加任何解释、前缀或后缀`
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: value },
      ]
      let enhanced = ''
      try {
        await api.generateMessagesStream(
          { messages, model: OPTIMIZE_MODEL },
          (chunk) => { enhanced += chunk },
          (final) => {
            const result = (final || enhanced).trim()
            if (result) {
              if (field === 'title') setContent({ title: result })
              else if (mode === 'video') setContent({ desc: result })
              else setContent({ note: result })
              addToast(`${partName}已优化`, 'success')
            }
            setEnhancingField(null)
          },
          (err) => {
            setEnhancingField(null)
            addToast(err || '优化失败', 'error')
          },
        )
      } catch {
        setEnhancingField(null)
        addToast('优化请求失败', 'error')
      }
    },
    [content.title, content.desc, content.note, mode, setContent, addToast],
  )

  return (
    <motion.div
      custom={0}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
    >
      <Card className="card-refined">
        <CardContent className="p-5 space-y-4">
          <SectionHeader icon={<FileText className="h-4 w-4" />} title="填写内容" />

          {/* ── Title ────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="wizard-content-title" className="flex items-center gap-1">
                标题
                <span className="text-primary" aria-hidden="true">*</span>
                {/* SR 旁路 — `aria-hidden` 让 * 对屏幕阅读器隐形，
                    这里补上「必填」让 SR 用户听清「标题 必填」。
                    视觉用户看 *，SR 用户听「必填」，两个通道等价。 */}
                <span className="sr-only">必填</span>
              </Label>
              <div className="flex items-center gap-1.5">
                <Tip text="AI 优化标题">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 rounded-md p-0"
                    onClick={() => enhanceField('title')}
                    disabled={enhancingField !== null || !content.title.trim()}
                  >
                    {enhancingField === 'title' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3" />
                    )}
                  </Button>
                </Tip>
                {/* 字数计数器只在用户开始输入后才出现 —— 进入空表单时不
                    看到 `0/100` 显得腊饰。80% 以上进入 warning 高亮，
                    100% 变 error 红。 */}
                {content.title.length > 0 && (
                  <span
                    className={cn(
                      'text-[11px] tabular-nums transition-colors duration-200',
                      content.title.length >= 100
                        ? 'text-error-fg'
                        : content.title.length >= 80
                          ? 'text-warning-fg'
                          : 'text-muted-foreground',
                    )}
                    aria-label={`标题字数 ${content.title.length} / 100`}
                  >
                    {content.title.length}/100
                  </span>
                )}
              </div>
            </div>              <Input
              id="wizard-content-title"
              name="title"
              placeholder={mode === 'video' ? '请输入视频标题（建议 6-20 字）' : '请输入图文标题'}
              value={content.title}
              onChange={(e) => setContent({ title: e.target.value })}
              maxLength={100}
            />
          </div>

          {/* ── Description / Content ────────────────────────── */}
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="wizard-content-body">
                  {mode === 'video' ? '视频简介' : '图文正文'}
                </Label>
                <Tip text="AI 优化">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 rounded-md p-0"
                    onClick={() => enhanceField('desc')}
                    disabled={
                      enhancingField !== null ||
                      !(mode === 'video' ? content.desc : content.note).trim()
                    }
                  >
                    {enhancingField === 'desc' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3" />
                    )}
                  </Button>
                </Tip>
              </div>
              <Textarea
                id="wizard-content-body"
                className="min-h-[80px]"
                placeholder={mode === 'video' ? '补充视频简介、背景说明或发布备注' : '请输入图文正文'}
                value={mode === 'video' ? content.desc : content.note}
                onChange={(e) =>
                  mode === 'video'
                    ? setContent({ desc: e.target.value })
                    : setContent({ note: e.target.value })
                }
                maxLength={mode === 'video' ? 1000 : 3000}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="wizard-content-tags">标签</Label>
                <span className="text-[11px] text-muted-foreground">
                  {platformTagLabel(activePlatforms)}
                </span>
              </div>
              <TagInput
                id="wizard-content-tags"
                placeholder="按 Enter 添加标签（# 可省略）"
                value={tags}
                onChange={setTags}
                maxTags={effectiveMaxTags(activePlatforms)}
              />
              <div className="flex items-center gap-2">
                <Tip text="AI 推荐标签">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={handleRecommendTags}
                    disabled={tagLoading || !content.title.trim()}
                  >
                    {tagLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Tags className="h-3 w-3" />
                    )}
                    推荐标签
                  </Button>
                </Tip>
                {recommendedTags.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={clearTags}
                  >
                    清除推荐
                  </button>
                )}
              </div>
              <TagChipGroup
                tags={recommendedTags}
                selectedTags={tags}
                onToggle={handleToggleRecommendedTag}
                loading={tagLoading}
              />
              <SchedulePicker
                value={content.schedule}
                onChange={(val) => setContent({ schedule: val })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 高级选项 (controlled, driven by PublishWizard) ─────────
           OPT-3G (wizard port): mirrors VideoForm's advanced Accordion
           so GroupPublishSelector's "💡 N 项平台专属待配置" chip can
           expand this surface + ring the matching section. The card
           is intentionally a sibling rather than nested in the
           content `<Card>` so chip-driven accordion state doesn't
           jostle the visual weight of the headline form card. The
           trigger matches VideoForm's chrome (Settings icon +
           "高级选项" copy + hairline-active dot) for parity. */}
      <Card className="card-refined overflow-hidden">
        <Accordion
          type="single"
          collapsible
          value={advancedOpen ? 'advanced' : ''}
          onValueChange={(v) => onAdvancedChange?.((v as string) === 'advanced')}
        >
          <AccordionItem value="advanced" className="border-b-0">
            <AccordionTrigger className="px-5 py-3 hover:no-underline">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Settings className="h-3.5 w-3.5" />
                </div>
                <span className="text-sm font-semibold">高级选项</span>
                {hasAnyPlatformSpecific ? (
                  <>
                    <span
                      className="ml-1 text-[11px] font-normal text-muted-foreground tabular-nums"
                      aria-label={`${pendingPlatformConfigsCount} 项平台专属待配置`}
                    >
                      {pendingPlatformConfigsCount} 项专属
                    </span>
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  </>
                ) : activePlatforms.length > 0 ? (
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground/60">
                    无可配置项
                  </span>
                ) : null}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              {/* ── 抖音专属 ── */}
              {hasDouyin && (
                <div
                  id="advanced-section-douyin"
                  data-section="douyin"
                  className={cn(
                    'rounded-md transition-all duration-300',
                    highlightedSection === 'douyin'
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background px-3 pb-3 bg-primary/5'
                      : 'pt-3',
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <PlatformIcon platform="douyin" className="h-3 w-3" />
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      抖音专属
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    商品链接 / 商品标题（表单字段待接入）
                  </p>
                </div>
              )}

              {/* ── B 站专属 ── */}
              {hasBilibili && (
                <div
                  id="advanced-section-bilibili"
                  data-section="bilibili"
                  className={cn(
                    'rounded-md transition-all duration-300',
                    hasDouyin && 'mt-3',
                    highlightedSection === 'bilibili'
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background px-3 pb-3 bg-primary/5'
                      : 'pt-3',
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <PlatformIcon platform="bilibili" className="h-3 w-3" />
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      B 站专属
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    分区分类（表单字段待接入）
                  </p>
                </div>
              )}

              {/* ── 视频号专属 ── */}
              {hasTencent && (
                <div
                  id="advanced-section-tencent"
                  data-section="tencent"
                  className={cn(
                    'rounded-md transition-all duration-300',
                    (hasDouyin || hasBilibili) && 'mt-3',
                    highlightedSection === 'tencent'
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background px-3 pb-3 bg-primary/5'
                      : 'pt-3',
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <PlatformIcon platform="tencent" className="h-3 w-3" />
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      视频号专属
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    短标题 / 原创分类（表单字段待接入）
                  </p>
                </div>
              )}

              {!hasAnyPlatformSpecific && (
                <p className="mt-2 text-[11px] text-muted-foreground/50">
                  选择抖音、B 站或视频号后显示专属选项
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </motion.div>
  )
})
