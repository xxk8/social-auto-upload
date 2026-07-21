import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'

// Mock BEFORE importing CalendarPage so the lazy map resolves.
vi.mock('react-big-calendar', () => ({
  Calendar: () => <div data-testid="rbc-stub" />,
  dateFnsLocalizer: () => ({}),
  Views: { MONTH: 'month', WEEK: 'week', DAY: 'day', AGENDA: 'agenda' },
}))

vi.mock('@/hooks/useCalendarTasks', () => ({
  useCalendarTasks: vi.fn(),
}))

vi.mock('@/features/tasks/TaskDrawer', () => ({
  TaskDrawer: () => null,
}))

import CalendarPage from '../CalendarPage'
import { useCalendarTasks } from '@/hooks/useCalendarTasks'

const mockUseCalendarTasks = vi.mocked(useCalendarTasks)

beforeEach(() => {
  mockUseCalendarTasks.mockReturnValue({
    data: {
      tasks: [
        {
          task_id: 'tk-1',
          platform: 'douyin',
          account: 'work1',
          action: 'upload-video',
          status: 'success',
          title: '测试视频',
          scheduled_at: null,
          created: '2026-07-08T10:00:00',
          effective_date: '2026-07-08',
        },
      ],
      summary: {
        total: 1,
        by_platform: { douyin: 1 },
        by_status: { success: 1 },
      },
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCalendarTasks>)
})

function mountAt(path: string) {
  return render(
    <TestProviders client={makeQueryClient()} initialEntries={[path]}>
      <CalendarPage />
    </TestProviders>,
  )
}

describe('CalendarPage', () => {
  it('renders page header + calendar stub + summary footer', () => {
    mountAt('/dashboard/calendar')
    expect(screen.getByText('内容日历')).toBeDefined()
    expect(screen.getByTestId('rbc-stub')).toBeDefined()
    expect(screen.getByTestId('calendar-summary-total').textContent).toBe('1')
  })

  it('renders summary with one platform and one status bucket', () => {
    mountAt('/dashboard/calendar')
    const platforms = screen.getByTestId('calendar-summary-platforms')
    const statuses = screen.getByTestId('calendar-summary-statuses')
    expect(platforms.textContent).toContain('抖音')
    expect(statuses.textContent).toContain('已发布')
  })

  it('renders platform filter chips from PLATFORMS', () => {
    mountAt('/dashboard/calendar')
    expect(screen.getByLabelText('筛选 平台 抖音')).toBeDefined()
    expect(screen.getByLabelText('筛选 平台 Bilibili')).toBeDefined()
  })

  it('suppresses accounts filter when no tasks present', () => {
    mockUseCalendarTasks.mockReturnValueOnce({
      data: { tasks: [], summary: { total: 0, by_platform: {}, by_status: {} } },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCalendarTasks>)
    mountAt('/dashboard/calendar')
    // 账号 group should NOT render when availableAccounts is empty.
    expect(screen.queryByText('账号')).toBeNull()
  })
})
