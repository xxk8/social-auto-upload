// ──────────────────────────────────────────────────────────────────────────
// features/uploadProgressDialog/tabs/BatchImportProgressTab.tsx
//
// Round-OPT-prefs-dialog v6 (slice replication): scaffold-only tab —
//
// Existing inline progress for the AI API Key "批量导入" flow in
// `Components/AiSidebar/AiSidebar.tsx` stays in place until a
// follow-up migration turn re-homes it through this slice. The
// future implementation reads `record` per `kind === 'batchImport'`
// and renders aggregate count (added / skipped / failed) rather
// than a single ratio bar.
// ──────────────────────────────────────────────────────────────────────────

import type { UploadProgress } from '../UploadProgressDialogProvider.helpers'
import { ProgressBar } from '../shared/ProgressBar'

interface BatchImportProgressTabProps {
  record: UploadProgress
  /** Optional aggregate counters from the consumer (added / skipped / failed). */
  counters?: {
    added?: number
    skipped?: number
    failed?: number
  }
}

export function BatchImportProgressTab({
  record,
  counters,
}: BatchImportProgressTabProps) {
  const state =
    record.stage === 'done'
      ? 'done'
      : record.stage === 'failed'
        ? 'failed'
        : 'running'
  const stageLabel =
    record.stage === 'failed'
      ? record.error ?? '批量导入失败'
      : record.stage === 'done'
        ? `批量导入完成${counters?.added ? ` · 新增 ${counters.added} 个` : ''}`
        : '批量导入中'
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium tracking-tight text-foreground">
          {record.label}
        </span>
        {counters && (
          <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
            {counters.added !== undefined && `+${counters.added} `}
            {counters.skipped !== undefined && `~${counters.skipped} `}
            {counters.failed !== undefined &&
              counters.failed > 0 &&
              `!${counters.failed}`}
          </span>
        )}
      </div>
      <ProgressBar
        ratio={record.ratio}
        stageLabel={stageLabel}
        state={state}
        ariaLabel={`Batch import progress for ${record.label}`}
      />
    </div>
  )
}
