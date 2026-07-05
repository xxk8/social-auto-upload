import { describe, expect, it } from 'vitest'
import {
  MAGIC_COMMANDS,
  MAGIC_HELP_TEXT,
  buildMagicCommandMessage,
  parseMagicCommand,
} from './magicCommands'

/**
 * Pure-parser unit tests. No DOM, no store — if these break the
 * invariant is in the parser alone.
 */
describe('parseMagicCommand', () => {
  it('parses bare /fullflow', () => {
    const r = parseMagicCommand('/fullflow')
    expect(r).toEqual({ kind: 'fullflow', topic: '' })
  })

  it('parses /fullflow with a topic', () => {
    const r = parseMagicCommand('/fullflow 美食探店')
    expect(r).toEqual({ kind: 'fullflow', topic: '美食探店' })
  })

  it('parses /enhance with text', () => {
    const r = parseMagicCommand('/enhance 写一段短视频开场')
    expect(r).toEqual({ kind: 'enhance', text: '写一段短视频开场' })
  })

  it('parses /variants with topic', () => {
    const r = parseMagicCommand('/variants 旅游攻略')
    expect(r).toEqual({ kind: 'variants', topic: '旅游攻略', search: false })
  })

  // ── /variants search opt-in grammar ──
  // The parser must accept BOTH the keyword form (`search <topic>`)
  // and the flag form (`--search[=true|false] <topic>`). The boolean
  // is mandatory on the variants variant — even the default-no-flag
  // case surfaces as `search: false` so consumers can pass it through
  // unconditionally without an optional-unwrap ceremony.

  it('opts into web search via the keyword form', () => {
    const r = parseMagicCommand('/variants search 美食探店')
    expect(r).toEqual({ kind: 'variants', topic: '美食探店', search: true })
  })

  it('opts into web search via the flag form', () => {
    const r = parseMagicCommand('/variants --search foodcaster')
    expect(r).toEqual({ kind: 'variants', topic: 'foodcaster', search: true })
  })

  it('opts into web search via the explicit flag', () => {
    const r = parseMagicCommand('/variants --search=true abc def')
    expect(r).toEqual({ kind: 'variants', topic: 'abc def', search: true })
  })

  it('opts OUT via explicit --search=false (rare, but supported)', () => {
    const r = parseMagicCommand('/variants --search=false 美食探店')
    expect(r).toEqual({ kind: 'variants', topic: '美食探店', search: false })
  })

  it('treats whitespace-only-after-flag as empty topic + flagged search', () => {
    const r = parseMagicCommand('/variants search')
    expect(r).toEqual({ kind: 'variants', topic: '', search: true })
  })

  it('preserves a multi-word topic verbatim', () => {
    const r = parseMagicCommand('/variants --search 北京 美食探店 攻略')
    expect(r).toEqual({ kind: 'variants', topic: '北京 美食探店 攻略', search: true })
  })

  it('is case-insensitive on the leading flag token', () => {
    const r = parseMagicCommand('/variants SEARCH 美食探店')
    expect(r).toEqual({ kind: 'variants', topic: '美食探店', search: true })
    const r2 = parseMagicCommand('/variants --Search=true 美食探店')
    expect(r2).toEqual({ kind: 'variants', topic: '美食探店', search: true })
  })

  it('MAGIC_HELP_TEXT mentions the new search opt-in', () => {
    expect(MAGIC_HELP_TEXT).toMatch(/\/variants\s+search|\/variants\s+--search/)
  })

  it('parses bare /apply and /clear and /help', () => {
    expect(parseMagicCommand('/apply')).toEqual({ kind: 'apply' })
    expect(parseMagicCommand('/clear')).toEqual({ kind: 'clear' })
    expect(parseMagicCommand('/help')).toEqual({ kind: 'help' })
  })

  it('parses unknown /magic tokens as a typed error', () => {
    const r = parseMagicCommand('/unicorn')
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.reason).toMatch(/未知命令/)
    }
  })

  it('parses non-/ input as a typed error', () => {
    const r = parseMagicCommand('hello')
    expect(r.kind).toBe('error')
  })

  it('treats uppercased tokens case-insensitively', () => {
    const r = parseMagicCommand('/FULLFLOW')
    expect(r).toEqual({ kind: 'fullflow', topic: '' })
  })

  it('keeps whitespace-collapsed topic', () => {
    const r = parseMagicCommand('/fullflow     美食探店 北京三天    ')
    expect(r).toEqual({ kind: 'fullflow', topic: '美食探店 北京三天' })
  })
})

describe('buildMagicCommandMessage', () => {
  it('marks every return as a system message', () => {
    for (const cmd of [
      parseMagicCommand('/fullflow'),
      parseMagicCommand('/help'),
      parseMagicCommand('/apply'),
      parseMagicCommand('/unicorn-bad'),
    ]) {
      const msg = buildMagicCommandMessage(cmd)
      expect(msg.role).toBe('system')
      expect(msg.id).toBeTruthy()
      expect(msg.createdAt).toBeGreaterThan(0)
    }
  })

  it('embeds the topic in /fullflow output', () => {
    const msg = buildMagicCommandMessage(parseMagicCommand('/fullflow 美食'))
    expect(msg.content).toMatch(/一键全流程/)
    expect(msg.content).toMatch(/美食/)
  })

  it('flags /variants search visibly in the announcement breadcrumb', () => {
    const withSearch = buildMagicCommandMessage(
      parseMagicCommand('/variants search 美食探店'),
    )
    expect(withSearch.content).toMatch(/启用联网/)
    expect(withSearch.content).toMatch(/美食探店/)

    const withoutSearch = buildMagicCommandMessage(
      parseMagicCommand('/variants 美食探店'),
    )
    expect(withoutSearch.content).not.toMatch(/启用联网/)
  })

  it('renders the help message exactly as MAGIC_HELP_TEXT', () => {
    const msg = buildMagicCommandMessage(parseMagicCommand('/help'))
    expect(msg.content).toBe(MAGIC_HELP_TEXT)
  })
})

describe('MAGIC_COMMANDS registry', () => {
  it('exposes the 6 registry entries aligned with the parser grammar', () => {
    expect(MAGIC_COMMANDS.map((c) => c.cmd)).toEqual([
      '/fullflow',
      '/variants',
      '/enhance',
      '/apply',
      '/clear',
      '/help',
    ])
  })

  it('every registry entry has a non-empty label and blurb', () => {
    for (const c of MAGIC_COMMANDS) {
      expect(c.cmd.startsWith('/')).toBe(true)
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.blurb.length).toBeGreaterThan(0)
    }
  })
})
