// ──────────────────────────────────────────────────────────────────────────
// features/preferences/shared/info-row.tsx
//
// Single source of truth for the dialog's info-row primitive. Lives in
// `features/preferences/shared/` because there are now exactly 2
// consumers (AccountTab + OverviewTab's tile summaries) — the
// canonical "promote-to-shared" trigger. Previously was a private
// helper inside AccountTab.tsx; that was right when there was one
// consumer (round-OPT-prefs-dialog v3 — the dialog shell only
// mounted AccountTab; no other surface needed row primitive).
//
// Round-OPT-3G+ extended the surface list: OverviewTab renders a
// 2x2 grid of jump-off tiles, EACH tile renders up to 4 InfoRow
// instances (Account: 邮箱/角色/显示名/最近登录; Settings:
// 套餐/价格/已包含/相关页面; Personalization: 主题/紧凑度/语言;
// About: 应用名/版本/SHA/描述). With 2 consumers, the helper
// graduates from co-located-with-its-only-consumer staying-in-file
// to shared/.
//
// Layout rhythm (py-2 + hairline border-b per row, last:border-0):
// • friendly on dense Overview tiles (4 rows in <80px stack)
//
// Mono flag flips value to font-mono for dates / IDs / build SHAs
// — same convention AccountTab already used in round-OPT-prefs-dialog
// v3 so the visual style stays in lockstep across both surfaces.
//
// data-testid invariants (round-OPT-3G+):
// • `preferences-info-row-${label}` — added so OverviewTab tiles
//   can be asserted per-row from PreferencesDialog.test.tsx (r).
// • AccountTab rows use the same convention — backwards compatible,
//   no source-tab test pinning changes needed (AccountTab was
//   asserted by text, not data-testid).
//
// On `eslint-disable react-refresh/only-export-components`:
// This module exports exactly one React component (InfoRow) and
// zero non-component values, so the rule is already satisfied
// without an eslint-disable banner. See openspec/config.yaml
// per-directory rule config.
// ──────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type RowDensity = 'default' | 'compact'

interface InfoRowProps {
  /** Short label rendered as 11px font-mono uppercase eyebrow
   *  above the value (matches AccountTab v3 convention). */
  label: string
  /** Display value. Truncated by default (text-only); pass `mono`
   *  for font-mono tabular-nums without truncation (dates, SHAs).
   *  Round-OPT-3G+ v2 widens to ReactNode so callers can prepend
   *  a leading icon (e.g. <LinkIcon /> for a related-page row)
   *  inline with the text — previously this was hacked via
   *  `as unknown as string` which is a type-system lie. */
  value: ReactNode
  /** Optional subdued context line below the value. */
  hint?: string
  /** Render the value in font-mono (dates / IDs / build SHAs).
   *  Only applies when `value` is a string; ReactNode values
   *  render their own styling since callers compose them. */
  mono?: boolean
  /** `data-testid` override; default = `preferences-info-row-${label}`. */
  testId?: string
  /** Round-OPT-3G+ v2.5: visual density.
   *  • `default` — py-3 + text-[15px]; matches AccountTab v3
   *    (5 rows × ~70px = ~350px card). Use for the dedicated
   *    AccountTab surface so the original rhythm is preserved.
   *  • `compact` — py-2 + text-[13px]; matches Overview tile
   *    density (4 rows × ~50px = ~200px per tile × 4 tiles =
   *    ~800px content area; fits into the modal's 70vh with
   *    minimal scroll). Use for jump-off tile rows.
   *  Without this, compacting the shared helper for Overview
   *  silently shrinks AccountTab — a regression on the original
   *  source-tab visual rhythm. */
  density?: RowDensity
}

export function InfoRow({
  label,
  value,
  hint,
  mono,
  testId,
  density = 'default',
}: InfoRowProps) {
  const isCompact = density === 'compact'
  const valueSizeClass = isCompact ? 'text-[13px]' : 'text-[15px]'
  const padClass = isCompact ? 'py-2.5' : 'py-3.5'
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border/30 last:border-b-0 transition-colors', padClass)}
      data-testid={testId ?? `preferences-info-row-${label}`}
    >
      <span className="text-[10.5px] font-mono font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
        {label}
      </span>
      <span
        className={cn(
          valueSizeClass,
          'text-foreground/95',
          // mono only applies to plain-string values; ReactNode
          // values are caller-styled (the inline-flex wrapper
          // also handles truncate correctly for icons).
          mono && typeof value === 'string' && 'font-mono tabular-nums',
          (!mono || typeof value !== 'string') && 'truncate',
        )}
      >
        {value}
      </span>
      {hint && (
        <span className={cn('mt-0.5 leading-snug text-muted-foreground/60', isCompact ? 'text-[11px]' : 'text-xs')}>
          {hint}
        </span>
      )}
    </div>
  )
}
