/**
 * Display-shape helpers for AI chrome (model id rendering, etc.).
 *
 * Centralizing these strings keeps the publish page's AI sidebar chrome
 * coherent across the `<AiSettingsHeader>` chip, the `<ModelInlinePicker>`
 * trigger, and the outer `<PublishAiSidebar>` header — three sites used
 * to inline the same `id.split('/').pop() / slice / '…'` recipe with
 * drifting thresholds (22 vs 28 vs 18) and silent drift risk.
 */

/**
 * Take the tail segment of a model id (`openai/gpt-4o-mini` → `gpt-4o-mini`)
 * and cap length with the U+2026 HORIZONTAL ELLIPSIS suffix.
 *
 * Picks `maxLen - 2` for the slice so the ellipsis + 1 char always fit
 * inside the rendered string at exactly `maxLen` columns. Defaults to
 * 22 to match the dense merged-header context (where every cell sits
 * next to ModelPicker / SettingsPopover / Close button on the same row).
 *
 * Returns `''` for null/undefined so callers don't need to guard before
 * passing the value into `title=` / a placeholder.
 */
export function shortModel(id: string | null | undefined, maxLen = 22): string {
  if (!id) return ''
  const tail = id.split('/').pop() || id
  return tail.length > maxLen ? `${tail.slice(0, maxLen - 2)}…` : tail
}
