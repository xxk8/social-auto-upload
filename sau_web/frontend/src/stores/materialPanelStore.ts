import { create } from 'zustand'
import { aiApi, type NormalizedImage } from '@/api/ai'
import { api } from '@/api/client'
import { safeApplyMedia } from '@/lib/chat/chatFormBridge'
import type { ApplyAttempt, FormHandle } from '@/lib/chat/chatFormBridge'
import type { RefObject } from 'react'

/**
 * ai-sidebar-material-search §6 — Zustand store backing the AI sidebar's
 * MaterialSection. Two SEPARATE result slots so manual search and
 * title-triggered auto-recommend can coexist without clobbering each
 * other per the spec (§"Auto-recommend images by form title —
 * the manual results SHALL REPLACE imageResults[] AND recommendResults[]
 * SHALL remain visible"). One session-level cap on the auto-recommend
 * counter so a user who edits their title 50 times in 5 minutes doesn't
 * burn through Pexels's 200/hour free tier.
 *
 * Storage strategy (mirrors `useAiHistory.ts`):
 *   - `recentQueries` IS persisted via manual `localStorage.getItem`
 *     / `setItem` (NOT the persist middleware — codebase convention).
 *     LRUs to MAX_RECENT_QUERIES=3 to avoid LS bloat; survives reload.
 *   - `recommendCount` is INTENTIONALLY in-memory only. Spec requires
 *     a session-level cap that resets on full panel remount; persisting
 *     would let a user open a new tab and dodge the protection.
 *   - `imageResults / recommendResults` are in-memory only. They are
 *     inherently bound to the current page (search keyword is
 *     session-local), and the spec never asks for them to persist.
 */

const STORAGE_KEY = 'sau-material-panel-recent-queries'
const MAX_RECENT_QUERIES = 3

interface MaterialPanelState {
  // ── Manual search slot ──
  imageQuery: string
  imageResults: NormalizedImage[]
  imageLoading: boolean
  imageError: string | null
  // Map of NormalizedImage.id -> true while a single tile's "add-to-form"
  // request is in flight (debounces spam clicks on the same tile).
  addingImageIds: Set<string>

  // ── Auto-recommend slot ──
  recommendResults: NormalizedImage[]
  recommendLoading: boolean
  recommendError: string | null
  /** Session-level cap (3). Reset on remount — NOT persisted. */
  recommendCount: number
  /** Last read title, so the polling hook skips a no-change dup. */
  lastRecommendedTitle: string | null

  // ── Recent queries (LS-persisted, max 3 LRU) ──
  recentQueries: string[]

  // ── URL one-click fetch (AddUrlForm) ──
  urlFetching: boolean
  urlError: string | null

  // ── Actions ──
  setImageQuery: (q: string) => void
  searchImages: (query: string) => Promise<void>
  recommendByTitle: (title: string, force?: boolean) => Promise<void>
  addImageToForm: (
    image: NormalizedImage,
    formRef: RefObject<FormHandle | null>,
    formMode: 'video' | 'note',
  ) => Promise<ApplyAttempt>
  fetchAndAddUrl: (url: string, formRef: RefObject<FormHandle | null>, mode: 'video' | 'note') => Promise<void>
  clearResults: () => void
  reset: () => void
}

// ── recent-queries LS helpers (manual; no persist middleware) ─────
function loadRecentQueries(): string[] {
  try {
    const raw = (typeof localStorage !== 'undefined' ? localStorage : null)?.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT_QUERIES) : []
  } catch {
    return []
  }
}

function saveRecentQueries(queries: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries.slice(0, MAX_RECENT_QUERIES)))
  } catch {
    // LS quota or private-mode throw — never fail the action. Recent
    // queries are nice-to-have, not a hard state dependency.
  }
}

const INITIAL = {
  imageQuery: '',
  imageResults: [] as NormalizedImage[],
  imageLoading: false,
  imageError: null,
  addingImageIds: new Set<string>(),
  recommendResults: [] as NormalizedImage[],
  recommendLoading: false,
  recommendError: null,
  recommendCount: 0,
  lastRecommendedTitle: null as string | null,
  recentQueries: loadRecentQueries(),
  urlFetching: false,
  urlError: null,
}

export const useMaterialPanelStore = create<MaterialPanelState>((set, get) => ({
  ...INITIAL,

  setImageQuery: (q) => set({ imageQuery: q }),

  /**
   * Manual keyword search. Calls `/api/ai/images/search` and writes
   * the returned NormalizedImage[] into `imageResults`. Errors stay
   * short — backend returns Chinese one-liners (e.g. "未配置图片搜索
   * API key...") that the caller can surface verbatim.
   *
   * `recentQueries`: only push on success. Empty queries are dropped
   * at the UI layer.
   */
  searchImages: async (query) => {
    const trimmed = query.trim()
    if (!trimmed) return
    set({ imageLoading: true, imageError: null })
    try {
      const envelope = await aiApi.searchImages({ query: trimmed, count: 9 })
      if (envelope.success) {
        set({ imageResults: envelope.data, imageLoading: false })

        // LRUs new successful query (newest at front, dedup by
        // case-insensitive match, drop empties beyond MAX).
        const current = get().recentQueries
        const lower = trimmed.toLowerCase()
        const filtered = current.filter((q) => q.toLowerCase() !== lower)
        const next = [trimmed, ...filtered].slice(0, MAX_RECENT_QUERIES)
        set({ recentQueries: next })
        saveRecentQueries(next)
      } else {
        set({
          imageLoading: false,
          imageError: envelope.message || '搜索失败',
          imageResults: [],
        })
      }
    } catch (err) {
      set({
        imageLoading: false,
        imageError: err instanceof Error ? err.message : '搜索失败',
        imageResults: [],
      })
    }
  },

  /**
   * Title-triggered auto-recommend. Slimmer than searchImages — same
   * backend dispatch (`/api/ai/recommend-images`) but writes to
   * `recommendResults[]` (NOT imageResults[]).
   *
   * Cap: 3 calls per AiAssistantPanel lifetime (spec §"Session
   * recommendation cap"). Force=true bypasses the cap — used only
   * for the visibilitychange "fresh slate after 30s inactive" path.
   *
   * Dedup: skip polls where title matches `lastRecommendedTitle`,
   * empty string, or already-triggered this session.
   */
  recommendByTitle: async (title, force = false) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const { recommendCount, lastRecommendedTitle } = get()
    if (!force && recommendCount >= 3) return
    if (!force && trimmed === lastRecommendedTitle) return

    set({ recommendLoading: true, recommendError: null })
    try {
      const envelope = await aiApi.recommendImages({
        topic: trimmed,
        count: 9,
      })
      if (envelope.success) {
        set({
          recommendResults: envelope.data,
          recommendLoading: false,
          recommendCount: recommendCount + 1,
          lastRecommendedTitle: trimmed,
        })
      } else {
        set({
          recommendLoading: false,
          recommendError: envelope.message || '推荐失败',
          // Spec: failure does NOT decrement the session cap —
          // the failure is the user's signal that the server isn't
          // ready, not a retry. Increment the count so a follow-up
          // invisible try can't burn the budget.
          recommendCount: recommendCount + 1,
          lastRecommendedTitle: trimmed,
        })
      }
    } catch (err) {
      set({
        recommendLoading: false,
        recommendError: err instanceof Error ? err.message : '推荐失败',
        recommendCount: recommendCount + 1,
        lastRecommendedTitle: trimmed,
      })
    }
  },

  /**
   * Add a single image (from MaterialImageGrid click) to the form.
   * Three-step pipeline:
   *   1. fetch bytes from `/api/ai/images/fetch?url=...` (server-side
   *      CORS proxy + SSRF gate + 10MB cap)
   *   2. wrap as `File` via aiApi.fetchImageAsFile
   *   3. dispatch to form via safeApplyMedia with {images: [file]}
   *      (note mode only — video mode structurally rejects `{images}`,
   *      so this helper is effectively note-only; the caller surfaces
   *      a `no-media-slot` toast pointing the user at mode-switch.)
   *
   * Per-tile debounce: `addingImageIds: true` from click → response so
   * spam-clicks queue until the first finishes. The set is a `Set<string>`
   * for O(1) membership checks; we swap reference on each update so
   * Zustand subscribers see a fresh array (Set instances are mutable
   * so a same-reference write would not retrigger React).
   */
  addImageToForm: async (image, formRef, formMode) => {
    const current = get().addingImageIds
    if (current.has(image.id)) {
      // Spam-click on in-flight tile is a silent no-op. Returning the
      // dedicated 'debounced' reason (vs reusing 'unmounted') lets the
      // caller-side switch stay semantically honest — the grid
      // swallows this clue without firing a rejection toast, so a
      // fast double-click won't spam the user with "失败" copy.
      return { applied: false, reason: 'debounced' as const }
    }
    set({ addingImageIds: new Set(current).add(image.id) })
    try {
      let attempt: ApplyAttempt
      if (formMode === 'video') {
        // Video mode uses the URL STRING as the cover thumbnail;
        // no File download needed (the cover is a URL, not a blob).
        // This is the §6-9 double-toast fix path: prior versions
        // hard-coded {images: [file]} which VideoForm rejected with
        // 'no-media-slot' — and the form's inner "视频表单不支持..."
        // warning would stack on top of the grid's post-await success
        // toast. Routing to {thumbnail} here is the form-side veto.
        attempt = safeApplyMedia(formRef, { thumbnail: image.full })
      } else {
        // Note mode downloads bytes and APPENDS to images[] list
        // (per-form contract: not replaced). Platform-MAX is enforced
        // by NoteForm.applyMedia through `addImagesWithinLimit`.
        const ext = deriveExtFromUrlOrAlt(image)
        const filename = `${image.source}_${image.id.split(':')[1]}.${ext}`
        const file = await aiApi.fetchImageAsFile(image.full, filename, mimeFromExt(ext))
        attempt = safeApplyMedia(formRef, { images: [file] })
      }
      return attempt
    } catch (err) {
      const msg = err instanceof Error ? err.message : '图片下载失败'
      // Belt-and-suspenders — AddUrlForm path's `urlError` reader mirrors
      // the surfaced message even though the primary surface is now
      // the grid's post-Attempt error toast.
      set({ imageError: msg })
      return { applied: false, reason: 'threw' as const, message: msg }
    } finally {
      const set2 = get().addingImageIds
      const next = new Set(set2)
      next.delete(image.id)
      set({ addingImageIds: next })
    }
  },

  /**
   * URL paste → server download → file apply. Two-step pipeline:
   *   1. POST /api/inbox/download → `{success, filename, engine}`
   *      (server saves to videos/<inbox>/disk, returns filename).
   *   2. GET /api/inbox/file/<name> via `api.inboxFetchFile(filename)`
   *      → bytes → File → safeApplyMedia(formRef, {file}).
   * Only mode='video' makes sense here (a downloaded video IS the main
   * media file). Note mode callers should display a hint or pass
   * `{images: [...video_as_image_unsupported]}` — for now we accept
   * both modes and dispatch via the form's applyMedia, letting each
   * form surface its own mode-specific toast.
   */
  fetchAndAddUrl: async (url, formRef, mode) => {
    set({ urlFetching: true, urlError: null })
    try {
      const dlRes = (await api.inboxDownload(url)) as
        | { success: true; filename: string; engine: string; dir?: string }
        | { success: false; message: string }
      if (!dlRes.success) {
        set({ urlFetching: false, urlError: dlRes.message || '下载失败' })
        return
      }
      const file = await api.inboxFetchFile(dlRes.filename, mimeFromFilename(dlRes.filename))
      const attempt = safeApplyMedia(formRef, { file })
      if (!attempt.applied && attempt.reason === 'unmounted') return
      if (mode === 'note') {
        // Note mode rejected `{file}` — surface explicitly. The form
        // already toasts, but make sure the URL form knows so it can
        // offer a "toast says switch to video" follow-up.
        set({ urlFetching: false })
      } else {
        set({ urlFetching: false })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '下载失败'
      set({ urlFetching: false, urlError: msg })
      throw err
    }
  },

  clearResults: () => set({
    imageResults: [],
    imageError: null,
    recommendResults: [],
    recommendError: null,
    addingImageIds: new Set(),
    urlError: null,
  }),

  /**
   * Full reset — used by the auto-recommend hook on visibilitychange
   * hidden >30s to give the user a fresh slate. Clears the cap too.
   */
  reset: () => set({
    ...INITIAL,
    recentQueries: get().recentQueries, // preserve LS-backed LRUs
  }),
}))

// ── helpers used by both actions and direct callers ─────────────────

function deriveExtFromUrlOrAlt(image: NormalizedImage): string {
  // Pixabay exposes format hints; otherwise fall back to PNG for
  // Pexels `original` URLs (Pexels serves mostly JPEG at .original).
  if (image.full.includes('.webm')) return 'webm'
  if (image.full.includes('.png')) return 'png'
  // Default to jpg — works for both sources.
  return 'jpg'
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'webm': return 'image/webm'
    default: return 'image/jpeg'
  }
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.m4v')) return 'video/x-m4v'
  if (lower.endsWith('.ts')) return 'video/mp2t'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}
