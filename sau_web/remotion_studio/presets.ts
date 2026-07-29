export type VisualPreset = {
  id: string
  name: string
  description?: string
  [key: string]: unknown
}

export type PresetId = string

export const PRESETS: VisualPreset[] = [
  { id: 'classic', name: 'Classic' },
]

export function getPreset(id: string): VisualPreset | undefined {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}

export function getPresetById(id: string | null | undefined): VisualPreset {
  if (!id) return PRESETS[0]
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}

export default PRESETS
