// ──────────────────────────────────────────────────────────────────────────
// features/confirmDialog/tabs/BatchDeleteGroupConfirm.test.tsx
//
// Round-OPT-prefs-dialog v7 (dumb-component migration): test for the
// migrated `BatchDeleteGroupConfirm` dumb tab.
//
// The dialog body is decoupled from the accounts slice, so the test
// exercises the dumb behavior with synthetic props (no Provider
// mocks, no jsdom Redux tree):
//
//   • closed-when-open=false (body unflattens through ConfirmShell
//     stub)
//   • open-when-open=true shows the title from CONFIRM_COPY
//   • derived preview / hiddenCount / totalAuthCount / selectedCount
//     are computed from selectedIds + groups
//   • confirm button + Cmd/Ctrl+Enter both call onConfirm
//   • cancel / close-icon both call onOpenChange
//
// ConfirmShell is mocked to a render-props stub that re-emits the
// negotiated surface (open, onOpenChange, title, description,
// confirmLabel, onConfirm, variant, hotkeyConfirm) so assertions
// can read them directly. The shared shell's own behavior
// (Radix portal, focus trap, footer layout) is tested separately
// by ConfirmShell's own tests.
// ──────────────────────────────────────────────────────────────────────────

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  BatchDeleteGroupConfirm,
  type GroupSummary,
} from './BatchDeleteGroupConfirm'

// Stub ConfirmShell so we can read its negotiated surface directly.
// The stub is intentionally observable — assertions look up the
// captured props by querying the rendered stub element.
vi.mock('../shared/ConfirmShell', () => ({
  ConfirmShell: (props: Record<string, unknown>) => (
    <div
      data-testid="confirm-shell-stub"
      data-open={String(props.open)}
      data-variant={props.variant ?? 'default'}
      data-hotkey={String(Boolean(props.hotkeyConfirm))}
      data-title={typeof props.title === 'string' ? props.title : ''}
      data-confirm-label={
        typeof props.confirmLabel === 'string' ? props.confirmLabel : ''
      }
    >
      <button data-testid="trigger-confirm" onClick={() => (props.onConfirm as () => void)()}>
        confirm-stub
      </button>
      <button data-testid="trigger-cancel" onClick={() => (props.onOpenChange as (open: boolean) => void)(false)}>
        cancel-stub
      </button>
      <div data-testid="description-slot">{props.description as React.ReactNode}</div>
    </div>
  ),
}))

function makeGroup(id: string, name: string, authCount: number): GroupSummary {
  return {
    id,
    name,
    authorizations: new Array(authCount).fill({ platform: 'douyin' }),
  }
}

describe('BatchDeleteGroupConfirm', () => {
  it('renders the shell with `open=false` when caller passes closed state', () => {
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set()}
        groups={[]}
        open={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )
    const stub = screen.getByTestId('confirm-shell-stub')
    expect(stub.getAttribute('data-open')).toBe('false')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders the title from CONFIRM_COPY.deleteGroup', () => {
    // The outer file-top `vi.mock('../shared/ConfirmShell', ...)` is
    // the only effective mock — vitest hoists mocks at module-scope.
    // An inner `vi.doMock` would be dead code (the imported module
    // reference is already fixed). The data-title attribute already
    // asserts the title end-to-end.
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set()}
        groups={[]}
        open={true}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(
      screen.getByTestId('confirm-shell-stub').getAttribute('data-title'),
    ).toBe('确认批量删除')
  })

  it('opens with `variant="destructive"` + `hotkeyConfirm=true`', () => {
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set()}
        groups={[]}
        open={true}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    )
    const stub = screen.getByTestId('confirm-shell-stub')
    expect(stub.getAttribute('data-variant')).toBe('destructive')
    expect(stub.getAttribute('data-hotkey')).toBe('true')
  })

  it('derives preview list + hiddenCount tail from selectedIds + groups', () => {
    const groups: ReadonlyArray<GroupSummary> = [
      makeGroup('a', '小红书种草号', 2),
      makeGroup('b', '抖音主号', 5),
      makeGroup('c', '视频号矩阵', 1),
      makeGroup('d', 'B站小号', 0),
      makeGroup('e', '公众号', 4),
    ]
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set(['a', 'b', 'c', 'd', 'e'])}
        groups={groups}
        open={true}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    )
    const description = screen.getByTestId('description-slot')
    // Preview list shows first MAX_NAMES_SHOWN (3).
    expect(description.textContent).toContain('小红书种草号')
    expect(description.textContent).toContain('抖音主号')
    expect(description.textContent).toContain('视频号矩阵')
    // 4th + 5th group should NOT be in the preview list.
    expect(description.textContent).not.toContain('B站小号')
    expect(description.textContent).not.toContain('公众号')
    // Hidden tail shows overflow count (5 - 3 = 2).
    expect(description.textContent).toContain('…其它 2 个')
    // selectedCount + authCount (=2+5+1+0+4 = 12) inline.
    expect(description.textContent).toContain('5')
    expect(description.textContent).toContain('12')
  })

  it('handles zero authorizations with the `（暂无）` fallback copy', () => {
    const groups: ReadonlyArray<GroupSummary> = [
      makeGroup('a', '未授权小组', 0),
    ]
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set(['a'])}
        groups={groups}
        open={true}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    )
    const description = screen.getByTestId('description-slot')
    expect(description.textContent).toContain('所有关联平台授权（暂无）')
  })

  it('renders the dynamic confirm label "删除 N 个分组"', () => {
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set(['a', 'b'])}
        groups={[makeGroup('a', 'a', 1), makeGroup('b', 'b', 1)]}
        open={true}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    )
    const stub = screen.getByTestId('confirm-shell-stub')
    expect(stub.getAttribute('data-confirm-label')).toBe('删除 2 个分组')
  })

  it('clicking the confirm button calls onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set(['a'])}
        groups={[makeGroup('a', 'a', 0)]}
        open={true}
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByTestId('trigger-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('clicking the cancel button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set(['a'])}
        groups={[makeGroup('a', 'a', 0)]}
        open={true}
        onOpenChange={onOpenChange}
        onConfirm={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('trigger-cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // ── Note on the kbd shortcut: the original BatchDeleteDialog
  // attached a `keydown` handler to `<AlertDialogContent>`. The
  // dumb version delegates this to ConfirmShell's `hotkeyConfirm`
  // prop, which in the real-shell implementation wires the
  // handler onto the content element. The ConfirmShell's own
  // hotkey tests are the right place for the actual keypress
  // assertion; here we only verify the prop is forwarded.
  it('forwards hotkeyConfirm=true to ConfirmShell (regression: Cmd+Enter wiring)', () => {
    render(
      <BatchDeleteGroupConfirm
        selectedIds={new Set(['a'])}
        groups={[makeGroup('a', 'a', 0)]}
        open={true}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    )
    const stub = screen.getByTestId('confirm-shell-stub')
    expect(stub.getAttribute('data-hotkey')).toBe('true')
  })
})
