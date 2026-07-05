import { describe, it, expect, beforeEach } from 'vitest'
import { usePublishWizardStore } from './publishWizardStore'

/**
 * Regression suite — locks in the post-Path-C tag-array helper contract
 * AND the memoization invariant that motivated the refactor.
 *
 * Path C: `content.tags: string[]` natively. The wire-format string
 * (`'.join(',')`) only exists at the HTTP boundary — see
 * `lib/tags::serializeTags`. Helpers operate on the array directly,
 * preserving reference identity when the normalized output equals
 * the current array (cheap shallow-array compare in `setTags`).
 */

function reset() {
  usePublishWizardStore.getState().reset()
}

beforeEach(() => reset())

describe('publishWizardStore · content.tags (post-Path-C string[] shape)', () => {
  describe('initial state', () => {
    it('starts as an empty array (not empty string)', () => {
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('initial array reference is stable across resets', () => {
      const a = usePublishWizardStore.getState().content.tags
      reset()
      const b = usePublishWizardStore.getState().content.tags
      // Empty array literal stays consistent — strict equality is OK.
      expect(a).toBe(b)
    })
  })

  describe('setContent({ tags }) — accepts string[] AND legacy string', () => {
    it('passes string[] through cleanly', () => {
      usePublishWizardStore.getState().setContent({ tags: ['#foo', '#bar'] })
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo', '#bar'])
    })

    it('parses legacy comma-joined string wire form', () => {
      usePublishWizardStore.getState().setContent({ tags: '#foo,#bar' })
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo', '#bar'])
    })

    it('parses legacy full-width comma 「，」 wire form', () => {
      usePublishWizardStore.getState().setContent({ tags: '#foo，#bar，#baz' })
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo', '#bar', '#baz'])
    })

    it('drops empty tokens from legacy mixed string', () => {
      usePublishWizardStore.getState().setContent({ tags: '#foo,  ,#bar,,' })
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo', '#bar'])
    })

    it('setContent({ tags: [] }) clears', () => {
      usePublishWizardStore.getState().addTag('foo')
      usePublishWizardStore.getState().setContent({ tags: [] })
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('setContent({ tags: [""] }) clears (parsed empty)', () => {
      usePublishWizardStore.getState().addTag('foo')
      usePublishWizardStore.getState().setContent({ tags: '' })
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })
  })

  describe('addTag() idempotency', () => {
    it('inserts at end if not present', () => {
      usePublishWizardStore.getState().addTag('foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo'])
    })

    it('treats "foo" and "#foo" identically (canonical-hash collapse)', () => {
      const s = usePublishWizardStore.getState()
      s.addTag('foo')
      s.addTag('#foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo'])
    })

    it('strips leading whitespace / commas / hashes', () => {
      usePublishWizardStore.getState().addTag('  ##foo,,  ')
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo'])
    })

    it('no-op on empty / whitespace / hash-only / pure-comma input', () => {
      const s = usePublishWizardStore.getState()
      s.addTag('')
      s.addTag('   ')
      s.addTag('#')
      s.addTag('#, ,')
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('preserves insertion order', () => {
      const s = usePublishWizardStore.getState()
      s.addTag('foo')
      s.addTag('bar')
      s.addTag('foo') // dup — should be skipped
      s.addTag('baz')
      s.addTag('qux')
      expect(usePublishWizardStore.getState().content.tags).toEqual([
        '#foo',
        '#bar',
        '#baz',
        '#qux',
      ])
    })
  })

  describe('removeTag()', () => {
    it('removes a present tag', () => {
      const s = usePublishWizardStore.getState()
      s.addTag('foo')
      s.addTag('bar')
      s.removeTag('foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#bar'])
    })

    it('no-op on a missing tag', () => {
      const s = usePublishWizardStore.getState()
      s.addTag('foo')
      s.removeTag('bar')
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo'])
    })

    it('canonical-hash collapse: removeTag("#foo") matches a tag stored from "foo"', () => {
      const s = usePublishWizardStore.getState()
      s.addTag('foo')
      s.removeTag('#foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('no-op on empty / whitespace / hash input', () => {
      const s = usePublishWizardStore.getState()
      s.addTag('foo')
      s.removeTag('')
      s.removeTag('   ')
      s.removeTag('#')
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo'])
    })
  })

  describe('toggleTag()', () => {
    it('adds when missing, removes when present', () => {
      const s = usePublishWizardStore.getState()
      s.toggleTag('foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo'])
      s.toggleTag('foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('"foo" then "#foo" → empty (canonical pair collapse)', () => {
      const s = usePublishWizardStore.getState()
      s.toggleTag('foo')
      s.toggleTag('#foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('"#foo" then "foo" → empty (canonical pair collapse, reverse)', () => {
      const s = usePublishWizardStore.getState()
      s.toggleTag('#foo')
      s.toggleTag('foo')
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('no-op on empty input', () => {
      const s = usePublishWizardStore.getState()
      s.toggleTag('')
      s.toggleTag('   ')
      s.toggleTag('#')
      s.toggleTag('#, ,')
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })
  })

  describe('setTags() bulk writes', () => {
    it('normalizes and de-dupes a mixed array', () => {
      usePublishWizardStore
        .getState()
        .setTags(['#foo', 'foo', '#bar', 'bar'])
      expect(usePublishWizardStore.getState().content.tags).toEqual(['#foo', '#bar'])
    })

    it('drops empty / hash-only / whitespace / pure-comma tokens', () => {
      usePublishWizardStore
        .getState()
        .setTags(['', '   ', '#', '#,#', '  ##'])
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('setTags([]) → empty array', () => {
      usePublishWizardStore.getState().addTag('foo')
      usePublishWizardStore.getState().setTags([])
      expect(usePublishWizardStore.getState().content.tags).toEqual([])
    })

    it('round-trip: setTags([...]) reads back via store reference', () => {
      const arr = ['#foo', '#bar', '#baz']
      usePublishWizardStore.getState().setTags(arr)
      const after = usePublishWizardStore.getState().content.tags
      expect(after).toEqual(arr)
    })
  })

  describe('memoization invariant (the whole point of Path C)', () => {
    it('content.tags reference is stable across unrelated title edits', () => {
      const before = usePublishWizardStore.getState().content.tags
      usePublishWizardStore.getState().setContent({ title: 'hello' })
      const after = usePublishWizardStore.getState().content.tags
      expect(after).toBe(before) // strict ref equality — Zustand re-renders ignored
    })

    it('content.tags reference is stable across desc / note edits', () => {
      const before = usePublishWizardStore.getState().content.tags
      usePublishWizardStore.getState().setContent({ desc: 'a' })
      usePublishWizardStore.getState().setContent({ note: 'b' })
      usePublishWizardStore.getState().setContent({ schedule: '2026-12-31' })
      const after = usePublishWizardStore.getState().content.tags
      expect(after).toBe(before)
    })

    it('content.tags reference changes when addTag mutates the array', () => {
      const before = usePublishWizardStore.getState().content.tags
      usePublishWizardStore.getState().addTag('foo')
      const after = usePublishWizardStore.getState().content.tags
      expect(after).not.toBe(before)
    })

    it('addTag of an already-present tag does NOT change reference (dedupe short-circuit)', () => {
      usePublishWizardStore.getState().addTag('foo')
      const before = usePublishWizardStore.getState().content.tags
      usePublishWizardStore.getState().addTag('foo')
      const after = usePublishWizardStore.getState().content.tags
      expect(after).toBe(before)
    })

    it('addTag of canonical-equivalent does NOT change reference', () => {
      usePublishWizardStore.getState().addTag('foo')
      const before = usePublishWizardStore.getState().content.tags
      usePublishWizardStore.getState().addTag('#foo')
      const after = usePublishWizardStore.getState().content.tags
      expect(after).toBe(before)
    })

    it('setTags with same normalized content does NOT change reference', () => {
      usePublishWizardStore.getState().setTags(['#foo', '#bar'])
      const before = usePublishWizardStore.getState().content.tags
      usePublishWizardStore.getState().setTags(['#foo', '#bar'])
      const after = usePublishWizardStore.getState().content.tags
      expect(after).toBe(before)
    })

    it('addTag + single toggleTag round-trips back to original empty state', () => {
      // Original behavior assertion: `addTag('foo')` puts `#foo` in the
      // array; the very next `toggleTag('foo')` inverts (it's present,
      // so remove). One pair → original empty state. (Earlier draft
      // wrote *two* toggles expecting to land on empty, but two
      // toggles cancel the first removal — that's where the v0 draft
      // regressed.) Test keeps the deep-equal contract; reference
      // identity is not asserted because parseTags([]) may allocate
      // a fresh `[]` literal per call, which is acceptable.
      usePublishWizardStore.getState().addTag('foo')
      usePublishWizardStore.getState().toggleTag('foo')
      const finalState = usePublishWizardStore.getState().content.tags
      expect(finalState).toEqual([])
    })
  })
})
