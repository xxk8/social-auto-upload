import { memo } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/index'
import { PLATFORMS } from '../../api/client'

export type AddTaskFormState = {
  platform: string
  action: string
  account: string
  title: string
}

type AddTaskDialogProps = {
  open: boolean
  values: AddTaskFormState
  onChange: (next: AddTaskFormState) => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 新建任务 modal. Self-contained: surfaces the form fields, validates the
 * required-platform/action/account trio, and forwards the validated values
 * to a parent callback. Parent owns the form-draft state so we don't lose
 * what the user typed if the dialog closes and reopens mid-edit.
 */
export const AddTaskDialog = memo(function AddTaskDialog({
  open,
  values,
  onChange,
  onConfirm,
  onCancel,
}: AddTaskDialogProps) {
  const canConfirm = !!values.platform && !!values.action && !!values.account
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>创建一个新的任务</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-new-platform">平台</Label>
            <Select value={values.platform} onValueChange={(v) => onChange({ ...values, platform: v })}>
              <SelectTrigger id="task-new-platform" aria-label="平台">
                <SelectValue placeholder="选择平台" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-new-action">操作</Label>
            <Select value={values.action} onValueChange={(v) => onChange({ ...values, action: v })}>
              <SelectTrigger id="task-new-action" aria-label="操作">
                <SelectValue placeholder="选择操作" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="login">登录</SelectItem>
                <SelectItem value="check">检查</SelectItem>
                <SelectItem value="upload-video">上传视频</SelectItem>
                <SelectItem value="upload-note">上传图文</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-new-account">账号</Label>
            <Input
              id="task-new-account"
              name="account"
              placeholder="输入账号名称"
              value={values.account}
              onChange={(e) => onChange({ ...values, account: e.target.value })}
              // `account` reads as a system-account handle (not a credential), so we
              // intentionally opt OUT of credential autofill — password managers key
              // off `username` + `current-password` and would otherwise surface unrelated
              // personal-account entries. Switch to `username` if/when this field
              // ever accepts the user's OWN credential handle.
              autoComplete="off"
              spellCheck={false}
              data-form-type="other"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-new-title">标题</Label>
            <Input
              id="task-new-title"
              name="title"
              placeholder="输入标题（上传操作需要）"
              value={values.title}
              onChange={(e) => onChange({ ...values, title: e.target.value })}
              maxLength={120}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={!canConfirm}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
