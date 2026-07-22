import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import { humanizeTaskError } from '@/lib/taskError'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────
// TaskErrorPanel — surfaces humanized failure context for failed / error /
// cookie_invalid tasks. Rendered inside TaskDrawer (and TaskTableRow) so
// operators see actionable Chinese copy + an optional deep-link CTA
// ("去重新登录" / "重新发布") instead of a raw error string.
//
// Fixes: TBF-029 (use-without-define — this component was referenced at
// `TaskDrawer.tsx:198` but the file had been deleted in an earlier cleanup
// pass, leaving a `ReferenceError` at every render that crossed the
// `task.error || status in {failed,error,cookie_invalid}` conditional).
//
// Memo contract: `TaskDrawer` already memoizes its sibling children
// (TaskStatusBadge / RetryButton / TaskDrawerBody / Field). This panel is
// memoized on the same prop surface (`error` + `status`) so prop identity
// churn from the parent's TanStack Query subscription doesn't bust the
// outer memo.
//
// Visual design:
//   • Alert-style container — destructive border + 5%-tint background, the
//     same `--status-error-fg` family used by the `error` Badge + the tone
//     chip system in `@/lib/tone`. Catches the eye on first scan.
//   • `role="alert" + aria-live="polite"` — screen readers announce
//     failures when the panel enters the DOM (drawer-open trigger).
//   • `data-tag` / `data-kind` / `data-needs-relogin` — test affordances
//     that don't depend on i18n text (so future locale flips don't break
//     test selectors).
// ─────────────────────────────────────────────────────────────────────────

export interface TaskErrorPanelProps {
  /** Raw error string from `TaskItem.error`; may be null/empty. */
  error: string | null | undefined
  /** Task status — used by humanizeTaskError for cookie_invalid fallback. */
  status: string
}

export const TaskErrorPanel = memo(function TaskErrorPanel({
  error,
  status,
}: TaskErrorPanelProps) {
  const h = humanizeTaskError(error, { status })

  return (
    <div
      role="alert"
      aria-live="polite"
      data-tag="task-error-panel"
      data-kind={h.kind}
      data-needs-relogin={h.needsRelogin ? 'true' : 'false'}
      className={cn(
        'rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2',
        // Slightly stronger contrast for the relogin CTA so the operator
        // can spot it at a glance — the most common fix path on
        // production failures.
        h.needsRelogin && 'ring-1 ring-destructive/20',
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-destructive">{h.title}</p>
          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">
            {h.detail}
          </p>
        </div>
      </div>
      {h.action && (
        h.action.href ? (
          <Link
            to={h.action.href}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {h.action.label} <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <span className="inline-flex items-center text-xs text-muted-foreground">
            {h.action.label}
          </span>
        )
      )}
    </div>
  )
})
