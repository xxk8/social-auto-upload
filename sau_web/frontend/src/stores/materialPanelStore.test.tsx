import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useMaterialPanelStore } from './materialPanelStore'

/**
 * Regression suite — locks in the §6 contract for the AI sidebar's
 * material-panel store. Four mandated scenarios per `tasks.md §11.1`:
 *
 *   1. search 成功 → imageResults offsets by new payload, imageLoading resets
 *   2. search 5xx → imageError sets, imageResults clears
 *   3. recommend preserves manual slot stacking (recommendResults updates
 *      while imageResults stays stale — manual search does NOT clobber)
 *   4. recentQueries LRU-only-max-3 (cap + case-insensitive dedup + LS)
 *
 * Plus an extra invariant: `reset()` MUST preserve LS-backed recentQueries
 * (visibilitychange hidden >30s "fresh slate" path needs this — see
 * useMaterialAutoRecommend.ts).
 *
 * Mock strategy: vi.mock `@/api/ai` so a real Pexels/Pixabay HTTP call
 * is replaced by parameterized envelopes. `localStorage` is real —
 * we read/write the canonical `sau-material-panel-recent-queries` key
 * via the test's beforeEach cleanup (NOT via vi.mock; LS is
 * side-effect-safe in this test env).
 */

// ── mock @/api/ai ───────────────────────────────────────────────
// We use vi.mocked(aiApi) for type-safe assertion. Returns a single
// object so vi.mocked() can find each method.
vi.mock('@/api/ai', () => ({
  aiApi: {
    searchImages: vi.fn(),
    recommendImages: vi.fn(),
    fetchImageAsFile: vi.fn(),
  },
  NormalizedImage: class NormalizedImage {}, // type-only export placeholder
}))
import { aiApi } from '@/api/ai'

// ── mock @/api/client (only fetchAndAddUrl pathway; not exercised here but
//    needed because materialPanelStore imports `api` for the inbox flow). ──
vi.mock('@/api/client', () => ({
  api: {
    inboxDownload: vi.fn(),
    inboxReveal: vi.fn(),
    inboxTranscribeStream: vi.fn(),
    inboxFetchFile: vi.fn(),
  },
  getNoteImageLimit: () => 30,
  PLATFORMS: [],
  NOTE_PLATFORMS: [],
}))
import { api } from '@/api/client'

// ── LS cleanup hook ─────────────────────────────────────────────
const STORAGE_KEY = 'sau-material-panel-recent-queries'
beforeEach(() => {
  // Wipe LS so each test starts from a clean slate.
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  // Reset store to INITIAL.
  useMaterialPanelStore.setState({
    imageQuery: '',
    imageResults: [],
    imageLoading: false,
    imageError: null,
    addingImageIds: new Set(),
    recommendResults: [],
    recommendLoading: false,
    recommendError: null,
    recommendCount: 0,
    lastRecommendedTitle: null,
    recentQueries: [],
    urlFetching: false,
    urlError: null,
  })
  vi.mocked(aiApi.searchImages).mockReset()
  vi.mocked(aiApi.recommendImages).mockReset()
  vi.mocked(aiApi.fetchImageAsFile).mockReset()
  vi.mocked(api.inboxDownload).mockReset()
  vi.mocked(api.inboxFetchFile).mockReset()
})
afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
})

// ── factory helpers ─────────────────────────────────────────────
function pxImages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `pexels:${1000 + i}`,
    source: 'pexels' as const,
    thumb: `https://example.com/${i}.jpg`,
    preview: `https://example.com/${i}.jpg`,
    full: `https://example.com/${i}.jpg`,
    photographer: `Photog ${i}`,
    photographerUrl: null,
    pageUrl: 'https://pexels.com',
    alt: '',
  }))
}

// ── Scenario 1: search success ────────────────────────────────
describe('searchImages — §11.1 scenario 1 (success)', () => {
  it('happy path: imageResults updates with the new payload, imageLoading resets', async () => {
    const images = pxImages(3)
    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: true,
      data: images,
      debug: { pexels_count: 3, pixabay_count: 0, merged_count: 3 },
    })
    await useMaterialPanelStore.getState().searchImages('咖啡')
    const s = useMaterialPanelStore.getState()
    expect(s.imageResults).toHaveLength(3)
    expect(s.imageResults[0]?.id).toBe('pexels:1000')
    expect(s.imageLoading).toBe(false)
    expect(s.imageError).toBeNull()
  })

  it('recentQueries pushes "咖啡" to head on success', async () => {
    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: true,
      data: pxImages(1),
    })
    await useMaterialPanelStore.getState().searchImages('咖啡')
    expect(useMaterialPanelStore.getState().recentQueries).toEqual(['咖啡'])
  })

  it('empty input is a no-op (no fetch, no state change)', async () => {
    await useMaterialPanelStore.getState().searchImages('   ')
    expect(aiApi.searchImages).not.toHaveBeenCalled()
    expect(useMaterialPanelStore.getState().imageResults).toEqual([])
  })
})

// ── Scenario 2: search failure ────────────────────────────────
describe('searchImages — §11.1 scenario 2 (failure envelope)', () => {
  it('envelope-mode failure path: imageError sets, imageResults clears', async () => {
    // Seed with prior results so we can verify the clear.
    useMaterialPanelStore.setState({ imageResults: pxImages(3) })
    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: false,
      message: '未配置图片搜索 API key。请在 .env 设置 PEXELS_API_KEY',
      code: 'IMAGE_SOURCE_NOT_CONFIGURED',
    })
    await useMaterialPanelStore.getState().searchImages('foo')
    const s = useMaterialPanelStore.getState()
    expect(s.imageResults).toEqual([])
    expect(s.imageError).toContain('未配置图片搜索 API key')
    expect(s.imageLoading).toBe(false)
  })

  it('throw-mode failure path: imageError derives from Error.message', async () => {
    vi.mocked(aiApi.searchImages).mockRejectedValue(new Error('network down'))
    await useMaterialPanelStore.getState().searchImages('foo')
    const s = useMaterialPanelStore.getState()
    expect(s.imageError).toBe('network down')
    expect(s.imageResults).toEqual([])
  })

  it('throw-mode non-Error rejection falls back to the 搜索失败 static string', async () => {
    // Store's catch is `err instanceof Error ? err.message : '搜索失败'`.
    // A bare-string throw (NOT an Error instance) takes the fallback
    // path — the literal throw string is NOT surfaced (would leak
    // arbitrary raw content past the UI). This locks that contract so
    // a future refactor that drops the fallback surfaces a clear
    // regression instead of silently leaking the raw throw value.
    vi.mocked(aiApi.searchImages).mockRejectedValue('string-only panic')
    await useMaterialPanelStore.getState().searchImages('foo')
    const s = useMaterialPanelStore.getState()
    expect(s.imageError).toBe('搜索失败')
    // imageResults always cleared, imageLoading always off — same
    // invariant as Error-mode failure.
    expect(s.imageResults).toEqual([])
    expect(s.imageLoading).toBe(false)
  })
})

// ── Scenario 3: recommend preserves manual slot stacking ─────
describe('recommendByTitle — §11.1 scenario 3 (manual coexist with recommend)', () => {
  it('populates recommendResults without touching imageResults', async () => {
    const manual = pxImages(2)
    useMaterialPanelStore.setState({ imageResults: manual })
    const recs = pxImages(3).map((p, i) => ({ ...p, id: `pixabay:${7_000 + i}` }))
    vi.mocked(aiApi.recommendImages).mockResolvedValue({
      success: true,
      data: recs,
    })
    await useMaterialPanelStore.getState().recommendByTitle('周末咖啡')
    const s = useMaterialPanelStore.getState()
    expect(s.recommendResults).toHaveLength(3)
    expect(s.recommendResults[0]?.source).toBe('pexels') // renamed ids only, but src same
    // Image results are NOT touched.
    expect(s.imageResults).toEqual(manual)
    expect(s.recommendCount).toBe(1)
    expect(s.lastRecommendedTitle).toBe('周末咖啡')
  })

  it('same-title repeat is a no-op (dedup by lastRecommendedTitle)', async () => {
    vi.mocked(aiApi.recommendImages).mockResolvedValue({
      success: true,
      data: pxImages(2),
    })
    await useMaterialPanelStore.getState().recommendByTitle('coffee')
    await useMaterialPanelStore.getState().recommendByTitle('coffee')
    expect(aiApi.recommendImages).toHaveBeenCalledTimes(1)
  })

  it('recommendCount cap at 3 (no force)', async () => {
    for (const title of ['a', 'b', 'c', 'd']) {
      vi.mocked(aiApi.recommendImages).mockResolvedValue({
        success: true,
        data: pxImages(1),
      })
      await useMaterialPanelStore.getState().recommendByTitle(title)
    }
    expect(aiApi.recommendImages).toHaveBeenCalledTimes(3)
    expect(useMaterialPanelStore.getState().recommendCount).toBe(3)
  })

  it('recommendCount cap at 3 (force=true bypasses)', async () => {
    for (const title of ['a', 'b', 'c']) {
      vi.mocked(aiApi.recommendImages).mockResolvedValue({
        success: true,
        data: pxImages(1),
      })
      await useMaterialPanelStore.getState().recommendByTitle(title)
    }
    // Now capped; force=true bypasses.
    vi.mocked(aiApi.recommendImages).mockResolvedValue({
      success: true,
      data: pxImages(1),
    })
    await useMaterialPanelStore.getState().recommendByTitle('a-new-title', true)
    expect(aiApi.recommendImages).toHaveBeenCalledTimes(4)
    expect(useMaterialPanelStore.getState().recommendCount).toBe(4)
  })

  it('failure increments the cap (per spec §"Auto-recommend ... no decrement")', async () => {
    vi.mocked(aiApi.recommendImages).mockResolvedValue({
      success: false,
      message: 'boom',
    })
    await useMaterialPanelStore.getState().recommendByTitle('t')
    expect(useMaterialPanelStore.getState().recommendCount).toBe(1)
  })
})

// ── Scenario 4: recentQueries LRU-only-max-3 ──────────────────
describe('recentQueries — §11.1 scenario 4 (LRU cap = 3, LS-persisted)', () => {
  it('keeps at most 3 entries, drops oldest', async () => {
    for (const q of ['q1', 'q2', 'q3', 'q4']) {
      vi.mocked(aiApi.searchImages).mockResolvedValue({
        success: true,
        data: pxImages(1),
      })
      await useMaterialPanelStore.getState().searchImages(q)
    }
    expect(useMaterialPanelStore.getState().recentQueries).toEqual(['q4', 'q3', 'q2'])
  })

  it('newest at the front; existing tail preserved (LRU semantics)', async () => {
    for (const q of ['alpha', 'beta', 'gamma']) {
      vi.mocked(aiApi.searchImages).mockResolvedValue({
        success: true,
        data: pxImages(1),
      })
      await useMaterialPanelStore.getState().searchImages(q)
    }
    // Re-search alpha (re-promote)
    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: true,
      data: pxImages(1),
    })
    await useMaterialPanelStore.getState().searchImages('alpha')
    expect(useMaterialPanelStore.getState().recentQueries).toEqual(['alpha', 'gamma', 'beta'])
  })

  it('case-insensitive dedupe (case folding)', async () => {
    for (const q of ['Cafe', 'cafe', 'CAFE']) {
      vi.mocked(aiApi.searchImages).mockResolvedValue({
        success: true,
        data: pxImages(1),
      })
      await useMaterialPanelStore.getState().searchImages(q)
    }
    // Case-preserving newest wins; older duplicates dropped.
    expect(useMaterialPanelStore.getState().recentQueries).toEqual(['CAFE'])
  })

  it('LS is written per search (survives a remount-style reset)', async () => {
    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: true,
      data: pxImages(1),
    })
    await useMaterialPanelStore.getState().searchImages('ls-token')
    // Read raw LS to confirm.
    const raw = localStorage.getItem('sau-material-panel-recent-queries')
    expect(raw).toBe(JSON.stringify(['ls-token']))
  })

  it('MAX_RECENT_QUERIES = 3 hard cap invariant', () => {
    // The store's internal default is 3 (matches spec). Verify by stuffing
    // 5 uniques into the array (bypassing LRU) and reading back — should
    // still be capped to 3 after the next search.
    useMaterialPanelStore.setState({
      recentQueries: ['x1', 'x2', 'x3', 'x4', 'x5'],
    })
    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: true,
      data: pxImages(1),
    })
    return useMaterialPanelStore
      .getState()
      .searchImages('q6')
      .then(() => {
        // LRU front + tail from current (slice to 3).
        expect(useMaterialPanelStore.getState().recentQueries.length).toBeLessThanOrEqual(3)
      })
  })
})

// ── Extra invariant: reset() preserves LS-backed recentQueries ──
describe('reset() — visibilitychange "fresh slate" path', () => {
  it('preserves recentQueries (LS-persisted) but clears in-memory slots', async () => {
    // Seed LS-backed data.
    useMaterialPanelStore.setState({
      recentQueries: ['persisted-1', 'persisted-2'],
      imageResults: pxImages(3),
      recommendResults: pxImages(2),
      recommendCount: 2,
      lastRecommendedTitle: 'old',
      imageError: 'stale',
      recommendError: 'stale',
      urlError: 'stale',
      addingImageIds: new Set(['pexels:1']),
    })
    useMaterialPanelStore.getState().reset()
    const s = useMaterialPanelStore.getState()
    expect(s.recentQueries).toEqual(['persisted-1', 'persisted-2'])
    expect(s.imageResults).toEqual([])
    expect(s.recommendResults).toEqual([])
    expect(s.recommendCount).toBe(0)
    expect(s.lastRecommendedTitle).toBeNull()
    expect(s.imageError).toBeNull()
    expect(s.recommendError).toBeNull()
    expect(s.urlError).toBeNull()
    expect(s.addingImageIds.size).toBe(0)
  })
})

// ── Extra invariant: clearResults() vs reset() ────────────────
describe('clearResults() — partial reset (keeps cap + LS)', () => {
  it('clears result slots + errors but KEEPS recommendCount and recentQueries', () => {
    useMaterialPanelStore.setState({
      imageResults: pxImages(3),
      recommendResults: pxImages(2),
      recommendCount: 1,
      recentQueries: ['keep-me'],
      imageError: 'stale',
      recommendError: 'stale',
      urlError: 'stale',
    })
    useMaterialPanelStore.getState().clearResults()
    const s = useMaterialPanelStore.getState()
    expect(s.imageResults).toEqual([])
    expect(s.recommendResults).toEqual([])
    expect(s.imageError).toBeNull()
    expect(s.recommendError).toBeNull()
    expect(s.urlError).toBeNull()
    expect(s.recommendCount).toBe(1) // KEEP — partial reset
    expect(s.recentQueries).toEqual(['keep-me']) // KEEP — LS-backed
  })
})
