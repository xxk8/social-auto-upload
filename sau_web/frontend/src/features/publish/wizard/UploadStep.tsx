import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Button,
  Card,
  CardContent,
} from '@/Components/ui/index'
import { cn } from '@/lib/utils'
import { useToast } from '@/Components/ui/toast'
import { getNoteImageLimit } from '@/api/client'
import {
  ArrowDownToLine,
  FilePlus,
  ImageIcon,
  UploadCloud,
  Video,
  X,
  Maximize,
} from 'lucide-react'
import { SectionHeader } from '../shared'
import { cardVariants, springTransition, thumbVariants } from '../animations'
import { ImageLightbox } from '../ImageLightbox'
import { formatFileSize } from '@/lib/features'
import { usePublishWizardStore, type WizardMode } from '@/stores/publishWizardStore'
import type { GroupSelection } from '../GroupPublishSelector'

/**
 * §11.3 — UploadStep (the first step of the PublishWizard).
 *
 * Engineering-tool polish pass:
 *   1. Mode selector rewritten as 2 deliberate cards (`<ModeCard>` × 2,
 *      in-file helper, NOT exported — keeps the `only-export-components`
 *      rule inviolate). Selection cue is a 2px sodium-amber left-strip +
 *      icon-color shift — NO block-fill on the active card (mirrors
 *      DESIGN.md `chrome-patterns.sidebar-active-row` reused on cards).
 *   2. File input wrapped with `<label htmlFor>` instead of `<div onClick>`
 *      + `getElementById('…').click()`. The label/input pair natively
 *      satisfies WCAG (it's what the browser console warnings reported:
 *      "No label associated with a form field" + "A form field element
 *      should have an id or name attribute"). `<input>` is now `sr-only`
 *      so it stays focusable + screen-reader-visible but doesn't paint.
 *   3. Drop overlay flipped from `border-primary bg-primary/10` (a tint
 *      block-fill) to a 2px `ring-primary ring-inset` (a precise frame).
 *      Aligns with DESIGN.md "no block-fill on selected state" rule.
 *   4. Platform-aware vertical format hints — driven by
 *      `groupSelection.platforms`. Empty group → a single generic line;
 *      one or more platforms selected → mono lines per platform.
 *
 * State flows through `usePublishWizardStore` (unchanged):
 *   - `mode` controls which upload UI is shown
 *   - `files.file` / `files.images` hold the chosen File(s)
 *
 * `onFormChange` (preview URLs + fileType) is reported upward unchanged
 * so ReviewStep can preview.
 */

// ── Format hint tables (vertical, mono) ──────────────────────────────────
// Source-of-truth note: these two maps are step-0-only (UI affordance for
// the dropzone footer). Image-COUNT caps are NOT here — those are owned
// by `src/api/client.ts::NOTE_PLATFORM_IMAGE_LIMITS` and consulted by
// `usePublishWizardStore.canProceed()` to gate the "next" button.
const VIDEO_FORMAT_HINTS: Record<string, string> = {
  douyin: '抖音 · 单视频 · ≤ 1h · 1080p 推荐',
  kuaishou: '快手 · 单视频 · ≤ 1h · MP4',
  tencent: '视频号 · 单视频 · ≤ 1h · 竖屏 9:16',
  bilibili: 'B 站 · 单视频 · H.264 · 1080p',
  xiaohongshu: '小红书 · 单视频 · 横屏 16:9 · 1080p',
  tiktok: 'TikTok · ≤ 10 min · 1080p · 30fps',
  baijiahao: '百家号 · 单视频 · 横屏',
}

const NOTE_FORMAT_HINTS: Record<string, string> = {
  xiaohongshu: '小红书 · 最多 9 张 · 首图必选',
  douyin: '抖音 · 最多 30 张 · 拼图',
  kuaishou: '快手 · 最多 18 张 · 自动轮播',
  bilibili: 'B 站 · 最多 20 张 · 1080p',
  tencent: '视频号 · 9 张图集',
  baijiahao: '百家号 · 图片轮播',
}

interface UploadStepProps {
  groupSelection: GroupSelection | null
  onFormChange?: (urls: string[], fileType: 'video' | 'image' | null) => void
}

export const UploadStep = memo(function UploadStep({
  groupSelection,
  onFormChange,
}: UploadStepProps) {
  const { addToast } = useToast()
  const mode = usePublishWizardStore((s) => s.mode)
  const setMode = usePublishWizardStore((s) => s.setMode)
  const files = usePublishWizardStore((s) => s.files)
  const setFiles = usePublishWizardStore((s) => s.setFiles)

  const [dragOver, setDragOver] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const dragIdxRef = useRef<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  /**
   * Stable mode group label id. `useId()` is deterministic per
   * component instance; stripping `:` keeps the rendered id
   * alphanumeric so it survives a CSS-selector query. Multiple
   * wizard instances on one page each get a unique
   * `aria-labelledby` link. (Hardcoded string ids would clash on
   * the second mount.)
   */
  const modeLabelId = `wizard-mode-label-${useId().replace(/:/g, '')}`

  const activePlatforms = groupSelection?.platforms ?? []
  const imageLimit = Math.min(
    ...(activePlatforms.length > 0 ? activePlatforms.map((p) => getNoteImageLimit(p)) : [30]),
  )

  // ── Preview URL management ──────────────────────────────────────────
  const videoPreviewUrl = useMemo(
    () => (files.file ? URL.createObjectURL(files.file) : null),
    [files.file],
  )
  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl)
    }
  }, [videoPreviewUrl])

  const imagePreviewUrls = useMemo(
    () => files.images.map((f) => URL.createObjectURL(f)),
    [files.images],
  )
  useEffect(() => {
    return () => {
      imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [imagePreviewUrls])

  // Report preview URLs upward (stable ref pattern).
  const onFormChangeRef = useRef(onFormChange)
  useEffect(() => {
    onFormChangeRef.current = onFormChange
  }, [onFormChange])

  useEffect(() => {
    const handler = onFormChangeRef.current
    if (!handler) return
    if (mode === 'video') {
      handler(videoPreviewUrl ? [videoPreviewUrl] : [], files.file ? 'video' : null)
    } else {
      handler(imagePreviewUrls, files.images.length > 0 ? 'image' : null)
    }
  }, [mode, videoPreviewUrl, imagePreviewUrls, files.file, files.images.length])

  // ── File handlers ────────────────────────────────────────────────────

  /** Max video file size before warning (2 GB). Non-blocking — the toast
   *  informs but does not prevent upload. */
  const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024
  /** Max video duration before warning (1 hour). Non-blocking. */
  const MAX_VIDEO_DURATION = 3600

  /** Tracks the in-flight duration-check <video> element so a rapid
   *  second file selection can cancel and clean up the first one. */
  const durationCheckRef = useRef<HTMLVideoElement | null>(null)

  const handleVideoSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/')) {
        addToast('请选择视频文件', 'warning')
        return
      }

      // ── Cancel any in-flight duration check from a previous file ────
      if (durationCheckRef.current) {
        URL.revokeObjectURL(durationCheckRef.current.src)
        durationCheckRef.current.onloadedmetadata = null
        durationCheckRef.current.onerror = null
        durationCheckRef.current = null
      }

      // ── Size check (non-blocking warning) ──────────────────────────
      if (file.size > MAX_VIDEO_SIZE) {
        addToast(
          `视频文件较大（${formatFileSize(file.size)}），建议压缩后再上传`,
          'warning',
        )
      }

      // ── Duration check (non-blocking warning) ───────────────────────
      // Uses a temporary <video> element to read metadata. The ref guard
      // above cancels any previous in-flight check, so rapid swaps
      // don't leak object URLs.
      const videoUrl = URL.createObjectURL(file)
      const video = document.createElement('video')
      durationCheckRef.current = video
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        video.onerror = null // mutually exclusive — prevent double-cleanup
        URL.revokeObjectURL(videoUrl)
        durationCheckRef.current = null
        if (video.duration > MAX_VIDEO_DURATION) {
          const h = Math.floor(video.duration / 3600)
          const m = Math.floor((video.duration % 3600) / 60)
          addToast(
            `视频时长较长（${h}h${m}m），部分平台有 1 小时限制`,
            'warning',
          )
        }
      }
      video.onerror = () => {
        video.onloadedmetadata = null
        URL.revokeObjectURL(videoUrl)
        durationCheckRef.current = null
      }
      video.src = videoUrl

      setFiles({ file, images: [] })
    },
    [setFiles, addToast],
  )

  const addImagesWithinLimit = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return
      const remaining = imageLimit - files.images.length
      if (remaining <= 0) {
        addToast(`当前平台最多只能添加 ${imageLimit} 张图片`, 'warning')
        return
      }
      const toAdd = incoming.slice(0, remaining)
      if (toAdd.length < incoming.length) {
        addToast(`已截取前 ${toAdd.length} 张（当前平台限制 ${imageLimit} 张）`, 'warning')
      }
      setFiles({ images: [...files.images, ...toAdd] })
    },
    [files.images, imageLimit, setFiles, addToast],
  )

  const removeImage = useCallback(
    (idx: number) => {
      const next = files.images.filter((_, i) => i !== idx)
      setFiles({ images: next })
      setLightboxIndex((prev) => {
        if (prev === null) return prev
        if (idx < prev) return prev - 1
        if (idx === prev) return null
        return prev
      })
    },
    [files.images, setFiles],
  )

  const moveImage = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return
      const next = [...files.images]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      setFiles({ images: next })
    },
    [files.images, setFiles],
  )

  const handleModeChange = useCallback(
    (newMode: WizardMode) => {
      if (newMode === mode) return
      setMode(newMode)
    },
    [mode, setMode],
  )

  return (
    <motion.div
      custom={0}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
    >
      <Card className="card-refined">
        <CardContent className="p-3 sm:p-5 space-y-3 sm:space-y-5">
          <SectionHeader icon={<FilePlus className="h-4 w-4" />} title="上传素材" />

          {/* ── Mode selector: compact toggle (slimmed from 2 full cards) ──
              精简后的模式切换：两个小型按钮，仅显示图标 + 标签，
              无描述文本、无 2px 琥珀左条。选中态：primary bg +
              primary-foreground ink；非选中：outline 边框。 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span
                id={modeLabelId}
                className="text-xs text-muted-foreground"
              >
                发布模式
              </span>
            </div>
            <div
              role="group"
              aria-labelledby={modeLabelId}
              className="flex gap-2"
            >
              <button
                type="button"
                onClick={() => handleModeChange('video')}
                aria-pressed={mode === 'video'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  'outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  mode === 'video'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Video className="h-4 w-4" />
                视频
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('note')}
                aria-pressed={mode === 'note'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  'outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  mode === 'note'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <ImageIcon className="h-4 w-4" />
                图文
              </button>
            </div>
          </div>

          {/* ── Step content (animated transitions) ───────────────── */}
          <AnimatePresence mode="wait">
            {mode === 'video' && (
              <VideoDropzone
                key="video-dropzone"
                file={files.file}
                previewUrl={videoPreviewUrl}
                dragOver={dragOver}
                formats={platformFormatLines(activePlatforms, 'video')}
                onSetDragOver={setDragOver}
                onSelectFile={handleVideoSelect}
                onClear={() => setFiles({ file: null })}
              />
            )}

            {mode === 'note' && (
              <NoteDropzone
                key="note-dropzone"
                images={files.images}
                imageLimit={imageLimit}
                previewUrls={imagePreviewUrls}
                dragOver={dragOver}
                formats={platformFormatLines(activePlatforms, 'note')}
                onSetDragOver={setDragOver}
                onAddImages={addImagesWithinLimit}
                onRemoveImage={removeImage}
                onMoveImage={moveImage}
                onOpenLightbox={(idx) => setLightboxIndex(idx)}
                dragIndex={dragIndex}
                setDragIndex={setDragIndex}
                dropTarget={dropTarget}
                setDropTarget={setDropTarget}
                dragIdxRef={dragIdxRef}
              />
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {mode === 'note' && lightboxIndex !== null && (
        <ImageLightbox
          imageUrls={imagePreviewUrls}
          openIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() =>
            setLightboxIndex((i) =>
              i !== null && i < files.images.length - 1 ? i + 1 : i,
            )
          }
        />
      )}
    </motion.div>
  )
})

// ── Helpers (in-file, NOT exported — keeps only-export-components alive) ──

/**
 * Build the per-platform format hint strip shown beneath the dropzone.
 *  - No platforms selected → a generic nudge to pick a group upstream.
 *  - One+ platforms selected → one mono line per platform, label and
 *    detail both inside the same string (per
 *    DESIGN.md pillow-text-rules.separator-glyph — U+00B7 hairline
 *    middle dot is the canonical separator).
 *  - Platforms not in the local hint table (rare — tiktok in note mode)
 *    are silently skipped so a future PLATFORMS addition doesn't crash.
 */
function platformFormatLines(platforms: string[], kind: 'video' | 'note'): string[] {
  if (platforms.length === 0) {
    return ['未选平台 · 请先在上方选择账号组']
  }
  const table = kind === 'video' ? VIDEO_FORMAT_HINTS : NOTE_FORMAT_HINTS
  return platforms.flatMap((p) => {
    const hint = table[p]
    return hint ? [hint] : []
  })
}

const FormatHintStrip = memo(function FormatHintStrip({
  formats,
}: {
  formats: string[]
}) {
  if (formats.length === 0) return null
  return (
    <div
      className="font-mono text-[11px] leading-relaxed tabular-nums tracking-tight text-muted-foreground/80"
      aria-label="平台格式建议"
    >
      {formats.length === 1 ? (
        <span>
          <span aria-hidden>[●]</span> {formats[0]}
        </span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {formats.map((line) => (
            <span key={line}>
              <span aria-hidden>[●]</span> {line}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})

/** Video dropzone — wrapped with `<label htmlFor>` so the file input is
 *  natively associated (fixes the console warning). Empty-state pure
 *  visual cue is `UploadCloud` (subtle scale-up + transformation). */
const VideoDropzone = memo(function VideoDropzone({
  file,
  previewUrl,
  dragOver,
  formats,
  onSetDragOver,
  onSelectFile,
  onClear,
}: {
  file: File | null
  previewUrl: string | null
  dragOver: boolean
  formats: string[]
  onSetDragOver: (over: boolean) => void
  onSelectFile: (file: File) => void
  onClear: () => void
}) {
  const inputId = useId()
  const inputIdSafe = `wizard-video-input-${inputId.replace(/:/g, '')}`

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="space-y-3"
    >
      <label
        htmlFor={inputIdSafe}
        className={cn(
          'relative flex flex-col items-center justify-center rounded-xl p-4 sm:p-6 cursor-pointer transition-colors duration-200 outline-none',
          'focus-visible:ring-1 focus-visible:ring-ring',
          dragOver
            ? 'ring-2 ring-primary ring-inset border-transparent bg-card'
            : file
              ? 'border border-primary/40 bg-card'
              : 'border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onSetDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!e.currentTarget.contains(e.relatedTarget as Node)) onSetDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onSetDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onSelectFile(f)
        }}
      >
        {file && previewUrl ? (
          <motion.div
            key={file.name + file.size}
            className="w-full space-y-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springTransition}
          >
            <div className="relative rounded-lg overflow-hidden bg-black/70 group/video">
              <video
                src={previewUrl}
                controls
                className="w-full max-h-[240px] sm:max-h-[360px] object-contain"
                preload="metadata"
              >
                您的浏览器不支持视频预览
              </video>
              <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-7 w-7 bg-black/60 hover:bg-black/80 text-white border-0"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onClear()
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80 truncate max-w-[200px]">
                {file.name}
              </span>
              <span>{formatFileSize(file.size)}</span>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 sm:gap-2 py-2.5 sm:py-4">
            {dragOver ? (
              <ArrowDownToLine className="h-8 w-8 text-primary" />
            ) : (
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
            )}
            <p className="text-sm font-medium text-foreground">
              {dragOver ? '松开即可上传' : '点击选择视频 或 拖入此处'}
            </p>
            <p className="text-[11px] text-muted-foreground/80 font-mono tabular-nums tracking-tight">
              MP4 · MOV · AVI · 常见格式
            </p>
          </div>
        )}
        <input
          id={inputIdSafe}
          name="wizard_video_file"
          type="file"
          accept="video/*"
          className="sr-only"
          aria-label="上传视频文件"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onSelectFile(f)
          }}
        />
      </label>

      <FormatHintStrip formats={formats} />
    </motion.div>
  )
})

/** Note dropzone — same `<label htmlFor>` + `sr-only` pattern. */
const NoteDropzone = memo(function NoteDropzone({
  images,
  imageLimit,
  previewUrls,
  dragOver,
  formats,
  onSetDragOver,
  onAddImages,
  onRemoveImage,
  onMoveImage,
  onOpenLightbox,
  dragIndex,
  setDragIndex,
  dropTarget,
  setDropTarget,
  dragIdxRef,
}: {
  images: File[]
  imageLimit: number
  previewUrls: string[]
  dragOver: boolean
  formats: string[]
  onSetDragOver: (over: boolean) => void
  onAddImages: (incoming: File[]) => void
  onRemoveImage: (idx: number) => void
  onMoveImage: (fromIdx: number, toIdx: number) => void
  onOpenLightbox: (idx: number) => void
  dragIndex: number | null
  setDragIndex: (n: number | null) => void
  dropTarget: number | null
  setDropTarget: (n: number | null) => void
  dragIdxRef: React.MutableRefObject<number | null>
}) {
  const inputId = useId()
  const inputIdSafe = `wizard-note-input-${inputId.replace(/:/g, '')}`
  // Independent useId() so this label is independent of the parent
  // UploadStep's mode-label id across co-mounted siblings.
  const noteLabelId = `wizard-note-label-${useId().replace(/:/g, '')}`

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="space-y-3"
    >
      {/* 图片分组标题 — 用 `<span id>` + `aria-labelledby` 而不是 `<Label>`，
          因为下方 dropzone 已经用 native <label htmlFor> 接住 file input，
          上方标题是分组头而非 form-label。 */}
      <span id={noteLabelId}>图片</span>
      <label
        htmlFor={inputIdSafe}
        className={cn(
          'flex flex-col items-center justify-center rounded-xl p-6 cursor-pointer transition-colors duration-200 outline-none',
          'focus-visible:ring-1 focus-visible:ring-ring',
          dragOver
            ? 'ring-2 ring-primary ring-inset border-transparent bg-card'
            : 'border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onSetDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!e.currentTarget.contains(e.relatedTarget as Node)) onSetDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onSetDragOver(false)
          const droppedFiles = e.dataTransfer.files
          if (droppedFiles) {
            const newImages = Array.from(droppedFiles).filter((f) =>
              f.type.startsWith('image/'),
            )
            if (newImages.length > 0) onAddImages(newImages)
          }
        }}
      >
        <ImageIcon className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm font-medium text-foreground">点击添加图片 或 拖入此处</p>
        <p className="text-[11px] text-muted-foreground/80 font-mono tabular-nums tracking-tight mt-1">
          JPG · PNG · GIF · WebP · {imageLimit} 张以内
        </p>
        <input
          id={inputIdSafe}
          name="wizard_note_images"
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="上传图片文件"
          onChange={(e) => {
            const fileList = e.target.files
            if (fileList) onAddImages(Array.from(fileList))
          }}
        />
      </label>

      {images.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {images.length}/{imageLimit} 张
              {images.length > 1 && ' · 拖拽可调整顺序'}
            </p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2">
            {images.map((file, idx) => (
              <ImageTile
                key={`${file.name}-${file.size}-${file.lastModified}`}
                url={previewUrls[idx]}
                alt={`图片 ${idx + 1}`}
                index={idx}
                isDragging={dragIndex === idx}
                isDropTarget={dropTarget === idx}
                onOpen={() => onOpenLightbox(idx)}
                onRemove={() => onRemoveImage(idx)}
                onDragStart={() => {
                  dragIdxRef.current = idx
                  setDragIndex(idx)
                }}
                onDragOver={() => setDropTarget(idx)}
                onDrop={() => {
                  if (dragIdxRef.current != null) {
                    onMoveImage(dragIdxRef.current, idx)
                  }
                  setDragIndex(null)
                  setDropTarget(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setDropTarget(null)
                }}
                onDragLeave={() => setDropTarget(null)}
              />
            ))}
          </div>
        </>
      )}

      <FormatHintStrip formats={formats} />
    </motion.div>
  )
})

/** Individual image thumbnail tile with drag-reordering support.
 *  Uses native `<button type=button>` for the tile + a stopPropagation
 *  remove button so a click stays in element space. */
const ImageTile = memo(function ImageTile({
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
      className={cn(
        'relative aspect-square rounded-lg overflow-hidden border group/img cursor-pointer transition-all duration-150',
        isDragging && 'opacity-30 scale-95',
        isDropTarget && 'ring-2 ring-primary border-primary scale-105',
      )}
      onClick={onOpen}
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
      onDragEnd={() => onDragEnd?.()}
      onDragLeave={() => onDragLeave?.()}
    >
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
        type="button"
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
