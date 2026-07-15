/**
 * Tests for `StudioDetailPage` — AI generate button + SSE stream handling.
 *
 * OpenSpec ref: `openspec/changes/studio-ai-script-generation/tasks.md`
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { mockUseAuth } from '@/test/auth-router-spies'
import StudioDetailPage from '@/Pages/StudioDetailPage'
import { readSSEStream, type SSEHandlers } from '@/api/sse'
import { studioApi, type StudioApiEnvelope, type StudioProject, type StudioEpisode, type StudioAsset } from '@/api/studio'

// TypeScript sees `studioApi` as the real module, but it is replaced by
// the vi.mock factory below. Use a deeply-mocked wrapper so mock methods
// (mockResolvedValue, mockReturnValue, etc.) are available.
const mockedStudioApi = vi.mocked(studioApi, true)

// `readSSEStream` is a named export; vi.mock replaces it at runtime but
// TypeScript keeps the original function type. Cast to Mock so vitest
// methods are available in the test body.
const mockedReadSSEStream = readSSEStream as Mock<typeof readSSEStream>

// ── Mocks ─────────────────────────────────────────────────────────────
vi.mock('@/api/sse', () => ({ readSSEStream: vi.fn() }))

vi.mock('@/Components/Studio/StudioRenderQuotaPill', () => ({
  StudioRenderQuotaPill: () => <div data-testid="quota-pill" />,
}))

vi.mock('@/Components/Studio/StudioUpsellModal', () => ({
  StudioUpsellModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="upsell-modal" /> : null,
}))

vi.mock('@/Components/Studio/EpisodeAppendDialog', () => ({
  EpisodeAppendDialog: ({ errorMessage }: { errorMessage?: string }) =>
    errorMessage ? <div data-testid="episode-dialog-error">{errorMessage}</div> : null,
}))

vi.mock('../../remotion_studio/presets', () => ({
  PRESETS: [{ id: 'classic', label: 'Classic', description: 'Classic preset' }],
  getPresetById: (id: string) =>
    ({ id, label: id, description: '' }) as any,
}))

vi.mock('@/api/studio', () => ({
  studioApi: {
    getProject: vi.fn(),
    ttsHealth: vi.fn(),
    getQuota: vi.fn(),
    generateEpisodes: vi.fn(),
  },
}))

// ── Local helpers ─────────────────────────────────────────────────────
function makeProject(
  overrides: Partial<{ synopsis: string; episodes: unknown[] }> = {},
): StudioApiEnvelope<StudioProject & { episodes: StudioEpisode[]; assets: StudioAsset[] }> {
  return {
    success: true,
    data: {
      id: 1,
      title: 'Test Project',
      synopsis: overrides.synopsis ?? 'A young warrior seeks revenge.',
      style: null,
      status: 'draft' as const,
      owner_user_id: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      episodes: (overrides.episodes ?? []) as StudioEpisode[],
      assets: [] as StudioAsset[],
    },
  }
}

function setAuth(opts: { isAuthenticated?: boolean; isLoading?: boolean } = {}) {
  mockUseAuth.mockReturnValue({
    isAuthenticated: opts.isAuthenticated ?? true,
    isLoading: opts.isLoading ?? false,
    user: opts.isAuthenticated !== false
      ? { id: 1, email: 'qa@sau.dev', role: 'admin', name: 'QA', tier: 'pro' }
      : null,
    login: vi.fn(),
    logout: vi.fn(),
  } as any)
}

function mountStudioDetailPage(initialPath = '/dashboard/studio/1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    qc,
    ...render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <Routes>
                <Route path="/dashboard/studio/:id" element={<StudioDetailPage />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    ),
  }
}

beforeEach(async () => {
  mockUseAuth.mockReset()
  mockedReadSSEStream.mockReset()
  mockedStudioApi.getProject.mockReset()
  mockedStudioApi.ttsHealth.mockReset()
  mockedStudioApi.getQuota.mockReset()
  mockedStudioApi.generateEpisodes.mockReset()

  setAuth({ isAuthenticated: true, isLoading: false })

  mockedStudioApi.ttsHealth.mockResolvedValue({
    success: true,
    data: { available: true, voice: 'zh-CN', default_voice: 'zh-CN', install_hint: '' },
  })
  mockedStudioApi.getQuota.mockResolvedValue({
    success: true,
    data: {
      tier: 'pro',
      quotas: {
        publish: { limit: -1, used: 0, remaining: -1, resets_at: null, is_unlimited: true, can_upgrade: false, required_tier: null },
        ai_generate: { limit: -1, used: 0, remaining: -1, resets_at: null, is_unlimited: true, can_upgrade: false, required_tier: null },
        accounts: { limit: -1, used: 0, remaining: -1, resets_at: null, is_unlimited: true, can_upgrade: false, required_tier: null },
        studio_render: { limit: -1, used: 0, remaining: -1, resets_at: null, is_unlimited: true, can_upgrade: false, required_tier: null },
      },
    },
  })

  if (!i18n.isInitialized) {
    await i18n.init()
  }
  await i18n.changeLanguage('zh-CN')
})

afterEach(async () => {
  await i18n.changeLanguage('zh-CN')
})

// ── Tests ────────────────────────────────────────────────────────────

describe('StudioDetailPage · AI generate button', () => {
  it('disables AI generate button when synopsis is empty', async () => {
    mockedStudioApi.getProject.mockResolvedValue(makeProject({ synopsis: '' }))

    mountStudioDetailPage()

    const button = await screen.findByTestId('ai-generate-button')
    expect(button).toBeDisabled()
  })

  it('enables AI generate button when synopsis is present', async () => {
    mockedStudioApi.getProject.mockResolvedValue(makeProject())

    mountStudioDetailPage()

    const button = await screen.findByTestId('ai-generate-button')
    expect(button).not.toBeDisabled()
  })

  it('shows generating state while streaming', async () => {
    mockedStudioApi.getProject.mockResolvedValue(makeProject())
    mockedStudioApi.generateEpisodes.mockReturnValue('http://localhost:6001/api/studio/projects/1/generate')

    let resolveStream: (() => void) | undefined
    mockedReadSSEStream.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStream = resolve
        }),
    )

    const user = userEvent.setup()
    mountStudioDetailPage()

    const button = await screen.findByTestId('ai-generate-button')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByTestId('ai-generate-button')).toBeDisabled()
      expect(screen.getByText('生成中…')).toBeInTheDocument()
    })

    resolveStream?.()

    await waitFor(() => {
      expect(screen.getByTestId('ai-generate-button')).not.toBeDisabled()
    })
  })

  it('calls readSSEStream with the generate endpoint when clicked', async () => {
    mockedStudioApi.getProject.mockResolvedValue(makeProject())
    mockedStudioApi.generateEpisodes.mockReturnValue('http://localhost:6001/api/studio/projects/1/generate')
    mockedReadSSEStream.mockResolvedValue(undefined)

    const user = userEvent.setup()
    mountStudioDetailPage()

    const button = await screen.findByTestId('ai-generate-button')
    await user.click(button)

    await waitFor(() => {
      expect(mockedReadSSEStream).toHaveBeenCalledWith(
        'http://localhost:6001/api/studio/projects/1/generate',
        {},
        expect.objectContaining({
          onChunk: expect.any(Function),
          onGenerationDone: expect.any(Function),
          onError: expect.any(Function),
        }),
        expect.any(AbortSignal),
      )
    })
  })

  it('invalidates project queries when generation completes', async () => {
    mockedStudioApi.getProject.mockResolvedValue(makeProject())
    mockedStudioApi.generateEpisodes.mockReturnValue('http://localhost:6001/api/studio/projects/1/generate')

    let generationDoneHandler: ((data: { episodes: unknown[] }) => void) | undefined
    mockedReadSSEStream.mockImplementation(async (_url: string, _payload: Record<string, unknown>, handlers: SSEHandlers) => {
      generationDoneHandler = handlers.onGenerationDone
      return Promise.resolve()
    })

    const { qc } = mountStudioDetailPage()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const button = await screen.findByTestId('ai-generate-button')
    await userEvent.setup().click(button)

    await waitFor(() => expect(mockedReadSSEStream).toHaveBeenCalled())

    generationDoneHandler?.({ episodes: [] })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['studio-project', 1] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['studio-projects'] })
    })
  })

  it('surfaces error message inline when generation fails', async () => {
    mockedStudioApi.getProject.mockResolvedValue(makeProject())
    mockedStudioApi.generateEpisodes.mockReturnValue('http://localhost:6001/api/studio/projects/1/generate')

    let errorHandler: ((msg: string) => void) | undefined
    mockedReadSSEStream.mockImplementation(async (_url: string, _payload: Record<string, unknown>, handlers: SSEHandlers) => {
      errorHandler = handlers.onError
      return Promise.resolve()
    })

    mountStudioDetailPage()

    const button = await screen.findByTestId('ai-generate-button')
    await userEvent.setup().click(button)

    await waitFor(() => expect(mockedReadSSEStream).toHaveBeenCalled())

    errorHandler?.('AI 生成失败')

    await waitFor(() => {
      const alert = screen.getByTestId('ai-generate-error')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveTextContent('AI 生成失败')
    })
  })

  it('clears inline error when the dismiss button is clicked', async () => {
    mockedStudioApi.getProject.mockResolvedValue(makeProject())
    mockedStudioApi.generateEpisodes.mockReturnValue('http://localhost:6001/api/studio/projects/1/generate')

    let errorHandler: ((msg: string) => void) | undefined
    mockedReadSSEStream.mockImplementation(async (_url: string, _payload: Record<string, unknown>, handlers: SSEHandlers) => {
      errorHandler = handlers.onError
      return Promise.resolve()
    })

    const user = userEvent.setup()
    mountStudioDetailPage()

    const button = await screen.findByTestId('ai-generate-button')
    await user.click(button)

    await waitFor(() => expect(mockedReadSSEStream).toHaveBeenCalled())

    errorHandler?.('AI 生成失败')

    await waitFor(() => {
      expect(screen.getByTestId('ai-generate-error')).toBeInTheDocument()
    })

    const dismiss = screen.getByLabelText('关闭错误提示')
    await user.click(dismiss)

    await waitFor(() => {
      expect(screen.queryByTestId('ai-generate-error')).not.toBeInTheDocument()
    })
  })
})
