import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {  } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { PLATFORMS } from '@/api/client'
import { api } from '@/api/client'
import { usePublishWizardStore } from '@/stores/publishWizardStore'
import { Loader2, Plus, Trash2 } from 'lucide-react'

/**
 * ContentTemplatePicker (openspec/changes/product-roadmap-2026q3, tasks 15.1–15.5).
 *
 * Lists saved copy templates, lets the user fill template fields and run
 * AI generation (apply), then writes the result into the publish wizard
 * form via `usePublishWizardStore.setContent`. Also supports creating a
 * new template.
 */

type Template = {
  id: number
  name: string
  platform: string | null
  template: {
    type?: string
    prompt?: string
    fields?: Array<{ key: string; label: string; placeholder?: string }>
  }
}

export function ContentTemplatePicker({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { addToast } = useToast()
  const platformLabel = Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label]))
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [applyId, setApplyId] = useState<number | null>(null)
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPlatform, setNewPlatform] = useState('')
  const [newType, setNewType] = useState('product')
  const [newPrompt, setNewPrompt] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await api.contentTemplates.list()
      if (res.success) setTemplates(res.data ?? [])
    } finally {
      setLoading(false)
    }
  }

  const openApply = (tpl: Template) => {
    setApplyId(tpl.id)
    setVariables({})
  }

  const runApply = async (tpl: Template) => {
    const platform = usePublishWizardStore.getState().groupSelection?.platforms?.[0] || newPlatform || tpl.platform || ''
    if (!platform) {
      addToast('请先在发布页选择平台', 'error')
      return
    }
    setGenerating(true)
    try {
      const res = await api.contentTemplates.apply(tpl.id, { variables, platform })
      if (res.success && res.data) {
        const mode = usePublishWizardStore.getState().mode
        const patch: Record<string, unknown> = {}
        if (res.data.title) patch.title = res.data.title
        if (res.data.tags) patch.tags = res.data.tags
        if (res.data.description) {
          if (mode === 'video') patch.desc = res.data.description
          else patch.note = res.data.description
        }
        usePublishWizardStore.getState().setContent(patch)
        addToast('已生成并填入表单', 'success')
        onOpenChange(false)
      } else {
        addToast(res.message || '生成失败', 'error')
      }
    } finally {
      setGenerating(false)
    }
  }

  const createTemplate = async () => {
    if (!newName.trim() || !newPrompt.trim()) {
      addToast('名称和提示词必填', 'error')
      return
    }
    const res = await api.contentTemplates.create({
      name: newName.trim(),
      platform: newPlatform || undefined,
      template: { type: newType, prompt: newPrompt, fields: [] },
    })
    if (res.success) {
      addToast('模板已创建', 'success')
      setCreateOpen(false)
      setNewName('')
      setNewPrompt('')
      void refresh()
    }
  }

  const remove = async (id: number) => {
    await api.contentTemplates.remove(id)
    void refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) void refresh()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>内容模板</DialogTitle>
          <DialogDescription>选择模板，填写字段后由 AI 生成文案并填入发布表单。</DialogDescription>
        </DialogHeader>

        {applyId === null ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                新建模板
              </Button>
            </div>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : templates.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无模板，点击「新建模板」创建。</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{tpl.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {tpl.platform ? platformLabel[tpl.platform] ?? tpl.platform : '通用'} ·{' '}
                        {tpl.template.type ?? '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" onClick={() => openApply(tpl)}>
                        应用
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => void remove(tpl.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          (() => {
            const tpl = templates.find((t) => t.id === applyId)
            const fields = tpl?.template.fields ?? []
            return (
              <div className="space-y-3">
                <p className="text-sm font-medium">{tpl?.name}</p>
                {fields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">该模板无变量字段，点击生成直接套用提示词。</p>
                ) : (
                  fields.map((f) => (
                    <div key={f.key}>
                      <label className="text-xs text-muted-foreground">{f.label}</label>
                      <Input
                        className="mt-1"
                        placeholder={f.placeholder}
                        value={variables[f.key] ?? ''}
                        onChange={(e) => setVariables((v) => ({ ...v, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setApplyId(null)}>
                    返回
                  </Button>
                  <Button size="sm" onClick={() => void runApply(tpl!)} disabled={generating}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : '生成并填入'}
                  </Button>
                </div>
              </div>
            )
          })()
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建内容模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">名称</label>
              <Input className="mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <div className="w-1/2">
                <label className="text-xs text-muted-foreground">平台（可选）</label>
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-150"
                  value={newPlatform}
                  onChange={(e) => setNewPlatform(e.target.value)}
                >
                  <option value="">通用</option>
                  {PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-1/2">
                <label className="text-xs text-muted-foreground">类型</label>
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-150"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                >
                  <option value="product">好物推荐</option>
                  <option value="tutorial">教程分享</option>
                  <option value="daily">日常记录</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">提示词（用 {'{变量}'} 占位）</label>
              <Input
                className="mt-1"
                placeholder="围绕 {product} 写一段种草文案"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={() => void createTemplate()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
