import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MultiPlatformGeneratePanel } from './MultiPlatformGeneratePanel'
import { aiApi } from '@/api/ai'

// Round-XXX second-batch migration: split the legacy `@/api/client` mock
// into `@/api/ai` (for `aiApi.generateMultiPlatformStream`) + `@/api/types`
// (for the PLATFORMS constant). Production MultiPlatformGeneratePanel.tsx
// imports `aiApi` from `@/api/ai` and `PLATFORMS` from `@/api/client` (which
// re-exports from `@/api/types`).
vi.mock('@/api/ai', () => ({
  aiApi: {
    generateMultiPlatformStream: vi.fn(),
  },
}))
vi.mock('@/api/types', () => ({
  PLATFORMS: [
    { label: '抖音', value: 'douyin', color: 'magenta' },
    { label: '快手', value: 'kuaishou', color: 'orange' },
    { label: '小红书', value: 'xiaohongshu', color: 'red' },
    { label: '视频号', value: 'tencent', color: 'green' },
    { label: 'Bilibili', value: 'bilibili', color: 'blue' },
    { label: 'TikTok', value: 'tiktok', color: 'cyan' },
    { label: '百家号', value: 'baijiahao', color: 'gold' },
  ],
}))



describe('MultiPlatformGeneratePanel', () => {
  const mockApply = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the panel header', () => {
    render(<MultiPlatformGeneratePanel onApplyResult={mockApply} />)
    expect(screen.getByText('AI 多平台内容生成')).toBeDefined()
  })

  it('renders topic input and platform checkboxes', () => {
    render(<MultiPlatformGeneratePanel onApplyResult={mockApply} />)
    expect(screen.getByPlaceholderText(/输入你想创作的内容主题/)).toBeDefined()
    expect(screen.getByText('抖音')).toBeDefined()
    expect(screen.getByText('小红书')).toBeDefined()
  })

  it('generate button is disabled when topic is empty', () => {
    render(<MultiPlatformGeneratePanel onApplyResult={mockApply} />)
    const button = screen.getByText('一键生成')
    expect(button).toBeDisabled()
  })

  it('generate button is enabled when topic is filled', () => {
    render(<MultiPlatformGeneratePanel onApplyResult={mockApply} />)
    const input = screen.getByPlaceholderText(/输入你想创作的内容主题/)
    fireEvent.change(input, { target: { value: 'Python教程' } })
    const button = screen.getByText('一键生成')
    expect(button).not.toBeDisabled()
  })

  it('calls generateMultiPlatformStream on generate click', () => {
    const mockGenerate = vi.mocked(aiApi.generateMultiPlatformStream)
    mockGenerate.mockImplementation(async () => {})

    render(<MultiPlatformGeneratePanel onApplyResult={mockApply} />)
    const input = screen.getByPlaceholderText(/输入你想创作的内容主题/)
    fireEvent.change(input, { target: { value: 'Python教程' } })
    fireEvent.click(screen.getByText('一键生成'))

    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockGenerate.mock.calls[0][0]).toEqual({
      topic: 'Python教程',
      platforms: ['douyin', 'xiaohongshu', 'kuaishou', 'bilibili'],
    })
  })

  it('panel is collapsible', () => {
    render(<MultiPlatformGeneratePanel onApplyResult={mockApply} />)
    const trigger = screen.getByText('AI 多平台内容生成')
    fireEvent.click(trigger)
    expect(screen.queryByPlaceholderText(/输入你想创作的内容主题/)).toBeNull()
  })
})
