// ─────────────────────────────────────────────────────────────────────
// SegmentedTimeRange — premium underline-style segmented control that
// wraps Radix Tabs primitives.
//
// Replaces the default `bg-muted p-1` pill TabsList on admin pages with
// a subtle bottom-border underline that activates for the selected
// segment. Visually it reads like Linear's filter chips / Vercel's
// Insights tabs — quiet, no fill noise, only the active segment
// switches its color and gains an underline.
//
// Visual contract:
//   • TabsList underflow: no background pill, only a slate-100 hairline
//     table-row border for the strip.
//   • Inactive trigger: muted-foreground text, hover subtle.
//   • Active trigger: foreground text + 2px primary underline that
//     bleeds slightly past the rounded corners.
//
// `data-testid` is preserved per the existing contract on callers:
// `admin-nav-tab-{value}` is set BY THE CALLER (not this primitive) so
// we don't lock test layout here. We still set `role="tab"` on each
// trigger because Radix does that for us.
//
// Each option's rendered accessible name is the `label` (e.g. "全部"),
// which matches the existing `screen.getByRole('tab', { name: '全部' })`
// test contract on AdminDashboard.test.tsx.
//
// Module exports ONLY the component so Fast Refresh stays happy.
// ─────────────────────────────────────────────────────────────────────

import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

interface PresetOption<V extends string> {
  value: V
  label: string
}

interface SegmentedTimeRangeProps<V extends string> {
  value: V
  onValueChange: (value: V) => void
  options: ReadonlyArray<PresetOption<V>>
  className?: string
  ariaLabel?: string
}

function SegmentedTimeRange<V extends string>({
  value,
  onValueChange,
  options,
  className,
  ariaLabel,
}: SegmentedTimeRangeProps<V>) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      className={className}
    >
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className="relative inline-flex items-end gap-1 border-b border-border/60"
      >
        {options.map((opt) => {
          // Manually compose className so we both keep Radix's data-state
          // hook *and* drop the default `bg-muted` background in favor of
          // a clean underline: active state gets a 2px primary bar pinned
          // bottom-0 via inline shadow (no border-collapse side effects).
          // Trigger carries `group` so the inner underline span's
          // `group-data-[state=active]:opacity-100` variant resolves.
          // Without `group` on the parent, Tailwind's group-data
          // selector cannot read the trigger's `data-state="active"`
          // and the active underline stays invisible.
          return (
            <TabsPrimitive.Trigger
              key={opt.value}
              value={opt.value}
              className={cn(
                'group relative inline-flex items-center justify-center whitespace-nowrap',
                'px-3 pt-1.5 pb-2 text-[12.5px] font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
                // Radix-defaults we want to keep:
                'disabled:pointer-events-none disabled:opacity-50',
                // Tonal mapping: muted default, foreground on active.
                'text-muted-foreground/80 hover:text-foreground',
                'data-[state=active]:text-foreground',
              )}
            >
              {opt.label}
              {/* Active-only underline strip — 2px rounded line at the
                  bottom of the trigger. Variant reads parent's data
                  state via the `group` class above. */}
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute left-2 right-2 -bottom-[1.5px] h-[2px] rounded-full',
                  'bg-foreground opacity-0 transition-opacity duration-150',
                  'group-data-[state=active]:opacity-100',
                )}
              />
            </TabsPrimitive.Trigger>
          )
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

export { SegmentedTimeRange }
