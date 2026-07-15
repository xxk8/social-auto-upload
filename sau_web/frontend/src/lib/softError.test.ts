import { describe, it, expect } from 'vitest'
import { resolveSoftPrompt, DEFAULT_FALLBACK_MESSAGE } from './softError'

describe('resolveSoftPrompt', () => {
  // ── Tier 1 — idempotent 409-add (verb-driven) ───────────────────────

  it('409 + verb=add → info (Account Groups create, License activate, AI key save)', () => {
    const r = resolveSoftPrompt('已被其他用户使用', '激活失败', { status: 409, verb: 'add' })
    expect(r.tone).toBe('info')
    expect(r.message).toBe('已被其他用户使用')
  })

  it('409 + verb=update → info (Account Groups rename)', () => {
    const r = resolveSoftPrompt('分组名已存在', '重命名失败', { status: 409, verb: 'update' })
    expect(r.tone).toBe('info')
    expect(r.message).toBe('分组名已存在')
  })

  // ── Tier 1 — message-driven fallback ─────────────────────────────────

  it('409 + "Platform \'X\' already authorized" → info (regex fallback)', () => {
    const r = resolveSoftPrompt("Platform 'douyin' already authorized", '授权失败', { status: 409 })
    expect(r.tone).toBe('info')
  })

  it('409 + 中文 "该 Key 已经添加过了" → info', () => {
    const r = resolveSoftPrompt('该 Key 已经添加过了。', '保存失败', { status: 409 })
    expect(r.tone).toBe('info')
  })

  // ── Tier 2 — stale-cache 404-delete ──────────────────────────────────

  it('404 + verb=delete → info (Group/Task/Template/Inbox already-gone)', () => {
    const r = resolveSoftPrompt('Group not found', '删除失败', { status: 404, verb: 'delete' })
    expect(r.tone).toBe('info')
  })

  it('404 + verb=update → error (404 not on a delete verb should stay hard)', () => {
    const r = resolveSoftPrompt('Template not found', '更新失败', { status: 404, verb: 'update' })
    expect(r.tone).toBe('error')
  })

  // ── Tier 3 — 409 state-conflict ─────────────────────────────────────

  it('409 + "Can only reschedule pending tasks" → warning', () => {
    const r = resolveSoftPrompt('Can only reschedule pending tasks', '改期失败', { status: 409, verb: 'action' })
    expect(r.tone).toBe('warning')
  })

  it('409 + "Can only copy pending/scheduled tasks" → warning', () => {
    const r = resolveSoftPrompt('Can only copy pending/scheduled tasks', '复制失败', { status: 409, verb: 'action' })
    expect(r.tone).toBe('warning')
  })

  // ── Edge cases ──────────────────────────────────────────────────────

  it('400 + validation message → error (real validation, must stay hard)', () => {
    const r = resolveSoftPrompt('platform and account are required', '保存失败', { status: 400 })
    expect(r.tone).toBe('error')
  })

  it('null backend message + 409+verb=add → info + uses fallback message', () => {
    const r = resolveSoftPrompt(null, '创建失败', { status: 409, verb: 'add' })
    expect(r.tone).toBe('info')
    expect(r.message).toBe('创建失败')
  })

  it('empty string backend message → uses fallback', () => {
    const r = resolveSoftPrompt('', '创建失败', { status: 409, verb: 'add' })
    expect(r.message).toBe('创建失败')
    expect(r.tone).toBe('info')
  })

  it('whitespace-only backend message → uses fallback', () => {
    const r = resolveSoftPrompt('   ', '创建失败', { status: 409, verb: 'add' })
    expect(r.message).toBe('创建失败')
  })

  it('no context (no status, no verb) + non-matching message → default error', () => {
    const r = resolveSoftPrompt('something completely unrelated', 'fallback')
    expect(r.tone).toBe('error')
  })

  // ── Defensive contract: message is always non-empty ──────────────────
  // Locks against the str_replace char-substitution bug that bit the v1
  // defensive assertions (CJK literals were rewritten to non-canonical
  // glyphs by tooling). Importing `DEFAULT_FALLBACK_MESSAGE` from the
  // source file means the test follows the ships-byte-for-byte.

  it('empty + whitespace-only inputs → defaults to DEFAULT_FALLBACK_MESSAGE', () => {
    const r1 = resolveSoftPrompt('', '', { status: 409, verb: 'add' })
    expect(r1.message).toBe(DEFAULT_FALLBACK_MESSAGE)
    expect(r1.tone).toBe('info')
    const r2 = resolveSoftPrompt('   ', '   ', { status: 409, verb: 'add' })
    expect(r2.message).toBe(DEFAULT_FALLBACK_MESSAGE)
    expect(r2.tone).toBe('info')
  })
})
