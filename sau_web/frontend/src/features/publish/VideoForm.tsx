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
import { useTranslation } from 'react-i18next'
import type { FormPreviewData } from './previewTypes'
import type { GroupSelection, PlatformSpecificSection } from './GroupPublishSelector'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/Components/ui/index'
import { cn } from '@/lib/utils'
import {PlatformIcon} from '@/Components/ui/platform-icon';import { TagInput } from '@/Components/ui/tag-input'
import { motion } from 'motion/react'
import { useToast } from '@/Components/ui/toast'
import { usePublishDraft } from '@/hooks/usePublishDraft'
import { PublishDraftBanner } from './PublishDraftBanner'
import { api } from '../../api/client'
import {
  FilePlus,
  Inbox,
  Loader2,
  Settings,
  Wand2,
  X,
} from 'lucide-react'
import {SectionHeader} from './shared';
import {effectiveMaxTags, platformTagLabel} from './shared.helpers';import { cardVariants, springTransition } from './animations'
import { SchedulePicker } from './SchedulePicker'
import { formatFileSize } from '@/lib/features'
import { Tip } from '@/lib/tip'

/**
 * Staggered entrance for each animated card in the form. `custom={index}` (0..N)
 * cascades the cards from top to bottom.
 */
/** Bilibili zone (分区) options surfaced in the advanced-options card. */
const BILIBILI_TIDS = [
  { id: 1, name: '动画' },
  { id: 13, name: '番剧' },
  { id: 168, name: '国创' },
  { id: 3, name: '音乐' },
  { id: 129, name: '舞蹈' },
  { id: 4, name: '游戏' },
  { id: 17, name: '单机游戏' },
  { id: 36, name: '科技' },
  { id: 188, name: '数码' },
  { id: 234, name: '美食' },
  { id: 223, name: '汽车' },
  { id: 155, name: '时尚' },
  { id: 202, name: '资讯' },
  { id: 181, name: '影视' },
  { id: 177, name: '纪录片' },
  { id: 23, name: '电影' },
  { id: 11, name: '电视剧' },
] as const

/** Imperative handle — parent calls `videoFormRef.current?.applyAiResult(r)`.
 *  Aliased to `FormHandle` from the chat bridge so chatAction hooks can read
 *  the same contract. `getFormSnapshot` lets the chat pipeline capture the
 *  current form contents at send time so the AI sees the user's latest edits.
 */
export type VideoFormHandle = FormHandle

/**
 * OPT-3G type re-export — union lives in GroupPublishSelector.tsx
 * (where the producer — chip + pendingPlatformConfigs memo — sits)
 * and is re-exported here so existing `import type { PlatformSpecificSection }
 * from '../VideoForm'` paths keep type-checking without changes to
 * the legacy PublishPage wiring. Add a 4th platform later by editing
 * only GroupPublishSelector.
 */
export type { PlatformSpecificSection } from './GroupPublishSelector'

type VideoFormProps = {
  /**
   * Pre-resolved group selection from GroupPublishSelector.
   * The form uses the group's cookie files directly for submission.
   */
  groupSelection?: GroupSelection | null
  /**
   * Fired on every successful submission (no thrown exceptions). Reports both
   * completed and failed task counts so the parent can show the success
   * banner / toast without parsing individual results.
   */
  onSuccess: (info: { count: number; taskIds: string[]; failedCount: number; mode: '视频' }) => void
  /** Internal exceptions (network failure, etc). The parent toasts accordingly. */
  onError: (label: '视频') => void
  /** Called on every form-change so the parent can render a live preview. */
  onFormChange?: (data: FormPreviewData) => void
  /**
   * OPT-3G: controlled `advanced` accordion state, owned by PublishPage so
   * `GroupPublishSelector`'s 'N 项平台专属待配置' chip can drive it from
   * outside the form. Default false keeps prior behaviour for callers
   * that don't opt in.
   */
  advancedOpen?: boolean
  /**
   * OPT-3G: callback fired whenever the user toggles the advanced
   * accordion inside the form (manual click on the trigger). Lets the
   * parent keep its `advancedOpen` state in sync with the form's local
   * intent so future cross-component affordances stay accurate.
   */
  onAdvancedChange?: (open: boolean) => void
  /**
   * OPT-3G: which platform-specific section (if any) to surface with a
   * highlight ring inside the expanded accordion. Cleared by the parent's
   * auto-timer (or via `onHighlightConsumed`). Three platforms are
   * supported because they are the only ones with conditional gen-fields
   * in this form: 抖音 / Bilibili / 视频号.
   */
  highlightedSection?: PlatformSpecificSection | null
}

/**
 * Video publishing form — content card (素材) + advanced options accordion,
 * stacked as animated cards. The advanced accordion holds the schedule picker,
 * headless toggle, and platform-specific fields (Douyin/Bilibili/Tencent).
 *
 * Owns 16+ fields locally so typing never re-renders the rest of PublishPage.
 *
 * Memoized because PublishPage's parent re-renders on mode toggle and on
 * AI-sidebar state changes; both pre-extraction triggered costly re-renders
 * throughout PublishPage.
 */
export const VideoForm = memo(
  forwardRef<VideoFormHandle, VideoFormProps>(function VideoForm(
    {
      groupSelection,
      onSuccess,
      onError,
      onFormChange,
      advancedOpen = false,
      onAdvancedChange,
      highlightedSection = null,
    },
    ref,
  ) {
    const { addToast } = useToast()
    const { t } = useTranslation()

    const [title, setTitle] = useState('')
    const [desc, setDesc] = useState('')
    /** Path C: native `string[]` (canonical `#tag`). Wire-format join
     *  happens only at the api.uploadVideo call site in `submit()`. */
    const [tags, setTags] = useState<string[]>([])
    const [schedule, setSchedule] = useState('')
    const [headless, setHeadless] = useState(true)
    const [thumbnail, setThumbnail] = useState('')
    const [thumbnailLandscape, setThumbnailLandscape] = useState('')
    const [thumbnailPortrait, setThumbnailPortrait] = useState('')
    const [productLink, setProductLink] = useState('')
    const [productTitle, setProductTitle] = useState('')
    const [tid, setTid] = useState<number | undefined>()
    const [shortTitle, setShortTitle] = useState('')
    const [category, setCategory] = useState('')
    const [isDraft, setIsDraft] = useState(false)
    const [enhancingField, setEnhancingField] = useState<'title' | 'desc' | null>(null)

    const fileRef = useRef<File | null>(null)
    const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [confirmClearOpen, setConfirmClearOpen] = useState(false)

    // ── PR-OPT-2D: draft auto-save + restore + clear-confirmation ───────
    // Snapshot is the canonical serializable view of every persisting field.
    // `lastFileMeta` rides along so a recovered draft can hint "请重新上传".
    // Function refs are NOT needed (state setters are reactive reference).
    const draftSnapshot = useMemo(
      () => ({
        title,
        desc,
        tags,
        schedule,
        headless,
        thumbnail,
        thumbnailLandscape,
        thumbnailPortrait,
        productLink,
        productTitle,
        tid,
        shortTitle,
        category,
        isDraft,
        lastFileMeta: fileInfo,
      }),
      [
        title,
        desc,
        tags,
        schedule,
        headless,
        thumbnail,
        thumbnailLandscape,
        thumbnailPortrait,
        productLink,
        productTitle,
        tid,
        shortTitle,
        category,
        isDraft,
        fileInfo,
      ],
    )

    const {
      pendingDraft,
      draftSavedAt,
      acknowledge,
      clearDraftStorage,
    } = usePublishDraft('video', draftSnapshot)

    // Filled-field count drives the clear-confirmation threshold (≥2).
    // Booleans don't count unless true; numbers (tid) count if non-null.
    const filledFieldCount = useMemo(() => {
      let n = 0
      const textKeys = [
        title, desc, schedule,
        thumbnail, thumbnailLandscape, thumbnailPortrait,
        productLink, productTitle, shortTitle, category,
      ] as const
      for (const v of textKeys) if (v.trim()) n++
      if (tags.length > 0) n++
      if (tid != null) n++
      if (isDraft) n++
      return n
    }, [
      title, desc, tags, schedule,
      thumbnail, thumbnailLandscape, thumbnailPortrait,
      productLink, productTitle, shortTitle, category,
      tid, isDraft,
    ])

    // Helper: copy every persisted field from a pending draft back into the
    // form's local state. The video File itself (fileRef) cannot be restored
    // across reloads — we only set the visible `fileInfo` so the user sees
    // "请重新上传" context in the empty dropzone.
    const restoreDraft = useCallback(() => {
      if (!pendingDraft) return
      const d = pendingDraft as typeof draftSnapshot
      let restored = 0
      if (d.title) { setTitle(d.title); restored++ }
      if (d.desc) { setDesc(d.desc); restored++ }
      if (Array.isArray(d.tags)) { setTags(d.tags); if (d.tags.length > 0) restored++ }
      // Legacy pre-Path-C draft (tags stored as a comma-joined string
      // in localStorage). The `as typeof draftSnapshot` cast above
      // narrows `d.tags` to `string[]` for the current snapshot shape,
      // making this branch UNREACHABLE in the type system — but at
      // runtime `usePublishDraft` may return a legacy draft where
      // `tags` is a string. The `@ts-expect-error` on the line below
      // suppresses the tsc error on the `.split` call (where `d.tags`
      // is `never` per the narrowed type) while preserving the runtime
      // legacy handling. If a future refactor widens the cast to
      // `string[] | string`, the `@ts-expect-error` can be removed.
      else if (typeof d.tags === 'string' && d.tags) {
        // @ts-expect-error - legacy drafts have `tags: string`; current type cast asserts `string[]`
        const parsed = d.tags.split(/[,，]+/).map((t) => t.trim().replace(/^#+/, '#').replace(/#+/, '#')).filter(Boolean)
        setTags(parsed)
        if (parsed.length > 0) restored++
      }
      if (typeof d.schedule === 'string') { setSchedule(d.schedule); if (d.schedule) restored++ }
      if (typeof d.headless === 'boolean') { setHeadless(d.headless); if (d.headless) restored++ }
      if (typeof d.thumbnail === 'string') { setThumbnail(d.thumbnail); if (d.thumbnail) restored++ }
      if (typeof d.thumbnailLandscape === 'string') { setThumbnailLandscape(d.thumbnailLandscape); if (d.thumbnailLandscape) restored++ }
      if (typeof d.thumbnailPortrait === 'string') { setThumbnailPortrait(d.thumbnailPortrait); if (d.thumbnailPortrait) restored++ }
      if (typeof d.productLink === 'string') { setProductLink(d.productLink); if (d.productLink) restored++ }
      if (typeof d.productTitle === 'string') { setProductTitle(d.productTitle); if (d.productTitle) restored++ }
      if (d.tid != null) { setTid(d.tid); restored++ }
      if (typeof d.shortTitle === 'string') { setShortTitle(d.shortTitle); if (d.shortTitle) restored++ }
      if (typeof d.category === 'string') { setCategory(d.category); if (d.category) restored++ }
      if (typeof d.isDraft === 'boolean') { setIsDraft(d.isDraft); if (d.isDraft) restored++ }
      if (d.lastFileMeta) {
        setFileInfo(d.lastFileMeta)
        restored++
      }
      acknowledge()
      // Guard zero-restored: a draft of only `headless: true` (default) or
      // cleared form defaults would otherwise say "已恢复 0 项字段".
      if (restored > 0) {
        addToast(`已恢复 ${restored} 项字段；视频文件请重新上传`, 'success')
      } else {
        addToast('草稿内容全部为空，未应用', 'info')
      }
    }, [pendingDraft, acknowledge, addToast])

    const discardDraft = useCallback(() => {
      clearDraftStorage()
      acknowledge()
    }, [clearDraftStorage, acknowledge])

    /** Restore draft hint text — surfaces in the banner under the heading. */
    const draftBannerFieldsHint = useMemo(() => {
      if (!pendingDraft) return undefined
      const d = pendingDraft as Record<string, unknown>
      const filled: string[] = []
      if (typeof d.title === 'string' && d.title.trim()) filled.push('标题')
      if (typeof d.desc === 'string' && d.desc.trim()) filled.push('简介')
      if (Array.isArray(d.tags) ? d.tags.length > 0 : typeof d.tags === 'string' && d.tags.trim()) filled.push('标签')
      if (typeof d.schedule === 'string' && d.schedule.trim()) filled.push('定时')
      if (d.lastFileMeta) filled.push('视频元信息')
      return filled.length > 0
        ? `将恢复：${filled.join(' · ')}${filled.includes('视频元信息') ? '（视频需重新上传）' : ''}`
        : '草稿不含可恢复字段；视频需重新上传'
    }, [pendingDraft])

    /** draft fields count, ignoring pure-metadata entries, for the banner footer. */
    const draftFieldCountForBanner = useMemo(() => {
      if (!pendingDraft) return 0
      const d = pendingDraft as Record<string, unknown>
      let n = 0
      for (const k of ['title', 'desc', 'schedule', 'thumbnail', 'thumbnailLandscape', 'thumbnailPortrait', 'productLink', 'productTitle', 'shortTitle', 'category']) {
        const v = d[k]
        if (typeof v === 'string' && v.trim()) n++
      }
      if (Array.isArray(d.tags) && d.tags.length > 0) n++
      else if (typeof d.tags === 'string' && d.tags.trim()) n++
      if (d.tid != null) n++
      return n
    }, [pendingDraft])

    /** Currently selected/active platforms for conditional field rendering. */
    const activePlatforms = useMemo(
      () => new Set(groupSelection?.platforms ?? []),
      [groupSelection],
    )
    const hasDouyin = activePlatforms.has('douyin')
    const hasBilibili = activePlatforms.has('bilibili')
    const hasTencent = activePlatforms.has('tencent')
    const hasAnyPlatformSpecific = hasDouyin || hasBilibili || hasTencent

    const OPTIMIZE_MODEL = 'google/gemma-3-1b-it:free'

    const enhanceField = useCallback(async (field: 'title' | 'desc') => {
      const value = field === 'title' ? title : desc
      if (!value.trim()) return
      setEnhancingField(field)
      const partName = field === 'title' ? '标题' : '视频简介'
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
              if (field === 'title') setTitle(result)
              else setDesc(result)
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
    }, [title, desc, addToast])

    /**
     * Stable imperative handle. Setters returned by useState are reference-
     * stable across renders, so listing them explicitly silences any
     * `react-hooks/exhaustive-deps` lint warnings without changing behavior.
     */
    useImperativeHandle(
      ref,
      () => ({
        applyAiResult(result) {
          if (result.title) setTitle(result.title)
          if (result.desc) setDesc(result.desc)
          if (result.tags && result.tags.length > 0) setTags(result.tags)
        },
        // ai-sidebar-material-search §4.1 + spec.md §"URL one-click fetch":
        // VideoForm accepts TWO media keys:
        //   1. `{file}` — REPLACES the main video File slot (URL-fetched
        //      Inbox download). Spec invariant: "VideoForm's file slot
        //      SHALL be replaced (not appended, since this is the main
        //      media)". This adds the spec.md-mandated `{file}` key that
        //      tasks.md §3 omitted (spec gap fix).
        //   2. `{thumbnail}` — updates the single main cover URL string.
        //      Locked by §4.1 originally.
        //
        // Both write to local useState; on success the caller (MaterialSection's
        // onClick / AddUrlForm's onDownload) is told `applied: true` and a
        // success toast surfaces. `{images}` is rejected with `no-media-slot`
        // because video mode structurally has no image-file list — the user
        // must switch to mode='note' to use the AI sidebar's image grid.
        // Per spec §4.1 acceptance: video-mode cap is 0 (not 11), so any
        // silently-accept path is a regression.
        applyMedia(media) {
          const { file, thumbnail, images } = media
          if (images && images.length > 0) {
            // Note-mode media rejected (no image-list slot in video mode).
            // Caller toasts the no-media-slot hint — see
            // MaterialImageGrid's switch on Attempt.reason. Keeping the
            // form SILENT here closes Part A of the §6-9 双 toast wart.
            return { applied: false, reason: 'no-media-slot' as const }
          }
          if (file) {
            fileRef.current = file
            setFileInfo({ name: file.name, size: file.size })
            return { applied: true }
          }
          if (thumbnail) {
            setThumbnail(thumbnail)
            return { applied: true }
          }
          // Empty media object — no key matched. Treat as no-media-slot
          // (semantically identical UX from the caller's perspective).
          return { applied: false, reason: 'no-media-slot' as const }
        },
        // Path C: tags is string[] — bridge sees array form directly.
        getFormSnapshot: () => ({ title, desc, tags }),
      }),
      [setTitle, setDesc, setTags, setThumbnail, setFileInfo, title, desc, tags],
    )

    /**
     * Object URL lifecycle: re-creates whenever the chosen file changes,
     * and revokes on unmount or before the next allocation.
     */
    const previewUrl = useMemo(
      () => (fileRef.current ? URL.createObjectURL(fileRef.current) : null),
      [fileInfo],
    )
    useEffect(() => {
      return () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
      }
    }, [previewUrl])

    /** Report form state upward for the live preview panel. */
    // Mirror the parent callback through a ref so this effect's dep array
    // stays focused on the form fields only. (The current `handleFormChange`
    // in PublishPage is `useCallback([])` and therefore stable; this pattern
    // is defensive — it guarantees the effect never re-fires spuriously if a
    // future refactor accidentally binds the callback to reactive state.)
    const onFormChangeRef = useRef(onFormChange)
    useEffect(() => {
      onFormChangeRef.current = onFormChange
    }, [onFormChange])

    useEffect(() => {
      const handler = onFormChangeRef.current
      if (!handler) return
      const urls: string[] = []
      if (previewUrl) urls.push(previewUrl)
      if (thumbnailPortrait) urls.push(thumbnailPortrait)
      if (thumbnailLandscape) urls.push(thumbnailLandscape)
      if (thumbnail) urls.push(thumbnail)
      handler({
        title: title.trim(),
        desc: desc.trim(),
        tags,
        fileUrls: urls,
        fileType: fileInfo ? 'video' : null,
      })
    }, [title, desc, tags, previewUrl, thumbnailPortrait, thumbnailLandscape, thumbnail, fileInfo])

    /**
     * PR-OPT-2D: split clearAll into two intents:
     *   - clearEverything(): end-user triggered "清空" — wipes EVERYTHING
     *     + the persisted LS draft. Guarded by an AlertDialog when
     *     `filledFieldCount >= 2`.
     *   - clearFilesAndReset(): post-submit success — clears the video
     *     file reference + its preview, but keeps title/desc/tags/schedule
     *     so the user can immediately re-submit to another account group
     *     without retyping.
     */
    const clearEverything = useCallback(() => {
      setTitle('')
      setDesc('')
      setTags([])
      setSchedule('')
      setThumbnail('')
      setThumbnailLandscape('')
      setThumbnailPortrait('')
      setProductLink('')
      setProductTitle('')
      setTid(undefined)
      setShortTitle('')
      setCategory('')
      setIsDraft(false)
      setFileInfo(null)
      fileRef.current = null
      clearDraftStorage()
    }, [clearDraftStorage])

    const clearFilesAndReset = useCallback(() => {
      setFileInfo(null)
      fileRef.current = null
      // Title/desc/tags/schedule/headless/thumbnails/platform-specific stay.
      // The next debounced auto-save tick (after useEffect re-runs) will
      // persist the retained fields so a reload still has them.
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
        addToast(t('publish.video_form.validation.no_group', '请先在上方选择发布账号组和平台'), 'warning')
        return
      }
      if (!fileRef.current) {
        addToast(t('publish.video_form.validation.no_file', '请选择视频文件'), 'warning')
        return
      }
      if (!title.trim()) {
        addToast(t('publish.video_form.validation.no_title', '请输入标题'), 'warning')
        return
      }

      setSubmitting(true)
      try {
        const tasks = groupSelection.mappings
          .filter((m) => groupSelection.platforms.includes(m.platform))
          .map((mapping) =>
            api
              .uploadVideo({
                platform: mapping.platform,
                account: mapping.cookieFile,
                title,
                file: fileRef.current!,
                desc: desc || undefined,
                // Wire-boundary: join is the only place string[] → string.
                tags: tags.length > 0 ? tags.join(',') : undefined,
                schedule: schedule || undefined,
                headless: String(headless),
                thumbnail: thumbnail || undefined,
                thumbnail_landscape: thumbnailLandscape || undefined,
                thumbnail_portrait: thumbnailPortrait || undefined,
                product_link: productLink || undefined,
                product_title: productTitle || undefined,
                tid,
                short_title: shortTitle || undefined,
                category: category || undefined,
                is_draft: isDraft ? 'true' : undefined,
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
          addToast(`已提交 ${results.length} 个视频上传任务`, 'success')
        }
        clearFilesAndReset()
        onSuccess({ count: results.length, taskIds: ids, failedCount: failed.length, mode: '视频' })
      } catch {
        addToast('视频请求失败，请检查后端连接', 'error')
        onError('视频')
      } finally {
        setSubmitting(false)
      }
    }, [
      groupSelection,
      title,
      t,
      desc,
      tags,
      schedule,
      headless,
      thumbnail,
      thumbnailLandscape,
      thumbnailPortrait,
      productLink,
      productTitle,
      tid,
      shortTitle,
      category,
      isDraft,
      addToast,
      clearFilesAndReset,
      onSuccess,
      onError,
    ])

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
              <SectionHeader icon={<FilePlus className="h-4 w-4" />} title="内容素材" />
              <div className="space-y-4">
                <div className="space-y-2">
                  {/* eslint-disable-next-line sau/label-html-for -- 装饰标签·div作为click-target + 隐藏 <input id="video-file-input"> */}
                  <Label>视频文件</Label>
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 transition-colors cursor-pointer',
                      dragOver && !fileInfo
                        ? 'border-primary bg-primary/10'
                        : fileInfo
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
                    )}
                    onClick={() => document.getElementById('video-file-input')?.click()}
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
                      const file = e.dataTransfer.files?.[0]
                      if (file && file.type.startsWith('video/')) {
                        fileRef.current = file
                        setFileInfo({ name: file.name, size: file.size })
                      }
                    }}
                  >
                    {fileInfo ? (
                      <motion.div
                        key={fileInfo.name + fileInfo.size}
                        className="w-full space-y-3"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={springTransition}
                      >
                        <div className="relative rounded-lg overflow-hidden bg-black/70 group/video">
                          <video
                            src={previewUrl ?? undefined}
                            controls
                            className="w-full max-h-[360px] object-contain"
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
                                e.stopPropagation()
                                setFileInfo(null)
                                fileRef.current = null
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80 truncate max-w-[200px]">
                            {fileInfo.name}
                          </span>
                          <span>{formatFileSize(fileInfo.size)}</span>
                        </div>
                      </motion.div>
                    ) : (
                      <>
                        <Inbox className="h-10 w-10 text-primary mb-2" />
                        <p className="text-sm text-muted-foreground">
                          点击此区域或拖拽视频文件到此处上传
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          支持 MP4 / MOV / AVI 等常见格式
                        </p>
                      </>
                    )}
                  </div>
                  <input
                    id="video-file-input"
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        fileRef.current = file
                        setFileInfo({ name: file.name, size: file.size })
                      }
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    {/* eslint-disable-next-line sau/label-html-for -- 装饰标签·行内布局 (AI 优化按钮 + 0/100 计数器同行) */}
                    <Label>标题</Label>
                    <div className="flex items-center gap-1.5">
                      <Tip text="AI 优化标题">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 rounded-md p-0"
                          onClick={() => enhanceField('title')}
                          disabled={enhancingField !== null || !title.trim()}
                        >
                          {enhancingField === 'title' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Wand2 className="h-3 w-3" />
                          )}
                        </Button>
                      </Tip>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {title.length}/100
                      </span>
                    </div>
                  </div>
                  <Input
                    id="video-title"
                    name="title"
                    placeholder={t('publish.video_form.title_placeholder', '请输入视频标题（建议 6-20 字）')}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="video-desc">视频简介</Label>
                      <Tip text="AI 优化简介">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 rounded-md p-0"
                          onClick={() => enhanceField('desc')}
                          disabled={enhancingField !== null || !desc.trim()}
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
                      id="video-desc"
                      className="min-h-[90px]"
                      placeholder={t('publish.video_form.desc_placeholder', '补充视频简介、背景说明或发布备注')}
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      maxLength={1000}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      {/* eslint-disable-next-line sau/label-html-for -- 装饰分组·TagInput 当前调用未挂 id (后续 PR 跟随 ContentStep 修复补) */}
                      <Label>标签</Label>
                      <span className="text-[11px] text-muted-foreground">
                        {platformTagLabel([...activePlatforms])}
                      </span>
                    </div>
                    <TagInput
                      placeholder={t('publish.video_form.tags_placeholder', '按 Enter 添加标签（# 可省略）')}
                      value={tags}
                      onChange={setTags}
                      maxTags={effectiveMaxTags([...activePlatforms])}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 高级选项 (collapsed by default) ───────────────────── */}
        <motion.div
          custom={1}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
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
                    {(thumbnail ||
                      thumbnailLandscape ||
                      thumbnailPortrait ||
                      schedule ||
                      hasAnyPlatformSpecific) && (
                      <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-5 pb-5">
                  {/* ── 通用行为: 定时发布 + 无头模式 ── */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pb-4 border-b border-border/30">
                    <SchedulePicker value={schedule} onChange={setSchedule} />
                    <div className="flex items-center gap-2 self-end pb-1">
                      <Checkbox
                        id="video-headless"
                        checked={headless}
                        onCheckedChange={(checked) => setHeadless(checked === true)}
                      />
                      <Label htmlFor="video-headless" className="text-xs text-muted-foreground">
                        无头模式（不显示浏览器窗口）
                      </Label>
                    </div>
                  </div>

                  {/* ── 通用封面字段 ── */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mt-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="video-thumbnail" className="text-xs">封面地址</Label>
                      <Input
                        id="video-thumbnail"
                        name="thumbnail"
                        placeholder="URL 或 Data URI"
                        value={thumbnail}
                        onChange={(e) => setThumbnail(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="video-thumbnail-landscape" className="text-xs">横版封面 (4:3)</Label>
                      <Input
                        id="video-thumbnail-landscape"
                        name="thumbnail_landscape"
                        placeholder="URL 或 Data URI"
                        value={thumbnailLandscape}
                        onChange={(e) => setThumbnailLandscape(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="video-thumbnail-portrait" className="text-xs">竖版封面 (3:4)</Label>
                      <Input
                        id="video-thumbnail-portrait"
                        name="thumbnail_portrait"
                        placeholder="URL 或 Data URI"
                        value={thumbnailPortrait}
                        onChange={(e) => setThumbnailPortrait(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  {/* ── 平台特定字段: 抖音 ── */}
                  {hasDouyin && (
                    <div
                      id="advanced-section-douyin"
                      data-section="douyin"
                      className={cn(
                        'mt-4 pt-4 border-t border-border/30 rounded-md transition-all duration-300',
                        highlightedSection === 'douyin' && 'ring-2 ring-primary ring-offset-2 ring-offset-background px-3 pb-3 bg-primary/5',
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <PlatformIcon platform="douyin" className="h-3 w-3" />
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          抖音专属
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="video-product-link" className="text-xs">商品链接</Label>
                          <Input
                            id="video-product-link"
                            name="product_link"
                            type="url"
                            placeholder="https://"
                            value={productLink}
                            onChange={(e) => setProductLink(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="video-product-title" className="text-xs">商品标题</Label>
                          <Input
                            id="video-product-title"
                            name="product_title"
                            placeholder="可选"
                            value={productTitle}
                            onChange={(e) => setProductTitle(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── 平台特定字段: Bilibili ── */}
                  {hasBilibili && (
                    <div
                      id="advanced-section-bilibili"
                      data-section="bilibili"
                      className={cn(
                        'mt-4 pt-4 border-t border-border/30 rounded-md transition-all duration-300',
                        highlightedSection === 'bilibili' && 'ring-2 ring-primary ring-offset-2 ring-offset-background px-3 pb-3 bg-primary/5',
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <PlatformIcon platform="bilibili" className="h-3 w-3" />
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          Bilibili 专属
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="video-bilibili-tid" className="text-xs">分区分类</Label>
                          <Select
                            value={String(tid || '')}
                            onValueChange={(v) => setTid(v ? Number(v) : undefined)}
                          >
                            <SelectTrigger id="video-bilibili-tid" className="h-8 text-xs" aria-label="分区分类">
                              <SelectValue placeholder="选择分区" />
                            </SelectTrigger>
                            <SelectContent>
                              {BILIBILI_TIDS.map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── 平台特定字段: 视频号 ── */}
                  {hasTencent && (
                    <div
                      id="advanced-section-tencent"
                      data-section="tencent"
                      className={cn(
                        'mt-4 pt-4 border-t border-border/30 rounded-md transition-all duration-300',
                        highlightedSection === 'tencent' && 'ring-2 ring-primary ring-offset-2 ring-offset-background px-3 pb-3 bg-primary/5',
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <PlatformIcon platform="tencent" className="h-3 w-3" />
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          视频号专属
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="video-tencent-short-title" className="text-xs">短标题</Label>
                          <Input
                            id="video-tencent-short-title"
                            name="short_title"
                            placeholder="可选"
                            value={shortTitle}
                            onChange={(e) => setShortTitle(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="video-tencent-category" className="text-xs">原创分类</Label>
                          <Input
                            id="video-tencent-category"
                            name="category"
                            placeholder="可选"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Checkbox
                          id="video-draft"
                          checked={isDraft}
                          onCheckedChange={(checked) => setIsDraft(checked === true)}
                        />
                        <Label htmlFor="video-draft" className="text-xs">
                          保存为草稿
                        </Label>
                      </div>
                    </div>
                  )}

                  {!hasAnyPlatformSpecific && (
                    <p className="mt-4 text-[11px] text-muted-foreground/50">
                      选择抖音、Bilibili 或视频号后显示专属选项
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>
        </motion.div>

        {/* ── 提交按钮 ─────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClearClick}>
            {t('publish.video_form.button_clear', '清空')}
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="btn-elegant"
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('publish.video_form.button_submit', '提交视频')}
          </Button>
        </div>

        {/* ── PR-OPT-2D: 草稿恢复条 ──── */}
        <PublishDraftBanner
          visible={pendingDraft !== null}
          savedAt={draftSavedAt}
          fieldsHint={draftBannerFieldsHint}
          fieldCount={draftFieldCountForBanner}
          onRestore={restoreDraft}
          onDiscard={discardDraft}
        />

        {/* ── PR-OPT-2D: 清空二次确认对话框 ──── */}
        <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('publish.video_form.clear_dialog.title', '确认清空表单？')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  'publish.video_form.clear_dialog.description',
                  '当前已填写 {{count}} 项字段。清空后会同时删除本地草稿，操作不可撤销。',
                  { count: filledFieldCount },
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('publish.video_form.clear_dialog.cancel', '取消')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmClearOpen(false)
                  clearEverything()
                }}
              >
                {t('publish.video_form.clear_dialog.confirm', '清空')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }),
)
