import type { FormPreviewData } from './previewTypes'
import { memo } from 'react'
import { motion } from 'motion/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { Eye, FileText, Image, Video, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export type { FormPreviewData } from './previewTypes'

type PublishPreviewProps = {
  mode: 'video' | 'note'
  data: FormPreviewData
}

const hasContent = (d: FormPreviewData) =>
  d.title || d.desc || d.tags || d.fileUrls.length > 0

const tagList = (tags: string | string[] | undefined | null) =>
  (Array.isArray(tags) ? tags.join(",") : tags || "")
    .split(/[,，]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)

/**
 * Live preview of the publish form content. Reads only from props — no
 * store access, no side effects. The parent (PublishPage) feeds it via
 * `onFormChange` callbacks from VideoForm / NoteForm.
 */
export const PublishPreview = memo(function PublishPreview({
  mode,
  data,
}: PublishPreviewProps) {
  if (!hasContent(data)) {
    return (
      <Card className="card-refined h-fit">
        <CardHeader className="pb-0 pt-5">
          <CardTitle className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Eye className="h-3.5 w-3.5" />
            </div>
            <span>内容预览</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-4">
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/40 px-4 py-8 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/20 mb-3" />
            <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-[200px]">
              填写表单后，这里会实时展示发布内容的预览效果
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const tags = tagList(data.tags)
  const label = mode === 'video' ? '描述' : '内容'

  return (
    <Card className="card-refined h-fit">
      <CardHeader className="pb-0 pt-5">
        <CardTitle className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Eye className="h-3.5 w-3.5" />
          </div>
          <span>内容预览</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {mode === 'video' ? '视频' : '图文'}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 px-5 pb-5 pt-4">
        {/* ── Thumbnail ──────────────────────────────────── */}
        {data.fileUrls.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="relative rounded-xl overflow-hidden bg-muted ring-1 ring-border/30"
          >
            {data.fileType === 'video' ? (
              <video
                src={data.fileUrls[0]}
                className="w-full max-h-[200px] object-contain bg-black/5"
                controls
                preload="metadata"
              />
            ) : (
              <div className="grid grid-cols-2 gap-px max-h-[200px] overflow-hidden bg-border/20">
                {data.fileUrls.slice(0, 4).map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`预览 ${i + 1}`}
                    className={cn(
                      'w-full object-cover transition-transform duration-300 hover:scale-105',
                      data.fileUrls.length <= 2 && i === 0 ? 'col-span-2 h-full max-h-[200px]' : 'h-[99px]',
                    )}
                  />
                ))}
                {data.fileUrls.length > 4 && (
                  <div className="flex items-center justify-center bg-muted text-xs font-medium text-muted-foreground h-[99px]">
                    +{data.fileUrls.length - 4}
                  </div>
                )}
              </div>
            )}
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded-lg bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] text-white">
              {data.fileType === 'video' ? (
                <Video className="h-3 w-3" />
              ) : (
                <Image className="h-3 w-3" />
              )}
              <span className="font-medium">{data.fileType === 'video' ? '视频' : `${data.fileUrls.length} 张图片`}</span>
            </div>
          </motion.div>
        )}

        {/* ── Title ──────────────────────────────────────── */}
        {data.title && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              标题
            </span>
            <p className="text-sm font-semibold leading-snug text-foreground">{data.title}</p>
          </div>
        )}

        {/* ── Content divider (if desc or tags follow) ───── */}
        {(data.desc || tags.length > 0) && data.title && (
          <div className="border-t border-border/30" />
        )}

        {/* ── Desc ───────────────────────────────────────── */}
        {data.desc && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {label}
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
              {data.desc}
            </p>
          </div>
        )}

        {/* ── Tags ───────────────────────────────────────── */}
        {tags.length > 0 && (
          <div className="space-y-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              标签
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-md bg-primary/5 border border-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary/80"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1 border-t border-border/20">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/50">
              发布后效果参考
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/40 tabular-nums">
            {[data.title && '标题', data.desc && label, tags.length > 0 && `${tags.length} 标签`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </CardContent>
    </Card>
  )
})
