import { memo, useEffect, useState } from 'react'
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
import { Label } from '@/Components/ui/label'
import { Loader2 } from 'lucide-react'
import { useTemplatesStore } from '@/stores/useTemplatesStore'
import {useToast} from '@/Components/ui/toast.helpers';/**
 * §9.4 — SaveTemplateDialog: a modal that lets the user save the current
 * form state as a named template. The parent passes the current snapshot
 * (title, desc, tags, schedule, advanced fields, etc.) and the mode
 * ('video' | 'note'). On confirm, the dialog calls
 * `useTemplatesStore.add(name, mode, snapshot)`.
 *
 * The dialog manages its own open state via the `open` / `onOpenChange`
 * props (controlled pattern, consistent with AddTaskDialog).
 */

interface SaveTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current form mode — determines which template list the saved
   *  template will appear in. */
  mode: 'video' | 'note'
  /** Serializable snapshot of the current form state. The caller is
   *  responsible for excluding non-serializable values (File objects,
   *  FileList, etc.) before passing. */
  snapshot: Record<string, unknown>
}

export const SaveTemplateDialog = memo(function SaveTemplateDialog({
  open,
  onOpenChange,
  mode,
  snapshot,
}: SaveTemplateDialogProps) {
  const { add, loading } = useTemplatesStore()
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset the name input whenever the dialog opens.
  useEffect(() => {
    if (open) setName('')
  }, [open])

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      addToast('请输入模板名称', 'warning')
      return
    }
    setSaving(true)
    const ok = await add(trimmed, mode, snapshot)
    setSaving(false)
    if (ok) {
      addToast(`模板「${trimmed}」已保存`, 'success')
      onOpenChange(false)
    } else {
      // The store sets `error` — the toast is shown here as feedback.
      addToast('保存模板失败，请重试', 'error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>保存为模板</DialogTitle>
          <DialogDescription>
            将当前表单内容保存为可复用的模板，下次发布时可一键应用。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="template-name">模板名称</Label>
          <Input
            id="template-name"
            placeholder="如：日常探店模板"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={50}
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            将保存 {Object.keys(snapshot).length} 项字段（{mode === 'video' ? '视频' : '图文'}模式）
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
