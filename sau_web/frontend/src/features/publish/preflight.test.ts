import { describe, it, expect } from 'vitest'
import {
  buildPublishPreflight,
  preflightHasBlocking,
  firstBlockingReason,
} from './preflight'
import type { GroupSelection } from './GroupPublishSelector'

const baseSelection = (mappings: GroupSelection['mappings']): GroupSelection => ({
  groupId: 1,
  groupName: '个人',
  platforms: mappings.map((m) => m.platform),
  mappings,
})

describe('buildPublishPreflight', () => {
  it('blocks when no platforms', () => {
    const items = buildPublishPreflight({
      mode: 'video',
      title: 'hello',
      hasMedia: true,
      groupSelection: null,
    })
    expect(preflightHasBlocking(items)).toBe(true)
    expect(firstBlockingReason(items)).toMatch(/平台/)
  })

  it('blocks empty title', () => {
    const items = buildPublishPreflight({
      mode: 'video',
      title: '   ',
      hasMedia: true,
      groupSelection: baseSelection([
        { platform: 'douyin', cookieFile: 'a.json', authId: 1, valid: true },
      ]),
    })
    expect(items.find((i) => i.id === 'title')?.severity).toBe('error')
  })

  it('blocks missing media', () => {
    const items = buildPublishPreflight({
      mode: 'note',
      title: 'title',
      hasMedia: false,
      groupSelection: baseSelection([
        { platform: 'xiaohongshu', cookieFile: 'a.json', authId: 1, valid: true },
      ]),
    })
    expect(items.find((i) => i.id === 'media')?.severity).toBe('error')
  })

  it('blocks invalid cookie', () => {
    const items = buildPublishPreflight({
      mode: 'video',
      title: 'ok title',
      hasMedia: true,
      groupSelection: baseSelection([
        { platform: 'douyin', cookieFile: 'a.json', authId: 1, valid: false },
        { platform: 'kuaishou', cookieFile: 'b.json', authId: 2, valid: true },
      ]),
    })
    expect(items.find((i) => i.id === 'cookie-invalid')?.severity).toBe('error')
    expect(preflightHasBlocking(items)).toBe(true)
  })

  it('warns on stale cookie without blocking', () => {
    const items = buildPublishPreflight({
      mode: 'video',
      title: 'ok title',
      hasMedia: true,
      groupSelection: baseSelection([
        { platform: 'douyin', cookieFile: 'a.json', authId: 1, valid: true, stale: true },
      ]),
    })
    expect(items.find((i) => i.id === 'cookie-stale')?.severity).toBe('warning')
    expect(preflightHasBlocking(items)).toBe(false)
  })

  it('all green path', () => {
    const items = buildPublishPreflight({
      mode: 'video',
      title: 'ok title',
      hasMedia: true,
      bodyLength: 20,
      groupSelection: baseSelection([
        { platform: 'douyin', cookieFile: 'a.json', authId: 1, valid: true, stale: false },
      ]),
    })
    expect(preflightHasBlocking(items)).toBe(false)
    expect(items.every((i) => i.severity === 'ok')).toBe(true)
  })
})
