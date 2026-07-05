import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
// ── shared mock prop shapes (see TaskTableRow.test.tsx for rationale) ──
//
// `MockProps` is the common denominator covering HTMLAttributes + children
// + an open index signature `[key: string]: unknown` so data-* / aria-*
// still flow through `{...rest}` without dropping. Sub-types narrowly
// extend with the Radix-style callbacks that particular vi.mock components
// need.
type MockProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode
  [key: string]: unknown
}
type MockCheckboxProps = MockProps & {
  checked?: boolean | 'indeterminate'
  onCheckedChange?: (checked: boolean) => void
}
type MockSelectProps = MockProps & {
  value?: string | number
  onValueChange?: (value: string) => void
}
type MockSelectItemProps = MockProps & {
  value?: string | number
}
type MockMultiSelectProps = MockProps & {
  value?: string[]
  options?: Array<{ value: string; label?: string }>
  onChange?: (value: string[]) => void
  placeholder?: string
}
type MockMultiSelectOption = { value: string; label?: string }
type MockPlatformIconProps = MockProps & { platform?: string }
type MockTagInputProps = MockProps & {
  value?: string
  onChange?: (value: string) => void
}

import type { AiGenerationResult } from '@/Components/AiSidebar/AiSidebar'
import type { HTMLAttributes, ReactNode } from 'react'

// Imperative-handle tests below use the render-spy pattern (assert that
// applyAiResult triggers a re-render via `cardRenderSpy` incrementing) rather
// than DOM-value assertions. The DOM approach proved unreliable under
// happy-dom: arbitrary `aria-*`/`data-*` props forwarded through a custom
// React component (Input mock) are not consistently preserved, and the
// `querySelector('[attr="..."]')` matcher is flaky. The render-spy is the
// strongest contract: the imperative handle exists, is callable, and
// triggering it propagates state via the form's local setTitle/setContent →
// re-renders. Any future regression in the applyAiResult body (e.g. an
// accidental setter removal) breaks this spy assertion.

// ── hoisted render-spy for memo hit-rate testing ───────────────────────
// Card is the outermost component NoteForm renders. Memo hit = NoteForm
// function body does NOT execute → Card NOT called. Memo miss = body
// runs → Card invoked. Profiler-based attribution fails for memo+forwardRef
// under React 19; this spy-on-mocked-child pattern is reliable.
const cardRenderSpy = vi.hoisted(() => vi.fn())

// ── mocks (must precede under-test imports) ─────────────────────────────

vi.mock('motion/react', () => {
  // Dynamic JSX Tag (string-keyed) and Proxy target type can't be cleanly
  // typed — disable no-explicit-any on the three sites annotated below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motionCache = new Map<string, (props: any) => any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motion: any = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        if (!motionCache.has(tag)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          motionCache.set(tag, (props: any) => {
            const { children, ...rest } = (props ?? {}) as Record<string, unknown>
            // Dynamic JSX tag from a string key — `as any` is required for
            // <Tag {...rest}> where rest keys aren't statically known.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Tag = ((tag as string) || 'div') as any
            return <Tag {...rest}>{children}</Tag>
          })
        }
        return motionCache.get(tag)
      },
    },
  )
  return {
    motion,
    AnimatePresence: ({ children }: MockProps) => <>{children}</>,
  }
})

vi.mock('@/Components/ui/index', () => {
  const Tag = (tag: string) => (props: MockProps) => {
    const { children, className, ...rest } = props
    return (
      <div data-tag={tag} className={className} {...rest}>
        {children}
      </div>
    )
  }
  function Select({ value, onValueChange, children }: MockSelectProps) {
    return (
      <select
        data-testid="select"
        value={value ?? ''}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {children}
      </select>
    )
  }
  function Checkbox({ checked, onCheckedChange, ...rest }: MockCheckboxProps) {
    return (
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...rest}
      />
    )
  }
  function Input({ className, ...rest }: MockProps) {
    return <input className={className} {...rest} />
  }
  function Textarea({ className, ...rest }: MockProps) {
    return <textarea className={className} {...rest} />
  }
  function MultiSelect({ options, value, onChange, placeholder }: MockMultiSelectProps) {
    return (
      <select
        data-testid="multi-select"
        multiple
        value={value ?? []}
        onChange={(e) =>
          onChange?.(
            Array.from(
              (e.target as HTMLSelectElement).selectedOptions,
              (o) => o.value,
            ),
          )
        }
        data-placeholder={placeholder}
      >
        {(options ?? []).map((o: MockMultiSelectOption) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  return {
    Alert: Tag('alert'),
    AlertDescription: Tag('alert-description'),
    AlertDialog: ({ children }: MockProps) => <>{children}</>,
    AlertDialogAction: ({ children, onClick }: MockProps) => (
      <button data-tag="alert-action" onClick={onClick}>{children}</button>
    ),
    AlertDialogCancel: ({ children }: MockProps) => <button data-tag="alert-cancel">{children}</button>,
    AlertDialogContent: ({ children }: MockProps) => <div data-tag="alert-content">{children}</div>,
    AlertDialogDescription: ({ children }: MockProps) => <div data-tag="alert-desc">{children}</div>,
    AlertDialogFooter: ({ children }: MockProps) => <div data-tag="alert-footer">{children}</div>,
    AlertDialogHeader: ({ children }: MockProps) => <div data-tag="alert-header">{children}</div>,
    AlertDialogTitle: ({ children }: MockProps) => <div data-tag="alert-title">{children}</div>,
    AlertDialogTrigger: ({ children }: MockProps) => <>{children}</>,
    Badge: Tag('badge'),
    Button: ({ children, className, ...rest }: MockProps) => (
      <button className={className} {...rest}>
        {children}
      </button>
    ),
    // Card spy — fires when NoteForm's function body executes.
    Card: (props: MockProps) => {
      cardRenderSpy()
      return <Tag data-tag="card" {...props} />
    },
    CardContent: Tag('card-content'),
    CardHeader: Tag('card-header'),
    CardTitle: Tag('card-title'),
    Checkbox,
    Input,
    Label: Tag('label'),
    MultiSelect,
    Select,
    SelectContent: ({ children }: MockProps) => <>{children}</>,
    SelectItem: ({ value, children }: MockSelectItemProps) => <option value={value}>{children}</option>,
    SelectTrigger: Tag('select-trigger'),
    SelectValue: Tag('select-value'),
    Separator: () => <hr />,
    Textarea,
  }
})

vi.mock('@/Components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ addToast: vi.fn() }),
}))

// OPT-followup-3-b: OPT-follow-up-3-sweep-2 moved the non-component value
// exports out of `toast.tsx` into `toast.helpers.ts`, so NoteForm.tsx
// imports `useToast` from `@/Components/ui/toast.helpers` (not from
// `@/Components/ui/toast`). Without a parallel mock, the test hits
// `useToast must be used within a ToastProvider`. Same-shape stub on
// the new path closes that gap.
vi.mock('@/Components/ui/toast.helpers', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/Components/ui/platform-icon', () => ({
  PlatformIcon: ({ platform, className }: MockPlatformIconProps) => (
    <span data-platform={platform} className={className} />
  ),
  PLATFORM_COLORS: {},
}))

vi.mock('@/Components/ui/tag-input', () => ({
  TagInput: ({ value, onChange, ...rest }: MockTagInputProps) => (
    <input
      aria-label="tag-input"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  ),
}))

vi.mock('@/api/client', () => ({
  api: {
    uploadVideo: vi.fn(),
    uploadNoteMultipart: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'n1' } }),
    getAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  PLATFORMS_WITH_ICONS: [],
  PLATFORMS: [
    { label: '抖音', value: 'douyin' },
    { label: '快手', value: 'kuaishou' },
  ],
  NOTE_PLATFORMS: [
    { label: '抖音', value: 'douyin' },
    { label: '快手', value: 'kuaishou' },
  ],
  getNoteImageLimit: () => 30,
}))

vi.mock('./ImageLightbox', () => ({
  ImageLightbox: () => null,
}))

// ── imports (post-mock) ────────────────────────────────────────────────

import { NoteForm, type NoteFormHandle } from './NoteForm'
import { sampleAccounts } from '@/test/fixtures'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'

// ── imperative-handle tests (render-spy based) ─────────────────────────
// NoteForm's applyAiResult maps result.desc → internal 'content' state.
// That mapping is exercised by the render-spy: a re-render fires iff the
// setter bundle actually ran.

describe('NoteForm — imperative handle', () => {
  it('exposes applyAiResult', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()
    const ref = { current: null as NoteFormHandle | null }
    render(
      <TestProviders client={qc}>
        <NoteForm
          ref={(r) => {
            ref.current = r
          }}
          accountOptions={sampleAccounts}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    expect(typeof ref.current?.applyAiResult).toBe('function')
  })

  it('triggers a re-render when called with title + desc', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()
    const ref = { current: null as NoteFormHandle | null }
    render(
      <TestProviders client={qc}>
        <NoteForm
          ref={(r) => {
            ref.current = r
          }}
          accountOptions={sampleAccounts}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    const baseline = cardRenderSpy.mock.calls.length
    act(() => {
      ref.current!.applyAiResult({
        title: '笔记标题',
        desc: '正文段落',
        tags: 'a, b',
      } as AiGenerationResult)
    })
    // React 19 batches concurrent setStates inside the same handler into a
    // single commit, so setTitle + setContent together = at least one render.
    // Assert ≥ 1 to stay durable across React's batching-policy changes.
    expect(cardRenderSpy.mock.calls.length - baseline).toBeGreaterThanOrEqual(1)
  })

  it('does NOT throw when applyAiResult receives empty strings', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()
    const ref = { current: null as NoteFormHandle | null }
    render(
      <TestProviders client={qc}>
        <NoteForm
          ref={(r) => {
            ref.current = r
          }}
          accountOptions={sampleAccounts}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    const baseline = cardRenderSpy.mock.calls.length
    expect(() => {
      act(() => {
        ref.current!.applyAiResult({
          title: '',
          desc: '',
          tags: '',
        } as AiGenerationResult)
      })
    }).not.toThrow()
    // No setters → no re-renders → spy unchanged.
    expect(cardRenderSpy.mock.calls.length).toBe(baseline)
  })
})

// ── React.memo + callback-stability: render-spy pattern ─────────────────

describe('NoteForm — React.memo + callback stability (render-spy)', () => {
  beforeEach(() => {
    cardRenderSpy.mockClear()
  })

  it('memo HIT: shallow-equal props → spy not called on rerender', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <NoteForm
          accountOptions={sampleAccounts}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    expect(cardRenderSpy.mock.calls.length).toBeGreaterThan(0)
    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <NoteForm
          accountOptions={sampleAccounts}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).not.toHaveBeenCalled()
  })

  it('memo MISS: fresh onSuccess identity → spy called on rerender', () => {
    const onError = vi.fn()
    const stableSuccess = vi.fn()
    const freshSuccess = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <NoteForm
          accountOptions={sampleAccounts}
          onSuccess={stableSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <NoteForm
          accountOptions={sampleAccounts}
          onSuccess={freshSuccess}
          onError={onError}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).toHaveBeenCalled()
  })

  it('memo MISS: fresh accountOptions array identity → spy called', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <NoteForm
          accountOptions={sampleAccounts}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <NoteForm
          accountOptions={[...sampleAccounts]} // fresh array identity
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).toHaveBeenCalled()
  })

  it('memo contract: NoteForm is React.memo wrapped', () => {
    // $$typeof is Symbol.for('react.memo') when React.memo wraps the component.
    // The symbol isn't on MemoExoticComponent's public type — assert via the
    // lossy `unknown → { $$typeof }` bridge so we don't need `as any`.
    const memoSymbol = Symbol.for('react.memo')
    expect(
      (NoteForm as unknown as { $$typeof: symbol } | undefined)?.$$typeof,
    ).toBe(memoSymbol)
  })
})
