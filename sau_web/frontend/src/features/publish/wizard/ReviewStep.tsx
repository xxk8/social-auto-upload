import { memo, useCallback, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import {
  Card,
  CardContent,
  Badge,
} from '@/Components/ui/index'
import {PlatformIcon} from '@/Components/ui/platform-icon';import {
  Clock,
  Eye,
  FileText,
  Image as ImageIcon,
  Video,
  Send,
  Tag,
} from 'lucide-react'
import {SectionHeader} from '../shared';import { cardVariants } from '../animations'
import { cn } from '@/lib/utils'
import { usePublishWizardStore } from '@/stores/publishWizardStore'
import {useToast} from '@/Components/ui/toast.helpers';import { api, PLATFORMS } from '@/api/client'
import type { GroupSelection } from '../GroupPublishSelector'

/**
 * §11.5 — ReviewStep (Step 3 of the Publish Wizard).
 *
 * Shows a read-only summary of everything the user has entered:
 *   - File/media preview (video thumbnail or image count)
 *   - Title, description/note, tags
 *   - Schedule (if set)
 *   - Target platforms from the group selection
 *
 * The submit button fires the actual upload calls — it dispatches to
 * `api.uploadVideo` or `api.uploadNoteMultipart` for each selected
 * platform mapping, exactly as VideoForm/NoteForm do today.
 */

interface ReviewStepProps {
  groupSelection: GroupSelection | null
  previewUrls: string[]
  previewFileType: 'video' | 'image' | null
  onSubmit: (info: { count: number; taskIds: string[]; failedCount: number; mode: '视频' | '图文' }) => void
  /** Ref-based imperative submit — called by WizardNav's submit button. */
  submitRef: React.MutableRefObject<(() => Promise<void>) | null>
}

export const ReviewStep = memo(function ReviewStep({
  groupSelection,
  previewUrls,
  previewFileType,
  onSubmit,
  submitRef,
}: ReviewStepProps) {
  const { addToast } = useToast()
  const mode = usePublishWizardStore((s) => s.mode)
  const files = usePublishWizardStore((s) => s.files)
  const content = usePublishWizardStore((s) => s.content)
  const clearFiles = usePublishWizardStore((s) => s.clearFiles)
  const clearContent = usePublishWizardStore((s) => s.clearContent)

  const platformLabel = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])),
    [],
  )

  // `content.tags` is native `string[]` post-Path-C. The chip display
  // strips the canonical `#` prefix via `serializeTags` (or its
  // sibling lib helper) — the wire-format join happens ONLY at api
  // call sites below.
  const displayedTags = useMemo(
    () => content.tags.map((t) => t.replace(/^#+/, '')),
    [content.tags],
  )
  const tagsWireString = useMemo(
    () => (content.tags.length > 0 ? content.tags.join(',') : ''),
    [content.tags],
  )

  const handleSubmit = useCallback(async () => {
    if (!groupSelection?.platforms.length) {
      addToast('请先选择发布账号组', 'warning')
      return
    }

    const mappings = groupSelection.mappings.filter((m) =>
      groupSelection.platforms.includes(m.platform),
    )

    try {
      if (mode === 'video') {
        if (!files.file) {
          addToast('请先上传视频文件', 'warning')
          return
        }
        const tasks = mappings.map((mapping) =>
          api
            .uploadVideo({
              platform: mapping.platform,
              account: mapping.cookieFile,
              title: content.title,
              file: files.file!,
              desc: content.desc || undefined,
              tags: tagsWireString || undefined,
              schedule: content.schedule || undefined,
            })
            .then((res) => ({
              success: res.success,
              taskId: res.data?.task_id,
            })),
        )
        const results = await Promise.all(tasks)
        const ids = results.filter((r) => r.success && r.taskId).map((r) => r.taskId!)
        const failed = results.filter((r) => !r.success)
        if (failed.length) addToast(`${failed.length} 个任务失败`, 'error')
        else addToast(`已提交 ${results.length} 个视频任务`, 'success')
        onSubmit({ count: results.length, taskIds: ids, failedCount: failed.length, mode: '视频' })
        clearFiles()
        clearContent()
      } else {
        if (files.images.length === 0) {
          addToast('请先添加图片', 'warning')
          return
        }
        const tasks = mappings.map((mapping) =>
          api
            .uploadNoteMultipart({
              platform: mapping.platform,
              account: mapping.cookieFile,
              title: content.title,
              images: files.images,
              note: content.note || undefined,
              tags: tagsWireString || undefined,
              schedule: content.schedule || undefined,
            })
            .then((res) => ({
              success: res.success,
              taskId: res.data?.task_id,
            })),
        )
        const results = await Promise.all(tasks)
        const ids = results.filter((r) => r.success && r.taskId).map((r) => r.taskId!)
        const failed = results.filter((r) => !r.success)
        if (failed.length) addToast(`${failed.length} 个任务失败`, 'error')
        else addToast(`已提交 ${results.length} 个图文任务`, 'success')
        onSubmit({ count: results.length, taskIds: ids, failedCount: failed.length, mode: '图文' })
        clearFiles()
        clearContent()
      }
    } catch {
      addToast('提交请求失败，请检查后端连接', 'error')
    }
  }, [groupSelection, mode, files, content, addToast, clearFiles, clearContent, onSubmit])

  // Expose the submit handler via a ref so WizardNav's final-step button
  // can trigger it without duplicating the submit logic.
  useEffect(() => {
    submitRef.current = handleSubmit
    return () => { submitRef.current = null }
  }, [handleSubmit, submitRef])

  const bodyLabel = mode === 'video' ? '视频简介' : '图文正文'
  const bodyText = mode === 'video' ? content.desc : content.note

  return (
    <motion.div
      custom={0}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
    >
      <Card className="card-refined">
        <CardContent className="p-5 space-y-5">
          <SectionHeader icon={<Eye className="h-4 w-4" />} title="确认发布" />

          {/* ── Media preview ─────────────────────────────────── */}
          {previewUrls.length > 0 && previewFileType && (
            <div className="rounded-lg overflow-hidden bg-muted">
              {previewFileType === 'video' ? (
                <video
                  src={previewUrls[0]}
                  className="w-full max-h-[200px] object-contain"
                  controls
                  preload="metadata"
                />
              ) : (
                <div className="grid grid-cols-4 gap-0.5 max-h-[200px] overflow-hidden">
                  {previewUrls.slice(0, 4).map((url, i) => (
                    <img key={i} src={url} alt={`预览 ${i + 1}`} loading="lazy" className="w-full h-[88px] object-cover" />
                  ))}
                  {previewUrls.length > 4 && (
                    <div className="flex flex-col items-center justify-center gap-1 bg-muted-foreground/10 text-muted-foreground">
                      <ImageIcon className="h-4 w-4" />
                      <span className="text-[10px]">+{previewUrls.length - 4}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Content summary ───────────────────────────────── */}
          <div className="space-y-3">
            <ReviewField icon={<FileText className="h-3.5 w-3.5" />} label="标题" value={content.title || '（未填写）'} />
            <ReviewField icon={mode === 'video' ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />} label={bodyLabel} value={bodyText || '（未填写）'} multiline />
            {displayedTags.length > 0 && (
              <div className="flex items-start gap-2">
                <Tag className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {displayedTags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {content.schedule && (
              <ReviewField icon={<Clock className="h-3.5 w-3.5" />} label="定时发布" value={content.schedule} />
            )}
          </div>

          {/* ── Target platforms ──────────────────────────────── */}
          {groupSelection && groupSelection.platforms.length === 0 ? (
            // Defensive banner: 用户进入 step 2 后在 step 0 上反向
            // 取选了所有平台理论上 canProceed 已阻断前进，但若中间
            // 状态不一致出现空集，这里给出明确的 fallback。
            <div className="rounded-lg border border-warning-fg/30 bg-warning/10 p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-medium text-warning-fg">
                <Send className="h-3.5 w-3.5" />
                未选择发布平台
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                请返回第 1 步选择账号组 / 勾选至少一个目标平台后再发布。
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-muted/40 border border-border/50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Send className="h-3.5 w-3.5" />
                将发布到 {groupSelection?.platforms.length ?? 0} 个平台
              </div>
              {groupSelection && (
                <div className="flex flex-wrap gap-1.5">
                  {groupSelection.platforms.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1 rounded bg-background border border-border/60 px-2 py-0.5 text-xs font-medium"
                    >
                      <PlatformIcon platform={p} className="h-3 w-3" />
                      {platformLabel[p] ?? p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}


        </CardContent>
      </Card>
    </motion.div>
  )
})

/** Read-only review field row. */
function ReviewField({
  icon,
  label,
  value,
  multiline,
}: {
  icon: React.ReactNode
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <p className={cn('text-sm', multiline ? 'leading-relaxed line-clamp-4' : 'font-medium')}>
          {value}
        </p>
      </div>
    </div>
  )
}
