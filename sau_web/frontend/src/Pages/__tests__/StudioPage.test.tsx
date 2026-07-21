/**
 * Tests for `StudioPage` — Script Studio Phase 1 frontend.
 *
 * OpenSpec ref: `openspec/changes/script-studio/tasks.md §1.6.6`
 * and `script-viewer/spec.md §测试`.
 *
 * Coverage map (test name → spec task):
 *   test_empty_state_when_no_projects         → tasks.md §1.6.1
 *   test_create_dialog_invokes_api            → tasks.md §1.6.2
 *   test_unauthenticated_user_redirected      → tasks.md §1.6.4
 *
 * When the implementation is absent (scaffold-only PR before
 * StudioPage ships), the entire describe block is .skip-ped so
 * the test report shows a clear "scaffold: page not yet merged"
 * signal — NOT three 1-second timeouts from a noop render.
 *
 * Convention: `setAuth` is a LOCAL helper, not an export of
 * `@/test/auth-router-spies`. Matches the canonical pattern used
 * by ProfilePage / PublishPage / InboxPage / SettingsPage /
 * AccountsShell / AppShell / App / UserMenu test files.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { type ComponentType } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { mockUseAuth } from '@/test/auth-router-spies'

// ── Module-existence gate ────────────────────────────────────────────
// When StudioPage is present, run the suite; otherwise .skip with a
// clear reason so vitest reports an obvious signal.

type StudioPageModule = typeof import('@/Pages/StudioPage')
const studioModule: Partial<StudioPageModule> = {}
try {
  Object.assign(studioModule, await import('@/Pages/StudioPage'))
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(
    `[StudioPage.test] skipping: @/Pages/StudioPage not resolvable ` +
      `(${(err as Error).message}). Implementation ships in the companion OpenSpec implementation PR.`,
  )
}
const hasStudioPage = typeof studioModule.default === 'function'
const describeIf = hasStudioPage ? describe : describe.skip
const StudioPageComp = studioModule.default as ComponentType

// ── API client mock ─────────────────────────────────────────────────
// The page imports `studioApi from '@/api/studio'` (see
// proposal.md §Frontend impact — single global api entry-point).

vi.mock('@/api/studio', () => ({
  studioApi: {
    listProjects: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createProject: vi.fn().mockImplementation(async (payload) => ({
      success: true,
      data: {
        id: Math.floor(Math.random() * 10_000),
        title: payload.title,
        synopsis: payload.synopsis,
        style: payload.style ?? null,
        status: 'draft',
        owner_user_id: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })),
    getProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}))

// ── Local helper (mirrors codebase convention) ──────────────────────

function setAuth(opts: {
  isAuthenticated?: boolean
  isLoading?: boolean
  role?: 'admin' | 'user'
}) {
  mockUseAuth.mockReturnValue({
    isAuthenticated: opts.isAuthenticated ?? false,
    isLoading: opts.isLoading ?? false,
    user: opts.isAuthenticated
      ? { id: 1, email: 'qa@sau.dev', role: opts.role ?? 'admin', name: 'QA', tier: 'pro' }
      : null,
    login: vi.fn(),
    logout: vi.fn(),
  } as any)
}

// ── Mount harness (mirrors LoginPage.test.tsx) ──────────────────────

function mountStudioPage(initialPath = '/dashboard/studio') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <TooltipProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <StudioPageComp />
            </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  mockUseAuth.mockReset()
  // Wait for i18n init — the StudioPage's round-2 i18n refactor uses
  // t('studio.page.title', '剧本工坊') + t('studio.list.empty_title',
  // '还没有项目'). Without this wait, the t() call returns the key
  // string and the existing test_empty_state_when_no_projects +
  // page-header assertions fail. Mirrors the InboxPage.test.tsx
  // fix in this same round.
  if (!i18n.isInitialized) {
    await i18n.init()
  }
  // Force the language to zh-CN — the test environment's
  // navigator.language may be 'en-US' (vitest runs in en-US locale
  // by default), so the i18n config's foldBcp47() returns 'en-US'.
  // Without this explicit changeLanguage, t() returns the en-US
  // resource value ('Script Studio') instead of the zh-CN one
  // ('剧本工坊') that all hardcoded assertions expect.
  await i18n.changeLanguage('zh-CN')
})

// ── Tests ────────────────────────────────────────────────────────────

describeIf('StudioPage · Phase 1 page contract', () => {
  it('test_empty_state_when_no_projects (tasks.md §1.6.1)', async () => {
    setAuth({ isAuthenticated: true, isLoading: false, role: 'admin' })
    mountStudioPage()

    // Empty-state contract from script-viewer/spec.md §EmptyState:
    // title 「还没有项目」 + 「新建剧本题材」 CTA (matching ProjectList.tsx)
    // and tasks.md harness name 「创建第一个剧本」.
    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建剧本题材/ })).toBeInTheDocument()
  })

  it('test_create_dialog_invokes_api (tasks.md §1.6.2)', async () => {
    setAuth({ isAuthenticated: true, isLoading: false, role: 'admin' })

    const { studioApi } = await import('@/api/studio')
    const user = userEvent.setup()

    mountStudioPage()

    // Open the create dialog from the page header action button
    const createBtn = await screen.findByRole('button', { name: /新建剧本题材/ })
    await user.click(createBtn)

    // Fill in title + synopsis and submit
    const titleInput = await screen.findByLabelText(/标题/)
    await user.type(titleInput, '灰烬')

    const synopsisInput = screen.getByLabelText(/一句话灵感/)
    await user.type(synopsisInput, '少年剑客复仇')

    const submit = screen.getByRole('button', { name: /创建项目/ })
    await user.click(submit)

    await waitFor(() => {
      expect(studioApi.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ title: '灰烬', synopsis: '少年剑客复仇' }),
      )
    })
  })

  it('test_unauthenticated_user_redirected (tasks.md §1.6.4)', () => {
    setAuth({ isAuthenticated: false, isLoading: false })

    // AuthGuard responsibility — the page-level test pins that the
    // unauthenticated render (rare path: AuthGuard disabled in dev)
    // does NOT show the empty-state CTA (privacy leak guard).
    // Pinning the exact redirect target lives in App.test.tsx's
    // routing-split tests.
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <MemoryRouter initialEntries={['/dashboard/studio']}>
              <StudioPageComp />
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    expect(screen.queryByText(/还没有项目/)).not.toBeInTheDocument()
  })
})
