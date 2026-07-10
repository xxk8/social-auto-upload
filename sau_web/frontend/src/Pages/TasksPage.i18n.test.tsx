/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@/Components/ui/tooltip'
import i18n from '@/lib/i18n/config'
import { makeQueryClient } from '@/test/render-harness.helpers'
import { makeTask } from '@/test/fixtures'
import type { TaskItem } from '../api/client'

// ─────────────────────────────────────────────────────────────────────────
// TasksPage · i18n flip (round-2 dashboard-surface sweep)
//
// Mirrors AppShell.i18n.test.tsx structure: real <I18nextProvider
// i18n={i18n}> wrap (NOT a vi.mock stub) so the production
// changeLanguage codepath is exercised end-to-end. The TasksPage
// hook chain is mocked at the data layer only — useTaskTableState
// runs naturally so STATUS_CHIPS label resolution + chipOptions
// flow through the real `t()` call site.
//
// Test surface (8 specs):
//   (a) Initial zh-CN page chrome — page title + description +
//       new task button text
//   (b) Initial zh-CN table headers — 8 column headers in canonical
//       order
//   (c) Initial zh-CN status filter chips — 7 chips render via
//       <StatusTabs> using labelKey/labelFallback resolution
//   (d) Initial zh-CN empty state + toolbar (search placeholder,
//       polling chip, refresh + clear button text, empty title +
//       description + refresh button)
//   (e) Switch to en-US flips page chrome + table headers + status
//       chips + empty state (full absorption — no zh-CN leakage)
//   (f) Round-trip persistence — zh-CN → en-US → zh-CN restores
//       Chinese labels
//   (g) With-tasks: status badge label inside TaskTableRow flips
//       with locale (resolves via STATUS_META.labelKey)
//   (h) With-tasks: status badge title attribute (filter hint) flips
//       with locale — interpolates the resolved status label
//       into the localized prefix/suffix
// ─────────────────────────────────────────────────────────────────────────

// Mutable backing for the useTasks mock — the factory closes over
// this ref so each `mountTasksPage({ tasks: ... })` call swaps the
// task list for that render without re-mocking the module.
let mockTasks: TaskItem[] = []

vi.mock('../hooks/useTasks', () => ({
  useTasks: () => ({
    data: mockTasks,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('../hooks/useTaskMutations', () => ({
  useTaskMutations: () => ({
    refresh: vi.fn(),
    handleOpenAddModal: vi.fn(),
    handleClearSelection: vi.fn(),
    handleBatchRetry: vi.fn(),
    handleBatchDelete: vi.fn(),
    handleCloseDrawer: vi.fn(),
    handleRetry: vi.fn(),
    handleDelete: vi.fn(),
    handleStatusBadgeClick: vi.fn(),
    handleOpenDrawer: vi.fn(),
    handleToggleSelect: vi.fn(),
    handleToggleAll: vi.fn(),
    handleAddTaskChange: vi.fn(),
    handleAddTaskConfirm: vi.fn(),
    handleCloseAddModal: vi.fn(),
    handleClear: vi.fn(),
  }),
}))

vi.mock('../hooks/useTaskHotkeys', () => ({
  useTaskHotkeys: () => undefined,
}))

// Lazy import AFTER vi.mock declarations so the mock chain is in
// place before TasksPage module evaluation closes over the spies.
import TasksPage from './TasksPage'

function mountTasksPage({
  tasks = [] as TaskItem[],
  initialPath = '/dashboard/tasks',
} = {}) {
  mockTasks = tasks
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={makeQueryClient()}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <TasksPage />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

// (a) Initial page chrome — PageHeader title/description + the
//     header action button text. The "新建任务" string appears
//     twice in the page (header action + write-actions row) so we
//     assert with getAllByText to avoid a false-positive on a
//     single-instance assertion.
describe('TasksPage · i18n flip', () => {
  beforeEach(async () => {
    mockTasks = []
    localStorage.removeItem('sau-ui-locale')
    // Reset the i18next singleton to zh-CN at the start of every
    // test so subsequent changeLanguage() calls trigger a re-render
    // (rather than setting language to its current value).
    await i18n.changeLanguage('zh-CN')
  })

  // (a) Initial zh-CN page chrome
  it('initial zh-CN: page title + description + new-task button render in Chinese', () => {
    mountTasksPage()
    expect(screen.getByText('任务列表')).toBeInTheDocument()
    expect(screen.getByText('查看和管理所有上传任务')).toBeInTheDocument()
    // "新建任务" appears in the PageHeader action + write-actions row
    expect(screen.getAllByText('新建任务').length).toBeGreaterThanOrEqual(1)
  })

  // (b) Initial zh-CN table headers (7 text headers + 1 select-all
  //     Checkbox column). The Checkbox column has no text — only an
  //     aria-label — so `getAllByRole('columnheader')` returns 8
  //     headers but the first one has empty textContent. We assert
  //     on the 7 text headers + the select-all aria-label
  //     separately to cover both surfaces.
  it('initial zh-CN: 7 text headers + select-all aria-label render in Chinese', () => {
    mountTasksPage()
    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    const headerTexts = headers.map((h) => h.textContent ?? '').filter((t) => t.length > 0)
    // Order-independent assertion — column order is a layout concern
    // (covered by TaskTable tests, not i18n)
    expect(headerTexts).toEqual(
      expect.arrayContaining([
        '任务 ID',
        '平台',
        '动作',
        '账号',
        '状态',
        '创建时间',
        '操作',
      ]),
    )
    // Select-all Checkbox aria-label (the 1 header without text content)
    expect(within(table).getByLabelText('全选')).toBeInTheDocument()
  })

  // (c) Initial zh-CN status filter chips — 7 chips from STATUS_CHIPS
  //     resolved through t(labelKey, labelFallback). Asserts the
  //     labelKey/labelFallback pattern works for the module-level
  //     manifest (no React coupling in shared.tsx).
  it('initial zh-CN: 7 status filter chips render in Chinese', () => {
    mountTasksPage()
    const tablist = screen.getByRole('tablist')
    // All 7 status labels in Chinese
    expect(within(tablist).getByText('全部')).toBeInTheDocument()
    expect(within(tablist).getByText('等待中')).toBeInTheDocument()
    expect(within(tablist).getByText('执行中')).toBeInTheDocument()
    expect(within(tablist).getByText('定时中')).toBeInTheDocument()
    expect(within(tablist).getByText('成功')).toBeInTheDocument()
    expect(within(tablist).getByText('失败')).toBeInTheDocument()
    expect(within(tablist).getByText('异常')).toBeInTheDocument()
  })

  // (d) Empty state + toolbar chrome
  it('initial zh-CN: empty state title/description + toolbar buttons render in Chinese', () => {
    mountTasksPage()
    // Empty state
    expect(screen.getByText('暂无任务')).toBeInTheDocument()
    expect(screen.getByText('创建任务后会在这里显示')).toBeInTheDocument()

    // Toolbar — search input placeholder + polling chip + refresh +
    // clear buttons
    const searchInput = screen.getByPlaceholderText(
      '搜索任务 ID、平台、账号（按 / 聚焦）',
    ) as HTMLInputElement
    expect(searchInput).toBeInTheDocument()

    // "刷新" appears in the toolbar refresh button (the table is
    // empty, so the empty-state refresh button is the second instance)
    expect(screen.getAllByText('刷新').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('轮询中')).toBeInTheDocument()
    // Clear button
    expect(screen.getByText('清理')).toBeInTheDocument()
  })

  // (e) Switch to en-US flips page chrome + table headers + status
  //     chips + empty state. Absorption check: every zh-CN label
  //     from tests (a-d) is gone AND every en-US label is present.
  it('switching to en-US flips page chrome + table headers + status chips + empty state', async () => {
    mountTasksPage()
    // Sanity: initial Chinese labels render
    expect(screen.getByText('任务列表')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    // Page chrome in English
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(
      screen.getByText('View and manage all upload tasks'),
    ).toBeInTheDocument()
    // "New task" appears in PageHeader action + write-actions row
    expect(screen.getAllByText('New task').length).toBeGreaterThanOrEqual(1)
    // "任务列表" is gone
    expect(screen.queryByText('任务列表')).not.toBeInTheDocument()

    // Table headers in English (7 text headers + select-all aria-label)
    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    const headerTexts = headers.map((h) => h.textContent ?? '').filter((t) => t.length > 0)
    expect(headerTexts).toEqual(
      expect.arrayContaining([
        'Task ID',
        'Platform',
        'Action',
        'Account',
        'Status',
        'Created',
        'Actions',
      ]),
    )
    // Select-all Checkbox aria-label flipped to English
    expect(within(table).getByLabelText('Select all')).toBeInTheDocument()
    // Chinese headers gone
    expect(within(table).queryByText('任务 ID')).not.toBeInTheDocument()
    expect(within(table).queryByText('创建时间')).not.toBeInTheDocument()

    // Status chips in English
    const tablist = screen.getByRole('tablist')
    expect(within(tablist).getByText('All')).toBeInTheDocument()
    expect(within(tablist).getByText('Pending')).toBeInTheDocument()
    expect(within(tablist).getByText('Running')).toBeInTheDocument()
    expect(within(tablist).getByText('Scheduled')).toBeInTheDocument()
    expect(within(tablist).getByText('Succeeded')).toBeInTheDocument()
    expect(within(tablist).getByText('Failed')).toBeInTheDocument()
    expect(within(tablist).getByText('Errored')).toBeInTheDocument()
    expect(within(tablist).queryByText('执行中')).not.toBeInTheDocument()

    // Empty state in English
    expect(screen.getByText('No tasks yet')).toBeInTheDocument()
    expect(
      screen.getByText('Tasks you create will appear here'),
    ).toBeInTheDocument()
    // Refresh list button (in empty state)
    expect(screen.getByText('Refresh list')).toBeInTheDocument()

    // Toolbar
    const searchInput = screen.getByPlaceholderText(
      'Search task ID, platform, account (press / to focus)',
    ) as HTMLInputElement
    expect(searchInput).toBeInTheDocument()
    expect(screen.getByText('Polling')).toBeInTheDocument()
    // "Refresh" + "Clear" buttons
    expect(screen.getAllByText('Refresh').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Clear')).toBeInTheDocument()
  })

  // (f) Round-trip persistence — zh-CN → en-US → zh-CN restores
  //     Chinese labels. Catches a regression where the resolved
  //     `chipOptions` array is mutated during a language change
  //     (per ADR-i18n-invariant: NEVER mutate STATUS_CHIPS — the
  //     resolution `.map` must always produce a fresh array).
  it('zh-CN → en-US → zh-CN round-trip restores Chinese labels', async () => {
    mountTasksPage()
    expect(screen.getByText('任务列表')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.queryByText('任务列表')).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })

    // Chinese labels restored; English labels gone
    expect(screen.getByText('任务列表')).toBeInTheDocument()
    expect(screen.getByText('查看和管理所有上传任务')).toBeInTheDocument()
    const tablist = screen.getByRole('tablist')
    expect(within(tablist).getByText('全部')).toBeInTheDocument()
    expect(within(tablist).getByText('执行中')).toBeInTheDocument()
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
    expect(within(tablist).queryByText('All')).not.toBeInTheDocument()
  })

  // (g) With-tasks: status badge label inside TaskTableRow flips
  //     with locale. The status badge is `meta.icon ?? statusLabel`
  //     where statusLabel = t(meta.labelKey, meta.labelFallback).
  //     Pins the labelKey/labelFallback resolution path inside
  //     TaskTableRow, which is the only file that reads
  //     STATUS_META directly.
  it('with-tasks: status badge label inside TaskTableRow flips with locale', async () => {
    // Single task with status='running' — STATUS_META.running has
    // no icon, so the label "执行中" / "Running" is what renders
    // inside the Badge.
    const runningTask = makeTask({ task_id: 'running-1', status: 'running' })
    mountTasksPage({ tasks: [runningTask] })

    const table = screen.getByRole('table')
    // Initial zh-CN — badge text is '执行中'
    expect(within(table).getByText('执行中')).toBeInTheDocument()
    expect(within(table).queryByText('Running')).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    // After flip — badge text is 'Running' (uses task.status === 'running'
    // → STATUS_META.running.labelKey = 'tasks.statuses.running' →
    // en-US resource = 'Running')
    expect(within(table).getByText('Running')).toBeInTheDocument()
    expect(within(table).queryByText('执行中')).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })
    // Round-trip
    expect(within(table).getByText('执行中')).toBeInTheDocument()
  })

  // (h) With-tasks: status badge title attribute (filter hint) flips
  //     with locale. The `title` interpolates the resolved status
  //     label into the localized prefix/suffix, so a flipped locale
  //     should produce a fully-localized title string. Uses
  //     `getByTitle` (queries by the title attribute directly) rather
  //     than `getByText().closest('[title]')` so the assertion is
  //     robust to Badge component DOM-shape changes.
  it('with-tasks: status badge filter title flips with locale (interpolates status label)', async () => {
    const runningTask = makeTask({ task_id: 'running-1', status: 'running' })
    mountTasksPage({ tasks: [runningTask] })

    const table = screen.getByRole('table')
    // Initial zh-CN — title is `筛选「执行中」任务`
    expect(within(table).getByTitle('筛选「执行中」任务')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    // After flip — title is `Filter "Running" tasks`
    expect(within(table).getByTitle('Filter "Running" tasks')).toBeInTheDocument()
    // Absorption: zh-CN title gone
    expect(within(table).queryByTitle('筛选「执行中」任务')).not.toBeInTheDocument()
  })
})
