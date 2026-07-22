// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/tabs/PublishProgressTab.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): scaffold-only tab —
// establishes the convention that "publish video to platforms" gets
// a progress-flow tab in this slice. Future implementation: render a
// per-platform row (抖音 / 视频号 / 小红书 / etc.) + an aggregate
// progress bar + retry-isolated error row per item.
//
// Existing inline progress in `Pages/TasksPage.tsx` stays in place
// until a follow-up migration turn re-homes it through this slice.
// ──────────────────────────────────────────────────────────────────────────

import type { UploadProgress } from '../UploadProgressDialogProvider.helpers'
import { ProgressBar } from '../shared/ProgressBar'

interface PublishProgressTabProps {
  record: UploadProgress
  /** Optional platform icon list alongside the label. */
  platforms?: ReadonlyArray<string>
}

export function PublishProgressTab({
  record,
  platforms = [],
}: PublishProgressTabProps) {
  const state =
    record.stage === 'done'
      ? 'done'
      : record.stage === 'failed'
        ? 'failed'
        : 'running'
  const stageLabel =
    record.stage === 'preparing'
      ? '准备中'
      : record.stage === 'uploading'
        ? `上传中 · ${record.label}`
        : record.stage === 'finalizing'
          ? '收尾中'
          : record.stage === 'done'
            ? '发布完成'
            : record.stage === 'failed'
              ? record.error ?? '发布失败'
              : '准备中'
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium tracking-tight text-foreground">
          {record.label}
        </span>
        {platforms.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {platforms.join(' · ')}
          </span>
        )}
      </div>
      <ProgressBar
        ratio={record.ratio}
        stageLabel={stageLabel}
        state={state}
        ariaLabel={`Publish progress for ${record.label}`}
      />
    </div>
  )
}
