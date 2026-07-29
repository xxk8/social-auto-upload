/**
 * Schedule time-pick presets shared between `SchedulePicker.tsx` (the
 * UI) and `SchedulePicker.test.tsx` (the Monday-edge regression
 * suite).
 *
 * Kept in its own module because `SchedulePicker.tsx` is a memoized
 * React component — extracting the static preset list keeps the file
 * single-export and satisfies `react-refresh/only-export-components`,
 * while still giving the test suite a single source of truth to
 * exercise against (so a future preset rename self-fails both sides).
 *
 * If a future caller needs a custom preset set, swap the binding in
 * `SchedulePicker.tsx` (the import is named, not aliased) OR build a
 * `<PresetPicker presetSet={...}>` child component.
 */

// Interface kept file-local: `PRESETS` annotates itself as
// `PresetButton[]` so the type name is referenced via the const
// declaration's annotation, but no external file needs to mention
// `PresetButton` by name. De-exporting keeps the module's public
// surface to `PRESETS` + `toLocalDatetimeString` only.
interface PresetButton {
  label: string
  compute: () => Date
}

/**
 * `datetime-local` input expects a *local* `YYYY-MM-DDTHH:mm` string.
 * `Date.toISOString()` is UTC and wrong by the user's tz offset — use
 * this helper to render the local form the input natively accepts.
 */
export function toLocalDatetimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Parse a calendar deep-link `?schedule=` value into a
 * `datetime-local` string (`YYYY-MM-DDTHH:mm`).
 *
 * Accepts:
 *   - `2026-07-25`           → that day at 09:00 local
 *   - `2026-07-25T14:30`     → as-is (seconds stripped)
 *   - `2026-07-25 14:30:00`  → normalized
 *   - full ISO with offset   → converted to local wall time
 *
 * Returns `null` when the input is empty or unparseable.
 */
export function parseScheduleParam(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null

  // Date only: pin to 09:00 (typical morning queue slot).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T09:00`
  }

  // datetime-local-ish without seconds
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    return s
  }

  // With seconds or space separator
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  )
  if (m) {
    // If no timezone suffix, treat as local wall time.
    if (!/[zZ]|[+-]\d{2}/.test(s)) {
      return `${m[1]}T${m[2]}:${m[3]}`
    }
  }

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return toLocalDatetimeString(d)
}

/** Three preset short-cuts matching the actual publish cadence: next hour,
 *  tomorrow 9am (typical content queue schedule), next Monday 6pm
 *  (typical weekly push). */
export const PRESETS: PresetButton[] = [
  { label: '1 小时后', compute: () => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d
  } },
  { label: '明天 09:00', compute: () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d
  } },
  { label: '下周一 18:00', compute: () => {
    const d = new Date()
    // 0=Sun..6=Sat.
    // 下周一定位人性化 — 如果今天是周一且尚未到 18:00，按今天
    // 处理；否则跳到下一个周一。`(8 - dow) % 7` 计算到下一个周一的
    // 偏移量。`(8 - 1) % 7 = 0` → 加上 `|| 7` 在「下周一」语义上
    // 映射为“今天只过了一天后的周一”。
    const todayIsMonday = d.getDay() === 1
    const targetIsToday =
      todayIsMonday && d.getHours() < 18
    const daysAhead = targetIsToday
      ? 0
      : ((8 - d.getDay()) % 7) || 7
    d.setDate(d.getDate() + daysAhead)
    d.setHours(18, 0, 0, 0)
    return d
  } },
]
