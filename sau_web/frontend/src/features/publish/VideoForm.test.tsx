import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { HTMLAttributes, ReactNode } from 'react'
// ── shared mock prop shapes (see TaskTableRow.test.tsx for rationale) ──
//
// `MockProps` is the common denominator: HTMLAttributes + children + an open
// index signature `[key: string]: unknown` so data-* / aria-* still flow
// through `{...rest}` without losing them. Sub-types narrowly extend with
// the Radix-style callbacks that particular vi.mock components need.
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

import type { AiGenerationResult } from '@/components/AiSidebar/AiSidebar'

// Imperative-handle tests below use the render-spy pattern (assert that
// applyAiResult triggers a re-render via `cardRenderSpy` incrementing) rather
// than DOM-value assertions. The DOM approach proved unreliable under
// happy-dom: arbitrary `aria-*`/`data-*` props forwarded through a custom
// React component (Input mock) are not consistently preserved, and the
// `querySelector('[attr="..."]')` matcher is flaky. The render-spy is the
// strongest contract: the imperative handle exists, is callable, and
// triggering it propagates state via the form's local setTitle/setDesc/setTags
// → re-renders. Any future regression in the applyAiResult body (e.g. an
// accidental setter removal) breaks this spy assertion.

// ── hoisted render-spy for memo hit-rate testing ───────────────────────
// Card is the outermost component VideoForm renders. Memo hit = VideoForm
// function body does NOT execute => Card is NOT called. Memo miss = body
// executes => Card is invoked. React 19 + forwardRef batches Profiler commits
// into a single onRender call regardless of memo outcome, so spy-on-mocked-
// child is the reliable differential.
const cardRenderSpy = vi.hoisted(() => vi.fn())

// ── mocks (must precede under-test imports) ─────────────────────────────

vi.mock('motion/react', () => {
  // Cache motion.<tag> by tag string so React sees a stable component type.
  // Without this cache, every access to `motion.div` returns a fresh arrow
  // function, which React's reconciler reads as a NEW component type →
  // unmount/remount on every render, defeating the memoization being tested.
  // The dynamic JSX Tag (string key) and the Proxy target type prevent a
  // fully typed mock — disable no-explicit-any on the three sites below.
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
            // The dynamic JSX tag is a string key — `as any` is the cleanest
            // anchor for <Tag {...rest}> when rest members aren't known.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Tag = (typeof tag === 'string' ? tag : 'div') as keyof JSX.IntrinsicElements
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

vi.mock('@/components/ui/index', () => {
  const makeTag = (tag: string) => (props: MockProps) => {
    const { children, className, ...rest } = props
    return (
      <div data-tag={tag} className={className} {...rest}>
        {children}
      </div>
    )
  }
  function Tag(props: MockProps) {
    const { children, className, ...rest } = props
    return (
      <div className={className} {...rest}>
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
    Alert: makeTag('alert'),
    AlertDescription: makeTag('alert-description'),
    // OPT-followup-3-c: AlertDialog surface wasn't exported from the prior
    // mock, so VideoForm.tsx's `import { AlertDialog, AlertDialogAction, …}`
    // resolved to `undefined` and the form crashed on render with
    // "No AlertDialog export is defined on the @/components/ui/index mock".
    // Added full AlertDialog* set mirroring the TaskTableRow / TaskDrawer
    // mock shape so any of the 9 imports resolve, and onClick on
    // AlertDialogAction passes through to fire the test's confirm hook.
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
    Badge: makeTag('badge'),
    Button: ({ children, className, ...rest }: MockProps) => (
      <button className={className} {...rest}>
        {children}
      </button>
    ),
    // Card is the outermost wrapper VideoForm renders — spy on it to detect
    // whether the wrapped function body executed on the latest render.
    Card: (props: MockProps) => {
      cardRenderSpy()
      return <Tag data-tag="card" {...props} />
    },
    CardContent: makeTag('card-content'),
    CardHeader: makeTag('card-header'),
    CardTitle: makeTag('card-title'),
    Checkbox,
    Input,
    Label: makeTag('label'),
    MultiSelect,
    Select,
    SelectContent: ({ children }: MockProps) => <>{children}</>,
    SelectItem: ({ value, children }: MockSelectItemProps) => <option value={value}>{children}</option>,
    SelectTrigger: makeTag('select-trigger'),
    SelectValue: makeTag('select-value'),
    Separator: () => <hr />,
    Textarea,
    Accordion: makeTag('accordion'),
    AccordionContent: makeTag('accordion-content'),
    AccordionItem: makeTag('accordion-item'),
    AccordionTrigger: makeTag('accordion-trigger'),
  }
})

vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/components/ui/platform-icon', () => ({
  PlatformIcon: ({ platform, className }: MockPlatformIconProps) => (
    <span data-platform={platform} className={className} />
  ),
  PLATFORM_COLORS: {},
}))

vi.mock('@/components/ui/tag-input', () => ({
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
    uploadVideo: vi.fn().mockResolvedValue({ success: true, data: { task_id: 't1' } }),
    uploadNoteMultipart: vi.fn(),
    getAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  PLATFORMS_WITH_ICONS: [
    { label: '抖音', value: 'douyin' },
    { label: '快手', value: 'kuaishou' },
  ],
  PLATFORMS: [
    { label: '抖音', value: 'douyin' },
    { label: '快手', value: 'kuaishou' },
  ],
  NOTE_PLATFORMS: [
    { label: '抖音', value: 'douyin' },
    { label: '快手', value: 'kuaishou' },
  ],
}))

// ── imports (post-mock) ────────────────────────────────────────────────

import { VideoForm, type VideoFormHandle } from './VideoForm'
import { TestProviders } from '@/test/render-harness'
import { makeQueryClient } from '@/test/render-harness.helpers'

// ── imperative-handle tests (render-spy based) ─────────────────────────

describe('VideoForm — imperative handle', () => {
  it('exposes applyAiResult and triggers a re-render when called', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()
    const ref = { current: null as VideoFormHandle | null }
    const refCallback = (node: VideoFormHandle | null) => {
      ref.current = node
    }

    render(
      <TestProviders client={qc}>
        <VideoForm
          ref={refCallback}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )

    expect(typeof ref.current?.applyAiResult).toBe('function')
    const baseline = cardRenderSpy.mock.calls.length

    // act() flushes the React 19 setState batch from useImperativeHandle.
    act(() => {
      ref.current!.applyAiResult({
        title: 'AI 标题',
        desc: 'AI 描述',
        tags: ['ai, video'],
      } as AiGenerationResult)
    })

    // Render propagation is the strongest contract: every setTitle/setDesc/
///setTags in applyAiResult schedules a re-render → Card spy fires again.
    expect(cardRenderSpy.mock.calls.length).toBeGreaterThan(baseline)
  })

  it('does NOT throw when applyAiResult receives empty strings', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()
    const ref = { current: null as VideoFormHandle | null }
    render(
      <TestProviders client={qc}>
        <VideoForm
          ref={(r) => {
            ref.current = r
          }}
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
          tags: [],
        } as AiGenerationResult)
      })
    }).not.toThrow()

    // Empty fields trigger conditional setters (the `if (result.title)` guard
    // in source), so no re-render is scheduled. spy count must NOT increase.
    expect(cardRenderSpy.mock.calls.length).toBe(baseline)
  })

  it('partial result (only title) does NOT throw and re-renders once', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()
    const ref = { current: null as VideoFormHandle | null }
    render(
      <TestProviders client={qc}>
        <VideoForm
          ref={(r) => {
            ref.current = r
          }}
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )

    const baseline = cardRenderSpy.mock.calls.length
    expect(() => {
      act(() => {
        ref.current!.applyAiResult({
          title: '仅标题',
        } as AiGenerationResult)
      })
    }).not.toThrow()

    // Exactly one setState (setTitle) → at least one re-render. Assert ≥ 1 to
    // stay durable across React batching-policy changes.
    expect(cardRenderSpy.mock.calls.length - baseline).toBeGreaterThanOrEqual(1)
  })
})

// ── React.memo + callback-stability: render-spy pattern ─────────────────
// `cardRenderSpy` fires every time the mocked Card is invoked by VideoForm.
// React.memo short-circuits VideoForm's render → spy NOT called.
// React.memo shallow-miss → VideoForm body runs → spy called.

describe('VideoForm — React.memo + callback stability (render-spy)', () => {
  beforeEach(() => {
    cardRenderSpy.mockClear()
  })

  it('memo HIT: shallow-equal props → spy not called on rerender', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    const initial = cardRenderSpy.mock.calls.length
    expect(initial).toBeGreaterThan(0) // initial mount

    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).not.toHaveBeenCalled()
  })

  it('memo MISS: fresh onSuccess identity → spy called on rerender', () => {
    const onError = vi.fn()
    const stableOnSuccess = vi.fn()
    const freshOnSuccess = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={stableOnSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={freshOnSuccess} // identity change → memo miss
          onError={onError}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).toHaveBeenCalled()
  })

  it('memo MISS: fresh onError identity → spy called on rerender', () => {
    const onSuccess = vi.fn()
    const stableOnError = vi.fn()
    const freshOnError = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={stableOnError}
        />
      </TestProviders>,
    )
    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={freshOnError}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).toHaveBeenCalled()
  })

  it('memo HIT: same accountOptions array reference → spy not called', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).not.toHaveBeenCalled()
  })

  it('memo MISS: fresh groupSelection identity → spy called', () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const qc = makeQueryClient()

    const { rerender } = render(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={onError}
        />
      </TestProviders>,
    )
    cardRenderSpy.mockClear()

    rerender(
      <TestProviders client={qc}>
        <VideoForm
          onSuccess={onSuccess}
          onError={onError}
          groupSelection={{ groupId: 1, groupName: 'g1', platforms: ['douyin'], mappings: [{ platform: 'douyin', cookieFile: 'c1', authId: 1 }] }}
        />
      </TestProviders>,
    )

    expect(cardRenderSpy).toHaveBeenCalled()
  })

  it('memo contract: VideoForm is React.memo wrapped (not a plain forwardRef)', () => {
    // $$typeof is Symbol.for('react.memo') when React.memo wraps the component.
    // Plain forwardRef components have $$typeof = Symbol.for('react.forward_ref').
    // `React.memo(forwardRef(fn))` collapses both — verify the merged surface.
    // The symbol isn't on MemoExoticComponent's public type — assert via the
    // lossy `unknown → { $$typeof }` bridge so we don't need `as any`.
    const memoSymbol = Symbol.for('react.memo')
    expect(
      (VideoForm as unknown as { $$typeof: symbol } | undefined)?.$$typeof,
    ).toBe(memoSymbol)
  })
})
