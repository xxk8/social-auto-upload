import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/ui/page-header'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/index'
import { useAccounts } from '../hooks/useTasks'
import { useAccountGroups } from '../hooks/useAccountGroups'
import { usePublishStore } from '../stores/publishStore'
import { PublishAiSidebar, MobileAiDrawer } from '@/components/AiRightPanel'
import { useMobileDrawer } from '@/hooks/useMobileDrawer'
import {
  Image as ImageIcon,
  Send,
  Video,
  RefreshCw,
  Sparkles,
  CalendarClock,
  X,
} from 'lucide-react'
import { VideoForm, type VideoFormHandle } from '../features/publish/VideoForm'
import { NoteForm, type NoteFormHandle } from '../features/publish/NoteForm'
import { PublishSuccessBanner } from '../features/publish/PublishSuccessBanner'
import { GroupPublishSelector, type GroupSelection } from '../features/publish/GroupPublishSelector'
import { MediaToolsPanel } from '../features/publish/MediaToolsPanel'
import type { FormPreviewData } from '../features/publish/PublishPreview'
import { useSearchParams } from '@/lib/router/useSearchParams'
import { ResizablePanel } from '@/components/ui/resizable-panel'
import { parseScheduleParam } from '../features/publish/schedulePresets'
import type { PublishAiActions } from '@/features/ai-assistant/publishActions'
import type { FormHandle } from '@/lib/chat/chatFormBridge'

/**
 * Two-column publish-center layout.
 *
 * Below lg (default 1024px): form spans full width, AI assistant is hidden
 * and surfaced via a floating action button → bottom-sheet drawer. We use
 * lg (not md=768) so the form keeps enough horizontal room for its
 * multi-select platform picker, dropzone, and schedule picker.
 *
 * lg and up: form takes the left 60%, AI assistant takes the right 40%
 * (resolves to `grid-cols-[3fr_2fr]`). The preview that used to live in
 * its own aside is now integrated into the AI sidebar as a collapsible
 * section at the bottom of the panel.
 */
export default function PublishPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: accountOptions = [], refetch: refetchAccounts } = useAccounts()
  const { data: groups = [] } = useAccountGroups()
  const submitSuccess = usePublishStore((s) => s.submitSuccess)
  const setLastTaskIds = usePublishStore((s) => s.setLastTaskIds)
  const setSubmitSuccess = usePublishStore((s) => s.setSubmitSuccess)

  const [mode, setMode] = useState<'video' | 'note'>('video')
  const [previewData, setPreviewData] = useState<FormPreviewData>({
    title: '',
    desc: '',
    tags: '',
    fileUrls: [],
    fileType: null,
  })
  const [groupSelection, setGroupSelection] = useState<GroupSelection | null>(null)
  // Seed from URL immediately so VideoForm/NoteForm mount with the value
  // (avoids a one-frame empty schedule before the effect runs).
  const scheduleFromQuery = useMemo(
    () => parseScheduleParam(searchParams.get('schedule')),
    [searchParams],
  )
  const [calendarScheduleBanner, setCalendarScheduleBanner] = useState<string | null>(
    () =>
      parseScheduleParam(
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('schedule')
          : null,
      ),
  )
  // Open "高级选项" when calendar deep-links a schedule so the picker is visible.
  const [videoAdvancedOpen, setVideoAdvancedOpen] = useState(
    () => Boolean(calendarScheduleBanner),
  )
  const scheduleConsumedRef = useRef(false)

  const videoFormRef = useRef<VideoFormHandle>(null)
  const noteFormRef = useRef<NoteFormHandle>(null)
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mobile bottom-drawer toggle. Above the md breakpoint the inline
  // PublishAiSidebar takes over and the hook auto-closes the drawer.
  const { isMobile, isOpen, open, close } = useMobileDrawer()

  // Calendar → publish deep-link: keep banner, expand advanced, strip query
  // so a refresh does not re-seed over a later user edit.
  useEffect(() => {
    if (scheduleConsumedRef.current) return
    if (!scheduleFromQuery && !calendarScheduleBanner) return
    const value = scheduleFromQuery ?? calendarScheduleBanner
    if (!value) return
    scheduleConsumedRef.current = true
    setCalendarScheduleBanner(value)
    setVideoAdvancedOpen(true)
    if (searchParams.has('schedule')) {
      const next = new URLSearchParams(searchParams)
      next.delete('schedule')
      setSearchParams(next, { replace: true })
    }
  }, [scheduleFromQuery, calendarScheduleBanner, searchParams, setSearchParams])

  // Clear pending auto-navigate on unmount.
  useEffect(() => {
    return () => {
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current)
    }
  }, [])

  const handleGoToTasks = useCallback(() => {
    if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current)
    navigate({ to: '/dashboard/tasks', search: { focus: undefined } })
  }, [navigate])

  const scheduleNavigateAfterSubmit = useCallback(() => {
    if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current)
    navigateTimerRef.current = setTimeout(
      () => navigate({ to: '/dashboard/tasks', search: { focus: undefined } }),
      1500,
    )
  }, [navigate])

  const handleVideoSuccess = useCallback(
    (info: { count: number; taskIds: string[]; failedCount: number; mode: '视频' }) => {
      setLastTaskIds(info.taskIds)
      setSubmitSuccess({
        count: info.count,
        mode: info.mode,
        taskIds: info.taskIds,
      })
      scheduleNavigateAfterSubmit()
    },
    [setLastTaskIds, setSubmitSuccess, scheduleNavigateAfterSubmit],
  )

  const handleNoteSuccess = useCallback(
    (info: { count: number; taskIds: string[]; failedCount: number; mode: '图文' }) => {
      setLastTaskIds(info.taskIds)
      setSubmitSuccess({
        count: info.count,
        mode: info.mode,
        taskIds: info.taskIds,
      })
      scheduleNavigateAfterSubmit()
    },
    [setLastTaskIds, setSubmitSuccess, scheduleNavigateAfterSubmit],
  )

  const handleVideoError = useCallback(() => {
    /* form already toasted */
  }, [])
  const handleNoteError = useCallback(() => {
    /* form already toasted */
  }, [])


  const handleFormChange = useCallback((data: FormPreviewData) => {
    setPreviewData(data)
  }, [])

  const publishActions: PublishAiActions = useMemo(
    () => ({
      mode,
      setMode,
      groups,
      selection: groupSelection,
      setSelection: setGroupSelection,
      formRef: (mode === 'video' ? videoFormRef : noteFormRef) as RefObject<FormHandle | null>,
    }),
    [mode, groups, groupSelection],
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4 sm:p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <PageHeader
          title="发布中心"
          description="左侧填表发布 · 右侧用自然语言让 AI 写文案"
          icon={<Send className="h-5 w-5 text-muted-foreground" />}
          className="mb-0"
          actions={
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="hidden sm:inline tabular-nums">
                {accountOptions.length} 账号
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => void refetchAccounts()}
                aria-label="刷新账号列表"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          }
        />
      </div>

      <PublishSuccessBanner info={submitSuccess} onGoToTasks={handleGoToTasks} />

      {calendarScheduleBanner ? (
        <Alert variant="info" className="mt-3 shrink-0">
          <CalendarClock className="size-4" />
          <AlertTitle className="flex items-center justify-between gap-2 pr-0">
            <span>已从内容日历填入定时发布</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label="关闭提示"
              onClick={() => setCalendarScheduleBanner(null)}
            >
              <X className="size-3.5" />
            </Button>
          </AlertTitle>
          <AlertDescription>
            排期时间已设为{' '}
            <span className="font-mono font-medium tabular-nums text-foreground">
              {calendarScheduleBanner.replace('T', ' ')}
            </span>
            。可在下方「高级选项 / 定时发布」中修改。
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ── Main: form + AI (chat-first) ── */}
      <ResizablePanel
        className="mt-4"
        left={
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-1">
            <Tabs
              value={mode}
              onValueChange={(v) => {
                setMode(v as 'video' | 'note')
                setGroupSelection(null)
              }}
            >
              <TabsList className="mb-5 grid w-full grid-cols-2 rounded-xl bg-muted/60 p-1">
                <TabsTrigger value="video" className="gap-2 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:font-medium">
                  <Video className="h-4 w-4" />
                  视频
                </TabsTrigger>
                <TabsTrigger value="note" className="gap-2 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:font-medium">
                  <ImageIcon className="h-4 w-4" />
                  图文
                </TabsTrigger>
              </TabsList>

              <GroupPublishSelector
                groups={groups}
                mode={mode}
                value={groupSelection}
                onChange={setGroupSelection}
              />

              <div className="mt-5">
                <MediaToolsPanel />
              </div>

              <div className="mt-5">
                <TabsContent value="video" className="mt-0 data-[state=inactive]:hidden">
                  <VideoForm
                    ref={videoFormRef}
                    groupSelection={groupSelection}
                    onSuccess={handleVideoSuccess}
                    onError={handleVideoError}
                    onFormChange={handleFormChange}
                    initialSchedule={calendarScheduleBanner ?? ''}
                    advancedOpen={videoAdvancedOpen}
                    onAdvancedChange={setVideoAdvancedOpen}
                  />
                </TabsContent>
                <TabsContent value="note" className="mt-0 data-[state=inactive]:hidden">
                  <NoteForm
                    ref={noteFormRef}
                    groupSelection={groupSelection}
                    onSuccess={handleNoteSuccess}
                    onError={handleNoteError}
                    onFormChange={handleFormChange}
                    initialSchedule={calendarScheduleBanner ?? ''}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        }
        right={
          <div className="hidden min-h-0 lg:flex lg:flex-col">
            <PublishAiSidebar
              mode={mode}
              platform={groupSelection?.platforms[0] ?? ''}
              formRef={mode === 'video' ? videoFormRef : noteFormRef}
              previewData={previewData}
              publishActions={publishActions}
            />
          </div>
        }
      />

      {/* ── Mobile (<lg): floating action button + drawer ───────────── */}
      {isMobile && (
        <Button
          onClick={open}
          size="lg"
          className="fixed bottom-4 right-4 z-40 h-11 rounded-full px-4 shadow-lg shadow-primary/25"
          data-testid="mobile-ai-trigger"
          aria-label="打开 AI 助手"
        >
          <Sparkles className="h-4 w-4 mr-1.5" />
          AI 助手
        </Button>
      )}
      <MobileAiDrawer open={isMobile && isOpen} onClose={close}>
        <PublishAiSidebar
          mode={mode}
          platform={groupSelection?.platforms[0] ?? ''}
          formRef={mode === 'video' ? videoFormRef : noteFormRef}
          previewData={previewData}
          publishActions={publishActions}
        />
      </MobileAiDrawer>
    </div>
  )
}
