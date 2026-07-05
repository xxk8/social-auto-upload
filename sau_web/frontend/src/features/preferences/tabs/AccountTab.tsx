// ──────────────────────────────────────────────────────────────────────────
// features/preferences/tabs/AccountTab.tsx
//
// Round-opt-prefs-dialog v4 (slice extraction): the round-OPT-prefs-dialog
// v2 layout previously bundled 4 body components in `Components/
// PreferencesContent.tsx`. v4 splits them into per-tab files under
// `features/preferences/tabs/` so each body lives next to the dialog
// provider that drives it.
//
// AccountTab is the round-OPT-prefs-dialog v1+ read-only account body.
// It's mounted by:
//   • `<PreferencesDialog>`'s `<Tabs.Content value="account">` pane
//     (auto-unmounts when inactive)
//   • `/app/account` route → `<ProfilePage>` (thin wrapper)
//
// Two surfaces render the same component, so email / role / name
// fields stay in lockstep through the same `useAuth()` hook — flip
// `authUser.tier` on one and the other reacts through the same call.
// data-testid invariants (`preferences-tab-account` trigger +
// dialog header `data-tab="account"`) live on the dialog shell, NOT
// here, so this component is reachable from any future shell that
// drops in the provider.
// ──────────────────────────────────────────────────────────────────────────

import { Card, CardContent, CardHeader, CardTitle } from '@/Components/ui/card'
import { useAuth } from '@/features/auth/useAuth'

export function AccountTab() {
  const { user: authUser } = useAuth()
  const email = authUser?.email ?? '—'
  // Round-7 fallback contract: '—' when name is null/undefined/empty
  // /whitespace-only, mirroring the backend PATCH validation that
  // collapses any of these to NULL before storing.
  const rawName = authUser?.name
  const displayName = rawName && rawName.trim() !== '' ? rawName : '—'
  const roleLabel = authUser?.role === 'admin' ? '管理员' : '用户'

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-[15px]">账号信息</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <InfoRow label="邮箱" value={email} />
        <InfoRow label="角色" value={roleLabel} />
        <InfoRow label="显示名" value={displayName} />
        {authUser?.last_login && (
          <InfoRow label="最近登录" value={authUser.last_login} mono />
        )}
        {authUser?.created_at && (
          <InfoRow label="注册时间" value={authUser.created_at} mono />
        )}
      </CardContent>
    </Card>
  )
}

// ── InfoRow (AccountTab-local helper) ───────────────────────────────
// v2 cadence: py-3 + hairline border-b per row so 5 rows read as
// a card-table rhythm. mono flag flips the value to font-mono for
// dates / IDs / build SHAs. Lives here, NOT in /shared/, because
// no other tab needs the row primitive; keeping it co-located with
// its only consumer avoids a future "what was this helper for?"
// archaeology.
function InfoRow({
  label,
  value,
  hint,
  mono,
}: {
  label: string
  value: string
  hint?: string
  /** Render the value in font-mono (dates / IDs / build SHAs). */
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-border/30 last:border-b-0">
      <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/70">
        {label}
      </span>
      <span
        className={
          mono
            ? 'text-[15px] text-foreground font-mono tabular-nums'
            : 'text-[15px] text-foreground truncate'
        }
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground/70 mt-0.5">{hint}</span>}
    </div>
  )
}
