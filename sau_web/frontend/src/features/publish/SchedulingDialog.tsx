import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/Components/ui/dialog'
import { Button } from '@/Components/ui/button'
import { Input } from '@/Components/ui/input'
import { Badge } from '@/Components/ui/badge'
import { useToast } from '@/Components/ui/toast'
import { Textarea } from '@/Components/ui/textarea'
import { PLATFORMS } from '@/api/client'
import { api } from '@/api/client'
import { usePublishWizardStore } from '@/stores/publishWizardStore'
import { Clock, Check, Loader2 } from 'lucide-react'

/**
 * SchedulingDialog (openspec/changes/product-roadmap-2026q3, tasks 12.1–12.4).
 *
 * 7×24 heatmap of historical engagement per (platform, account) from
 * `publish_insights`, top recommendations, "采纳" to set the wizard's
 * scheduled time, and a batch auto-assign dialog.
 */

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

type Insight = {
  hour_of_week: number
  avg_views: number
  avg_likes: number
  avg_comments: number
  sample_count: number
  next_occurrence: string
}

export function SchedulingDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { addToast } = useToast()
  const platformLabel = Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label]))
  const [platform, setPlatform] = useState('douyin')
  const [account, setAccount] = useState('')
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [assignments, setAssignments] = useState<Array<Record<string, unknown>>>([])
  const [assigning, setAssigning] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.scheduling.insights({ platform, account: account || undefined })
      if (res.success) {
        setInsights(res.data.insights ?? [])
        setReady(res.data.ready)
      }
    } finally {
      setLoading(false)
    }
  }

  const grid = new Array(168).fill(null) as (Insight | null)[]
  insights.forEach((i) => {
    grid[i.hour_of_week] = i
  })
  const maxViews = Math.max(1, ...insights.map((i) => i.avg_views))
  const colorFor = (i: Insight | null) =>
    i ? `rgba(99, 102, 241, ${0.15 + 0.85 * (i.avg_views / maxViews)})` : 'var(--muted)'

  const adopt = (i: Insight) => {
    usePublishWizardStore.getState().setSchedule(i.next_occurrence)
    addToast(`已采纳排期 ${i.next_occurrence}`, 'success')
    onOpenChange(false)
  }

  const runBatch = async () => {
    const items = batchInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [p, a] = l.split(',')
        return { platform: (p || '').trim(), account: (a || '').trim() || undefined }
      })
    if (items.length === 0) return
    setAssigning(true)
    try {
      const res = await api.scheduling.autoAssign(items)
      if (res.success) setAssignments(res.data.assignments ?? [])
    } finally {
      setAssigning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>智能排期</DialogTitle>
          <DialogDescription>
            基于历史发布效果数据，推荐最佳发布时间（需至少 {7} 条样本）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-3">
          <div className="w-40">
            <label className="text-xs text-muted-foreground">平台</label>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">账号（可选）</label>
            <Input
              className="mt-1"
              placeholder="留空表示全账号汇总"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '查询'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}>
            批量自动排期
          </Button>
        </div>

        {ready && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted-foreground">效果热力图（颜色越深 = 平均播放越高）</p>
            <div className="overflow-auto">
              <div className="grid grid-cols-[24px_repeat(24,minmax(14px,1fr))] gap-[2px]">
                {WEEKDAYS.map((d, day) => (
                  <div key={d} className="contents">
                    <div className="flex items-center justify-center text-[10px] text-muted-foreground">
                      {d}
                    </div>
                    {Array.from({ length: 24 }).map((_, hour) => {
                      const idx = day * 24 + hour
                      const cell = grid[idx]
                      return (
                        <button
                          key={hour}
                          type="button"
                          title={cell ? `周${d} ${hour}:00 · 均播 ${Math.round(cell.avg_views)}` : `周${d} ${hour}:00`}
                          className="h-4 w-4 rounded-sm"
                          style={{ background: colorFor(cell) }}
                          disabled={!cell}
                          onClick={() => cell && adopt(cell)}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {insights
                .slice()
                .sort((a, b) => b.avg_views - a.avg_views)
                .slice(0, 5)
                .map((i) => (
                  <Badge key={i.hour_of_week} variant="secondary" className="gap-1">
                    <Clock className="h-3 w-3" />
                    周{WEEKDAYS[Math.floor(i.hour_of_week / 24)]} {i.hour_of_week % 24}:00
                    <span className="text-muted-foreground">· 均播 {Math.round(i.avg_views)}</span>
                    <button type="button" className="ml-1 text-primary" onClick={() => adopt(i)}>
                      <Check className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
            </div>
          </div>
        )}
        {!ready && insights.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">数据积累中（样本不足 {7} 条），暂无可推荐时段。</p>
        )}
        {insights.length === 0 && !loading && (
          <p className="mt-4 text-sm text-muted-foreground">暂无效果数据，请先完成若干次发布。</p>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量自动排期</DialogTitle>
            <DialogDescription>每行一个「平台,账号」，自动分配最佳发布时间。</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={6}
            placeholder={'douyin,creator1\nbilibili,work1'}
            value={batchInput}
            onChange={(e) => setBatchInput(e.target.value)}
          />
          {assignments.length > 0 && (
            <div className="mt-3 max-h-48 overflow-auto rounded-md border">
              {assignments.map((a, idx) => (
                <div key={idx} className="flex items-center justify-between border-b px-3 py-2 text-sm last:border-0">
                  <span>
                    {platformLabel[String(a.platform)] ?? a.platform} · {String(a.account ?? '—')}
                  </span>
                  <Badge variant={a.scheduled_at ? 'default' : 'secondary'}>
                    {a.scheduled_at ? String(a.scheduled_at) : '样本不足'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBatchOpen(false)}>
              关闭
            </Button>
            <Button size="sm" onClick={() => void runBatch()} disabled={assigning}>
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : '分配'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
