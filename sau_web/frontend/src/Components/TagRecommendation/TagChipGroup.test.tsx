import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagChipGroup } from './TagChipGroup'

describe('TagChipGroup', () => {
  const mockToggle = vi.fn()

  beforeEach(() => {
    mockToggle.mockClear()
  })

  it('renders nothing when tags array is empty', () => {
    const { container } = render(
      <TagChipGroup tags={[]} selectedTags={[]} onToggle={mockToggle} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders all tags as chips', () => {
    render(
      <TagChipGroup tags={['python', '教程', '编程']} selectedTags={[]} onToggle={mockToggle} />,
    )
    expect(screen.getByText('#python')).toBeDefined()
    expect(screen.getByText('#教程')).toBeDefined()
    expect(screen.getByText('#编程')).toBeDefined()
  })

  it('highlights selected tags', () => {
    render(
      <TagChipGroup tags={['python', '教程']} selectedTags={['python']} onToggle={mockToggle} />,
    )
    const pythonChip = screen.getByText('#python')
    expect(pythonChip.className).toContain('bg-primary')
    const tutorialChip = screen.getByText('#教程')
    expect(tutorialChip.className).toContain('bg-secondary')
  })

  it('calls onToggle when a chip is clicked', () => {
    render(
      <TagChipGroup tags={['python']} selectedTags={[]} onToggle={mockToggle} />,
    )
    fireEvent.click(screen.getByText('#python'))
    expect(mockToggle).toHaveBeenCalledWith('python')
  })

  it('shows loading skeleton when loading is true', () => {
    const { container } = render(
      <TagChipGroup tags={[]} selectedTags={[]} onToggle={mockToggle} loading />,
    )
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBe(5)
  })
})
