import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContentVariantsPanel } from './ContentVariantsPanel'
import { aiApi } from '@/api/ai'

// Round-XXX second-batch migration: replaced legacy `@/api/client` mock
// with an explicit `@/api/ai` mock. Production ContentVariantsPanel.tsx
// imports `aiApi.generateVariantsStream` from `@/api/ai` (confirmed by
// reading the production source). The legacy `api.generateVariantsStream`
// barrel was never actually invoked.
vi.mock('@/api/ai', () => ({
  aiApi: {
    generateVariantsStream: vi.fn(),
  },
}))



describe('ContentVariantsPanel', () => {
  const mockApply = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the panel header', () => {
    render(<ContentVariantsPanel onApplyVariant={mockApply} />)
    expect(screen.getByText('AI 内容生成')).toBeDefined()
  })

  it('renders topic input', () => {
    render(<ContentVariantsPanel onApplyVariant={mockApply} />)
    // Panel starts collapsed; click the trigger to open it
    fireEvent.click(screen.getByText('AI 内容生成').closest('button')!)
    expect(screen.getByPlaceholderText(/输入你想创作的内容主题/)).toBeDefined()
  })

  it('generate button is disabled when topic is empty', () => {
    render(<ContentVariantsPanel onApplyVariant={mockApply} />)
    // Panel starts collapsed; click the trigger to open it
    fireEvent.click(screen.getByText('AI 内容生成').closest('button')!)
    const button = screen.getByText('一键生成')
    expect(button).toBeDisabled()
  })

  it('generate button is enabled when topic is filled', () => {
    render(<ContentVariantsPanel onApplyVariant={mockApply} />)
    // Panel starts collapsed; click the trigger to open it
    fireEvent.click(screen.getByText('AI 内容生成').closest('button')!)
    const input = screen.getByPlaceholderText(/输入你想创作的内容主题/)
    fireEvent.change(input, { target: { value: 'Python教程' } })
    const button = screen.getByText('一键生成')
    expect(button).not.toBeDisabled()
  })

  it('calls generateVariantsStream on generate click', () => {
    const mockGenerate = vi.mocked(aiApi.generateVariantsStream)
    mockGenerate.mockImplementation(async () => {})

    render(<ContentVariantsPanel onApplyVariant={mockApply} />)
    // Panel starts collapsed; click the trigger to open it
    fireEvent.click(screen.getByText('AI 内容生成').closest('button')!)
    const input = screen.getByPlaceholderText(/输入你想创作的内容主题/)
    fireEvent.change(input, { target: { value: 'Python教程' } })
    fireEvent.click(screen.getByText('一键生成'))

    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockGenerate.mock.calls[0][0]).toEqual({
      topic: 'Python教程',
      search: false,
    })
  })

  it('panel is collapsible', () => {
    render(<ContentVariantsPanel onApplyVariant={mockApply} />)
    // First open the panel
    const trigger = screen.getByText('AI 内容生成').closest('button')!
    fireEvent.click(trigger)
    expect(screen.getByPlaceholderText(/输入你想创作的内容主题/)).toBeDefined()
    // Then close it
    fireEvent.click(trigger)
    expect(screen.queryByPlaceholderText(/输入你想创作的内容主题/)).toBeNull()
  })
})
