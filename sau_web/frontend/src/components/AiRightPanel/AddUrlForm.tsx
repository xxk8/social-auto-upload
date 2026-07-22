import { memo, useCallback, useState } from 'react'
import { Link2, Loader2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useMaterialPanelStore } from '@/stores/materialPanelStore'
import type { FormHandle } from '@/lib/chat/chatFormBridge'
import type { RefObject } from 'react'
import { cn } from '@/lib/utils'

interface AddUrlFormProps {
  formMode: 'video' | 'note'
  formRef: RefObject<FormHandle | null>
  /**
   * Optional sticky URL — if the publish page surfaces a "deep link
   * from /dashboard/inbox" affordance later, we'd prefill this. Today it's
   * not wired; reserved for the future P1.
   */
  initialUrl?: string
}

/**
 * ai-sidebar-material-search §7.3 — one-click URL→video apply form.
 *
 * Flow:
 *   1. User pastes a share URL (Douyin / XHS / Bilibili / Kuaishou).
 *   2. POST /api/inbox/download via `materialPanelStore.fetchAndAddUrl`:
 *        server starts yt-dlp/patchright/BBDown; response is
 *        `{success, filename, engine}` after the binary lands on disk
 *        under videos/<inbox>/.
 *   3. GET /api/inbox/file/<name> via `api.inboxFetchFile(filename)`:
 *        stream the bytes back, wrap as a `File`.
 *   4. `safeApplyMedia(formRef, {file})`:
 *        - VideoForm accepts `{file}` → setFileInfo + fileRef.current
 *          + success toast.
 *        - NoteForm rejects with `no-media-slot` → toast
 *          "图文模式不支持单文件" (we surface a follow-up hint).
 *
 * Loading UI: a progress banner replaces the inline button while the
 * server is downloading. We use a single-stage lock (boolean) — the
 * backend doesn't return progressive status here, only final
 * success/failure. (Future P1: SSE-driven progress reuse like InboxPage.)
 */
export const AddUrlForm = memo(function AddUrlForm({
  formMode,
  formRef,
  initialUrl,
}: AddUrlFormProps) {
  const [url, setUrl] = useState(initialUrl ?? '')
  const { addToast } = useToast()
  const fetchAndAddUrl = useMaterialPanelStore((s) => s.fetchAndAddUrl)
  const fetching = useMaterialPanelStore((s) => s.urlFetching)
  const urlError = useMaterialPanelStore((s) => s.urlError)

  const handleSubmit = useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      addToast('请粘贴一个分享链接', 'warning')
      return
    }
    if (!/^https?:\/\//.test(trimmed)) {
      addToast('请粘贴 http(s) 开头的链接', 'warning')
      return
    }
    try {
      await fetchAndAddUrl(trimmed, formRef, formMode)
    } catch (err) {
      // fetchAndAddUrl already set urlError in-store; addToast mirrors
      // it briefly so the user sees the cause even if the in-store
      // message scrolls offscreen.
      addToast(err instanceof Error ? err.message : '下载失败', 'error')
    }
  }, [url, fetchAndAddUrl, formRef, formMode, addToast])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Enter submits (matches TagInput / chat composer conventions);
      // Shift+Enter is the user's natural newline escape hatch but
      // <input> doesn't accept newlines — so we just submit on Enter.
      if (e.key === 'Enter' && !e.shiftKey && !fetching) {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit, fetching],
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Link2 className="h-3.5 w-3.5" />
        </div>
        <span className="text-[11px] font-medium text-foreground">粘贴视频分享链接</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://v.douyin.com/... 或 小红书 / B站 / 快手"
          disabled={fetching}
          className="h-8 flex-1 text-[12px]"
          data-testid="material-url-input"
        />
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={fetching || !url.trim()}
          className="h-8 px-2 text-[11px]"
          data-testid="material-url-submit"
        >
          {fetching ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              解析中
            </>
          ) : (
            <>
              <Wand2 className="mr-1 h-3 w-3" />
              拉取
            </>
          )}
        </Button>
      </div>
      {fetching && (
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5',
            'text-[11px] text-primary',
          )}
          data-testid="material-url-progress"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>正在调用 yt-dlp / patchright 解析……</span>
        </div>
      )}
      {urlError && !fetching && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive"
          data-testid="material-url-error"
          role="alert"
        >
          {urlError.length > 200 ? urlError.slice(0, 200) + '…' : urlError}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/80 leading-tight">
        解析下载复用 <span className="font-mono">/dashboard/inbox</span> 的 yt-dlp + 浏览器兜底；cookie 文件需先在 <span className="font-mono">/dashboard</span> 扫码登录。
      </p>
    </div>
  )
})
