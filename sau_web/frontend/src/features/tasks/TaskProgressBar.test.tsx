import { describe, it, expect, vi } from 'vitest'
import { cloneElement, type ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from '@tanstack/react-router'
import { makeQueryClient } from '@/test/render-harness.helpers'

// recharts' ResponsiveContainer needs a real sized container; jsdom
// provides none, so we inject fixed dimensions into the chart child.
// This is the same pattern used by SuccessRateTrendChart.test.tsx.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 400, height: 40 } as Partial<unknown>),
  }
})

import { TaskProgressBar } from './TaskProgressBar'
import { formatTaskTooltip } from './tooltipFormatter'

// ── helpers ──────────────────────────────────────────────────────

/** Render TaskProgressBar with the minimum provider stack. */
function renderBar(total: number, counts: Record<string, number>) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQueryClient()}>
        <TaskProgressBar total={total} counts={counts} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

// ── formatTaskTooltip (pure function, no rendering needed) ────────

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
    // 7 / 22 = 31.818...% → rounds to 32%
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

  it('returns empty string as second tuple element to suppress default name', () => {
    const result = formatTaskTooltip(5, 'active', segs, 20)
    expect(result[1]).toBe('')
  })
})

// ── TaskProgressBar component rendering ──────────────────────────

describe('TaskProgressBar — empty state (total=0)', () => {
  it('renders a muted placeholder bar (no recharts BarChart)', () => {
    const { container } = renderBar(0, {})
    // When total===0, the component renders a plain <div className="bg-muted">
    // instead of a ResponsiveContainer/BarChart. Assert no recharts SVG.
    expect(container.querySelector('.recharts-bar')).not.toBeInTheDocument()
    expect(container.querySelector('.recharts-surface')).not.toBeInTheDocument()
    // The muted placeholder div is present.
    const placeholder = container.querySelector('.bg-muted.rounded-full')
    expect(placeholder).toBeInTheDocument()
  })

  it('shows the "暂无任务" legend with count 0', () => {
    renderBar(0, {})
    // The fallback label for the empty segment is '暂无任务' (zh-CN default).
    expect(screen.getByText('暂无任务')).toBeInTheDocument()
    // The empty segment's count is 0 — scope via the closest legend item.
    const emptyItem = screen.getByText('暂无任务').closest('div')
    expect(emptyItem).not.toBeNull()
    expect(within(emptyItem!).getByText('0')).toBeInTheDocument()
  })

  it('shows "总计" label with count 0', () => {
    renderBar(0, {})
    expect(screen.getByText('总计')).toBeInTheDocument()
    // Total count is also 0 — scope via the closest legend item to avoid
    // collision with the empty segment's 0.
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
    // "成功" segment shows count 10, "总计" shows 10.
    const successItem = screen.getByText('成功').closest('div')
    expect(successItem).not.toBeNull()
    expect(within(successItem!).getByText('10')).toBeInTheDocument()
    expect(screen.getByText('总计')).toBeInTheDocument()
    // Total count — find the "总计" label's sibling number.
    const totalItem = screen.getByText('总计').closest('div')
    expect(within(totalItem!).getByText('10')).toBeInTheDocument()
  })

  it('renders a recharts BarChart with a bar element', () => {
    const { container } = renderBar(10, { success: 10 })
    expect(container.querySelector('.recharts-bar')).toBeInTheDocument()
    expect(container.querySelector('.recharts-surface')).toBeInTheDocument()
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
  // total = 12 + 3 + 2 + 1 + 1 + 1 = 20
  // done = 12, active = 3+2+1 = 6, failed = 1+1 = 2

  it('renders all three segment labels', () => {
    renderBar(20, mixedCounts)
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('失败/异常')).toBeInTheDocument()
  })

  it('aggregates active keys (running + pending + scheduled) into one segment', () => {
    renderBar(20, mixedCounts)
    // "进行中" should show count 6 (= 3 + 2 + 1)
    const activeItem = screen.getByText('进行中').closest('div')
    expect(within(activeItem!).getByText('6')).toBeInTheDocument()
  })

  it('aggregates failed keys (failed + error) into one segment', () => {
    renderBar(20, mixedCounts)
    // "失败/异常" should show count 2 (= 1 + 1)
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

  it('renders legend dots for each segment', () => {
    const { container } = renderBar(20, mixedCounts)
    // Each legend item has a colored dot (span with rounded-full).
    const dots = container.querySelectorAll('.rounded-full')
    // At least 3 segment dots + the bar chart may also render dots.
    // We check at minimum the 3 legend dots exist.
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
    // success=5, but no running/pending/scheduled, and no failed/error
    renderBar(5, { success: 5, running: 0, failed: 0 })
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.queryByText('进行中')).not.toBeInTheDocument()
    expect(screen.queryByText('失败/异常')).not.toBeInTheDocument()
  })
})

describe('TaskProgressBar — props interface contract', () => {
  it('accepts a Record<string, number> for counts', () => {
    // TypeScript compilation is the contract; this test confirms
    // the component renders without runtime errors for a typical shape.
    const counts: Record<string, number> = { success: 1 }
    const { container } = renderBar(1, counts)
    expect(container.querySelector('.recharts-bar')).toBeInTheDocument()
  })
})
