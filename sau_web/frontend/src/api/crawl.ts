/**
 * Crawler API client (openspec/changes/mediacrawler-integration).
 *
 * Wraps the `web_runner/routes/crawl.py` blueprint. Mirrors the
 * barrel-export pattern in `client.ts` so a consumer can call
 * `api.crawl.search({...})` (after the barrel wires
 * ``crawl: crawlApi``).
 *
 * Response shape: every endpoint returns ``{ success: bool, data: T,
 * message?: string }`` — the existing success helper at
 * `client.ts` consumed by callers unwraps the envelope automatically,
 * so this module's returned promises resolve to ``T`` directly, not
 * the wrapped ApiResponse.
 */

import { request } from './request'
import { readSSEStream } from './sse'

export type CrawledContentItem = {
  id: number
  platform: string
  post_id: string | null
  raw_payload: Record<string, unknown> | string | null
  crawled_at: string | null
}

export type CrawledCommentItem = {
  id: number
  platform: string
  post_id: string | null
  raw_payload: Record<string, unknown> | string | null
  ai_sentiment: 'positive' | 'negative' | 'neutral' | null
  ai_sentiment_confidence: number | null
  ai_reply_suggestion: string | null
  crawled_at: string | null
}

export type SentimentBucket = {
  positive: number
  negative: number
  neutral: number
  /** NULL ai_sentiment rows (still in flight or failed). */
  pending: number
}

export type CrawlTaskStartResponse = {
  task_id: string
  status: string
}

export type CrawlTaskStatus = {
  task_id: string
  status: string
  platform: string | null
  action: string | null
  code: number | null
  error: string | null
  created: string | null
  result: string | null
}

export type CrawlHealth = {
  ok: boolean
  crawled_content_rows: number
  crawled_comments_rows: number
  now: string
}

/**
 * Barrel that matches the per-domain client convention used by
 * `accounts.ts` / `publish.ts` / `tasks.ts` / `ai.ts` / `inbox.ts`.
 * Re-exported from `client.ts` as ``api.crawl.<method>``.
 */
export const crawlApi = {
  search(payload: {
    platform: string
    keyword: string
    max_count?: number
    page_num?: number
  }): Promise<CrawlTaskStartResponse> {
    return request
      .post('/api/crawl/search', payload)
      .then((res) => res.data?.data)
  },

  /**
   * Stream search results via SSE. Rows are yielded through
   * `handlers.onPlatformResult` as they are scraped.
   */
  searchStream(
    payload: {
      platform: string
      keyword: string
      max_count?: number
      page_num?: number
      account?: string
    },
    handlers: import('./sse').SSEHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const baseURL = request.defaults.baseURL || ''
    return readSSEStream(
      `${baseURL}/api/crawl/search-stream`,
      payload as unknown as Record<string, unknown>,
      handlers,
      signal,
    )
  },

  detail(payload: {
    platform: string
    post_id: string
  }): Promise<CrawlTaskStartResponse> {
    return request
      .post('/api/crawl/detail', payload)
      .then((res) => res.data?.data)
  },

  comments(payload: {
    platform: string
    post_id: string
    max_count?: number
  }): Promise<CrawlTaskStartResponse> {
    return request
      .post('/api/crawl/comments', payload)
      .then((res) => res.data?.data)
  },

  status(taskId: string): Promise<CrawlTaskStatus> {
    return request
      .get('/api/crawl/status', { params: { task_id: taskId } })
      .then((res) => res.data?.data)
  },

  replySuggestion(payload: {
    platform: string
    comment_id?: number
    comment_text: string
    post_id?: string
    force?: boolean
  }): Promise<{ ai_reply_suggestion: string }> {
    return request
      .post('/api/crawl/reply-suggest', payload)
      .then((res) => res.data?.data)
  },

  data(params: {
    platform?: string
    post_id?: string
    limit?: number
  } = {}): Promise<CrawledContentItem[]> {
    return request
      .get('/api/crawl/data', { params })
      .then((res) => res.data?.data ?? [])
  },

  commentsList(params: {
    platform?: string
    post_id?: string
    sentiment?: 'positive' | 'negative' | 'neutral' | 'pending'
    limit?: number
  } = {}): Promise<CrawledCommentItem[]> {
    return request
      .get('/api/crawl/comments', { params })
      .then((res) => res.data?.data ?? [])
  },

  sentimentSummary(params: { platform?: string } = {}): Promise<SentimentBucket> {
    return request
      .get('/api/crawl/sentiment-summary', { params })
      .then((res) => res.data?.data)
  },

  health(): Promise<CrawlHealth> {
    return request.get('/api/crawl/health').then((res) => res.data?.data)
  },
}
