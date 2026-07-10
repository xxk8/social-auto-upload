/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { mockUseAuth } from '@/test/auth-router-spies'

// ─────────────────────────────────────────────────────────────────────────
// StudioPage · i18n flip (round-2 dashboard-surface sweep)
//
// Mirrors AppShell.i18n.test.tsx + TasksPage.i18n.test.tsx structure:
// real <I18nextProvider i18n={i18n}> wrap (NOT a vi.mock stub) so the
// production changeLanguage codepath is exercised end-to-end. The
// studioApi is mocked at the data layer only; ProjectList +
// ProjectCard + their t() call sites run naturally so the
// labelKey/labelFallback resolution path is hit end-to-end.
//
// Test surface (3 specs):
//   (a) Initial zh-CN page chrome — page title + description +
//       create CTA render in Chinese
//   (b) Initial zh-CN project list empty state — empty title +
//       empty description render in Chinese (no projects seed)
//   (c) Switch to en-US flips page chrome + empty state (full
//       absorption: no zh-CN leakage) + round-trip persistence
// ─────────────────────────────────────────────────────────────────────────

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// studioApi mock — listProjects returns empty so the ProjectList
// empty state renders (covers the user-visible 「还没有项目」 path).
// createProject/deleteProject are stubbed for any future tests that
// exercise the create/delete mutation (not needed for the i18n
// surface, but kept for parity with StudioPage.test.tsx).
vi.mock('@/api/studio', () => ({
  studioApi: {
    listProjects: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createProject: vi.fn(),
    getProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}))

import StudioPage from './StudioPage'

function setAuth() {
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    user: { id: 1, email: 'qa@sau.dev', role: 'admin', name: 'QA', tier: 'pro' },
    login: vi.fn(),
    logout: vi.fn(),
  } as any)
}

function mountStudioPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <MemoryRouter initialEntries={['/dashboard/studio']}>
            <StudioPage />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  mockUseAuth.mockReset()
  setAuth()
  // Reset the i18next singleton to zh-CN at the start of every test
  // so subsequent changeLanguage() calls trigger a re-render.
  await i18n.changeLanguage('zh-CN')
})

describe('StudioPage · i18n flip', () => {
  // (a) Initial zh-CN page chrome — PageHeader title + description
  //     + create CTA render in Chinese via t() resolution.
  it('initial zh-CN: page title + description + create CTA render in Chinese', async () => {
    mountStudioPage()
    // Page title (h1)
    expect(
      screen.getByRole('heading', { name: '剧本工坊', level: 1 }),
    ).toBeInTheDocument()
    // Page description (single sentence from the page header)
    expect(
      screen.getByText(/把一句话灵感变成多集剧本/),
    ).toBeInTheDocument()
    // Create CTA button — scoped to role to disambiguate from any
    // "新建" substring elsewhere on the page (none in the empty
    // state, but defensive scoping is cheap).
    expect(
      screen.getByRole('button', { name: '新建剧本题材' }),
    ).toBeInTheDocument()
  })

  // (b) Initial zh-CN project list empty state — listProjects
  //     returns [] so the ProjectList empty state renders. Asserts
  //     the empty_title + empty_description resolve via
  //     studio.list.* key path.
  it('initial zh-CN: project list empty state (title + description) renders in Chinese', async () => {
    mountStudioPage()
    // Empty state title + description (rendered inside ProjectList)
    expect(await screen.findByText('还没有项目')).toBeInTheDocument()
    expect(
      screen.getByText(/创建第一个剧本项目/),
    ).toBeInTheDocument()
  })

  // (c) Switch to en-US flips page chrome + empty state. Absorption
  //     check: every zh-CN label from tests (a-b) is gone AND every
  //     en-US label is present. Round-trip restores Chinese labels.
  it('switching to en-US flips page chrome + empty state (full absorption + round-trip)', async () => {
    mountStudioPage()

    // Sanity: initial Chinese labels render
    expect(
      screen.getByRole('heading', { name: '剧本工坊', level: 1 }),
    ).toBeInTheDocument()
    expect(await screen.findByText('还没有项目')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    // Page chrome in English
    expect(
      screen.getByRole('heading', { name: 'Script Studio', level: 1 }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Turn a one-line spark into a multi-episode script/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'New project' }),
    ).toBeInTheDocument()
    // Empty state in English
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(
      screen.getByText(/Create your first script project/),
    ).toBeInTheDocument()

    // Absorption: every zh-CN label is gone
    expect(
      screen.queryByRole('heading', { name: '剧本工坊', level: 1 }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('还没有项目')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '新建剧本题材' }),
    ).not.toBeInTheDocument()

    // Round-trip back to zh-CN restores Chinese labels
    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })
    expect(
      screen.getByRole('heading', { name: '剧本工坊', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('还没有项目')).toBeInTheDocument()
    // English labels gone after round-trip
    expect(
      screen.queryByRole('heading', { name: 'Script Studio', level: 1 }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
  })
})
