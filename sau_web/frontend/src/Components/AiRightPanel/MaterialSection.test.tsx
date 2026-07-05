/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MaterialSection } from './MaterialSection'
import { useMaterialPanelStore } from '@/stores/materialPanelStore'
import type { ApplyAttempt, FormHandle } from '@/lib/chat/chatFormBridge'

/**
 * Regression suite — locks in the §7 + §8 + §9 contract for the AI
 * sidebar's MaterialSection component. Four mandated scenarios per
 * `tasks.md §11.2`:
 *
 *   1. Accordion 关闭时 — AccordionContent hidden + 0 height
 *   2. image/link max-height caps (max-h-[380px] / max-h-[240px])
 *   3. manual search does NOT clear recommend slot (manual/recommend coexist)
 *   4. 单击 tile → addImageToForm 被调，成功 toast 显示
 *
 * Mock strategy mirrors AiPanel/AiPanelToolbar testing patterns:
 *
 *   • `@/api/client`     — intercept fetchImageAsFile + inbox nexus stubs
 *   • `@/hooks/useMaterialAutoRecommend` — stub to no-op (避免测试中
 *     setInterval 间歇 poll 调用 aiApi.recommendImages 把"only manual"
 *     场景污染为"manual + auto-recommend"组合)
 *   • `@/lib/ai/modelDisplay` — 未使用, 但 import 链锁定需要 stub
 *   • `@/Components/ui/toast` — 让 addToast 走 stub, 在测试中我们手动 assert
 *   • `@/api/ai`         — 直接 stub, store actions 也走它, 拆分明确
 *
 * 真实的 Radix Accordion 在 happy-dom 里渲染正常 — 不需要 stub Accordion。
 * （这是 contract-binding 测试, 不是 isolated unit test）
 */

// ── mocks ─────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  api: {
    inboxDownload: vi.fn().mockResolvedValue({ success: false, message: 'unmocked' }),
    inboxReveal: vi.fn(),
    inboxTranscribeStream: vi.fn(),
    inboxFetchFile: vi.fn(),
  },
  getNoteImageLimit: () => 30,
  PLATFORMS: [],
  NOTE_PLATFORMS: [],
  NOTE_PLATFORM_IMAGE_LIMITS: {},
}))
import { api } from '@/api/client'

vi.mock('@/api/ai', () => ({
  aiApi: {
    searchImages: vi.fn(),
    recommendImages: vi.fn(),
    fetchImageAsFile: vi.fn(),
  },
}))
import { aiApi } from '@/api/ai'

// Stub the auto-recommend polling hook so the interval doesn't fire
// mid-test and contaminate "manual search only" scenarios with auto-recommend
// calls to aiApi.recommendImages().
vi.mock('@/hooks/useMaterialAutoRecommend', () => ({
  useMaterialAutoRecommend: vi.fn(),
}))

// Stub the toast module — call the spy addToast we expose below.
vi.mock('@/Components/ui/toast', () => ({
  useToast: () => ({ addToast: (...args: unknown[]) => (globalThis as any).__addToastSpy?.(...args) }),
}))

// Stub Lucide icons to keep the noise low — icons are decorative.
// (Keeping real ones is harmless but bloats snapshot/log noise.)
vi.mock('lucide-react', () => ({
  Camera: () => null,
  ImageOff: () => null,
  Sparkles: () => null,
  Send: () => null,
  Loader2: () => null,
  ImagePlus: () => null,
  Check: () => null,
  Link2: () => null,
  Wand2: () => null,
  ChevronDown: () => null, // used by @/Components/ui/accordion's AccordionTrigger
}))

// ── helpers ───────────────────────────────────────────────────
function makeStubForm(applyMediaReturn: ApplyAttempt = { applied: true }): FormHandle {
  return {
    applyAiResult: vi.fn(),
    applyMedia: vi.fn().mockReturnValue(applyMediaReturn),
    getFormSnapshot: vi.fn().mockReturnValue({ title: '', desc: '', tags: [] }),
  }
}

const pxImages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `pexels:${1000 + i}`,
    source: 'pexels' as const,
    thumb: `https://example.com/${i}.jpg`,
    preview: `https://example.com/${i}.jpg`,
    full: `https://example.com/${i}.jpg`,
    photographer: `Photog ${i}`,
    photographerUrl: null,
    pageUrl: 'https://pexels.com',
    alt: '',
  }))

const recImages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `pixabay:${7_000 + i}`,
    source: 'pixabay' as const,
    thumb: `https://example.com/r${i}.jpg`,
    preview: `https://example.com/r${i}.jpg`,
    full: `https://example.com/r${i}.jpg`,
    photographer: `PhotogR ${i}`,
    photographerUrl: null,
    pageUrl: 'https://pixabay.com',
    alt: '',
  }))

beforeEach(() => {
  // Reset store
  useMaterialPanelStore.setState({
    imageQuery: '',
    imageResults: [],
    imageLoading: false,
    imageError: null,
    addingImageIds: new Set(),
    recommendResults: [],
    recommendLoading: false,
    recommendError: null,
    recommendCount: 0,
    lastRecommendedTitle: null,
    recentQueries: [],
    urlFetching: false,
    urlError: null,
  })
  if (typeof localStorage !== 'undefined') localStorage.removeItem('sau-material-panel-recent-queries')
  vi.mocked(aiApi.searchImages).mockReset()
  vi.mocked(aiApi.recommendImages).mockReset()
  vi.mocked(aiApi.fetchImageAsFile).mockReset()
  vi.mocked(api.inboxDownload).mockReset()
  vi.mocked(api.inboxFetchFile).mockReset()
})
afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.removeItem('sau-material-panel-recent-queries')
  // CRITICAL (reviewer MUST-FIX 1.2): wipe the globalThis spy so a previous
  // test's spy doesn't satisfy a future test's expectation silently.
  delete (globalThis as { __addToastSpy?: unknown }).__addToastSpy
})

// ── Scenario 1: Accordion closed ⇒ content hidden ────────────
describe('Accordion closed — §11.2 scenario 1', () => {
  it('renders both item triggers with a hidden content region', () => {
    const ref = { current: makeStubForm() }
    render(<MaterialSection formMode="note" formRef={ref} />)
    // Both triggers rendered.
    expect(screen.getByText('图片素材')).toBeInTheDocument()
    expect(screen.getByText('链接拉取')).toBeInTheDocument()
    // Initially Radix renders the content with `data-state="closed"` and
    // `hidden` (the Radix primitive's a11y contract — content is in the
    // DOM but marked hidden when collapsed). 'data-testid' is on the
    // content root so we can query its visibility attribute.
    const imgContent = screen.getByTestId('material-image-content')
    expect(imgContent).toHaveAttribute('hidden')
    expect(imgContent).toHaveAttribute('data-state', 'closed')
    const linkContent = screen.getByTestId('material-link-content')
    expect(linkContent).toHaveAttribute('hidden')
    expect(linkContent).toHaveAttribute('data-state', 'closed')
  })

  it('clicking the image trigger opens the content region', async () => {
    const ref = { current: makeStubForm() }
    render(<MaterialSection formMode="note" formRef={ref} />)
    const trigger = screen.getByText('图片素材')
    fireEvent.click(trigger)
    await waitFor(() => {
      const content = screen.getByTestId('material-image-content')
      expect(content).not.toHaveAttribute('hidden')
      expect(content).toHaveAttribute('data-state', 'open')
    })
  })

  it('enabledItems=[] returns null (no section rendered)', () => {
    const ref = { current: makeStubForm() }
    render(
      <MaterialSection
        formMode="note"
        formRef={ref}
        enabledItems={[] as ReadonlyArray<'material' | 'link'>}
      />,
    )
    expect(screen.queryByTestId('material-section')).toBeNull()
  })
})

// ── Scenario 2: image/link max-height caps ────────────────────
describe('max-height caps — §11.2 scenario 2', () => {
  it('image AccordionContent has max-h-[380px] + overflow-y-auto', async () => {
    const ref = { current: makeStubForm() }
    render(<MaterialSection formMode="note" formRef={ref} />)
    fireEvent.click(screen.getByText('图片素材'))
    await waitFor(() => {
      const content = screen.getByTestId('material-image-content')
      // shadcn's AccordionContent binding (`@/Components/ui/accordion.tsx`)
      // places the Radix root on `AccordionPrimitive.Content` (where
      // data-testid lands) and applies the consumer-supplied className
      // to the INNER `<div>` via `cn("pb-4 pt-0", className)` so the
      // Radix height-animation utility controls the wrapper. The
      // max-h cap + overflow-y-auto we pass therefore live on the inner.
      // Read the inner so we lock the actual user-visible scroll
      // contract, not just the Radix-animated ancestors' defaults.
      const inner = content.firstElementChild as HTMLElement
      expect(inner).not.toBeNull()
      expect(inner.className).toContain('max-h-[380px]')
      expect(inner.className).toContain('overflow-y-auto')
    })
  })

  it('link AccordionContent has max-h-[240px] + overflow-y-auto', async () => {
    const ref = { current: makeStubForm() }
    render(<MaterialSection formMode="note" formRef={ref} />)
    fireEvent.click(screen.getByText('链接拉取'))
    await waitFor(() => {
      const content = screen.getByTestId('material-link-content')
      const inner = content.firstElementChild as HTMLElement
      expect(inner).not.toBeNull()
      expect(inner.className).toContain('max-h-[240px]')
      expect(inner.className).toContain('overflow-y-auto')
    })
  })
})

// ── Scenario 3: recommend slot not cleared by manual search ──
describe('manual + recommend coexistence — §11.2 scenario 3', () => {
  it('manual search after recommend keeps recommendResults visible', async () => {
    const ref = { current: makeStubForm() }
    // Pre-seed recommend results (simulating auto-recommend earlier).
    useMaterialPanelStore.setState({ recommendResults: recImages(3) })

    render(<MaterialSection formMode="note" formRef={ref} />)

    // Open image section.
    fireEvent.click(screen.getByText('图片素材'))
    await waitFor(() =>
      expect(screen.getByTestId('material-image-content')).toHaveAttribute('data-state', 'open'),
    )

    // Manual search now.
    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: true,
      data: pxImages(3),
    })
    const searchInput = screen.getByTestId('material-search-input') as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: '咖啡' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    await waitFor(() => {
      // Manual results populated.
      const s = useMaterialPanelStore.getState()
      expect(s.imageResults).toHaveLength(3)
      // Recommend results still present (untouched).
      expect(s.recommendResults).toHaveLength(3)
    })

    // Both grids render in the DOM (distinct visually + by data-image-id).
    await waitFor(() => {
      const tiles = document.querySelectorAll('[data-image-id]')
      // Manual 3 + recommend 3 = 6 tiles total.
      expect(tiles.length).toBe(6)
    })
  })

  it('manual failure does NOT clobber recommendResults (only manual slot clears)', async () => {
    useMaterialPanelStore.setState({ recommendResults: recImages(2) })
    const ref = { current: makeStubForm() }
    render(<MaterialSection formMode="note" formRef={ref} />)
    fireEvent.click(screen.getByText('图片素材'))
    await waitFor(() =>
      expect(screen.getByTestId('material-image-content')).toHaveAttribute('data-state', 'open'),
    )

    vi.mocked(aiApi.searchImages).mockResolvedValue({
      success: false,
      message: 'boom',
    })
    const input = screen.getByTestId('material-search-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'fail' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      const s = useMaterialPanelStore.getState()
      expect(s.imageError).toBe('boom')
      expect(s.imageResults).toEqual([])
      // Recommend slot survives.
      expect(s.recommendResults).toHaveLength(2)
    })
  })
})

// ── Scenario 4: click tile → addImageToForm + success toast ──
describe('click tile → addImageToForm dispatched — §11.2 scenario 4', () => {
  it('manual results click invokes store.addImageToForm via safeApplyMedia', async () => {
    const form = makeStubForm()
    const ref = { current: form }
    useMaterialPanelStore.setState({ imageResults: pxImages(2) })

    // Spy toast via spy on the hook mock
    const toastSpy = vi.fn()
    ;(globalThis as any).__addToastSpy = toastSpy

    // Stub fetchImageAsFile to return a File
    vi.mocked(aiApi.fetchImageAsFile).mockResolvedValue(
      new File([new Uint8Array([1, 2, 3])], 'pexels_1000.jpg', { type: 'image/jpeg' }),
    )

    render(<MaterialSection formMode="note" formRef={ref} />)
    fireEvent.click(screen.getByText('图片素材'))
    await waitFor(() =>
      expect(screen.getByTestId('material-image-content')).toHaveAttribute('data-state', 'open'),
    )

    // The first tile (pexels:1000 — MaterialImageGrid renders the button
    // with `data-image-id={img.id}`, NOT `data-testid`. So screen.getByTestId
    // would incorrectly look for `data-testid="pexels:1000"` and throw; we
    // use the raw attribute selector that matches the component contract.)
    const tile = document.querySelector('[data-image-id="pexels:1000"]') as HTMLButtonElement | null
    expect(tile).not.toBeNull()
    fireEvent.click(tile!)

    await waitFor(() => {
      // applyMedia was called with image-array shape (note-mode).
      expect(form.applyMedia).toHaveBeenCalledTimes(1)
      const call = (form.applyMedia as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[0]).toHaveProperty('images')
      expect(call[0].images).toHaveLength(1)
      expect(call[0].images[0]).toBeInstanceOf(File)
      // toast fired — wrapped in waitFor so the act() boundary settles
      // before the spy assertion runs (prevents intermittent microtask
      // races when the toast is fired from a React event handler).
      expect(toastSpy).toHaveBeenCalledTimes(1)
      expect(toastSpy).toHaveBeenCalledWith('已加入图文附件', 'success')
    })
  })

  it('video-mode click routes to form.applyMedia with {thumbnail} shape + exactly one success toast (wart-fix lock)', async () => {
    // After the §6-9 双 toast UX wart fix:
    //   1. materialPanelStore.addImageToForm routes video-mode to
    //      safeApplyMedia({ thumbnail: image.full }) — URL STRING, NOT
    //      `{ images: [file] }`. The URL is the cover address, no bytes
    //      download needed.
    //   2. VideoForm.applyMedia accepts `{thumbnail}` silently (no inner
    //      toast).
    //   3. MaterialImageGrid.handleClick emits EXACTLY ONE success toast
    //      (the legacy straight-toast-one path used to stack on top of
    //      the form's rejection warning).
    // The single-toast invariant `toastSpy.mock.calls.length === 1` is
    // the user-visible regression lock for §6-9 war。
    const form = makeStubForm()
    const ref = { current: form }
    useMaterialPanelStore.setState({ imageResults: pxImages(1) })
    const toastSpy = vi.fn()
    ;(globalThis as { __addToastSpy?: typeof toastSpy }).__addToastSpy = toastSpy

    // Safety: video-mode path should NOT call fetchImageAsFile (URL is
    // a cover string, not a blob). Mock-clearing + negative assertion
    // locks that reliance so a future refactor that accidentally re-
    // downloads bytes surfaces a loud regression.
    vi.mocked(aiApi.fetchImageAsFile).mockClear()

    render(<MaterialSection formMode="video" formRef={ref} />)
    fireEvent.click(screen.getByText('图片素材'))
    await waitFor(() =>
      expect(screen.getByTestId('material-image-content')).toHaveAttribute('data-state', 'open'),
    )

    const tile = document.querySelector('[data-image-id="pexels:1000"]') as HTMLElement
    fireEvent.click(tile)

    await waitFor(() => {
      expect(form.applyMedia).toHaveBeenCalledTimes(1)
      const call = (form.applyMedia as ReturnType<typeof vi.fn>).mock.calls[0]
      // Video mode routes to {thumbnail: urlString}, NOT {images: [file]}.
      // The stub's pxImages() factory uses `https://example.com/{i}.jpg`
      // for `full` (NOT pexels.com — that's the `pageUrl` field which
      // isn't what gets dispatched). Asserting against `example.com`
      // locks the actual materialPanelStore.addImageToForm video-mode
      // branch: `safeApplyMedia(formRef, { thumbnail: image.full })`.
      expect(call[0]).toHaveProperty('thumbnail')
      expect(call[0].thumbnail).toMatch(/^https?:\/\/.+\.jpg$/)
      expect(call[0].thumbnail).toContain('example.com')
      expect(call[0]).not.toHaveProperty('images')
      // Single-toast invariant: only the success message. ANY second
      // toast on this click is a §6-9 wart regression.
      expect(toastSpy).toHaveBeenCalledTimes(1)
      expect(toastSpy).toHaveBeenCalledWith('封面图片已应用', 'success')
    })
    // Video mode skips fetchImageAsFile entirely — URL is used as
    // the cover string, no bytes needed for the AI sidebar path.
    expect(aiApi.fetchImageAsFile).not.toHaveBeenCalled()
  })

  it('wart regression — video-mode form reject fires exactly ONE mode-switch toast, NO success toast', async () => {
    // Locks the §6-9 war tweet fix: if VideoForm.applyMedia ever
    // rejects the `thumbnail` key (e.g. a future URL-validation step),
    // the grid emits ONE "请切换到图文模式" warning — NEVER stacking it
    // on top of a "封面图片已应用" success toast. Form-side veto +
    // grid single-source-of-truth is the architectural fix; this test
    // mechanics-locks the user-visible surface so a future revert
    // shifts the toast count > 1 loudly.
    const form = makeStubForm({ applied: false, reason: 'no-media-slot' })
    const ref = { current: form }
    useMaterialPanelStore.setState({ imageResults: pxImages(1) })
    const toastSpy = vi.fn()
    ;(globalThis as { __addToastSpy?: typeof toastSpy }).__addToastSpy = toastSpy
    vi.mocked(aiApi.fetchImageAsFile).mockClear()

    render(<MaterialSection formMode="video" formRef={ref} />)
    fireEvent.click(screen.getByText('图片素材'))
    await waitFor(() =>
      expect(screen.getByTestId('material-image-content')).toHaveAttribute('data-state', 'open'),
    )

    const tile = document.querySelector('[data-image-id="pexels:1000"]') as HTMLElement
    fireEvent.click(tile)

    await waitFor(() => {
      expect(form.applyMedia).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      // Single-toast invariant under the rejection branch.
      expect(toastSpy).toHaveBeenCalledTimes(1)
      // NO '封面图片已应用' (the historical liar-success toast that
      // stacked on top of the form's no-media-slot warning).
      expect(toastSpy).not.toHaveBeenCalledWith('封面图片已应用', 'success')
      // The single toast IS the mode-switch hint.
      expect(toastSpy).toHaveBeenCalledWith(
        expect.stringContaining('图文'),
        'warning',
      )
    })
  })

  it('URL submission to fetchAndAddUrl handles envelope failure without throwing', async () => {
    // Spec §11.2 "URL 解析失败 → 错误 toast 不抛异常" — but the URL
    // form's contract for `inboxDownload` envelope failure (success:false)
    // is to silently return + set in-store `urlError`. The MaterialSection
    // render then shows the error inline. NO toast on envelope failure.
    // A separate test covers `api.inboxDownload` throwing — THAT path toasts.
    const form = makeStubForm()
    const ref = { current: form }
    vi.mocked(api.inboxDownload).mockResolvedValue({
      success: false,
      message: '亲，cookie 没准备好',
    })
    const toastSpy = vi.fn()
    ;(globalThis as { __addToastSpy?: typeof toastSpy }).__addToastSpy = toastSpy

    render(<MaterialSection formMode="video" formRef={ref} />)
    fireEvent.click(screen.getByText('链接拉取'))
    await waitFor(() =>
      expect(screen.getByTestId('material-link-content')).toHaveAttribute('data-state', 'open'),
    )

    const urlInput = document.querySelector('[data-testid="material-url-input"]') as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'https://v.douyin.com/xYz' } })
    const submitBtn = document.querySelector('[data-testid="material-url-submit"]') as HTMLButtonElement
    fireEvent.click(submitBtn)

    await waitFor(() => {
      // urlError in-store surfaces the message verbatim (capped 200 chars)
      // and the MaterialSection renders it in an inline alert div. NO
      // exception is thrown (would surface as test failure via red box).
      const s = useMaterialPanelStore.getState()
      expect(s.urlError).toContain('cookie')
    })

    // The inline error div is the actual user-visible surface — verify it.
    await waitFor(() => {
      expect(screen.getByTestId('material-url-error').textContent).toContain('cookie')
    })

    // No toast fires on envelope failure path.
    expect(toastSpy).not.toHaveBeenCalled()
  })

  it('URL submission throws from inboxDownload → toast fires (catch path)', async () => {
    // Spec §11.2 explicitly: URL parse failure surfaces error toast and
    // does NOT throw uncaught. The catch path in handleSubmit calls
    // addToast(err.message) — distinct from the envelope-failure silent
    // return path tested above.
    const form = makeStubForm()
    const ref = { current: form }
    // Call-budget lock: pin exactly one inboxDownload call so future
    // refactors that retry / swallow-then-retry surface loudly instead
    // of silently shifting the side-effect count.
    const inboxSpy = vi.mocked(api.inboxDownload)
    inboxSpy.mockRejectedValue(new Error('亲，cookie 没准备好 (PatchedException)'))
    const toastSpy = vi.fn()
    ;(globalThis as { __addToastSpy?: typeof toastSpy }).__addToastSpy = toastSpy

    render(<MaterialSection formMode="video" formRef={ref} />)
    fireEvent.click(screen.getByText('链接拉取'))
    await waitFor(() =>
      expect(screen.getByTestId('material-link-content')).toHaveAttribute('data-state', 'open'),
    )

    const urlInput = document.querySelector('[data-testid="material-url-input"]') as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'https://v.douyin.com/xYz' } })
    const submitBtn = document.querySelector('[data-testid="material-url-submit"]') as HTMLButtonElement
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith('亲，cookie 没准备好 (PatchedException)', 'error')
      // Call-budget lock (see comment above).
      expect(inboxSpy).toHaveBeenCalledTimes(1)
    })
    // Test exits cleanly — no uncaught exception thrown.
  })
})
