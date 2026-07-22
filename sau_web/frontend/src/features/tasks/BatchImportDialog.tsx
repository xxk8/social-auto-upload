import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { api } from '@/api/client'
import { Upload, Download, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

/**
 * BatchImportDialog (openspec/changes/product-roadmap-2026q3, tasks 8.1–8.5).
 *
 * Uploads a CSV, shows a per-row preview with validation status, and a
 * confirm step. A single bad row never blocks the others — the backend
 * returns line-level pass/fail.
 */

type BatchResult = {
  line: number
  ok: boolean
  task_id: string | null
  error: string | null
}

export function BatchImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onImported?: () => void
}) {
  const { addToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<BatchResult[] | null>(null)
  const [summary, setSummary] = useState<{ total: number; created: number; errors: string[] } | null>(
    null,
  )

  const reset = () => {
    setFile(null)
    setResults(null)
    setSummary(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = (f: File | null) => {
    if (!f) return
    setFile(f)
    setResults(null)
    setSummary(null)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    try {
      const res = await api.batchImport(file)
      if (!res.success) {
        addToast(res.message || '导入失败', 'error')
        return
      }
      setResults(res.data.results ?? [])
      setSummary({ total: res.data.total, created: res.data.created, errors: res.data.errors ?? [] })
      if ((res.data.created ?? 0) > 0) onImported?.()
      addToast(`成功导入 ${res.data.created ?? 0} 条`, 'success')
    } catch {
      addToast('导入失败，请重试', 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleTemplate = async () => {
    try {
      const blob = await api.downloadBatchTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'sau-batch-template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      addToast('模板下载失败', 'error')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量导入任务</DialogTitle>
          <DialogDescription>
            上传 CSV（platform, account, file, title, desc, tags, schedule），逐行创建发布任务。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              选择 CSV
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => void handleTemplate()}>
              <Download className="h-4 w-4" />
              下载模板
            </Button>
            {file && <span className="text-xs text-muted-foreground truncate">{file.name}</span>}
          </div>

          {results && summary && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">共 {summary.total} 行</Badge>
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  成功 {summary.created}
                </Badge>
                {summary.total - summary.created > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" />
                    失败 {summary.total - summary.created}
                  </Badge>
                )}
              </div>
              <div className="max-h-[280px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>行</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>任务 ID</TableHead>
                      <TableHead>说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.line}>
                        <TableCell>{r.line}</TableCell>
                        <TableCell>
                          {r.ok ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              成功
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" />
                              失败
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {r.task_id ? r.task_id.slice(-8) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.error ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => { reset(); onOpenChange(false) }}>
            关闭
          </Button>
          <Button size="sm" className="gap-2" disabled={!file || uploading} onClick={() => void handleUpload()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? '导入中…' : '确认导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
