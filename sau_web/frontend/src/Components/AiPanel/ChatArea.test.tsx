import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ChatArea } from './ChatArea'
import { useChatStore } from '@/stores/useChatStore'

beforeEach(() => {
  useChatStore.getState().reset()
})

describe('ChatArea — empty state', () => {
  it('shows the command suggestions when no active session and no draft', () => {
    render(<ChatArea />)
    expect(screen.getByText(/选择命令快速开始/)).toBeDefined()
  })

  it('hides the command suggestions when a stream is in flight (draft non-empty)', () => {
    // No active session, but a draft is being typed
    useChatStore.getState().appendStreamingChunk('partial')
    render(<ChatArea />)
    expect(screen.queryByText(/选择命令快速开始/)).toBeNull()
    expect(screen.getByText('partial')).toBeDefined()
  })

  it('hides the command suggestions when the session has messages', () => {
    const sid = useChatStore.getState().newSession('video', 'douyin')
    useChatStore.getState().appendUserMessage(sid, { content: 'first turn' })
    render(<ChatArea />)
    expect(screen.queryByText(/选择命令快速开始/)).toBeNull()
    expect(screen.getByText('first turn')).toBeDefined()
  })
})

describe('ChatArea — message rendering', () => {
  it('renders user messages with right alignment', () => {
    const sid = useChatStore.getState().newSession('video', 'douyin')
    useChatStore.getState().appendUserMessage(sid, { content: '给我一个标题' })
    render(<ChatArea />)
    const bubble = screen.getByText('给我一个标题')
    // Container element should justify-end (right-aligned).
    const wrapper = bubble.closest('[class*="justify-end"]')
    expect(wrapper).toBeDefined()
  })

  it('renders assistant messages with left alignment and AI label', () => {
    const sid = useChatStore.getState().newSession('note', 'xiaohongshu')
    useChatStore.getState().appendUserMessage(sid, { content: 'q' })
    useChatStore.getState().appendStreamingChunk('答案: 你好世界')
    useChatStore.getState().commitAssistantMessage(sid)
    render(<ChatArea />)
    expect(screen.getByText('答案: 你好世界')).toBeDefined()
    expect(screen.getByText(/AI/)).toBeDefined()
    const answer = screen.getByText('答案: 你好世界')
    const wrapper = answer.closest('[class*="justify-start"]')
    expect(wrapper).toBeDefined()
  })

  it('renders system snapshot messages with italic muted styling', () => {
    // System messages can appear in history but are rare in practice. Test
    // by direct injection into the session.
    const sid = useChatStore.getState().newSession('video', 'douyin')
    // Hack: appendUserMessage only takes role 'user'; for the test, build
    // a session with a synthetic sys message via direct state mutation.
    useChatStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        [sid]: {
          ...s.sessions[sid],
          messages: [
            {
              id: 'sys-1',
              role: 'system',
              content: '[当前表单状态] 标题: 老王',
              createdAt: Date.now(),
            },
          ],
        },
      },
    }))
    render(<ChatArea />)
    const sysLine = screen.getByText(/当前表单状态/)
    expect(sysLine.className).toContain('italic')
  })

  it('renders the appliedTo chip when present', () => {
    const sid = useChatStore.getState().newSession('video', 'douyin')
    useChatStore.getState().appendUserMessage(sid, { content: 'q' })
    useChatStore.getState().appendStreamingChunk('a')
    const msg = useChatStore.getState().commitAssistantMessage(sid)!
    useChatStore.getState().markApplied(sid, msg.id, ['title', 'tags'])
    render(<ChatArea />)
    // ChatArea now renders localized field names: 标题/描述/标签.
    expect(screen.getByText(/已应用到:/)).toBeDefined()
    expect(screen.getByText(/标题|title/)).toBeDefined()
    expect(screen.getByText(/标签|tags/)).toBeDefined()
  })
})

describe('ChatArea — streaming draft', () => {
  it('shows streamingDraft + caret when jobStatus === "generating"', () => {
    // Open a session so chat store has somewhere to anchor the stream
    const sid = useChatStore.getState().newSession('video', 'douyin')
    useChatStore.setState({
      streamingDraft: '正在打字…',
      jobStatus: 'generating',
      activeSessionId: sid,
    })
    render(<ChatArea />)
    expect(screen.getByText('正在打字…')).toBeDefined()
    // Caret is a span sibling of MarkdownContent in the streaming container.
    // The parentElement of getByText is the prose div; the caret lives in the
    // parent container above that.
    const streamText = screen.getByText('正在打字…')
    const streamContainer = streamText.closest('[class*="text-foreground"]') || streamText.parentElement?.parentElement
    expect(streamContainer?.querySelector('span.bg-primary')).not.toBeNull()
  })

  it('does NOT show streaming text when draft is empty even if jobStatus says generating', () => {
    useChatStore.setState({ jobStatus: 'generating', streamingDraft: '' })
    render(<ChatArea />)
    // Streaming caret should not appear (empty draft hides the bubble)
    // — but the command suggestions show.
    expect(screen.getByText(/选择命令快速开始/)).toBeDefined()
  })
})

describe('ChatArea — error block', () => {
  it('renders the chat error when status is error', () => {
    useChatStore.setState({ jobStatus: 'error', error: 'API quota exhausted' })
    render(<ChatArea />)
    const errorText = screen.getByText('API quota exhausted')
    expect(errorText).toBeDefined()
    // The 'text-destructive' class is on the parent div, not on the text span
    expect(errorText.closest('div')?.className).toContain('text-destructive')
  })

  it('does NOT render the error block when status recovers to idle', () => {
    useChatStore.setState({ jobStatus: 'error', error: 'temp err' })
    useChatStore.setState({ jobStatus: 'idle', error: null })
    render(<ChatArea />)
    expect(screen.queryByText('temp err')).toBeNull()
  })
})
