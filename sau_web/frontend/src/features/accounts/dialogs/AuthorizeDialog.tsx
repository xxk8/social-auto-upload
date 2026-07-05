import { Button } from '@/Components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/Components/ui/dialog'
import { Label } from '@/Components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/Components/ui/select'
import { PLATFORMS } from '@/api/client'
import {useAccountsDispatch, useAccountsState} from '../AccountsProvider.helpers';/**
 * Add-platform-to-group modal. Validates selection, then delegates the
 * actual login flow to the LoginProgressModal.
 */
export function AuthorizeDialog() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()

  return (
    <Dialog
      open={state.authorizeDialogOpen}
      onOpenChange={dispatch.setAuthorizeDialogOpen}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加平台授权</DialogTitle>
          <DialogDescription>选择要授权的平台，然后扫码登录</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">选择平台</span>
            <Select
              value={state.selectedPlatform}
              onValueChange={dispatch.setSelectedPlatform}
            >
              <SelectTrigger>
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
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => dispatch.setAuthorizeDialogOpen(false)}
          >
            取消
          </Button>
          <Button onClick={dispatch.handleAuthorize} disabled={!state.selectedPlatform}>
            开始授权
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
