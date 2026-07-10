import { useEffect, useRef, useState, useMemo } from 'react'
import { useToast } from '@/Components/ui/toast'
import { accountsApi } from '@/api/accounts'
import { PLATFORMS } from '@/api/client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/Components/ui/dialog'
import { Progress } from '@/Components/ui/progress'
import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneTextClass } from '@/lib/tone'

interface RefreshProgressItem {
  platform: string
  account: string
  status: 'pending' | 'running' | 'success' | 'failed'
  message?: string
}

interface BatchRefreshDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export default function BatchRefreshDialog({
  open,
  onOpenChange,
  onComplete,
}: BatchRefreshDialogProps) {
  const { addToast } = useToast()
  const [items, setItems] = useState<RefreshProgressItem[]>([])
  const [succeeded, setSucceeded] = useState(0)
  const [failed, setFailed] = useState(0)
  const [isDone, setIsDone] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!open) {
      setItems([])
      setSucceeded(0)
      setFailed(0)
      setIsDone(false)
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      return
    }

    const es = accountsApi.refreshStaleAccounts()
    eventSourceRef.current = es

    es.addEventListener('start', (e) => {
      try {
        const data = JSON.parse(e.data)
        const initItems: RefreshProgressItem[] = (data.items || []).map((it: { platform: string; account: string }) => ({
          platform: it.platform,
          account: it.account,
          status: 'pending' as const,
        }))
        setItems(initItems)
        if (initItems.length === 0) {
          setIsDone(true)
        }
      } catch { /* ignore */ }
    })

    es.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data)
        const { index, platform, account, status, message } = data
        setItems((prev) => {
          const next = [...prev]
          if (next[index]) {
            next[index] = { ...next[index], status, message }
          }
          return next
        })
        if (status === 'success') setSucceeded((s) => s + 1)
        if (status === 'failed') setFailed((f) => f + 1)
      } catch { /* ignore */ }
    })

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data)
        setSucceeded(data.succeeded)
        setFailed(data.failed)
        setIsDone(true)
        onComplete()
        if (data.failed === 0 && data.succeeded > 0) {
          addToast(`已刷新 ${data.succeeded} 个过期 Cookie`, 'success')
        } else if (data.succeeded === 0 && data.failed > 0) {
          addToast(`${data.failed} 个刷新失败`, 'error')
        } else if (data.succeeded + data.failed > 0) {
          addToast(`刷新完成：${data.succeeded} 个成功，${data.failed} 个失败`, 'warning')
        }
      } catch { /* ignore */ }
    })

    es.onerror = () => {
      es.close()
      eventSourceRef.current = null
      setIsDone(true)
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [open, addToast, onComplete])

  const total = items.length
  const progressPct = total > 0 ? Math.round(((succeeded + failed) / total) * 100) : 0
  const platformLabel = (v: string) => PLATFORMS.find((p) => p.value === v)?.label ?? v

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            批量刷新过期 Cookie
          </DialogTitle>
          <DialogDescription>
            {isDone ? '刷新完成' : total > 0 ? `正在刷新 ${total} 个过期/失效的授权…` : '正在检测过期授权…'}
          </DialogDescription>
        </DialogHeader>

        {total > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Progress value={progressPct} className="h-1.5 flex-1" />
              <span className="text-[11px] font-medium text-muted-foreground tabular-nums shrink-0">
                {succeeded + failed}/{total}
              </span>
            </div>

            <div className="max-h-[240px] overflow-y-auto space-y-1">
              {items.map((item, i) => (
                <div
                  key={`${item.platform}-${item.account}-${i}`}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-xs',
                    item.status === 'running' && 'bg-primary/5',
                    item.status === 'success' && 'bg-emerald-500/5',
                    item.status === 'failed' && 'bg-destructive/5',
                  )}
                >
                  {item.status === 'success' ? (
                    <CheckCircle2 className={cn('h-3.5 w-3.5 shrink-0', toneTextClass('success'))} />
                  ) : item.status === 'failed' ? (
                    <XCircle className={cn('h-3.5 w-3.5 shrink-0', toneTextClass('error'))} />
                  ) : item.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                  )}
                  <span className="font-medium text-foreground">{platformLabel(item.platform)}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground truncate">{item.account}</span>
                  {item.message && (
                    <span className="ml-auto text-destructive truncate shrink-0">{item.message}</span>
                  )}
                </div>
              ))}
            </div>

            {isDone && (
              <div className="text-center text-xs text-muted-foreground pt-1">
                {failed === 0
                  ? `全部 ${succeeded} 个授权刷新成功`
                  : `${succeeded} 个成功，${failed} 个失败`}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
