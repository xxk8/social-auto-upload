import { describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render as rtlRender,
  type RenderOptions,
} from '@testing-library/react'
import { Profiler, type ComponentProps, type HTMLAttributes, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

// TaskTableRow calls useNavigate() inside its source. Vitest's bare
// `render()` doesn't provide a Router context, so we wrap every render
// through this local helper that injects a `<MemoryRouter key="render-root">`
// around the test JSX. Tests that bypass `renderRow` (the few direct
// `<TaskTableRow .../>` sites below) route through this helper
// automatically. TaskDrawer tests get the same coverage via the central
// `<MemoryRouter>` added to `TestProviders`.
//
// `key="render-root"` is explicit (vs. relying on positional inference)
// so React's reconciler deterministically reuses the same component slot
// across `render()` and the wrapped `rerender()` below — the persistent
// Router context is what stops useNavigate() from throwing on the second
// render.
//
// We ALSO wrap the resulting `rerender` so the memo-stability tests
// below (`rerender(<Profiler><TaskTableRow .../></Profiler>)`) keep the
// same MemoryRouter ancestor across the second render. Without the
// wrapped rerender, RTL's internal rerender replaces the container's
// root content (without the wrapper), which unmounts the existing Router
// context and re-throws `useNavigate() may be used only in the context
// of a <Router> component` on the second render.
//
// TODO: promote `renderWithRouter` to `src/test/render-harness.helpers.ts`
// once a second test file needs it — DRY the wrapper out.
function render(ui: React.ReactNode, options?: RenderOptions) {
  const result = rtlRender(
    <MemoryRouter key="render-root">{ui}</MemoryRouter>,
    options,
  )
  return {
    ...result,
    rerender(nextUi: React.ReactNode) {
      result.rerender(<MemoryRouter key="render-root">{nextUi}</MemoryRouter>)
    },
  }
}

// ── shared mock prop shapes ────────────────────────────────────
//
// The vi.mock factory below builds Radix-style wrappers that forward
// every intrinsic DOM prop to a <* data-tag="..."> shell. `MockProps`
// covers HTMLAttributes + children + a permissive index signature so
// data-* / aria-* flow through `{...rest}` without dropping. Sub-types
// layer Radix-specific callbacks (Button's disabled, Checkbox's
// onCheckedChange) on top, each opened only where the corresponding
// vi.mock component would otherwise need its own `any`.
type MockProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode
  [key: string]: unknown
}
type MockButtonProps = MockProps & { disabled?: boolean }
type MockCheckboxProps = MockProps & {
  checked?: boolean | 'indeterminate'
  onCheckedChange?: (checked: boolean) => void
}
type TaskTableRowProps = ComponentProps<typeof TaskTableRow>

vi.mock('@/Components/ui/index', () => {
  return {
    AlertDialog: ({ children }: MockProps) => <>{children}</>,
    AlertDialogAction: ({ children, onClick }: MockProps) => (
      <button data-tag="alert-action" onClick={onClick}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: MockProps) => <button data-tag="alert-cancel">{children}</button>,
    AlertDialogContent: ({ children }: MockProps) => <div data-tag="alert-content">{children}</div>,
    AlertDialogDescription: ({ children }: MockProps) => <div data-tag="alert-desc">{children}</div>,
    AlertDialogFooter: ({ children }: MockProps) => <div data-tag="alert-footer">{children}</div>,
    AlertDialogHeader: ({ children }: MockProps) => <div data-tag="alert-header">{children}</div>,
    AlertDialogTitle: ({ children }: MockProps) => <div data-tag="alert-title">{children}</div>,
    AlertDialogTrigger: ({ children }: MockProps) => <>{children}</>,
    Badge: ({ children, variant, ...rest }: MockProps) => (
      <span data-tag="badge" data-variant={variant} {...rest}>
        {children}
      </span>
    ),
    Button: ({ children, onClick, disabled, ...rest }: MockButtonProps) => (
      <button onClick={onClick} disabled={disabled} {...rest}>
        {children}
      </button>
    ),
    Checkbox: ({ checked, onCheckedChange, ...rest }: MockCheckboxProps) => (
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...rest}
      />
    ),
    Skeleton: ({ className }: MockProps) => <div data-tag="skeleton" className={className} />,
    TableCell: ({ children, className }: MockProps) => (
      <td data-tag="td" className={className}>
        {children}
      </td>
    ),
    TableRow: ({ children, className }: MockProps) => (
      <tr data-tag="tr" className={className}>
        {children}
      </tr>
    ),
    Tooltip: ({ children }: MockProps) => <>{children}</>,
    TooltipContent: ({ children }: MockProps) => <span data-tag="tooltip">{children}</span>,
    TooltipTrigger: ({ children }: MockProps) => <>{children}</>,
  }
})

import { TaskTableRow } from './TaskTableRow'
import { makeTask } from '@/test/fixtures'
import {
  makeProfilerCounter,
  type ProfilerCounter,
} from '@/test/render-harness.helpers'
import type { TaskItem } from '../../api/client'

function renderRow(
  taskOverrides: Partial<TaskItem> = {},
  propOverrides: Partial<Omit<TaskTableRowProps, 'task'>> = {},
  innerCounter?: ProfilerCounter,
) {
  const task = makeTask(taskOverrides)
  const onToggle = propOverrides.onToggle ?? vi.fn()
  const onOpenDrawer = propOverrides.onOpenDrawer ?? vi.fn()
  const onRetry = propOverrides.onRetry ?? vi.fn()
  const onDelete = propOverrides.onDelete ?? vi.fn()
  const onStatusFilter = propOverrides.onStatusFilter ?? vi.fn()

  const node = innerCounter ? (
    <Profiler id="row" onRender={(_, phase) => innerCounter.phases.push(phase as string)}>
      <TaskTableRow
        task={task}
        selected={propOverrides.selected ?? false}
        onToggle={onToggle}
        onOpenDrawer={onOpenDrawer}
        onRetry={onRetry}
        onDelete={onDelete}
        onStatusFilter={onStatusFilter}
        retrying={propOverrides.retrying ?? null}
      />
    </Profiler>
  ) : (
    <TaskTableRow
      task={task}
      selected={propOverrides.selected ?? false}
      onToggle={onToggle}
      onOpenDrawer={onOpenDrawer}
      onRetry={onRetry}
      onDelete={onDelete}
      onStatusFilter={onStatusFilter}
      retrying={propOverrides.retrying ?? null}
    />
  )

  return render(node)
}

describe('TaskTableRow — display + callbacks', () => {
  it('renders the task short id and metadata', () => {
    const task = makeTask({
      task_id: 'abcdef1234567890xyz',
      platform: 'douyin',
      action: 'upload-video',
      account: '主号',
      status: 'running',
    })
    const { container } = render(
      <TaskTableRow
        task={task}
        selected={false}
        onToggle={vi.fn()}
        onOpenDrawer={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onStatusFilter={vi.fn()}
        retrying={null}
      />,
    )
    expect(container.textContent).toContain('douyin')
    expect(container.textContent).toContain('upload-video')
    expect(container.textContent).toContain('主号')
  })

  it('status badge uses STATUS_META label for the running status', () => {
    const { container } = renderRow({ status: 'running' })
    // running -> '执行中' (per STATUS_META in shared.ts)
    expect(container.querySelector('[data-tag="badge"]')?.textContent).toMatch(/执行|运行|running/i)
  })

  it('clicking the status badge calls onStatusFilter with the status', () => {
    const onStatusFilter = vi.fn()
    const { container } = renderRow({ status: 'failed' }, { onStatusFilter })
    const badge = container.querySelector('[data-tag="badge"]') as HTMLElement
    fireEvent.click(badge)
    expect(onStatusFilter).toHaveBeenCalledTimes(1)
    expect(onStatusFilter).toHaveBeenCalledWith('failed')
  })

  it('clicking 详情 calls onOpenDrawer with the task', () => {
    const onOpenDrawer = vi.fn()
    const { container } = renderRow({ status: 'running' }, { onOpenDrawer })
    const buttons = Array.from(container.querySelectorAll('button'))
    const detailBtn = buttons.find((b) => b.textContent?.includes('详情'))
    expect(detailBtn).toBeDefined()
    fireEvent.click(detailBtn!)
    expect(onOpenDrawer).toHaveBeenCalledTimes(1)
    // Argument must be the task object itself (the parent re-reads from cache)
    const calledWith = onOpenDrawer.mock.calls[0][0]
    expect(calledWith.task_id).toBeDefined()
    expect(calledWith.status).toBe('running')
  })

  it('clicking retry calls onRetry with the task when status is failed', () => {
    const onRetry = vi.fn()
    const { container } = renderRow({ status: 'failed' }, { onRetry })
    const buttons = Array.from(container.querySelectorAll('button'))
    // Retry button has aria-label="Retry task" per the implementation.
    const retry = buttons.find((b) =>
      b.getAttribute('aria-label') === 'Retry task',
    )
    expect(retry).toBeDefined()
    fireEvent.click(retry!)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0][0].status).toBe('failed')
  })

  it('retry button disabled when status is success', () => {
    // canRetry is true only for failed/error.
    const { container } = renderRow({ status: 'success' })
    const retry = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Retry task',
    )
    expect(retry).toBeDefined()
    expect(retry!.hasAttribute('disabled')).toBe(true)
  })

  it('checkbox toggle calls onToggle(taskId, checked)', () => {
    const onToggle = vi.fn()
    const task = makeTask({ task_id: 'toggle-task-1' })
    const { container } = render(
      <TaskTableRow
        task={task}
        selected={false}
        onToggle={onToggle}
        onOpenDrawer={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onStatusFilter={vi.fn()}
        retrying={null}
      />,
    )
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith('toggle-task-1', true)
  })

  it('delete confirmation: clicking the confirm button calls onDelete(taskId)', () => {
    const onDelete = vi.fn()
    const task = makeTask({ task_id: 'del-1', status: 'failed' })
    const { container } = render(
      <TaskTableRow
        task={task}
        selected={false}
        onToggle={vi.fn()}
        onOpenDrawer={vi.fn()}
        onRetry={vi.fn()}
        onDelete={onDelete}
        onStatusFilter={vi.fn()}
        retrying={null}
      />,
    )
    // The chain in the source: AlertDialog > AlertDialogTrigger (button) >
    // AlertDialogContent > AlertDialogAction (the actual confirm).
    // Our mocks render all of these as siblings, so both the trigger and
    // the confirm are in the tree. We click the AlertDialogAction (the
    // confirm) directly.
    const confirmBtn = container.querySelector(
      'button[data-tag="alert-action"]',
    ) as HTMLButtonElement
    expect(confirmBtn).toBeDefined()
    fireEvent.click(confirmBtn)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('del-1')
  })
})

describe('TaskTableRow — React.memo + prop stability', () => {
  it('memo HIT: rerender with same task ref + stable callbacks → no new commit', () => {
    const task = makeTask({ status: 'pending' })
    const onToggle = vi.fn()
    const onOpenDrawer = vi.fn()
    const onRetry = vi.fn()
    const onDelete = vi.fn()
    const onStatusFilter = vi.fn()
    const counter = makeProfilerCounter()

    const { rerender } = render(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={task}
          selected={false}
          onToggle={onToggle}
          onOpenDrawer={onOpenDrawer}
          onRetry={onRetry}
          onDelete={onDelete}
          onStatusFilter={onStatusFilter}
          retrying={null}
        />
      </Profiler>,
    )
    const baseline = counter.phases.length

    rerender(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={task} // SAME object reference
          selected={false}
          onToggle={onToggle}
          onOpenDrawer={onOpenDrawer}
          onRetry={onRetry}
          onDelete={onDelete}
          onStatusFilter={onStatusFilter}
          retrying={null}
        />
      </Profiler>,
    )

    expect(counter.phases.length).toBe(baseline)
  })

  it('memo MISS: a NEW task object with same content triggers a commit', () => {
    const taskA = makeTask({ status: 'pending' })
    const onToggle = vi.fn()
    const onOpenDrawer = vi.fn()
    const onRetry = vi.fn()
    const onDelete = vi.fn()
    const onStatusFilter = vi.fn()
    const counter = makeProfilerCounter()

    const { rerender } = render(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={taskA}
          selected={false}
          onToggle={onToggle}
          onOpenDrawer={onOpenDrawer}
          onRetry={onRetry}
          onDelete={onDelete}
          onStatusFilter={onStatusFilter}
          retrying={null}
        />
      </Profiler>,
    )
    const baseline = counter.phases.length

    // Same content but different object identity — TanStack Query rebuilds
    // task refs on each poll even when the underlying payload hasn't changed.
    const taskB = makeTask({ status: 'pending', task_id: taskA.task_id })
    rerender(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={taskB}
          selected={false}
          onToggle={onToggle}
          onOpenDrawer={onOpenDrawer}
          onRetry={onRetry}
          onDelete={onDelete}
          onStatusFilter={onStatusFilter}
          retrying={null}
        />
      </Profiler>,
    )

    expect(counter.phases.length).toBeGreaterThan(baseline)
  })

  it('memo MISS: callback identity churn cascades to refresh', () => {
    const task = makeTask({ status: 'pending' })
    const counter = makeProfilerCounter()

    const { rerender } = render(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={task}
          selected={false}
          onToggle={vi.fn()}
          onOpenDrawer={vi.fn()}
          onRetry={vi.fn()}
          onDelete={vi.fn()}
          onStatusFilter={vi.fn()}
          retrying={null}
        />
      </Profiler>,
    )
    const baseline = counter.phases.length

    rerender(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={task}
          selected={false}
          onToggle={vi.fn()} // fresh identity
          onOpenDrawer={vi.fn()}
          onRetry={vi.fn()}
          onDelete={vi.fn()}
          onStatusFilter={vi.fn()}
          retrying={null}
        />
      </Profiler>,
    )

    expect(counter.phases.length).toBeGreaterThan(baseline)
  })

  it('memo MISS when status actually changes', () => {
    const task = makeTask({ status: 'pending' })
    const onToggle = vi.fn()
    const onOpenDrawer = vi.fn()
    const onRetry = vi.fn()
    const onDelete = vi.fn()
    const onStatusFilter = vi.fn()
    const counter = makeProfilerCounter()

    const { rerender } = render(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={task}
          selected={false}
          onToggle={onToggle}
          onOpenDrawer={onOpenDrawer}
          onRetry={onRetry}
          onDelete={onDelete}
          onStatusFilter={onStatusFilter}
          retrying={null}
        />
      </Profiler>,
    )
    const baseline = counter.phases.length

    const updated = { ...task, status: 'running' }
    rerender(
      <Profiler id="row" onRender={(_, phase) => counter.phases.push(phase as string)}>
        <TaskTableRow
          task={updated}
          selected={false}
          onToggle={onToggle}
          onOpenDrawer={onOpenDrawer}
          onRetry={onRetry}
          onDelete={onDelete}
          onStatusFilter={onStatusFilter}
          retrying={null}
        />
      </Profiler>,
    )

    expect(counter.phases.length).toBeGreaterThan(baseline)
  })
})
