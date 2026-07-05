import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { FormPreviewData } from './previewTypes'
import type { GroupSelection } from './GroupPublishSelector'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  Textarea,
} from '@/Components/ui/index'
import { cn } from '@/lib/utils'
import { TagInput } from '@/Components/ui/tag-input'
import { motion } from 'motion/react'
import {useToast} from '@/Components/ui/toast.helpers';import { toneTextClass } from '@/lib/tone'
import { usePublishDraft } from '@/hooks/usePublishDraft'
import { PublishDraftBanner } from './PublishDraftBanner'
import {
  api,
  getNoteImageLimit,
} from '../../api/client'
import {
  FilePlus,
  Image as ImageIcon,
  Loader2,
  Maximize,
  X,
} from 'lucide-react'
import {SectionHeader} from './shared';
import {effectiveMaxTags, platformTagLabel} from './shared.helpers';import { cardVariants, thumbVariants } from './animations'
import { SchedulePicker } from './SchedulePicker'
import { ImageLightbox } from './ImageLightbox'

/** Imperative handle: parent (PublishPage) routes AI generations here.
 *  Aliased to `FormHandle` from the chat bridge. `getFormSnapshot` exposes
 *  the live form state so chat actions can capture it at send time.
 *  Note: NoteForm internally stores body text as `content`, but the unified
 *  FormSnapshot shape uses `desc`; the bridge sees `{ title, desc, tags }`.
 */
export type NoteFormHandle = FormHandle

type NoteFormProps = {
  /**
   * Pre-resolved group selection from GroupPublishSelector.
   * The form uses the group's cookie files directly for submission.
   */
  groupSelection?: GroupSelection | null
  onSuccess: (info: { count: number; taskIds: string[]; failedCount: number; mode: '图文' }) => void
  onError: (label: '图文') => void
  /** Called on every form-change so the parent can render a live preview. */
  onFormChange?: (data: FormPreviewData) => void
}

/**
 * Note publishing form — content card with image grid, tags, schedule, and
 * headless toggle. Localizes form fields and the image-files array so
 * typing/scrolling never re-renders PublishPage.
 */
export const NoteForm = memo(
  forwardRef<NoteFormHandle, NoteFormProps>(function NoteForm(
    { groupSelection, onSuccess, onError, onFormChange },
    ref,
  ) {
    const { addToast } = useToast()

    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    /** Path C: native `string[]` (canonical `#tag`). Wire-format join
     *  happens only at the api.uploadNoteMultipart call site in `submit()`. */
    const [tags, setTags] = useState<string[]>([])
    const [schedule, setSchedule] = useState('')
    const [headless, setHeadless] = useState(true)

    const [imageFiles, setImageFiles] = useState<File[]>([])
    const [dragOver, setDragOver] = useState(false)
    const [dragIndex, setDragIndex] = useState<number | null>(null)
    const dragIdxRef = useRef<number | null>(null)
    const [dropTarget, setDropTarget] = useState<number | null>(null)
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [confirmClearOpen, setConfirmClearOpen] = useState(false)

    // ── PR-OPT-2D: draft auto-save + restore + clear-confirmation ────────
    // imageFiles are intentionally NOT in the snapshot (File is not
    // serializable). `imageMetas` records file metadata so the banner can
    // hint how many images will need re-uploading.
    const imageMetas = useMemo(
      () =>
        imageFiles.map((f) => ({
          name: f.name,
          size: f.size,
          lastModified: f.lastModified,
        })),
      [imageFiles],
    )
    const draftSnapshot = useMemo(
      () => ({ title, content, tags, schedule, headless, imageCount: imageMetas.length }),
      [title, content, tags, schedule, headless, imageMetas.length],
    )

    const {
      pendingDraft,
      draftSavedAt,
      acknowledge,
      clearDraftStorage,
    } = usePublishDraft('note', draftSnapshot)

    const filledFieldCount = useMemo(() => {
      let n = 0
      if (title.trim()) n++
      if (content.trim()) n++
      if (tags.length > 0) n++
      if (schedule.trim()) n++
      if (imageMetas.length > 0) n++
      return n
    }, [title, content, tags, schedule, imageMetas.length])

    const restoreDraft = useCallback(() => {
      if (!pendingDraft) return
      const d = pendingDraft as Record<string, unknown>
      let restored = 0
      if (typeof d.title === 'string') { setTitle(d.title); if (d.title) restored++ }
      if (typeof d.content === 'string') { setContent(d.content); if (d.content) restored++ }
      if (Array.isArray(d.tags)) { setTags(d.tags); if (d.tags.length > 0) restored++ }
      else if (typeof d.tags === 'string' && d.tags) {
        // Legacy pre-Path-C draft: comma-joined string. Parse and re-set.
        const parsed = d.tags.split(/[,，]+/).map((t) => t.trim().replace(/^#+/, '#').replace(/#+/, '#')).filter(Boolean)
        setTags(parsed)
        if (parsed.length > 0) restored++
      }
      if (typeof d.schedule === 'string') { setSchedule(d.schedule); if (d.schedule) restored++ }
      if (typeof d.headless === 'boolean') { setHeadless(d.headless); if (d.headless) restored++ }
      acknowledge()
      // Guard zero-restored: only emit toast when there's something to
      // recover beyond the default `headless: true` toggle.
      if (restored > 0) {
        const hadImages = typeof d.imageCount === 'number' && d.imageCount > 0
        addToast(
          `已恢复 ${restored} 项字段；${hadImages ? `需重新上传 ${d.imageCount} 张图片` : '无图片需重传'}`,
          'success',
        )
      } else {
        addToast('草稿内容全部为空，未应用', 'info')
      }
    }, [pendingDraft, acknowledge, addToast])

    const discardDraft = useCallback(() => {
      clearDraftStorage()
      acknowledge()
    }, [clearDraftStorage, acknowledge])

    const draftBannerFieldsHint = useMemo(() => {
      if (!pendingDraft) return undefined
      const d = pendingDraft as Record<string, unknown>
      const filled: string[] = []
      if (typeof d.title === 'string' && d.title.trim()) filled.push('标题')
      if (typeof d.content === 'string' && d.content.trim()) filled.push('正文')
      if (Array.isArray(d.tags) ? d.tags.length > 0 : typeof d.tags === 'string' && d.tags.trim()) filled.push('标签')
      if (typeof d.schedule === 'string' && d.schedule.trim()) filled.push('定时')
      const imgs = typeof d.imageCount === 'number' ? d.imageCount : 0
      if (imgs > 0) filled.push(`${imgs} 张图片元信息（需重传）`)
      return filled.length > 0
        ? `将恢复：${filled.join(' · ')}`
        : '草稿不含可恢复字段'
    }, [pendingDraft])

    const draftFieldCountForBanner = useMemo(() => {
      if (!pendingDraft) return 0
      const d = pendingDraft as Record<string, unknown>
      let n = 0
      for (const k of ['title', 'content', 'schedule']) {
        const v = d[k]
        if (typeof v === 'string' && v.trim()) n++
      }
      if (Array.isArray(d.tags) && d.tags.length > 0) n++
      else if (typeof d.tags === 'string' && d.tags.trim()) n++
      return n
    }, [pendingDraft])

    /** When multiple platforms are selected, use the most restrictive image limit. */
    const activePlatforms = groupSelection?.platforms ?? []
    const imageLimit = Math.min(
      ...(activePlatforms.length > 0 ? activePlatforms.map((p) => getNoteImageLimit(p)) : [30]),
    )
    const imageFilesRef = useRef(imageFiles)
    imageFilesRef.current = imageFiles

    /** Enforce platform-specific image limit. Uses a ref to read current
     *  length so toast side-effects stay outside the setState updater. */
    const addImagesWithinLimit = (incoming: File[]) => {
      if (incoming.length === 0) return
      const remaining = imageLimit - imageFilesRef.current.length
      if (remaining <= 0) {
        addToast(`当前平台最多只能添加 ${imageLimit} 张图片`, 'warning')
        return
      }
      const toAdd = incoming.slice(0, remaining)
      if (toAdd.length < incoming.length) {
        addToast(`已截取前 ${toAdd.length} 张（当前平台限制 ${imageLimit} 张）`, 'warning')
      }
      setImageFiles((prev) => [...prev, ...toAdd])
    }

    useImperativeHandle(
      ref,
      () => ({
        applyAiResult(result) {
          if (result.title) setTitle(result.title)
          if (result.desc) setContent(result.desc)
          if (result.tags && result.tags.length > 0) setTags(result.tags)
        },
        // ai-sidebar-material-search §4.2: NoteForm accepts ONLY the
        // `images` media key (File[]). `{ file }` is rejected with
        // `'no-media-slot'` (NoteForm has no single-file slot — its
        // main media is the images[] array itself). `{ thumbnail }`
        // is also rejected — NoteForm has no dedicated cover URL input
        // (its cover IS one of the images[] entries via submit-time
        // ordering). Caller (MaterialImageGrid / AddUrlForm) toasts the
        // no-slot hint.
        //
        // CRITICAL: delegates to `addImagesWithinLimit(images)` so the
        // platform-specific MAX (xiaohongshu=9 / douyin=30 / etc.)
        // and the inline-truncation toast path remain DRY — a future
        // PR raising one limit MUST update both the AI-apply and the
        // user-drop entry points via this single helper.
        applyMedia(media) {
          const { file, thumbnail, images } = media
          if (file || thumbnail) {
            // NoteForm has no single-file OR cover-URL slot — its cover
            // IS one of the `images[]` entries via submit-time ordering.
            // Caller toasts the no-media-slot hint (single-source-of-truth).
            // Part B of the §6-9 双 toast wart fix: stripping the inner
            // "图文模式不支持单文件/封面 URL" warning so the caller is the
            // sole owner of rejection copy.
            return { applied: false, reason: 'no-media-slot' as const }
          }
          if (images && images.length > 0) {
            // addImagesWithinLimit itself toasts truncated-vs-accepted;
            // REMAINING-IMAGE success is announced by the caller (grid
            // / AddUrlForm) which fires one toast per click.
            addImagesWithinLimit(images)
            return { applied: true }
          }
          // No key matched — treat as no-media-slot.
          return { applied: false, reason: 'no-media-slot' as const }
        },
        // NoteForm internal `content` ↔ FormSnapshot `desc` mapping preserved.
        // Path C: tags is string[] — bridge sees array form directly.
        getFormSnapshot: () => ({ title, desc: content, tags }),
      }),
      [setTitle, setContent, setTags, title, content, tags, addImagesWithinLimit],
    )

    /**
     * Object URLs leak if we don't revoke them. Re-create the memo whenever
     * the file list changes and revoke all on unmount.
     */
    const imageUrls = useMemo(
      () => imageFiles.map((f) => URL.createObjectURL(f)),
      [imageFiles],
    )
    useEffect(() => {
      return () => {
        imageUrls.forEach((url) => URL.revokeObjectURL(url))
      }
    }, [imageUrls])

    /** Report form state upward for the live preview panel. */
    // Mirror the parent callback through a ref so this effect's dep array
    // stays focused on the form fields only. Prevents spurious re-fires if
    // a future refactor binds `onFormChange` to reactive state.
    const onFormChangeRef = useRef(onFormChange)
    useEffect(() => {
      onFormChangeRef.current = onFormChange
    }, [onFormChange])

    useEffect(() => {
      const handler = onFormChangeRef.current
      if (!handler) return
      handler({
        title,
        desc: content,
        tags,
        fileUrls: imageUrls,
        fileType: imageFiles.length > 0 ? 'image' : null,
      })
    }, [title, content, tags, imageUrls])

    const handleLightboxClose = useCallback(() => setLightboxIndex(null), [])
    const handleLightboxPrev = useCallback(
      () => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i)),
      [],
    )
    const handleLightboxNext = useCallback(
      () =>
        setLightboxIndex((i) =>
          i !== null && i < imageFiles.length - 1 ? i + 1 : i,
        ),
      [imageFiles.length],
    )

    const removeImage = useCallback((idx: number) => {
      setImageFiles((prev) => prev.filter((_, i) => i !== idx))
      // Clamp lightbox if it was pointing at or past the removed index.
      setLightboxIndex((prev) => {
        if (prev === null) return prev
        if (idx < prev) return prev - 1
        if (idx === prev) return prev < prev ? prev : null
        return prev
      })
    }, [])

    const moveImage = useCallback((fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return
      setImageFiles((prev) => {
        const next = [...prev]
        const [item] = next.splice(fromIdx, 1)
        next.splice(toIdx, 0, item)
        return next
      })
      // Adjust lightbox index
      setLightboxIndex((prev) => {
        if (prev === null) return prev
        if (prev === fromIdx) return toIdx
        if (fromIdx < prev && toIdx >= prev) return prev - 1
        if (fromIdx > prev && toIdx <= prev) return prev + 1
        return prev
      })
    }, [])

    // PR-OPT-2D: split user-cleared vs post-submit-clear.
    const clearEverything = useCallback(() => {
      setTitle('')
      setContent('')
      setTags([])
      setSchedule('')
      setImageFiles([])
      clearDraftStorage()
    }, [clearDraftStorage])

    const clearFilesAndReset = useCallback(() => {
      setImageFiles([])
      // Title/content/tags/schedule preserved for re-submit to another group.
    }, [])

    const handleClearClick = useCallback(() => {
      if (filledFieldCount >= 2) {
        setConfirmClearOpen(true)
      } else {
        clearEverything()
      }
    }, [filledFieldCount, clearEverything])

    const submit = useCallback(async () => {
      if (!groupSelection?.platforms.length) {
        addToast('请先在上方选择发布账号组和平台', 'warning')
        return
      }
      if (imageFiles.length === 0) {
        addToast('请至少添加一张图片', 'warning')
        return
      }
      if (!title.trim()) {
        addToast('请输入标题', 'warning')
        return
      }

      setSubmitting(true)
      try {
        const tasks = groupSelection.mappings
          .filter((m) => groupSelection.platforms.includes(m.platform))
          .map((mapping) =>
            api
              .uploadNoteMultipart({
                platform: mapping.platform,
                account: mapping.cookieFile,
                title,
                note: content || undefined,
                // Wire-boundary: join is the only place string[] → string.
                tags: tags.length > 0 ? tags.join(',') : undefined,
                schedule: schedule || undefined,
                headless: String(headless),
                images: imageFiles,
              })
              .then((res) => ({
                platform: mapping.platform,
                accountKey: `${mapping.platform}::${mapping.cookieFile}`,
                success: res.success,
                taskId: res.data?.task_id,
              })),
          )

        const results = await Promise.all(tasks)
        const ids: string[] = []
        results.forEach((item) => {
          if (item.success && item.taskId) ids.push(item.taskId)
        })

        const failed = results.filter((item) => !item.success)
        if (failed.length) {
          addToast(`有 ${failed.length} 个任务提交失败`, 'error')
        } else {
          addToast(`已提交 ${results.length} 个图文上传任务`, 'success')
        }
        clearFilesAndReset()
        onSuccess({ count: results.length, taskIds: ids, failedCount: failed.length, mode: '图文' })
      } catch {
        addToast('图文请求失败，请检查后端连接', 'error')
        onError('图文')
      } finally {
        setSubmitting(false)
      }
    }, [groupSelection, title, content, tags, schedule, headless, imageFiles, addToast, clearFilesAndReset, onSuccess, onError])

    return (
      <>
        {/* ── 内容素材 ─────────────────────────────────────────── */}
        <motion.div
          custom={0}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
          <Card className="card-refined">
            <CardContent className="p-5 space-y-4">
              <SectionHeader
                icon={<FilePlus className="h-4 w-4" />}
                title="内容素材"
              />
              <div className="space-y-4">
                <div className="space-y-2">
                  {/* eslint-disable-next-line sau/label-html-for -- 装饰标签·div作为click-target + 隐藏 <input id="note-image-input"> */}
                  <Label>图片</Label>
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors cursor-pointer',
                      dragOver
                        ? 'border-primary bg-primary/10'
                        : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
                    )}
                    onClick={() => document.getElementById('note-image-input')?.click()}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOver(true)
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOver(false)
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOver(false)
                      const files = e.dataTransfer.files
                      if (files) {
                        const newImages = Array.from(files).filter((f) =>
                          f.type.startsWith('image/'),
                        )
                        if (newImages.length > 0) {
                          addImagesWithinLimit(newImages)
                        }
                      }
                    }}
                  >
                    <ImageIcon className="h-8 w-8 text-primary mb-2" />
                    <p className="text-sm text-muted-foreground">点击添加图片</p>
                  </div>
                  <input
                    id="note-image-input"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files
                      if (files) {
                        addImagesWithinLimit(Array.from(files))
                      }
                    }}
                  />                      {imageFiles.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-muted-foreground">
                          {imageFiles.length}/{imageLimit} 张
                          {imageFiles.length > 1 && ' · 拖拽可调整顺序'}
                        </p>
                        {imageFiles.length >= imageLimit && (
                          <span className={cn('text-[10px] font-medium', toneTextClass('warning'))}>
                            已达上限
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                      {imageFiles.map((file, idx) => (
                        <ThumbnailTile
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          url={imageUrls[idx]}
                          alt={`图片 ${idx + 1}`}
                          index={idx}
                          isDragging={dragIndex === idx}
                          isDropTarget={dropTarget === idx}
                          onOpen={() => setLightboxIndex(idx)}
                          onRemove={() => removeImage(idx)}
                          onDragStart={() => { dragIdxRef.current = idx; setDragIndex(idx) }}
                          onDragOver={() => setDropTarget(idx)}
                          onDrop={() => { moveImage(dragIdxRef.current!, idx); setDragIndex(null); setDropTarget(null) }}
                          onDragEnd={() => { setDragIndex(null); setDropTarget(null) }}
                          onDragLeave={() => setDropTarget((t) => (t === idx ? null : t))}
                        />
                      ))}
                      </div>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">
                    支持 JPG / PNG / GIF / WebP，可添加多张或拖拽到此区域
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="note-title">标题</Label>
                  <Input
                    id="note-title"
                    name="title"
                    placeholder="请输入图文标题"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="note-content">图文正文</Label>
                    <Textarea
                      id="note-content"
                      className="min-h-[90px]"
                      placeholder="请输入图文正文，多行内容会自动换行显示"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      maxLength={3000}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      {/* eslint-disable-next-line sau/label-html-for -- 装饰分组·TagInput 当前调用未挂 id */}
                      <Label>标签</Label>
                      <span className="text-[11px] text-muted-foreground">
                        {platformTagLabel(activePlatforms)}
                      </span>
                    </div>
                    <TagInput
                      placeholder="按 Enter 添加标签（# 可省略）"
                      value={tags}
                      onChange={setTags}
                      maxTags={effectiveMaxTags(activePlatforms)}
                    />
                    <SchedulePicker
                      value={schedule}
                      onChange={setSchedule}
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        id="note-headless"
                        checked={headless}
                        onCheckedChange={(checked) => setHeadless(checked === true)}
                      />
                      <Label htmlFor="note-headless" className="text-xs text-muted-foreground">
                        无头模式（不显示浏览器窗口）
                      </Label>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 草稿恢复条 ─────────────────────────────────────────── */}
        <PublishDraftBanner
          visible={pendingDraft !== null}
          savedAt={draftSavedAt}
          fieldsHint={draftBannerFieldsHint}
          fieldCount={draftFieldCountForBanner}
          onRestore={restoreDraft}
          onDiscard={discardDraft}
        />

        {/* ── 提交按钮 ─────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClearClick}>
            清空
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="btn-elegant"
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            提交图文
          </Button>
        </div>

        {/* ── 清空二次确认对话框 (≥2 字段时由 handleClearClick 触发) ──────── */}
        <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认清空表单？</AlertDialogTitle>
              <AlertDialogDescription>
                当前已填写 {filledFieldCount} 项字段。清空后会同时删除本地草稿，操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmClearOpen(false)
                  clearEverything()
                }}
              >
                清空
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ImageLightbox
          imageUrls={imageUrls}
          openIndex={lightboxIndex}
          onClose={handleLightboxClose}
          onPrev={handleLightboxPrev}
          onNext={handleLightboxNext}
        />
      </>
    )
  }),
)

/**
 * Single thumbnail rendered inside the image-grid. Memoized because the
 * grid renders N thumbnails per NoteForm and only one changes on hover/
 * remove — without memoization, removing index 3 re-renders all N tiles.
 *
 * Supports HTML5 drag-and-drop reordering: each tile is draggable, dropping
 * on another tile swaps their positions with visual feedback.
 */
const ThumbnailTile = memo(function ThumbnailTile({
  url,
  alt,
  index,
  isDragging,
  isDropTarget,
  onOpen,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onDragLeave,
}: {
  url: string
  alt: string
  index: number
  isDragging?: boolean
  isDropTarget?: boolean
  onOpen: () => void
  onRemove: () => void
  onDragStart?: () => void
  onDragOver?: () => void
  onDrop?: () => void
  onDragEnd?: () => void
  onDragLeave?: () => void
}) {
  return (
    <motion.div
      custom={index}
      variants={thumbVariants}
      initial="hidden"
      animate="visible"
      className={`relative aspect-square rounded-lg overflow-hidden border group/img cursor-pointer transition-all duration-150 ${
        isDragging ? 'opacity-30 scale-95' : ''
      } ${isDropTarget ? 'ring-2 ring-primary border-primary scale-105' : ''}`}
      onClick={onOpen}
      whileHover={{ scale: isDragging ? 0.95 : 1.02 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        const de = e as unknown as React.DragEvent<HTMLDivElement>
        de.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const de = e as unknown as React.DragEvent<HTMLDivElement>
        de.dataTransfer.dropEffect = 'move'
        onDragOver?.()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDrop?.()
      }}
      onDragEnd={() => {
        onDragEnd?.()
      }}
      onDragLeave={() => {
        onDragLeave?.()
      }}
    >
      {/* Order number badge */}
      <span className="absolute top-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-[9px] font-medium text-white opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
        {index + 1}
      </span>
      <img
        src={url}
        alt={alt}
        className="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-105"
        draggable={false}
      />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <Maximize className="h-4 w-4 text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
      </div>
      <button
        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="删除图片"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  )
})
