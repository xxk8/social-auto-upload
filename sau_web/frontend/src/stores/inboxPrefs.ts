/**
 * Persisted user preferences for the download centre (subtitle defaults + density).
 */

export type SubtitleModePref = 'bilingual' | 'zh' | 'en' | 'source'
export type SubtitleWritePref = 'hard' | 'soft' | 'none'
export type SubtitleQualityPref = 'original' | '1080' | '720'
export type InboxDensityPref = 'comfortable' | 'compact'

export interface InboxPrefs {
  subtitleMode: SubtitleModePref
  subtitleWrite: SubtitleWritePref
  subtitleQuality: SubtitleQualityPref
  density: InboxDensityPref
  /** Collapse transcript blocks by default in compact mode */
  collapseTranscript: boolean
}

const STORAGE_KEY = 'sau-inbox-prefs'
const DEFAULTS: InboxPrefs = {
  subtitleMode: 'bilingual',
  subtitleWrite: 'hard',
  subtitleQuality: '1080',
  density: 'comfortable',
  collapseTranscript: false,
}

export function loadInboxPrefs(): InboxPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<InboxPrefs>
    return {
      ...DEFAULTS,
      ...parsed,
      subtitleMode: (['bilingual', 'zh', 'en', 'source'] as const).includes(
        parsed.subtitleMode as SubtitleModePref,
      )
        ? (parsed.subtitleMode as SubtitleModePref)
        : DEFAULTS.subtitleMode,
      subtitleWrite: (['hard', 'soft', 'none'] as const).includes(
        parsed.subtitleWrite as SubtitleWritePref,
      )
        ? (parsed.subtitleWrite as SubtitleWritePref)
        : DEFAULTS.subtitleWrite,
      subtitleQuality: (['original', '1080', '720'] as const).includes(
        parsed.subtitleQuality as SubtitleQualityPref,
      )
        ? (parsed.subtitleQuality as SubtitleQualityPref)
        : DEFAULTS.subtitleQuality,
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      collapseTranscript: Boolean(parsed.collapseTranscript),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveInboxPrefs(patch: Partial<InboxPrefs>): InboxPrefs {
  const next = { ...loadInboxPrefs(), ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
  return next
}
