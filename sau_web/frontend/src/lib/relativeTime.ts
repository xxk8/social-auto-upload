// ─────────────────────────────────────────────────────────────────────
// relativeTimeFromNow — short zh-CN relative time formatter.
//
// Consensus ladder pulled out of the three duplicated `_relativeTime`
// copies in AdminOverviewPage / AdminUsersPage / AdminAuditPage. All
// three matched verbatim, except that OverviewPage returned `'—'` on
// null/invalid while UsersPage + AuditPage returned `''`. The unified
// API returns `''` and lets the caller decide how to render the
// placeholder (typically `{value && <span>…</span>}` so the field
// simply hides when there's no data — cleaner than a hard-coded
// em-dash that collides with the table's existing `—` placeholders
// for null cells).
//
// Output ladder (kept identical to the in-place copies):
//   null / unparseable  → `''`        (caller decides render)
//   < 1 minute         → `'刚刚'`
//   < 1 hour           → `'X 分钟前'`
//   < 1 day            → `'X 小时前'`
//   < 7 days           → `'X 天前'`
//   otherwise          → `'MM-DD'`   (absolute fallback)
//
// Module exports the function ONLY (safe for `react-refresh/
// only-export-components`).
// ─────────────────────────────────────────────────────────────────────

const MS_PER_MINUTE = 60_000

function _pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Format a datetime string as a short zh-CN relative offset.
 *
 * Pure function — no React refs, no Date side-effects beyond
 * `Date.now()`. Locale-independent; the strings are hard-coded zh-CN.
 *
 * @param iso — datetime string compatible with `new Date()` OR nullish.
 *             Passing numbers / objects will forward to `new Date()`.
 * @returns the relative-time string, OR `''` when the input is
 *          nullish or unparseable. Callers should branch on the
 *          empty fallback (e.g. `{value && <span>{value}</span>}`).
 */
function relativeTimeFromNow(iso: string | null | undefined): string {
  if (!iso) return ''
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return ''

  const diffMs = Date.now() - target.getTime()
  const minutes = Math.floor(diffMs / MS_PER_MINUTE)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`

  // Older than a week → fall back to absolute MM-DD so the cell still
  // carries context (e.g. "02-15" instead of "47 天前").
  return `${_pad(target.getMonth() + 1)}-${_pad(target.getDate())}`
}

export { relativeTimeFromNow }
