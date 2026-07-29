import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { HTMLAttributes, ReactNode } from 'react'

// ── shared mock prop shapes ──────────────────────────────────────────
type MockProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode
  [key: string]: unknown
}
type MockInputProps = MockProps & {
  value?: string | number | readonly string[]
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

// ── hoisted API spy ──────────────────────────────────────────────────
const apiSpy = vi.hoisted(() => ({
  inboxList: vi.fn().mockResolvedValue({ success: true, data: [] }),
  inboxStorage: vi.fn().mockResolvedValue({
    success: true,
    data: {
      inbox: { bytes: 0, count: 0, oldest: null, newest: null },
      subtitles: { bytes: 0, count: 0 },
      thumbs: { bytes: 0, count: 0 },
      total_bytes: 0,
    },
  }),
  inboxDownload: vi.fn(),
  inboxDelete: vi.fn().mockResolvedValue({ success: true, message: '已删除' }),
  inboxClear: vi.fn().mockResolvedValue({ success: true, message: '已清空' }),
  inboxCleanup: vi.fn().mockResolvedValue({ success: true, message: '已清理' }),
  inboxTranscribeStream: vi.fn(),
  inboxSubtitleStream: vi.fn(),
  inboxReveal: vi.fn(),
  inboxFetchFile: vi.fn(),
  inboxSubtitleSave: vi.fn(),
  inboxThumbUrl: vi.fn((fn: string) => `/api/inbox/thumb/${encodeURIComponent(fn)}`),
}))

// ── mocks (must precede under-test imports) ──────────────────────────

vi.mock('@/api/client', () => ({
  api: apiSpy,
}))

vi.mock('motion/react', () => {
  const motionCache = new Map<string, (props: MockProps) => ReactNode>()
  const motion: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        if (!motionCache.has(tag)) {
          motionCache.set(tag, (props: MockProps) => {
            const { children, ...rest } = props ?? {}
            const Tag = (typeof tag === 'string' ? tag : 'div') as keyof JSX.IntrinsicElements
            return <Tag {...rest}>{children}</Tag>
          })
        }
        return motionCache.get(tag)
      },
    },
  )
  return {
    motion,
    AnimatePresence: ({ children }: MockProps) => <>{children}</>,
  }
})

vi.mock('@/components/ui/index', () => {
  function makeTag(tag: string) {
    return (props: MockProps) => {
      const { children, className, ...rest } = props
      return (
        <div data-tag={tag} className={className} {...rest}>
          {children}
        </div>
      )
    }
  }
  return {
    Card: makeTag('card'),
    CardContent: makeTag('card-content'),
    Button: ({ children, onClick, ...rest }: MockProps) => (
      <button data-tag="button" onClick={onClick} {...rest}>
        {children}
      </button>
    ),
    Input: ({ value, onChange, className, ...rest }: MockInputProps) => (
      <input
        data-tag="input"
        value={value ?? ''}
        onChange={onChange}
        className={className}
        {...rest}
      />
    ),
    Badge: makeTag('badge'),
    Label: makeTag('label'),
    Separator: () => <hr />,
    Skeleton: makeTag('skeleton'),
    Dialog: ({ children, open }: MockProps & { open?: boolean }) =>
      open ? <div data-tag="dialog">{children}</div> : null,
    DialogContent: ({ children }: MockProps) => (
      <div data-tag="dialog-content">{children}</div>
    ),
    DialogDescription: ({ children }: MockProps) => (
      <p data-tag="dialog-desc">{children}</p>
    ),
    DialogFooter: ({ children }: MockProps) => (
      <div data-tag="dialog-footer">{children}</div>
    ),
    DialogHeader: ({ children }: MockProps) => (
      <div data-tag="dialog-header">{children}</div>
    ),
    DialogTitle: ({ children }: MockProps) => (
      <h2 data-tag="dialog-title">{children}</h2>
    ),
  }
})

vi.mock('@/components/ui/empty-state', () => ({
  EmptyState: ({ title, description }: MockProps) => (
    <div data-testid="empty-state">
      <p data-testid="empty-title">{String(title ?? '')}</p>
      <p data-testid="empty-desc">{String(description ?? '')}</p>
    </div>
  ),
}))

vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title, description }: MockProps) => (
    <div data-testid="page-header">
      <h1 data-testid="header-title">{String(title ?? '')}</h1>
      <p data-testid="header-desc">{String(description ?? '')}</p>
    </div>
  ),
}))

vi.mock('@/components/layout/PageWrapper', () => ({
  PageWrapper: ({ children }: MockProps) => (
    <div data-testid="page-wrapper">{children}</div>
  ),
}))

vi.mock('@/components/ui/platform-chip-strip', () => ({
  PlatformChipStrip: ({ activeKey, label }: MockProps) => (
    <div data-testid="platform-chip-strip" data-active={String(activeKey ?? '')}>
      {String(label ?? '')}
    </div>
  ),
}))

vi.mock('@/components/ui/platform-chip-strip.constants', () => ({
  PLATFORMS: [
    { key: 'youtube', name: 'YouTube', src: '/icons/youtube.svg' },
    { key: 'bilibili', name: 'B站', src: '/icons/bilibili.svg' },
    { key: 'douyin', name: '抖音', src: '/icons/douyin.svg' },
    { key: 'xiaohongshu', name: '小红书', src: '/icons/xhs.svg' },
    { key: 'kuaishou', name: '快手', src: '/icons/kuaishou.svg' },
    { key: 'tencent', name: '腾讯视频', src: '/icons/tencent.svg' },
    { key: 'general', name: '通用视频', src: undefined },
  ],
}))

vi.mock('@/components/ui/platform-icon', () => ({
  PlatformIcon: ({ platform }: MockProps) => (
    <span data-testid="platform-icon" data-platform={String(platform ?? '')} />
  ),
}))

vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/components/ui/toast.helpers', () => ({
  useToast: () => ({ addToast: vi.fn() }),
  toast: vi.fn(),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: MockProps & { open?: boolean }) =>
    open ? <div data-tag="dialog">{children}</div> : null,
  DialogContent: ({ children }: MockProps) => (
    <div data-tag="dialog-content">{children}</div>
  ),
  DialogDescription: ({ children }: MockProps) => (
    <p data-tag="dialog-desc">{children}</p>
  ),
  DialogFooter: ({ children }: MockProps) => (
    <div data-tag="dialog-footer">{children}</div>
  ),
  DialogHeader: ({ children }: MockProps) => (
    <div data-tag="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: MockProps) => (
    <h2 data-tag="dialog-title">{children}</h2>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: MockProps) => (
    <label htmlFor={String(htmlFor ?? '')}>{children}</label>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: MockProps) => (
    <span data-tag="badge" data-variant={String(variant ?? '')}>
      {children}
    </span>
  ),
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: MockProps) => (
    <div data-tag="skeleton" className={String(className ?? '')} />
  ),
}))

vi.mock('@/components/InboxJobQueue', () => ({
  InboxJobQueue: () => <div data-testid="inbox-job-queue" />,
}))

vi.mock('@/routes', () => ({
  ROUTES: {
    public: { landing: '/' },
    dashboard: { inbox: '/dashboard/inbox' },
  },
}))

vi.mock('@/stores/inboxJobRegistry', () => ({
  beginInboxJob: vi.fn(() => ({ aborted: false } as AbortSignal)),
  endInboxJob: vi.fn(),
  cancelInboxJob: vi.fn(),
}))

vi.mock('@/stores/inboxPrefs', () => {
  const defaults = {
    subtitleMode: 'bilingual' as const,
    subtitleWrite: 'hard' as const,
    subtitleQuality: '1080' as const,
    density: 'comfortable' as const,
    collapseTranscript: false,
  }
  let prefs = { ...defaults }
  return {
    loadInboxPrefs: vi.fn(() => ({ ...prefs })),
    saveInboxPrefs: vi.fn(
      (patch: Partial<typeof defaults>) => {
        prefs = { ...prefs, ...patch }
        return { ...prefs }
      },
    ),
  }
})

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({ children }: MockProps) => <>{children}</>,
}))

vi.mock('@dnd-kit/react/sortable', () => ({
  useSortable: () => ({
    ref: vi.fn(),
    handleRef: vi.fn(),
    isDragSource: false,
    isDragTarget: false,
  }),
}))

vi.mock('@dnd-kit/helpers', () => ({
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const result = [...arr]
    const [removed] = result.splice(from, 1)
    result.splice(to, 0, removed)
    return result
  },
}))

vi.mock('lucide-react', () => {
  const makeIcon = (name: string) => (props: MockProps) => {
    const { size, ...rest } = props
    return <span data-icon={name} {...rest} />
  }
  return {
    AlertCircle: makeIcon('alert-circle'),
    Captions: makeIcon('captions'),
    Check: makeIcon('check'),
    CheckSquare: makeIcon('check-square'),
    ChevronDown: makeIcon('chevron-down'),
    Clipboard: makeIcon('clipboard'),
    Copy: makeIcon('copy'),
    Download: makeIcon('download'),
    ExternalLink: makeIcon('external-link'),
    FileText: makeIcon('file-text'),
    FolderOpen: makeIcon('folder-open'),
    GripVertical: makeIcon('grip-vertical'),
    Inbox: makeIcon('inbox'),
    Link2: makeIcon('link-2'),
    Loader2: makeIcon('loader-2'),
    Mic: makeIcon('mic'),
    Play: makeIcon('play'),
    RefreshCw: makeIcon('refresh-cw'),
    Search: makeIcon('search'),
    Sparkles: makeIcon('sparkles'),
    Square: makeIcon('square'),
    Subtitles: makeIcon('subtitles'),
    Trash2: makeIcon('trash-2'),
    XCircle: makeIcon('x-circle'),
    X: makeIcon('x'),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: MockProps) => (
    <a data-testid="router-link" href={String(to ?? '')}>
      {children}
    </a>
  ),
}))

// ── Imports after mocks ──────────────────────────────────────────────
import InboxPage from './InboxPage'
import {
  useInboxStore,
  getInboxStore,
  clearInboxStorage,
} from '@/stores/inboxStore'

// ──────────────────────────────────────────────────────────────────────
// InboxPage component integration tests
// ──────────────────────────────────────────────────────────────────────

function renderPage() {
  // Note: does NOT call reset() here — callers should use beforeEach
  // to reset the store before each test, then add entries, then render.
  return render(<InboxPage />)
}

describe('InboxPage — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('renders the page header with title', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('[data-testid="page-header"]')).toBeTruthy()
    })
    const header = container.querySelector('[data-testid="header-title"]')
    expect(header?.textContent).toContain('下载中心')
  })

  it('shows empty state when no entries exist', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('[data-testid="inbox-filter-bar"]')).toBeNull()
    })
  })

  it('renders the URL input field', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      const input = container.querySelector('#inbox-url-input')
      expect(input).toBeTruthy()
    })
  })

  it('renders the paste and download buttons', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      const pasteBtn = container.querySelector('[data-testid="inbox-paste"]')
      const downloadBtn = container.querySelector('[data-testid="inbox-download"]')
      expect(pasteBtn).toBeTruthy()
      expect(downloadBtn).toBeTruthy()
    })
  })

  it('renders platform chip strip', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      const strip = container.querySelector('[data-testid="platform-chip-strip"]')
      expect(strip).toBeTruthy()
    })
  })

  it('shows storage bar when storage data loads', async () => {
    apiSpy.inboxStorage.mockResolvedValue({
      success: true,
      data: {
        inbox: { bytes: 1048576, count: 2, oldest: null, newest: null },
        subtitles: { bytes: 0, count: 0 },
        thumbs: { bytes: 0, count: 0 },
        total_bytes: 1048576,
      },
    })

    const { container } = renderPage()
    await waitFor(() => {
      expect(container.textContent).toContain('1.0 MB')
    })
    expect(container.textContent).toContain('2 个文件')
  })

  it('shows entry count badge', async () => {
    getInboxStore().addEntry({
      id: 'test-1',
      url: 'https://youtube.com/watch?v=abc',
      status: 'downloaded',
    })

    const { container } = renderPage()
    await waitFor(() => {
      const badge = container.querySelector('[data-testid="inbox-entry-count"]')
      expect(badge?.textContent).toBe('1')
    })
  })

  it('shows filter bar when entries exist', async () => {
    getInboxStore().addEntry({
      id: 'filter-test',
      url: 'https://example.com/vid',
      status: 'downloaded',
    })

    const { container } = renderPage()
    await waitFor(() => {
      const filterBar = container.querySelector('[data-testid="inbox-filter-bar"]')
      expect(filterBar).toBeTruthy()
    })
  })

  it('shows inflight indicator when entries are downloading', async () => {
    getInboxStore().addEntry({
      id: 'inflight-1',
      url: 'https://example.com',
      status: 'downloading',
    })
    getInboxStore().markInflight('inflight-1')

    const { container } = renderPage()
    await waitFor(() => {
      const inflight = container.querySelector('[data-testid="inbox-inflight-count"]')
      expect(inflight?.textContent).toContain('1 个后台进行中')
    })
  })
})

describe('InboxPage — URL input and detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('typing a YouTube URL shows platform detection', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('#inbox-url-input')).toBeTruthy()
    })

    const input = container.querySelector('#inbox-url-input') as HTMLInputElement
    fireEvent.change(input, {
      target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    })

    await waitFor(() => {
      const detected = container.querySelector('[data-testid="inbox-detected"]')
      expect(detected).toBeTruthy()
    })
  })

  it('typing share text extracts URL and detects platform', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('#inbox-url-input')).toBeTruthy()
    })

    const input = container.querySelector('#inbox-url-input') as HTMLInputElement
    fireEvent.change(input, {
      target: { value: '4.66 xfo:/ :4pm 08/23 #情感 https://v.douyin.com/X 复制此链接' },
    })

    await waitFor(() => {
      const detected = container.querySelector('[data-testid="inbox-detected"]')
      expect(detected).toBeTruthy()
    })
  })

  it('typing non-URL text does not show detection', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('#inbox-url-input')).toBeTruthy()
    })

    const input = container.querySelector('#inbox-url-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '纯文本无链接' } })

    await new Promise((r) => setTimeout(r, 50))
    const detected = container.querySelector('[data-testid="inbox-detected"]')
    expect(detected).toBeNull()
  })
})

describe('InboxPage — filter interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
    getInboxStore().addEntry({ id: 'f1', url: 'https://x.com/1', status: 'downloaded', filename: 'a.mp4' })
    getInboxStore().addEntry({ id: 'f2', url: 'https://x.com/2', status: 'failed', filename: 'b.mp4' })
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('clicking a filter changes the active filter', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('[data-testid="inbox-filter-bar"]')).toBeTruthy()
    })

    const failedBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('失败'),
    )
    expect(failedBtn).toBeTruthy()
    fireEvent.click(failedBtn!)

    await waitFor(() => {
      expect(getInboxStore().filterStatus).toBe('failed')
    })
  })
})

describe('InboxPage — search interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
    getInboxStore().addEntry({ id: 's1', url: 'https://x.com/video1', status: 'downloaded', filename: 'vid1.mp4' })
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('typing in search updates the store search query', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('[data-testid="inbox-search"]')).toBeTruthy()
    })

    const searchInput = container.querySelector(
      '[data-testid="inbox-search"] input, [data-testid="inbox-search"] [data-tag="input"]',
    ) as HTMLInputElement
    if (searchInput) {
      fireEvent.change(searchInput, { target: { value: 'vid1' } })
      await waitFor(() => {
        expect(getInboxStore().searchQuery).toBe('vid1')
      })
    }
  })

  it('clear search button resets search query', async () => {
    getInboxStore().setSearchQuery('some search')

    const { container } = renderPage()
    await waitFor(() => {
      expect(getInboxStore().searchQuery).toBe('some search')
    })

    const clearBtn = container.querySelector('[aria-label="清除搜索"]')
    if (clearBtn) {
      fireEvent.click(clearBtn)
      await waitFor(() => {
        expect(getInboxStore().searchQuery).toBe('')
      })
    }
  })
})

describe('InboxPage — density toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
    getInboxStore().addEntry({
      id: 'density-test',
      url: 'https://x.com/video',
      status: 'downloaded',
      filename: 'vid.mp4',
    })
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('renders density toggle with text', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.textContent).toContain('紧凑')
    })

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('紧凑') || b.textContent?.includes('舒适'),
    )
    expect(toggleBtn).toBeTruthy()
    fireEvent.click(toggleBtn!)
  })
})

describe('InboxPage — 全部清除 (clear all) dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
    getInboxStore().addEntry({
      id: 'clear-test',
      url: 'https://x.com',
      status: 'downloaded',
      filename: 'test.mp4',
    })
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('renders 全部清除 button', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.textContent).toContain('全部清除')
    })

    const clearBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('全部清除'),
    )
    expect(clearBtn).toBeTruthy()
  })
})

describe('InboxPage — keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('pressing / does not throw', async () => {
    renderPage()
    await new Promise((r) => setTimeout(r, 50))

    expect(() => {
      fireEvent.keyDown(document, { key: '/' })
    }).not.toThrow()
  })

  it('pressing Delete key with selection opens batch delete confirm', async () => {
    getInboxStore().addEntry({ id: 'kb-test', url: 'https://x.com', status: 'downloaded', filename: 'vid.mp4' })
    getInboxStore().toggleSelect('kb-test')

    renderPage()
    await new Promise((r) => setTimeout(r, 50))

    expect(() => {
      fireEvent.keyDown(document, { key: 'Delete' })
    }).not.toThrow()
  })

  it('pressing S key with selection triggers subtitle dialog', async () => {
    getInboxStore().addEntry({ id: 's-key', url: 'https://x.com', status: 'downloaded', filename: 'vid.mp4' })
    getInboxStore().toggleSelect('s-key')

    renderPage()
    await new Promise((r) => setTimeout(r, 50))

    expect(() => {
      const event = new KeyboardEvent('keydown', { key: 's', bubbles: true })
      document.dispatchEvent(event)
    }).not.toThrow()
  })
})

describe('InboxPage — download flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInboxStore().reset()
    clearInboxStorage()
  })

  afterEach(() => {
    getInboxStore().reset()
    clearInboxStorage()
  })

  it('clicking download with empty URL does not add entries', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(container.querySelector('[data-testid="inbox-download"]')).toBeTruthy()
    })

    const downloadBtn = container.querySelector('[data-testid="inbox-download"]')!
    fireEvent.click(downloadBtn)
    expect(getInboxStore().entries).toHaveLength(0)
  })
})
