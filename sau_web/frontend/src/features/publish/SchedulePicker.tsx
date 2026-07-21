import { memo, useId } from 'react'
import { Input, Label } from '@/Components/ui/index'
import { Button } from '@/Components/ui/button'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
// Preset list + Monday-edge math live in ./schedulePresets — the
// preset module is single-source-of-truth consumed by both this UI
// and `SchedulePicker.test.tsx` (so a future preset reorder self-
// fails on both sides). Kept in a sibling module so this file
// remains a single-export component (react-refresh/only-export-
// components). See `schedulePresets.ts` for the WHY/JSDoc.
import { PRESETS, toLocalDatetimeString } from './schedulePresets'

export interface SchedulePickerProps {
  value: string
  onChange: (value: string) => void
  /** Optional caller-provided id; falls back to a per-instance
   *  React.useId() so sibling instances (e.g. one inside VideoForm
   *  and one inside ContentStep sharing a page) never collide. */
  id?: string
  label?: string
  className?: string
}

export const SchedulePicker = memo(function SchedulePicker({
  value,
  onChange,
  id,
  label = '定时发布',
  className,
}: SchedulePickerProps) {
  // Round-form-audit: SchedulePicker is rendered inside multiple
  // forms (VideoForm advanced / ContentStep / NoteForm). A single
  // hard-coded `id="schedule-picker"` would emit duplicate-DOM-id
  // warnings when two coexist on the same PublishPage render. Use
  // React.useId() as the per-instance default; callers can still
  // override via the explicit `id` prop for tests that want a stable
  // selector.
  const reactId = useId()
  const inputId = id ?? `schedule-${reactId}`

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <Label htmlFor={inputId}>{label}</Label>
      </div>
      <Input
        id={inputId}
        name="schedule"
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* Quick-set presets. Each button writes back through `onChange`
          so a "1 小时后" tap mirrors the same path a manual datetime
          picker would. `font-mono tabular-nums` keeps the timestamps
          aligned if a future caller renders the picked value
          elsewhere. */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="outline"
            size="sm"
          className={cn(
            // h-8 lifts the chip to 32×32 — meets WCAG 2.5.5 / 2.5.8
            // (AAA) minimum tap-target. Quick-set presets are an
            // engagement loop and are tapped often, so the 32h floor
            // matters more than visual density.
            'h-8 px-2 text-[11px] font-normal',
            'border-border/60 text-muted-foreground hover:text-foreground',
          )}
            onClick={() => onChange(toLocalDatetimeString(preset.compute()))}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  )
})
