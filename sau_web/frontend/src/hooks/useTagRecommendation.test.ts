import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTagRecommendation } from './useTagRecommendation'

vi.mock('@/api/client', () => ({
  api: {
    generateMessagesStream: vi.fn(),
  },
}))

import { api } from '@/api/client'

describe('useTagRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with empty tags and not loading', () => {
    const { result } = renderHook(() => useTagRecommendation())
    expect(result.current.tags).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('calls generateMessagesStream with correct prompt structure', async () => {
    const mockGenerate = vi.mocked(api.generateMessagesStream)
    mockGenerate.mockImplementation(async (_payload, _onChunk, onDone) => {
      onDone('["标签1", "标签2", "标签3"]')
    })

    const { result } = renderHook(() => useTagRecommendation())

    await act(async () => {
      await result.current.recommend({ title: 'Python教程', platform: 'douyin' })
    })

    expect(mockGenerate).toHaveBeenCalledTimes(1)
    const payload = mockGenerate.mock.calls[0][0]
    expect(payload.messages).toHaveLength(2)
    expect(payload.messages[0].role).toBe('system')
    expect(payload.messages[1].role).toBe('user')
    expect(payload.messages[1].content).toContain('Python教程')
    expect(result.current.tags).toEqual(['标签1', '标签2', '标签3'])
    expect(result.current.loading).toBe(false)
  })

  it('includes description in prompt when provided', async () => {
    const mockGenerate = vi.mocked(api.generateMessagesStream)
    mockGenerate.mockImplementation(async (_payload, _onChunk, onDone) => {
      onDone('["a", "b"]')
    })

    const { result } = renderHook(() => useTagRecommendation())

    await act(async () => {
      await result.current.recommend({ title: '标题', description: '这是描述', platform: 'xiaohongshu' })
    })

    const payload = mockGenerate.mock.calls[0][0]
    expect(payload.messages[1].content).toContain('标题')
    expect(payload.messages[1].content).toContain('这是描述')
  })

  it('parses JSON array from code-fenced response', async () => {
    const mockGenerate = vi.mocked(api.generateMessagesStream)
    mockGenerate.mockImplementation(async (_payload, _onChunk, onDone) => {
      onDone('```json\n["tag1", "tag2"]\n```')
    })

    const { result } = renderHook(() => useTagRecommendation())

    await act(async () => {
      await result.current.recommend({ title: 'test' })
    })

    expect(result.current.tags).toEqual(['tag1', 'tag2'])
  })

  it('returns empty array on unparseable response', async () => {
    const mockGenerate = vi.mocked(api.generateMessagesStream)
    mockGenerate.mockImplementation(async (_payload, _onChunk, onDone) => {
      onDone('This is not JSON at all')
    })

    const { result } = renderHook(() => useTagRecommendation())

    await act(async () => {
      await result.current.recommend({ title: 'test' })
    })

    expect(result.current.tags).toEqual([])
  })

  it('does not call API when title is empty', async () => {
    const mockGenerate = vi.mocked(api.generateMessagesStream)
    const { result } = renderHook(() => useTagRecommendation())

    await act(async () => {
      await result.current.recommend({ title: '' })
    })

    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
