import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DeleteApiKeyConfirm,
  type DeleteApiKeyTarget,
} from './DeleteApiKeyConfirm'

// ── Minimal test surface for the migrated confirm tab ──────────────
//
// Round-OPT-prefs-dialog v6 (slice replication): locks the 3
// description branches ('all' / 'single' / 'history') + the onConfirm
// callback dispatch + the onOpenChange wiring. We do NOT exercise
// the pointer-down / click-outside close path because happy-dom 15.x
// crashes `@radix-ui/react-alert-dialog`'s dismissable-layer with
// `Cannot read properties of null (reading 'addEventListener')` —
// the same known limitation documented at the top of
// `PreferencesDialog.test.tsx`'s NOTE block. (Escape + close-button
// paths are the canonical regression shield; production reads
// AlertDialog's native pointer-down handling.)
// ────────────────────────────────────────────────────────────────────

describe('DeleteApiKeyConfirm · round-OPT-prefs-dialog v6', () => {
  it('does NOT render when target=null (closed by default)', () => {
    render(<DeleteApiKeyConfirm target={null} onOpenChange={() => {}} onConfirm={() => {}} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('renders "all API Keys" copy when target.type === "all"', () => {
    const target: DeleteApiKeyTarget = { type: 'all' }
    render(<DeleteApiKeyConfirm target={target} onOpenChange={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText('确认删除')).toBeInTheDocument()
    expect(screen.getByText(/确定要删除全部 API Key/)).toBeInTheDocument()
    expect(screen.getByText(/删除后将无法使用 AI 功能/)).toBeInTheDocument()
  })

  it('renders "single API Key" copy when target.type === "single"', () => {
    const target: DeleteApiKeyTarget = { type: 'single', id: 42 }
    render(<DeleteApiKeyConfirm target={target} onOpenChange={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText('确认删除')).toBeInTheDocument()
    expect(screen.getByText('确定要删除这个 API Key 吗？')).toBeInTheDocument()
  })

  it('renders "history entry" copy when target.type === "history"', () => {
    const target: DeleteApiKeyTarget = { type: 'history', id: 'entry-1' }
    render(<DeleteApiKeyConfirm target={target} onOpenChange={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText('确认删除')).toBeInTheDocument()
    expect(screen.getByText('确定要删除这条历史记录吗？')).toBeInTheDocument()
  })

  it('clicking the 确认 button invokes onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const target: DeleteApiKeyTarget = { type: 'single', id: 1 }
    const user = userEvent.setup()
    render(<DeleteApiKeyConfirm target={target} onOpenChange={() => {}} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('clicking the 取消 button forwards onOpenChange(false)', async () => {
    const onOpenChange = vi.fn()
    const target: DeleteApiKeyTarget = { type: 'all' }
    const user = userEvent.setup()
    render(<DeleteApiKeyConfirm target={target} onOpenChange={onOpenChange} onConfirm={() => {}} />)
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
