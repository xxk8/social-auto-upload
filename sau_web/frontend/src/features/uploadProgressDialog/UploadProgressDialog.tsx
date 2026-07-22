// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/UploadProgressDialog.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): composite component
// that reads from `<UploadProgressDialogProvider />` and renders the
// active records via the appropriate per-kind tab.
// ──────────────────────────────────────────────────────────────────────────

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useUploadProgressDialog } from './UploadProgressDialogProvider'
import { PublishProgressTab } from './tabs/PublishProgressTab'
import { BatchImportProgressTab } from './tabs/BatchImportProgressTab'
import { Button } from '@/components/ui/button'

export function UploadProgressDialog() {
  const { open, records, close, clear } = useUploadProgressDialog()
  if (!open || records.length === 0) return null
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">
            {records.length === 1 ? '上传进度' : `上传进度 · ${records.length} 项`}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-4">
          {records.map((record) => {
            if (record.kind === 'batchImport') {
              return (
                <BatchImportProgressTab
                  key={record.id}
                  record={record}
                />
              )
            }
            return (
              <PublishProgressTab key={record.id} record={record} />
            )
          })}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => records.forEach((r) => clear(r.id))}
          >
            清空记录
          </Button>
          <Button variant="outline" size="sm" onClick={close}>
            关闭
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
