import { describe, it, expect, vi } from 'vitest'
import { cloneElement, type ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { SuccessRateTrendChart } from './SuccessRateTrendChart'
import { formatDay, computeSuccessRates } from './format'
import type { AnalyticsSummary } from '@/hooks/useAnalytics'

// recharts' ResponsiveContainer needs a real sized container; happy-dom
// provides none, so we inject fixed dimensions into the chart child.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 400, height: 280 } as Partial<unknown>),
  }
})

const data: AnalyticsSummary['by_day'] = [
  { date: '2026-07-01', success: 8, failed: 2 },
  { date: '2026-07-02', success: 0, failed: 0 },
  { date: '2026-07-03', success: 0, failed: 5 },
]

describe('formatDay / computeSuccessRates', () => {
  it('formats a YYYY-MM-DD string to MM-DD', () => {
    expect(formatDay('2026-07-01')).toBe('07-01')
    expect(formatDay('2026-12-31')).toBe('12-31')
  })

  it('falls back to the original string for unparseable input', () => {
    expect(formatDay('not-a-date')).toBe('not-a-date')
  })

  it('computes success rate as a percentage', () => {
    const byDay: AnalyticsSummary['by_day'] = [
      { date: '2026-07-01', success: 8, failed: 2 },
    ]
    expect(computeSuccessRates(byDay)).toEqual([{ date: '07-01', rate: 80 }])
  })

  it('maps a day with no tasks to null', () => {
    const byDay: AnalyticsSummary['by_day'] = [
      { date: '2026-07-02', success: 0, failed: 0 },
    ]
    expect(computeSuccessRates(byDay)).toEqual([{ date: '07-02', rate: null }])
  })

  it('rates a fully-failed day as 0 (not null)', () => {
    const byDay: AnalyticsSummary['by_day'] = [
      { date: '2026-07-03', success: 0, failed: 5 },
    ]
    expect(computeSuccessRates(byDay)).toEqual([{ date: '07-03', rate: 0 }])
  })
})

describe('SuccessRateTrendChart', () => {
  it('renders the title', () => {
    render(<SuccessRateTrendChart data={[]} loading={false} />)
    expect(screen.getByText('成功率趋势')).toBeInTheDocument()
  })

  it('renders a skeleton while loading', () => {
    const { container } = render(<SuccessRateTrendChart data={data} loading />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(screen.queryByText('暂无发布数据')).not.toBeInTheDocument()
  })

  it('renders the empty state when there is no data', () => {
    render(<SuccessRateTrendChart data={[]} loading={false} />)
    expect(
      screen.getByRole('heading', { name: '暂无发布数据' }),
    ).toBeInTheDocument()
  })

  it('renders the line chart for non-empty data without crashing', () => {
    render(<SuccessRateTrendChart data={data} loading={false} />)
    // Title present + no empty state (chart branch chosen).
    expect(screen.getByText('成功率趋势')).toBeInTheDocument()
    expect(screen.queryByText('暂无发布数据')).not.toBeInTheDocument()
    // The line chart SVG is rendered (data branch).
    expect(document.querySelector('.recharts-line')).toBeInTheDocument()
  })
})
