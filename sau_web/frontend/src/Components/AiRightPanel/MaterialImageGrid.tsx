import { memo, useCallback } from 'react'
import type { NormalizedImage } from '@/api/ai'
import { useMaterialPanelStore } from '@/stores/materialPanelStore'
import { useToast } from '@/Components/ui/toast'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import type { RefObject } from 'react'
import { cn } from '@/lib/utils'
import { Loader2, ImagePlus, Check } from 'lucide-react'

interface MaterialImageGridProps {
  /** Result list. Separate passes for manual vs recommend — caller controls grouping. */
  images: NormalizedImage[]
  /** Show a header strip ("搜索结果" / "为你推荐") above the grid. */
  sourceLabel: string
  /** Render-mode hint for the click-toast;
   *  - 'note'  = apply as image-array
   *  - 'video' = apply as thumbnail (URL only, no File download) */
  formMode: 'video' | 'note'
  formRef: RefObject<FormHandle | null>
  /** Tailwind class for the parent container height; collapsed-when-empty uses default. */
  gridClassName?: string
}

/**
 * 3×3 (or 2×N for smaller counts) click-to-add image grid.
 * Per spec §"Material image grid":
 *   • Click → `materialPanelStore.addImageToForm(image)` → success toast
 *   • Hover → corner badge "来源 · 摄影师"
 *   • Per-tile isAdding (debounces spam clicks on the same tile)
 *
 * No internal layout state — pure controlled rendering: parent owns
 * `images[]` (manual vs recommend slot), this component just maps it.
 *
 * Failure surface: `safeApplyMedia` returns `{applied: false, reason}`
 * and the FORM's `applyMedia` impl is responsible for the precise
 * "切换到图文模式" toast. We re-`addToast` only when the image-fetch
 * proxy itself failed (not the form rejection), so the user sees one
 * coherent error per click.
 */
export const MaterialImageGrid = memo(function MaterialImageGrid({
  images,
  sourceLabel,
  formMode,
  formRef,
  gridClassName,
}: MaterialImageGridProps) {
  const addImageToForm = useMaterialPanelStore((s) => s.addImageToForm)
  const addingIds = useMaterialPanelStore((s) => s.addingImageIds)
  const { addToast } = useToast()

  const handleClick = useCallback(
    async (img: NormalizedImage) => {
      // Form-side veto + grid single-source-of-truth toasts. This
      // closes the §6-9 review 双 toast UX wart:
      //   - history: VideoForm.applyMedia({images}) inner-toasted
      //     "视频表单不支持图文附件..." + the grid's post-await
      //     "封面图片已应用" stacked on the same tile click.
      //   - The fix: forms implement applyMedia and return an
      //     ApplyAttempt WITHOUT inner toasts; the grid here is the
      //      sole owner of toast copy. Locked by
      //     MaterialSection.test.tsx "video-mode + form reject" + the
      //     single-toast invariant `toastSpy.mock.calls.length === 1`.
      const attempt = await addImageToForm(img, formRef, formMode)
      if (attempt.applied) {
        addToast(formMode === 'note' ? '已加入图文附件' : '封面图片已应用', 'success')
        return
      }
      switch (attempt.reason) {
        case 'no-media-slot':
          // Form rejected the key — most often because the user's mode
          // doesn't match the media type picked.
          addToast(
            formMode === 'note'
              ? '视频素材请切换到视频发布'
              : '请切换到图文模式以添加图片',
            'warning',
          )
          break
        case 'threw':
          // Form impl raised / fetch bytes flow threw — surface the
          // underlying message verbatim so the user sees the cause.
          addToast(attempt.message ?? '图片加入失败', 'error')
          break
        case 'debounced':
        case 'unmounted':
          // Silent no-op: spam-click on in-flight tile (debounced),
          // or page nav lost the ref (unmounted). Don't spam toasts.
          break
      }
    },
    [addImageToForm, formRef, formMode, addToast],
  )

  if (images.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-col gap-1.5', gridClassName)}>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-medium">{sourceLabel}</span>
        <span className="font-mono tabular-nums">{images.length} 张</span>
      </div>
      <div
        className="grid grid-cols-3 gap-1.5"
        data-testid="material-image-grid"
      >
        {images.map((img) => {
          const isAdding = addingIds.has(img.id)
          return (
            <button
              key={img.id}
              type="button"
              onClick={() => handleClick(img)}
              disabled={isAdding}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-md border border-border/40 bg-muted/30',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                'transition-all duration-150 hover:border-primary/40 hover:scale-[1.02]',
                isAdding && 'opacity-60 cursor-wait',
              )}
              data-source={img.source}
              data-image-id={img.id}
              title={`${img.source} · ${img.photographer}`}
            >
              <img
                src={img.thumb}
                alt={img.alt || img.photographer}
                loading="lazy"
                className="h-full w-full object-cover transition-opacity duration-200 group-hover:opacity-95"
                draggable={false}
              />
              {isAdding ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </div>
              ) : (
                <>
                  {/* Hover badge: source chip + photographer */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-0.5 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                    <div className="bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3">
                      <div className="flex items-center justify-between gap-1 text-[9px]">
                        <span className="font-mono uppercase text-white/90">
                          {img.source}
                        </span>
                        <span className="truncate text-white/80">
                          {img.photographer}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* "+" affordance on hover (quick-add icon) */}
                  <div className="pointer-events-none absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary/85 text-primary-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <ImagePlus className="h-2.5 w-2.5" />
                  </div>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
})

/**
 * Skeleton fallback for `imageLoading` state. 6-tile pulsing placeholders
 * mirroring the `grid-cols-3` layout so the grid doesn't height-collapse
 * mid-fetch (whose absence previously triggered a jarring chat viewport
 * reflow).
 */
export const MaterialImageGridSkeleton = memo(function MaterialImageGridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1.5" data-testid="material-image-grid-skeleton">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square animate-pulse rounded-md bg-muted/40"
        />
      ))}
    </div>
  )
})

/**
 * Empty-state. Tiny single-line "无搜索结果" hint when no images
 * NORMALLY but the user already searched (so we don't show "搜索以查看"
 * pre-search which is already covered by the placeholder text in the
 * search input).
 */
export const MaterialImageGridEmpty = memo(function MaterialImageGridEmpty({
  message = '暂无结果，换个关键词试试',
}: { message?: string }) {
  return (
    <div className="flex h-12 items-center justify-center text-[11px] text-muted-foreground/70">
      <span>{message}</span>
    </div>
  )
})

/** Tiny chip used by the image-card click + selected state alternative. */
export const ImageAddedFlag = memo(function ImageAddedFlag() {
  return (
    <div className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white">
      <Check className="h-2.5 w-2.5" />
    </div>
  )
})
