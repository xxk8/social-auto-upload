import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from '@tanstack/react-router'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { TaskProgressBar } from './TaskProgressBar'
import { formatTaskTooltip } from './tooltipFormatter'
import { toneFgVar } from '@/lib/tone'

// ── helpers ──────────────────────────────────────────────────────

function renderBar(total: number, counts: Record<string, number>) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQueryClient()}>
        <TaskProgressBar total={total} counts={counts} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

// ── toneFgVar contract (must be CSS color, not Tailwind class) ────

describe('toneFgVar', () => {
  it('returns CSS var strings for chart/SVG fill', () => {
    expect(toneFgVar('info')).toBe('var(--status-info-fg)')
    expect(toneFgVar('success')).toBe('var(--status-success-fg)')
    // Canonical token is --status-error-* (not danger)
    expect(toneFgVar('error')).toBe('var(--status-error-fg)')
    expect(toneFgVar('info')).not.toMatch(/^text-/)
  })
})

// ── formatTaskTooltip (pure) ─────────────────────────────────────

describe('formatTaskTooltip', () => {
  const segs = [
    { key: 'done', label: '成功', count: 12 },
    { key: 'active', label: '进行中', count: 5 },
    { key: 'failed', label: '失败/异常', count: 3 },
  ]

  it('formats a known segment with label, count, and percentage', () => {
    const result = formatTaskTooltip(12, 'done', segs, 20)
    expect(result[0]).toBe('成功 · 12 (60%)')
    expect(result[1]).toBe('')
  })

  it('formats the active segment correctly', () => {
    const result = formatTaskTooltip(5, 'active', segs, 20)
    expect(result[0]).toBe('进行中 · 5 (25%)')
  })

  it('formats the failed segment correctly', () => {
    const result = formatTaskTooltip(3, 'failed', segs, 20)
    expect(result[0]).toBe('失败/异常 · 3 (15%)')
  })

  it('rounds percentage to whole number', () => {
    const customSegs = [{ key: 'done', label: '成功', count: 7 }]
    const result = formatTaskTooltip(7, 'done', customSegs, 22)
    expect(result[0]).toBe('成功 · 7 (32%)')
  })

  it('handles total=0 gracefully (0%)', () => {
    const result = formatTaskTooltip(0, 'done', [{ key: 'done', label: '成功', count: 0 }], 0)
    expect(result[0]).toBe('成功 · 0 (0%)')
  })

  it('falls back to plain value for unknown segment key', () => {
    const result = formatTaskTooltip(42, 'unknown', segs, 20)
    expect(result[0]).toBe('42')
    expect(result[1]).toBe('')
  })
})

// ── TaskProgressBar (CSS bar, no recharts) ────────────────────────

describe('TaskProgressBar — empty state (total=0)', () => {
  it('does not use recharts', () => {
    const { container } = renderBar(0, {})
    expect(container.querySelector('.recharts-bar')).not.toBeInTheDocument()
    expect(container.querySelector('.recharts-surface')).not.toBeInTheDocument()
  })

  it('shows the "暂无任务" legend with count 0', () => {
    renderBar(0, {})
    expect(screen.getByText('暂无任务')).toBeInTheDocument()
    const emptyItem = screen.getByText('暂无任务').closest('div')
    expect(emptyItem).not.toBeNull()
    expect(within(emptyItem!).getByText('0')).toBeInTheDocument()
  })

  it('shows "总计" label with count 0', () => {
    renderBar(0, {})
    expect(screen.getByText('总计')).toBeInTheDocument()
    const totalItem = screen.getByText('总计').closest('div')
    expect(totalItem).not.toBeNull()
    expect(within(totalItem!).getByText('0')).toBeInTheDocument()
  })
})

describe('TaskProgressBar — all-success', () => {
  it('renders only the "成功" segment (no active/failed)', () => {
    renderBar(10, { success: 10 })
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.queryByText('进行中')).not.toBeInTheDocument()
    expect(screen.queryByText('失败/异常')).not.toBeInTheDocument()
  })

  it('shows correct count and total', () => {
    renderBar(10, { success: 10 })
    const successItem = screen.getByText('成功').closest('div')
    expect(successItem).not.toBeNull()
    expect(within(successItem!).getByText('10')).toBeInTheDocument()
    expect(screen.getByText('总计')).toBeInTheDocument()
    const totalItem = screen.getByText('总计').closest('div')
    expect(within(totalItem!).getByText('10')).toBeInTheDocument()
  })

  it('renders a pure CSS progress track (role=img)', () => {
    const { container } = renderBar(10, { success: 10 })
    expect(container.querySelector('[role="img"]')).toBeInTheDocument()
    expect(container.querySelector('.recharts-bar')).not.toBeInTheDocument()
  })
})

describe('TaskProgressBar — mixed statuses', () => {
  const mixedCounts = {
    success: 12,
    running: 3,
    pending: 2,
    scheduled: 1,
    failed: 1,
    error: 1,
  }

  it('renders all three segment labels', () => {
    renderBar(20, mixedCounts)
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('失败/异常')).toBeInTheDocument()
  })

  it('aggregates active keys (running + pending + scheduled) into one segment', () => {
    renderBar(20, mixedCounts)
    const activeItem = screen.getByText('进行中').closest('div')
    expect(within(activeItem!).getByText('6')).toBeInTheDocument()
  })

  it('aggregates failed keys (failed + error) into one segment', () => {
    renderBar(20, mixedCounts)
    const failedItem = screen.getByText('失败/异常').closest('div')
    expect(within(failedItem!).getByText('2')).toBeInTheDocument()
  })

  it('shows done count correctly', () => {
    renderBar(20, mixedCounts)
    const doneItem = screen.getByText('成功').closest('div')
    expect(within(doneItem!).getByText('12')).toBeInTheDocument()
  })

  it('shows total count', () => {
    renderBar(20, mixedCounts)
    const totalItem = screen.getByText('总计').closest('div')
    expect(within(totalItem!).getByText('20')).toBeInTheDocument()
  })

  it('renders legend chips for each segment', () => {
    const { container } = renderBar(20, mixedCounts)
    const dots = container.querySelectorAll('.rounded-full')
    expect(dots.length).toBeGreaterThanOrEqual(3)
  })
})

describe('TaskProgressBar — only-failed', () => {
  it('renders only the "失败/异常" segment (no done/active)', () => {
    renderBar(5, { failed: 3, error: 2 })
    expect(screen.getByText('失败/异常')).toBeInTheDocument()
    expect(screen.queryByText('成功')).not.toBeInTheDocument()
    expect(screen.queryByText('进行中')).not.toBeInTheDocument()
  })

  it('aggregates failed + error into count 5', () => {
    renderBar(5, { failed: 3, error: 2 })
    const failedItem = screen.getByText('失败/异常').closest('div')
    expect(within(failedItem!).getByText('5')).toBeInTheDocument()
  })
})

describe('TaskProgressBar — only-active', () => {
  it('renders only the "进行中" segment', () => {
    renderBar(4, { running: 2, pending: 1, scheduled: 1 })
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.queryByText('成功')).not.toBeInTheDocument()
    expect(screen.queryByText('失败/异常')).not.toBeInTheDocument()
  })

  it('aggregates running + pending + scheduled into count 4', () => {
    renderBar(4, { running: 2, pending: 1, scheduled: 1 })
    const activeItem = screen.getByText('进行中').closest('div')
    expect(within(activeItem!).getByText('4')).toBeInTheDocument()
  })
})

describe('TaskProgressBar — zero-value keys filtered out', () => {
  it('does not render a segment when its aggregated count is 0', () => {
    renderBar(5, { success: 5, running: 0, failed: 0 })
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.queryByText('进行中')).not.toBeInTheDocument()
    expect(screen.queryByText('失败/异常')).not.toBeInTheDocument()
  })
})
