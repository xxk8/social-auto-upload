// ── Platform chip strip — language-only chip row, active-state CSS ────────
//
// The "支持下载" row that lives below the URL input on `/dashboard/inbox` was
// originally inlined in `InboxPage.tsx`. After a multi-turn refactor
// path (per-platform colored SVGs → 15 in-sync BrandGlyph cursors →
// language-only chips with sodium-amber active-state wash) the strip's
// density call + chipClass template + chrome-pattern locks became
// stable enough to extract. Publish wizard / future sharing screens
// can now mount the same affordance with one import.
//
// Platform list + URLs live in `platform-chip-strip.constants.ts` to
// satisfy react-refresh Fast Refresh (constants must not cohabit a
// component file that exports JSX).
//
// Brand icons are sourced from `@/components/ui/platform-icon` (single
// source of truth — light/dark SVGs under `src/assets/brands/`).

import { PLATFORMS, PLATFORM_URLS, type PlatformKey } from './platform-chip-strip.constants'
import { PlatformIcon } from '@/components/ui/platform-icon'

// ── PlatformChipStrip — rendered chip row ───────────────────────────────
//
// Pure-declarative: `activeKey` is a single `PlatformKey | null` (the
// host's URL-detection result). One chip carries `bg-primary/10` +
// `ring-primary/30` at a time, no exceptions. `null` means "no chip
// active" (idle state — all 15 chips render in `bg-muted/50`).
//
// vitest fence: `data-testid="inbox-platform-chip-strip"` (overridable
// via `testId`) lets `InboxPage.test.tsx`'s active-state describe run
// `within(scope).getAllByRole('link').filter(...)` to lock the
// exclusivity invariant that no two chips ever light up simultaneously
// AND the scope is limited to the chip row (unrelated surfaces adopting
// `bg-primary/10` cannot silently inflate the count).

export { PLATFORMS, type PlatformKey } from './platform-chip-strip.constants'

export interface PlatformChipStripProps {
  /** The currently detected platform key from URL parsing; `null` → no chip activates. */
  activeKey: PlatformKey | null
  /** Vitest/automation scope anchor; default keeps the existing `inbox-platform-chip-strip` fence. */
  testId?: string
  /** Strip header label rendered before the chip row. Default = '支持下载'. */
  label?: string
}

export function PlatformChipStrip({
  activeKey,
  testId = 'inbox-platform-chip-strip',
  label = '支持下载',
}: PlatformChipStripProps) {
  return (
    <nav
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-3 border-t border-border/40"
      aria-label={`支持平台: ${PLATFORMS.map(p => p.name).join(', ')}`}
    >
      <span className="text-xs text-muted-foreground shrink-0 leading-none">{label}</span>
      {PLATFORMS.map((p) => {
        const url = PLATFORM_URLS[p.key]
        // chipClass: layout + active/idle bg + (clickable-only) hover + focus-visible.
        // `bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/30` is
        // the active-state CSS locked by InboxPage.test.tsx (4 tokens
        // at once). Anything other than `{idle: bg-muted/50}` for the
        // off-state breaks the vitest pin.
        const chipClass = `inline-flex items-center rounded-md px-2 py-0.5 text-xs transition-colors duration-150 leading-none ${
          activeKey === p.key
            ? 'bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 text-primary'
            : 'bg-muted/50 dark:bg-white/10 focus-visible:ring-1 focus-visible:ring-primary/60 focus-visible:ring-offset-1 text-muted-foreground'
        } ${url ? 'cursor-pointer hover:bg-muted/80 dark:hover:bg-white/15' : ''}`
        const chipContent = (
          <>
            {p.src && (
              <PlatformIcon
                platform={p.key}
                className="h-3.5 w-3.5 shrink-0 align-middle invert opacity-80 dark:invert-0 -mr-0.5"
                aria-hidden="true"
              />
            )}
            <span className="truncate">{p.name}</span>
          </>
        )
        return url ? (
          <a
            key={p.key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={`打开 ${p.name} 网站`}
            className={`no-underline ${chipClass}`}
          >
            {chipContent}
          </a>
        ) : (
          <span key={p.key} className={chipClass} title={p.name}>
            {chipContent}
          </span>
        )
      })}
    </nav>
  )
}