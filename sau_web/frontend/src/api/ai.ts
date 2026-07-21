import { request } from './request'
import { readSSEStream } from './sse'
import type {
  PlatformResult,
  PlatformError,
  ContentVariant,
  VariantError,
  PlatformVariant,
  PlatformVariantError,
} from '../lib/ai/types'

const baseURL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? '' : 'http://localhost:6001')

export const aiApi = {
  generateAiContent(payload: { prompt: string; model?: string; system_prompt?: string; platform?: string }) {
    return request.post('/api/ai/generate', payload).then((res) => res.data)
  },

  fetchAiModels() {
    return request.get('/api/ai/models').then((res) => res.data)
  },

  getAiConfig() {
    return request.get('/api/ai/config').then((res) => res.data)
  },

  listAiKeys() {
    return request.get('/api/ai/keys').then((res) => res.data)
  },

  setAiConfig(apiKey: string) {
    return request.post('/api/ai/config', { api_key: apiKey }).then((res) => res.data)
  },

  deleteAiConfig(keyId?: number) {
    return request.delete('/api/ai/config', { data: keyId !== undefined ? { key_id: keyId } : {} }).then((res) => res.data)
  },

  batchAddKeys(keys: string[]) {
    return request.post('/api/ai/keys/batch', { keys }).then((res) => res.data)
  },

  async generateMultiPlatformStream(
    payload: { topic: string; platforms: string[]; model?: string },
    onPlatformResult: (result: PlatformResult) => void,
    onPlatformError: (error: PlatformError) => void,
    onDone: (results: Record<string, PlatformResult | PlatformError>) => void,
    onError: (message: string) => void,
    signal?: AbortSignal,
  ) {
    await readSSEStream(`${baseURL}/api/ai/generate/multi-platform`, payload as unknown as Record<string, unknown>, {
      onPlatformResult: (d) => onPlatformResult(d as PlatformResult),
      onPlatformError: (d) => onPlatformError(d as PlatformError),
      onDone: (content) => { try { onDone(JSON.parse(content).results) } catch { onDone({}) } },
      onError,
    }, signal)
  },

  async generatePlatformVariantsStream(
    payload: { topic: string; platforms: string[]; model?: string; search?: boolean },
    onVariantResult: (result: PlatformVariant) => void,
    onVariantError: (error: PlatformVariantError) => void,
    onDone: (results: Record<string, PlatformVariant | PlatformVariantError>) => void,
    onError: (message: string) => void,
    signal?: AbortSignal,
  ) {
    // Same `/api/ai/generate/variants` endpoint as `generateVariantsStream`
    // BUT request body includes `platforms: [...]`. The backend switches
    // its generator to per-platform mode (one assistant turn per
    // platform) and emits `event: variant_result {platform, ...}` payloads
    // sharing the SSE event name with the style-mode variant consumer.
    // Discriminator: presence of `result.platform ? 'platform' : 'style'`
    // — this surface key-names everything `platform` so we DON'T collide
    // with the style-mode PayloadV (which carries `style`).
    await readSSEStream(`${baseURL}/api/ai/generate/variants`, payload as unknown as Record<string, unknown>, {
      onVariantResult: (d) => onVariantResult(d as unknown as PlatformVariant),
      onVariantError: (d) => onVariantError(d as unknown as PlatformVariantError),
      onDone: (content) => { try { onDone(JSON.parse(content).results) } catch { onDone({}) } },
      onError,
    }, signal)
  },

  async generateVariantsStream(
    payload: { topic: string; model?: string; search?: boolean },
    onVariantResult: (result: ContentVariant) => void,
    onVariantError: (error: VariantError) => void,
    onDone: (results: Record<string, ContentVariant | VariantError>) => void,
    onError: (message: string) => void,
    signal?: AbortSignal,
  ) {
    await readSSEStream(`${baseURL}/api/ai/generate/variants`, payload as unknown as Record<string, unknown>, {
      onVariantResult: (d) => onVariantResult(d as ContentVariant),
      onVariantError: (d) => onVariantError(d as VariantError),
      onDone: (content) => { try { onDone(JSON.parse(content).results) } catch { onDone({}) } },
      onError,
    }, signal)
  },

  async searchWeb(query: string, maxResults = 5) {
    const resp = await fetch(`${baseURL}/api/ai/search`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: maxResults }),
    })
    return resp.json()
  },

  async enhancePrompt(
    payload: { text: string; images?: string[]; model?: string; platform?: string },
    onChunk: (content: string) => void,
    onDone: (fullContent: string) => void,
    onError: (message: string) => void,
    onKeyInfo?: (keyId: number, masked: string) => void,
  ) {
    await readSSEStream(`${baseURL}/api/ai/enhance-prompt`, payload as unknown as Record<string, unknown>, { onChunk, onDone, onError, onKeyInfo })
  },

  async generateAiContentStream(
    payload: { prompt: string; model?: string; system_prompt?: string; platform?: string; images?: string[] },
    onChunk: (content: string) => void,
    onDone: (fullContent: string) => void,
    onError: (message: string) => void,
    onKeyInfo?: (keyId: number, masked: string) => void,
  ) {
    await readSSEStream(`${baseURL}/api/ai/generate/stream`, payload as unknown as Record<string, unknown>, { onChunk, onDone, onError, onKeyInfo })
  },

  async generateMessagesStream(
    payload: { messages: Array<{ role: string; content: unknown }>; model?: string; platform?: string },
    onChunk: (content: string) => void,
    onDone: (fullContent: string) => void,
    onError: (message: string) => void,
    onKeyInfo?: (keyId: number, masked: string) => void,
    signal?: AbortSignal,
  ) {
    await readSSEStream(`${baseURL}/api/ai/generate/stream`, payload as unknown as Record<string, unknown>, { onChunk, onDone, onError, onKeyInfo }, signal)
  },

  // ── ai-sidebar-material-search §5 ─────────────────────────────────
  // 3 helpers driving the AI sidebar's MaterialSection image-search
  // panel. Backend implemented in `web_runner/routes/ai.py` (3 routes
  // registered via ai-images-search / ai-recommend-images / ai-images-fetch
  // Blueprints). See openspec/changes/ai-sidebar-material-search for the
  // SSRF / rate-limit / no-key-error contracts.

  /**
   * Manual image keyword search. Pexels + Pixabay (or whichever key is
   * configured) are called concurrently server-side, deduped by source
   * id, and capped at `count` (default 9). Returns the full envelope
   * so the caller can surface `debug.errors` to a smarter toast.
   *
   * Error shape: backend returns 503 + `code: 'IMAGE_SOURCE_NOT_CONFIGURED'`
   * when no key is configured, or 429 with `retry_after_sec` when the
   * per-user rate limit trips. The MaterialSection image panel reads
   * the `message` field verbatim for the error toast.
   */
  async searchImages(
    payload: { query: string; count?: number },
  ): Promise<{
    success: boolean
    data: NormalizedImage[]
    message?: string
    code?: string
    retry_after_sec?: number
    debug?: { pexels_count?: number; pixabay_count?: number; merged_count?: number; errors?: string[] }
  }> {
    return (await request.post('/api/ai/images/search', payload)).data
  },

  /**
   * Title-triggered auto-recommend. Reduced-quality counterpart of
   * searchImages — same backend merge but the UI pipes results into a
   * separate `recommendResults[]` slot (not `imageResults[]`).
   * Capped server-side at 3 calls / session on the consumer side via
   * `useMaterialAutoRecommend` — backend does not track the cap
   * (cap is a UX concern, not a backend one).
   */
  async recommendImages(
    payload: { topic: string; count?: number },
  ): Promise<{
    success: boolean
    data: NormalizedImage[]
    message?: string
    code?: string
    debug?: { pexels_count?: number; pixabay_count?: number; merged_count?: number }
  }> {
    return (await request.post('/api/ai/recommend-images', payload)).data
  },

  /**
   * Fetch a public image URL through the backend CORS proxy
   * (`GET /api/ai/images/fetch?url=...`). Returns a `File` so the
   * caller can pipe it directly into `safeApplyMedia(formRef,
   * {images: [file]})` for note-mode drop-in, or as preview-only asset
   * (`URL.createObjectURL(file)`) for video-mode thumbnail preview.
   *
   * Server enforces SSRF (`_is_public_url` + `_resolve_is_public`)
   * and a 10 MB cap — we DON'T re-enforce either here. Errors thrown
   * by the fetch reject to the caller's `.catch()` and surface as
   * "图片下载失败，请重试" toast.
   */
  async fetchImageAsFile(
    url: string,
    filename?: string,
    mime?: string,
  ): Promise<File> {
    const resp = await fetch(
      `${baseURL}/api/ai/images/fetch?url=${encodeURIComponent(url)}`,
      { credentials: 'include' },
    )
    if (!resp.ok) {
      // Backend always returns JSON for non-200 (see web_runner/routes/ai.py);
      // surface the structured message so the caller can render a precise toast.
      let bodyText: string
      try {
        const body = await resp.json()
        bodyText = body?.message || `HTTP ${resp.status}`
      } catch {
        bodyText = `HTTP ${resp.status}`
      }
      throw new Error(bodyText)
    }
    const blob = await resp.blob()
    // Filename: prefer caller-supplied (deterministic from NormalizedImage
    // `${source}_${id}.${ext}`), else fallback to URL pathname basename,
    // else content-disposition, else a generic timestamped name.
    const fallbackName =
      filename || url.split('?')[0].split('/').pop() || `image-${Date.now()}.jpg`
    const fallbackMime = mime || blob.type || 'image/jpeg'
    return new File([blob], fallbackName, { type: fallbackMime })
  },
}

/**
 * Normalized image shape — single source of truth for the MaterialSection
 * grid + auto-recommend list. Matches `_normalize_pexels_photo` /
 * `_normalize_pixabay_hit` backend shape so frontend never deals with
 * raw upstream JSON. The `id` is `${source}:${source_id}` so dedup
 * across sources is impossible (their source_ids never collide) and
 * dedup WITHIN one source is a 1-step `Set` filter on the consumer side.
 */
export interface NormalizedImage {
  id: string
  source: 'pexels' | 'pixabay'
  thumb: string
  preview: string
  full: string
  photographer: string
  photographerUrl: string | null
  pageUrl: string
  alt: string
}