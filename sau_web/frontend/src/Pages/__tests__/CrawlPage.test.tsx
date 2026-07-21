import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { mockUseAuth } from '@/test/auth-router-spies'
import { AuthGuard } from '@/features/auth/AuthGuard'

// ── framework-level mocks (must precede under-test imports) ─────────────

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// CrawlPage calls `api.crawl.sentimentSummary / search / detail / comments
// / data / commentsList`. We stub each as a standalone vi.fn so per-test
// `mockResolvedValueOnce` overrides work cleanly. A future `api.crawl.*`
// addition not listed here will throw `TypeError: ... is not a function`
// during render — loud enough for the test author to add the stub.
const crawlSearch = vi.fn()
const crawlDetail = vi.fn()
const crawlComments = vi.fn()
const crawlData = vi.fn()
const crawlCommentsList = vi.fn()
const crawlSentimentSummary = vi.fn()
const crawlStatus = vi.fn()
const crawlReplySuggestion = vi.fn()
const crawlHealth = vi.fn()
const crawlSearchStream = vi.fn()
const getAccountGroups = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    crawl: {
      search: (...args: unknown[]) => crawlSearch(...args),
      searchStream: (...args: unknown[]) => crawlSearchStream(...args),
      detail: (...args: unknown[]) => crawlDetail(...args),
      comments: (...args: unknown[]) => crawlComments(...args),
      data: (...args: unknown[]) => crawlData(...args),
      commentsList: (...args: unknown[]) => crawlCommentsList(...args),
      sentimentSummary: (...args: unknown[]) => crawlSentimentSummary(...args),
      status: (...args: unknown[]) => crawlStatus(...args),
      replySuggestion: (...args: unknown[]) => crawlReplySuggestion(...args),
      health: (...args: unknown[]) => crawlHealth(...args),
    },
    // Flat surface — matches @/api/client.ts barrel (line 204:
    // `getAccountGroups: accountsApi.getAccountGroups`). Edit lockstep w/ CrawlPage.tsx.
    getAccountGroups: (...args: unknown[]) => getAccountGroups(...args),
  },
}))

// Clipboard mock — happy-dom doesn't ship a real clipboard.
const clipboardWrite = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(globalThis.navigator, 'clipboard', {
  value: { writeText: clipboardWrite },
  writable: true,
  configurable: true,
})

// ── imports (post-mock) ────────────────────────────────────────────────

import CrawlPage from '../CrawlPage'

// ── helpers ─────────────────────────────────────────────────────────────

function setAuth({
  isAuthenticated = true,
  user = { id: 1, email: 'qa@example.com', role: 'admin' as const },
}: {
  isAuthenticated?: boolean
  user?: { id: number; email: string; role: 'admin' | 'user' } | null
} = {}) {
  mockUseAuth.mockReturnValue({
    user,
    isAuthenticated,
    isLoading: false,
    sendCode: vi.fn().mockResolvedValue({ success: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    sendCodeStatus: 'idle',
    loginStatus: 'idle',
  })
}

function mountCrawlPage() {
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={['/dashboard/crawl']}>
      <AuthGuard>
        <CrawlPage />
      </AuthGuard>
    </TestProviders>,
  )
}

// Default mock shape: empty data for all endpoints, sentiment summary all
// zeros. Per-test overrides stack `mockResolvedValueOnce` on top.
beforeEach(() => {
  mockUseAuth.mockReset()
  crawlSearch.mockReset()
  crawlSearchStream.mockReset()
  crawlDetail.mockReset()
  crawlComments.mockReset()
  crawlData.mockReset()
  crawlCommentsList.mockReset()
  crawlSentimentSummary.mockReset()
  crawlStatus.mockReset()
  crawlReplySuggestion.mockReset()
  crawlHealth.mockReset()
  getAccountGroups.mockReset()
  clipboardWrite.mockClear()
  getAccountGroups.mockResolvedValue({ success: true, data: [] })

  crawlSentimentSummary.mockResolvedValue({
    positive: 0,
    negative: 0,
    neutral: 0,
    pending: 0,
  })
  crawlData.mockResolvedValue([])
  crawlCommentsList.mockResolvedValue([])
  crawlSearch.mockResolvedValue({ task_id: 'crawl-search-test-1', status: 'pending' })
  crawlDetail.mockResolvedValue({ task_id: 'crawl-detail-test-1', status: 'pending' })
  crawlComments.mockResolvedValue({ task_id: 'crawl-comments-test-1', status: 'pending' })
  crawlHealth.mockResolvedValue({
    ok: true,
    crawled_content_rows: 0,
    crawled_comments_rows: 0,
    now: '2026-01-01T00:00:00Z',
  })
})

// ── tests ───────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════
// Section 1 — Platform Picker
// ═════════════════════════════════════════════════════════════════════════

describe('CrawlPage · Platform Picker', () => {
  it('renders all 7 platform buttons with correct Chinese labels', async () => {
    setAuth()
    mountCrawlPage()
    // CrawlPage is a React.lazy() component — the first mount in the
    // test file shows the Suspense fallback until the lazy promise
    // resolves. Use findByText (async) to wait for the lazy component
    // to load. Subsequent tests can use getByText (sync) because the
    // lazy module is cached after the first resolution.
    expect(await screen.findByText('小红书')).toBeInTheDocument()
    expect(screen.getByText('抖音')).toBeInTheDocument()
    expect(screen.getByText('快手')).toBeInTheDocument()
    expect(screen.getByText('B站')).toBeInTheDocument()
    expect(screen.getByText('微博')).toBeInTheDocument()
    expect(screen.getByText('贴吧')).toBeInTheDocument()
    expect(screen.getByText('知乎')).toBeInTheDocument()
  })

  it('defaults to 小红书 (xhs) as the active platform', () => {
    setAuth()
    mountCrawlPage()
    // The default platform is 'xhs'. The sentiment summary chip fetches
    // with platform='xhs', and the header text includes the platform
    // label. The active button has the `bg-primary` class.
    const xhsButton = screen.getByText('小红书')
    expect(xhsButton.className).toContain('bg-primary')
  })

  it('clicking a platform button changes the active platform', () => {
    setAuth()
    mountCrawlPage()
    const dyButton = screen.getByText('抖音')
    // Initially: 抖音 is NOT active
    expect(dyButton.className).not.toContain('bg-primary')
    // Click 抖音
    fireEvent.click(dyButton)
    // Now 抖音 is active
    expect(dyButton.className).toContain('bg-primary')
    // And 小红书 is no longer active
    expect(screen.getByText('小红书').className).not.toContain('bg-primary')
  })

  it('platform change triggers a new sentimentSummary fetch with the new platform', async () => {
    setAuth()
    mountCrawlPage()
    // Initial fetch with default platform 'xhs'
    await waitFor(() => {
      expect(crawlSentimentSummary).toHaveBeenCalledWith({ platform: 'xhs' })
    })
    crawlSentimentSummary.mockClear()
    // Switch to 抖音
    fireEvent.click(screen.getByText('抖音'))
    await waitFor(() => {
      expect(crawlSentimentSummary).toHaveBeenCalledWith({ platform: 'dy' })
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Section 2 — Sentiment Summary Chip
// ═════════════════════════════════════════════════════════════════════════

describe('CrawlPage · Sentiment Summary Chip', () => {
  it('renders 4 sentiment tags with counts when data is returned', async () => {
    setAuth()
    crawlSentimentSummary.mockResolvedValueOnce({
      positive: 5,
      negative: 3,
      neutral: 2,
      pending: 1,
    })
    mountCrawlPage()
    await waitFor(() => {
      expect(screen.getByText('正面')).toBeInTheDocument()
      expect(screen.getByText('负面')).toBeInTheDocument()
      expect(screen.getByText('中性')).toBeInTheDocument()
      expect(screen.getByText('待分析')).toBeInTheDocument()
    })
  })

  it('shows the correct count number for each sentiment bucket', async () => {
    setAuth()
    crawlSentimentSummary.mockResolvedValueOnce({
      positive: 7,
      negative: 2,
      neutral: 4,
      pending: 3,
    })
    mountCrawlPage()
    // Total = 7 + 2 + 4 + 3 = 16
    await waitFor(() => {
      expect(screen.getByText(/共 16 条/)).toBeInTheDocument()
    })
    // Counts appear as tabular-nums spans next to each badge. Scope to
    // the sentiment chip card to avoid matching stray digits elsewhere.
    const chipCard = screen.getByText(/情感分布/).closest('[class*="border"]') as HTMLElement
    const chipScope = within(chipCard)
    expect(chipScope.getByText('7')).toBeInTheDocument()
    expect(chipScope.getByText('2')).toBeInTheDocument()
    expect(chipScope.getByText('4')).toBeInTheDocument()
    expect(chipScope.getByText('3')).toBeInTheDocument()
  })

  it('does NOT render the sentiment chip when API returns null (error)', async () => {
    setAuth()
    crawlSentimentSummary.mockRejectedValueOnce(new Error('network error'))
    mountCrawlPage()
    // Wait for the rejected promise to settle
    await waitFor(() => {
      expect(crawlSentimentSummary).toHaveBeenCalled()
    })
    // The chip card should not appear — the component returns null on
    // error or null bucket.
    expect(screen.queryByText('正面')).not.toBeInTheDocument()
  })

  it('renders the sentiment chip with zero total when all buckets are zero', async () => {
    setAuth()
    // Default mock returns all zeros. `bucket` is not null, so the
    // chip renders with total=0.
    mountCrawlPage()
    await waitFor(() => {
      expect(screen.getByText(/共 0 条/)).toBeInTheDocument()
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Section 3 — Tabs
// ═════════════════════════════════════════════════════════════════════════

describe('CrawlPage · Tabs', () => {
  it('renders 3 tabs with correct labels', () => {
    setAuth()
    mountCrawlPage()
    expect(screen.getByText('任务')).toBeInTheDocument()
    expect(screen.getByText('已采集内容')).toBeInTheDocument()
    expect(screen.getByText('评论与情感')).toBeInTheDocument()
  })

  it('defaults to the Tasks tab', () => {
    setAuth()
    mountCrawlPage()
    // The Tasks tab renders the "启动新的爬虫任务" card title
    expect(screen.getByText('启动新的爬虫任务')).toBeInTheDocument()
  })

  it('clicking "已采集内容" switches to the Content tab', async () => {
    setAuth()
    mountCrawlPage()
    // Click the Content tab
    fireEvent.click(screen.getByText('已采集内容'))
    await waitFor(() => {
      // Content tab renders a card title mentioning "最近 50 条内容"
      expect(screen.getByText(/最近 50 条内容/)).toBeInTheDocument()
    })
  })

  it('clicking "评论与情感" switches to the Comments tab', async () => {
    setAuth()
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      expect(screen.getByText(/最近 50 条评论/)).toBeInTheDocument()
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Section 4 — Tasks Tab
// ═════════════════════════════════════════════════════════════════════════

describe('CrawlPage · Tasks Tab', () => {
  it('renders the kind picker with 3 options (搜索 / 详情 / 评论)', () => {
    setAuth()
    mountCrawlPage()
    expect(screen.getByText('搜索')).toBeInTheDocument()
    expect(screen.getByText('详情')).toBeInTheDocument()
    expect(screen.getByText('评论')).toBeInTheDocument()
  })

  it('defaults to search kind with keyword input + placeholder', () => {
    setAuth()
    mountCrawlPage()
    expect(screen.getByPlaceholderText('比如：美食，旅游')).toBeInTheDocument()
    // The label for the search kind is "关键词"
    expect(screen.getByText('关键词')).toBeInTheDocument()
  })

  it('switching to detail kind shows post_id label + placeholder', () => {
    setAuth()
    mountCrawlPage()
    // Click the "详情" kind button inside the kind picker
    const detailBtn = screen.getAllByText('详情')[0]
    fireEvent.click(detailBtn)
    expect(screen.getByText('post_id')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('比如：abc123, def456')).toBeInTheDocument()
  })

  it('switching to comments kind shows post_id label + placeholder', () => {
    setAuth()
    mountCrawlPage()
    const commentsBtn = screen.getAllByText('评论')[0]
    fireEvent.click(commentsBtn)
    expect(screen.getByText('post_id')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('比如：BV1abc, mid123')).toBeInTheDocument()
  })

  it('submit button is disabled when input is empty', () => {
    setAuth()
    mountCrawlPage()
    const submitBtn = screen.getByText('启动搜索')
    expect(submitBtn).toBeDisabled()
  })

  it('submit button is enabled when keyword is entered', () => {
    setAuth()
    mountCrawlPage()
    const input = screen.getByPlaceholderText('比如：美食，旅游')
    fireEvent.change(input, { target: { value: '美食探店' } })
    expect(screen.getByText('启动搜索')).not.toBeDisabled()
  })

  it('submitting a search calls api.crawl.searchStream with correct params', async () => {
    setAuth()
    crawlSearchStream.mockImplementation(async (_payload, handlers) => {
      handlers.onDone()
    })
    mountCrawlPage()
    const input = screen.getByPlaceholderText('比如：美食，旅游')
    fireEvent.change(input, { target: { value: '美食探店' } })
    fireEvent.click(screen.getByText('启动搜索'))
    await waitFor(() => {
      expect(crawlSearchStream).toHaveBeenCalledWith(
        {
          platform: 'xhs',
          keyword: '美食探店',
          max_count: 20,
        },
        expect.any(Object),
        expect.anything(),
      )
    })
  })

  it('submitting a detail call uses api.crawl.detail with post_id', async () => {
    setAuth()
    mountCrawlPage()
    // Switch to detail kind
    fireEvent.click(screen.getAllByText('详情')[0])
    const input = screen.getByPlaceholderText('比如：abc123, def456')
    fireEvent.change(input, { target: { value: 'post123' } })
    fireEvent.click(screen.getByText('拉取详情'))
    await waitFor(() => {
      expect(crawlDetail).toHaveBeenCalledWith({
        platform: 'xhs',
        post_id: 'post123',
      })
    })
  })

  it('submitting a comments call uses api.crawl.comments with post_id + max_count', async () => {
    setAuth()
    mountCrawlPage()
    // Switch to comments kind
    fireEvent.click(screen.getAllByText('评论')[0])
    const input = screen.getByPlaceholderText('比如：BV1abc, mid123')
    fireEvent.change(input, { target: { value: 'BV1abc' } })
    fireEvent.click(screen.getByText('拉取评论'))
    await waitFor(() => {
      expect(crawlComments).toHaveBeenCalledWith({
        platform: 'xhs',
        post_id: 'BV1abc',
        max_count: 20,
      })
    })
  })

  it('task list renders the submitted streaming task with label + status badge', async () => {
    setAuth()
    crawlSearchStream.mockImplementation(async (_payload, handlers) => {
      handlers.onDone()
    })
    mountCrawlPage()
    fireEvent.change(screen.getByPlaceholderText('比如：美食，旅游'), {
      target: { value: '美食' },
    })
    fireEvent.click(screen.getByText('启动搜索'))
    await waitFor(() => {
      expect(screen.getByText('搜索「美食」')).toBeInTheDocument()
      expect(screen.getByText('completed')).toBeInTheDocument()
    })
  })

  it('shows empty-state message when no tasks have been started', () => {
    setAuth()
    mountCrawlPage()
    expect(
      screen.getByText(/还没有启动过任务/),
    ).toBeInTheDocument()
  })

  it('failed streaming search creates an error entry in the task list', async () => {
    setAuth()
    crawlSearchStream.mockImplementation(async (_payload, _handlers) => {
      throw new Error('网络超时')
    })
    mountCrawlPage()
    fireEvent.change(screen.getByPlaceholderText('比如：美食，旅游'), {
      target: { value: '旅行' },
    })
    fireEvent.click(screen.getByText('启动搜索'))
    await waitFor(() => {
      expect(screen.getByText(/失败/)).toBeInTheDocument()
      expect(screen.getByText('error')).toBeInTheDocument()
    })
  })

  it('streams search results incrementally into the task list area', async () => {
    setAuth()
    crawlSearchStream.mockImplementation(async (_payload, handlers) => {
      handlers.onPlatformResult({
        id: 1,
        platform: 'xhs',
        post_id: 'post-123',
        raw_payload: { title: ' streamed title', user: 'streamer' },
        crawled_at: '2026-01-01T00:00:00Z',
      })
      handlers.onDone()
    })
    mountCrawlPage()
    fireEvent.change(screen.getByPlaceholderText('比如：美食，旅游'), {
      target: { value: '美食' },
    })
    fireEvent.click(screen.getByText('启动搜索'))
    await waitFor(() => {
      expect(crawlSearchStream).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'xhs', keyword: '美食' }),
        expect.any(Object),
        expect.anything(),
      )
    })
    await waitFor(() => {
      expect(screen.getByText('streamed title')).toBeInTheDocument()
      expect(screen.getByText('streamer')).toBeInTheDocument()
    })
  })

  it('renders account dropdown for search kind when accounts are available', async () => {
    setAuth()
    getAccountGroups.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 1,
          name: '营销号',
          created: '2026-01-01T00:00:00Z',
          authorizations: [{ id: 1, platform: 'douyin', cookie_file: '/cookies/douyin_营销号.json' }],
        },
      ],
    })
    mountCrawlPage()
    // Switch to 抖音 so the douyin authorization appears
    fireEvent.click(screen.getByText('抖音'))
    await waitFor(() => {
      expect(screen.getByText('使用账号')).toBeInTheDocument()
    })
    expect(screen.getByText('营销号')).toBeInTheDocument()
  })

  it('passes selected account to searchStream', async () => {
    setAuth()
    getAccountGroups.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 1,
          name: '营销号',
          created: '2026-01-01T00:00:00Z',
          authorizations: [{ id: 1, platform: 'douyin', cookie_file: '/cookies/douyin_营销号.json' }],
        },
      ],
    })
    crawlSearchStream.mockImplementation(async (_payload, handlers) => {
      handlers.onDone()
    })
    mountCrawlPage()
    fireEvent.click(screen.getByText('抖音'))
    await waitFor(() => {
      expect(screen.getByText('使用账号')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('crawl-account-select'), {
      target: { value: '营销号' },
    })
    fireEvent.change(screen.getByPlaceholderText('比如：美食，旅游'), {
      target: { value: '美食' },
    })
    fireEvent.click(screen.getByText('启动搜索'))
    await waitFor(() => {
      expect(crawlSearchStream).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'dy', keyword: '美食', account: '营销号' }),
        expect.any(Object),
        expect.anything(),
      )
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Section 5 — Content Tab
// ═════════════════════════════════════════════════════════════════════════

describe('CrawlPage · Content Tab', () => {
  it('renders empty-state message when no data is available', async () => {
    setAuth()
    crawlData.mockResolvedValueOnce([])
    mountCrawlPage()
    fireEvent.click(screen.getByText('已采集内容'))
    await waitFor(() => {
      expect(screen.getByText(/暂无数据.*启动一次搜索/)).toBeInTheDocument()
    })
  })

  it('renders content rows when data is returned', async () => {
    setAuth()
    crawlData.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc123',
        raw_payload: { title: '美食推荐', desc: '今天去了一家超好吃的店' },
        crawled_at: '2026-01-15T10:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('已采集内容'))
    await waitFor(() => {
      expect(screen.getByText(/#1/)).toBeInTheDocument()
      expect(screen.getByText(/post_id=abc123/)).toBeInTheDocument()
    })
  })

  it('fetches data with the current platform filter', async () => {
    setAuth()
    crawlData.mockResolvedValueOnce([])
    mountCrawlPage()
    // Switch to 抖音 first
    fireEvent.click(screen.getByText('抖音'))
    // Then navigate to Content tab
    fireEvent.click(screen.getByText('已采集内容'))
    await waitFor(() => {
      expect(crawlData).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'dy', limit: 50 }),
      )
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Section 6 — Comments Tab
// ═════════════════════════════════════════════════════════════════════════

describe('CrawlPage · Comments Tab', () => {
  it('renders empty-state message when no comments are available', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      expect(screen.getByText(/暂无评论.*启动一次评论/)).toBeInTheDocument()
    })
  })

  it('renders comment rows with sentiment badges', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { text: '太好吃了！强烈推荐' },
        ai_sentiment: 'positive',
        ai_sentiment_confidence: 0.92,
        ai_reply_suggestion: null,
        crawled_at: '2026-01-15T10:00:00Z',
      },
      {
        id: 2,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { text: '一般般，不推荐' },
        ai_sentiment: 'negative',
        ai_sentiment_confidence: 0.85,
        ai_reply_suggestion: null,
        crawled_at: '2026-01-15T11:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      expect(screen.getByText('太好吃了！强烈推荐')).toBeInTheDocument()
      expect(screen.getByText('一般般，不推荐')).toBeInTheDocument()
    })
    // Sentiment badges: "正面" for positive, "负面" for negative.
    // These labels ALSO appear in the sentiment summary chip, so use
    // getAllByText and assert at least 2 occurrences (chip + row badge).
    expect(screen.getAllByText('正面').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('负面').length).toBeGreaterThanOrEqual(2)
  })

  it('shows confidence percentage next to the sentiment badge', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { text: '不错' },
        ai_sentiment: 'positive',
        ai_sentiment_confidence: 0.92,
        ai_reply_suggestion: null,
        crawled_at: '2026-01-15T10:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      // 0.92 * 100 = 92%
      expect(screen.getByText('92%')).toBeInTheDocument()
    })
  })

  it('shows "待分析" badge when ai_sentiment is null', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { text: '这是待分析的评论' },
        ai_sentiment: null,
        ai_sentiment_confidence: null,
        ai_reply_suggestion: null,
        crawled_at: '2026-01-15T10:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      expect(screen.getByText('这是待分析的评论')).toBeInTheDocument()
    })
    // "待分析" appears in BOTH the sentiment summary chip and the
    // comment row badge — at least 2 occurrences.
    const pendingBadges = screen.getAllByText('待分析')
    expect(pendingBadges.length).toBeGreaterThanOrEqual(2)
  })

  it('renders AI reply suggestion with a copy button', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { text: '好吃！' },
        ai_sentiment: 'positive',
        ai_sentiment_confidence: 0.9,
        ai_reply_suggestion: '谢谢支持！欢迎再来！',
        crawled_at: '2026-01-15T10:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      expect(screen.getByText('AI 建议:')).toBeInTheDocument()
      expect(screen.getByText('谢谢支持！欢迎再来！')).toBeInTheDocument()
      expect(screen.getByText('复制')).toBeInTheDocument()
    })
  })

  it('clicking the copy button calls navigator.clipboard.writeText with the suggestion', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { text: '好吃！' },
        ai_sentiment: 'positive',
        ai_sentiment_confidence: 0.9,
        ai_reply_suggestion: '谢谢支持！欢迎再来！',
        crawled_at: '2026-01-15T10:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    const copyBtn = await waitFor(() => screen.getByText('复制'))
    fireEvent.click(copyBtn)
    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith('谢谢支持！欢迎再来！')
    })
  })

  it('does NOT render AI suggestion section when ai_reply_suggestion is null', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { text: '一般' },
        ai_sentiment: 'neutral',
        ai_sentiment_confidence: 0.5,
        ai_reply_suggestion: null,
        crawled_at: '2026-01-15T10:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      expect(screen.getByText('一般')).toBeInTheDocument()
    })
    expect(screen.queryByText('AI 建议:')).not.toBeInTheDocument()
    expect(screen.queryByText('复制')).not.toBeInTheDocument()
  })

  it('extracts comment text from raw_payload via various key names', async () => {
    setAuth()
    crawlCommentsList.mockResolvedValueOnce([
      {
        id: 1,
        platform: 'xhs',
        post_id: 'abc',
        raw_payload: { content: '从content字段提取的文本' },
        ai_sentiment: null,
        ai_sentiment_confidence: null,
        ai_reply_suggestion: null,
        crawled_at: '2026-01-15T10:00:00Z',
      },
    ])
    mountCrawlPage()
    fireEvent.click(screen.getByText('评论与情感'))
    await waitFor(() => {
      // rawText helper tries 'text', 'content', 'comment', 'message', 'msg'
      expect(screen.getByText('从content字段提取的文本')).toBeInTheDocument()
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Section 7 — AuthGuard bounce
// ═════════════════════════════════════════════════════════════════════════

describe('CrawlPage · AuthGuard', () => {
  it('does NOT render page content when anonymous (AuthGuard bounce)', () => {
    setAuth({ isAuthenticated: false })
    mountCrawlPage()
    expect(
      screen.queryByRole('heading', { name: '数据采集 / 评论监控' }),
    ).not.toBeInTheDocument()
  })

  it('renders the page heading when authenticated', () => {
    setAuth()
    mountCrawlPage()
    expect(
      screen.getByRole('heading', { name: '数据采集 / 评论监控' }),
    ).toBeInTheDocument()
  })
})
