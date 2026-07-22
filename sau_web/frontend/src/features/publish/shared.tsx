/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
export { effectiveMaxTags, platformTagLabel, formatTaskId } from './shared.helpers'

/**
 * Render an icon-equipped section header used inside publishing cards.
 * Keep this here in publish/shared — it's tightly coupled to the publish
 * card layout (border-b / flex gap / rounded-lg background).
 *
 * The badge color is the unified `--primary` token; per-section overrides
 * were removed as part of the `feat(ui): unify brand colors` cleanup so
 * the design vocabulary has exactly one accent.
 *
 * OPT-follow-up-3-sweep-2: this is the only remaining top-level export
 * from `publish/shared.tsx`. The four callable helpers
 * (`PLATFORM_TAG_LIMITS`, `effectiveMaxTags`, `platformTagLabel`,
 * `formatTaskId`) moved to `publish/shared.helpers.ts` so the
 * `react-refresh/only-export-components` rule is inviolate.
 */
export function SectionHeader({
  icon,
  title,
}: {
  icon: ReactNode
  title: string
}) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <span className="text-sm font-semibold">{title}</span>
    </div>
  )
}
