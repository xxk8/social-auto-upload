import { Button } from '@/components/ui/button'
import {useToast} from '@/components/ui/toast.helpers';export function ToastDemo() {
  const { addToast } = useToast()
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => addToast('已发布到 3 个平台', 'success')}>Success</Button>
      <Button onClick={() => addToast('操作失败：cookie 已失效', 'error')} variant="destructive">
        Error
      </Button>
      <Button onClick={() => addToast('设备轮询中', 'info')}>Info</Button>
      <Button onClick={() => addToast('即将停止服务', 'warning')} variant="outline">
        Warning
      </Button>
      <Button onClick={() => addToast('已记录', 'default')}>Default</Button>
    </div>
  )
}
