/**
 * Phase 2b media production tools — clip / subtitle / thumbnail.
 * Calls backend endpoints; degrades when optional deps return 501.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionIcon } from '@/components/ui/section-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { request } from '@/api/request'
import { Clapperboard, Captions, ImageIcon, Loader2, Wand2 } from 'lucide-react'

type ToolResult = { kind: string; summary: string; url?: string; raw?: unknown }

export function MediaToolsPanel() {
  const { addToast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<ToolResult[]>([])

  async function run(kind: 'clip' | 'subtitle' | 'thumbnail') {
    if (!file) {
      addToast('请先选择视频文件', 'error')
      return
    }
    setBusy(kind)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (kind === 'thumbnail' && title) fd.append('text', title)
      const path =
        kind === 'clip'
          ? '/api/video/clip'
          : kind === 'subtitle'
            ? '/api/subtitle/generate'
            : '/api/thumbnail/generate'
      const res = await request.post(path, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600_000,
      })
      const body = res.data
      if (!body?.success) {
        addToast(body?.message || '处理失败', 'error')
        return
      }
      const data = body.data || {}
      let summary = ''
      let url: string | undefined
      if (kind === 'clip') {
        summary = `切片 ${data.clips?.length ?? 0} 段`
        url = data.clips?.[0]?.url
      } else if (kind === 'subtitle') {
        summary = `字幕 ${data.segments?.length ?? 0} 句 · ${data.language || '?'}`
        url = data.url
      } else {
        summary = '封面已生成'
        url = data.url
      }
      setResults((r) => [{ kind, summary, url, raw: data }, ...r].slice(0, 8))
      addToast(summary, 'success')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        '请求失败'
      addToast(String(msg), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="card-refined">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
          <SectionIcon size="sm"><Wand2 className="h-3.5 w-3.5" /></SectionIcon>
          媒体生产工具
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1.5">
          场景切片 / 自动字幕 / 封面生成（依赖后端 media 可选包）
        </p>
      </CardHeader>
      <CardContent className="space-y-3 px-3.5 pb-4">
        <div className="space-y-1.5">
          <Label className="text-xs">视频文件</Label>
          <Input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">封面文字（可选）</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="叠在封面上的标题"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!!busy}
            onClick={() => void run('clip')}
          >
            {busy === 'clip' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5 mr-1" />}
            场景切片
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!!busy}
            onClick={() => void run('subtitle')}
          >
            {busy === 'subtitle' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Captions className="h-3.5 w-3.5 mr-1" />}
            自动字幕
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!!busy}
            onClick={() => void run('thumbnail')}
          >
            {busy === 'thumbnail' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5 mr-1" />}
            生成封面
          </Button>
        </div>
        {results.length > 0 && (
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {results.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5">
                <span>
                  <strong className="text-foreground">{r.kind}</strong> · {r.summary}
                </span>
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline shrink-0"
                  >
                    打开
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
