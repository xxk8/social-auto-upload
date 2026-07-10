/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@/Components/ui/tooltip'
import { ToastProvider } from '@/Components/ui/toast'
import i18n from '@/lib/i18n/config'
import { makeQueryClient } from '@/test/render-harness.helpers'

// ─────────────────────────────────────────────────────────────────────────
// PublishPage · i18n flip (round-2 dashboard-surface sweep)
//
// Mirrors AppShell.i18n.test.tsx + TasksPage.i18n.test.tsx structure:
// real <I18nextProvider i18n={i18n}> wrap (NOT a vi.mock stub) so the
// production changeLanguage codepath is exercised end-to-end.
//
// Test surface (8 specs) — bounded to the user's round-2 scope:
//   (a) Initial zh-CN wizard step labels (上传 / 内容 / 确认)
//   (b) Initial zh-CN wizard nav buttons (上一步 / 下一步) + aria-label
//   (c) Initial zh-CN VideoForm placeholders + submit CTA (title/desc/tags
//       placeholders + 提交视频 + 清空) when wizard mode='video'
//   (d) Initial zh-CN NoteForm placeholders + submit CTA when mode='note'
//   (e) Switch to en-US flips step labels + nav buttons (full absorption)
//   (f) Switch to en-US flips VideoForm placeholders + submit CTA
//   (g) zh-CN → en-US → zh-CN round-trip restores Chinese chrome
//   (h) Validation messages flip (click submit with empty form →
//       "请输入标题" / "Please enter a title")
//
// The PublishPage is the most complex surface in the dashboard — it
// composes 6 custom hooks (useAccounts/useTasks/useAccountGroups/
// usePublishStore/usePublishWizardStore/useSearchParams/useMobileDrawer)
// + 3 lazy children. We mock the data layer (hooks + stores) and let
// the wizard tree render naturally so the i18n resolution path is
// exercised end-to-end.
// ─────────────────────────────────────────────────────────────────────────

// ── Data hook mocks (return empty arrays so the wizard tree renders
//    its empty-state chrome rather than crashing on missing groups) ─

vi.mock('../hooks/useTasks', () => ({
  useAccounts: () => ({ data: [], refetch: vi.fn() }),
  useTasks: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
}))

vi.mock('../hooks/useAccountGroups', () => ({
  useAccountGroups: () => ({ data: [] }),
  // The real module also exports `useAuthorizeAccountGroup` and
  // `useConfirmAuthorizeAccountGroup` (consumed by LoginProgressModal
  // and other account-group flows). Both are no-ops here since the
  // publish chrome doesn't exercise them, but vi.mock requires the
  // factory to define every named export the test tree transitively
  // imports.
  useAuthorizeAccountGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useConfirmAuthorizeAccountGroup: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useMobileDrawer', () => ({
  useMobileDrawer: () => ({
    isMobile: false,
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
  }),
}))

// ── Stub child components OUTSIDE this round's i18n scope ────────
// PublishAiSidebar / PublishStatsBar / PublishSuccessBanner have
// their own dependencies (useChat, useAiChat, etc.) that would
// require a separate mock chain. None of them carry chrome this
// round's i18n sweep targets, so a light stub is sufficient — the
// `data-testid` makes intent obvious to future readers.
vi.mock('../features/publish/PublishSuccessBanner', () => ({
  PublishSuccessBanner: () => <div data-testid="stub-success-banner" />,
}))
vi.mock('../features/publish/PublishStatsBar', () => ({
  PublishStatsBar: () => <div data-testid="stub-stats-bar" />,
}))
vi.mock('../Components/AiRightPanel/PublishAiSidebar', () => ({
  PublishAiSidebar: () => <div data-testid="stub-ai-sidebar" />,
}))
vi.mock('../Components/AiRightPanel/MobileAiDrawer', () => ({
  MobileAiDrawer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stub-mobile-ai-drawer">{children}</div>
  ),
}))

// ── Store mocks — `wizardMode` and `lastTaskIds` are read by
//    PublishPage; we keep them at the defaults (mode='video',
//    lastTaskIds=[]) so the page chrome is stable. Tests (c) and (d)
//    swap mode via `vi.mocked(usePublishWizardStore).mockImplementation`
//    to exercise the VideoForm vs NoteForm chrome surfaces. ─

let mockWizardMode: 'video' | 'note' = 'video'
let mockGroupSelection: any = null

vi.mock('../stores/publishStore', () => ({
  usePublishStore: (selector: any) => {
    const state = {
      lastTaskIds: [],
      submitSuccess: null,
      setLastTaskIds: vi.fn(),
      setSubmitSuccess: vi.fn(),
    }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

vi.mock('../stores/publishWizardStore', () => ({
  usePublishWizardStore: (selector: any) => {
    const state = {
      mode: mockWizardMode,
      currentStep: 0,
      setStep: vi.fn(),
      nextStep: vi.fn(),
      prevStep: vi.fn(),
      canProceed: () => true,
      proceedReason: () => null,
      reset: vi.fn(),
      groupSelection: mockGroupSelection,
      setGroupSelection: vi.fn(),
      files: { file: null, images: [] },
      content: { title: '', desc: '', note: '', tags: [], schedule: '' },
      clearFiles: vi.fn(),
      clearContent: vi.fn(),
    }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

// ── Lazy import AFTER vi.mock declarations ─────────────────────────────
import PublishPage from './PublishPage'

function mountPublishPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={makeQueryClient()}>
        <TooltipProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={['/dashboard/publish']}>
              <PublishPage />
            </MemoryRouter>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function setMode(mode: 'video' | 'note') {
  mockWizardMode = mode
}

describe('PublishPage · i18n flip', () => {
  beforeEach(async () => {
    mockWizardMode = 'video'
    mockGroupSelection = null
    localStorage.removeItem('sau-ui-locale')
    await i18n.changeLanguage('zh-CN')
  })

  // (a) Initial zh-CN wizard step labels (3 steps inside the step indicator)
  it('initial zh-CN: wizard step labels render in Chinese (上传 / 内容 / 确认)', () => {
    mountPublishPage()
    const stepList = screen.getByRole('list', { name: '发布向导步骤' })
    expect(within(stepList).getByText('上传')).toBeInTheDocument()
    expect(within(stepList).getByText('内容')).toBeInTheDocument()
    expect(within(stepList).getByText('确认')).toBeInTheDocument()
  })

  // (b) Initial zh-CN wizard nav buttons + aria-label
  it('initial zh-CN: wizard nav buttons render in Chinese (上一步 / 下一步)', () => {
    mountPublishPage()
    // 「上一步」 is hidden at opacity-0 on step 0 but still in the
    // accessibility tree — queryByRole returns it. We use a
    // presence check (not getByRole with name) to avoid the
    // opacity-0 quirk.
    expect(screen.getAllByText('上一步').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('下一步')).toBeInTheDocument()
  })

  // (c) Initial zh-CN VideoForm placeholders + submit CTA
  it('initial zh-CN (video mode): VideoForm placeholders + submit button render in Chinese', () => {
    setMode('video')
    mountPublishPage()
    // Title placeholder
    expect(
      screen.getByPlaceholderText('请输入视频标题（建议 6-20 字）'),
    ).toBeInTheDocument()
    // Desc placeholder
    expect(
      screen.getByPlaceholderText('补充视频简介、背景说明或发布备注'),
    ).toBeInTheDocument()
    // Tags placeholder (appears in both VideoForm and TagInput's
    // empty-state hint; assert via single instance)
    expect(
      screen.getAllByPlaceholderText('按 Enter 添加标签（# 可省略）').length,
    ).toBeGreaterThanOrEqual(1)
    // Submit button
    expect(screen.getByText('提交视频')).toBeInTheDocument()
    // Clear button
    expect(screen.getByText('清空')).toBeInTheDocument()
  })

  // (d) Initial zh-CN NoteForm placeholders + submit CTA
  it('initial zh-CN (note mode): NoteForm placeholders + submit button render in Chinese', () => {
    setMode('note')
    mountPublishPage()
    // Title placeholder
    expect(screen.getByPlaceholderText('请输入图文标题')).toBeInTheDocument()
    // Content placeholder
    expect(
      screen.getByPlaceholderText('请输入图文正文，多行内容会自动换行显示'),
    ).toBeInTheDocument()
    // Tags placeholder
    expect(
      screen.getAllByPlaceholderText('按 Enter 添加标签（# 可省略）').length,
    ).toBeGreaterThanOrEqual(1)
    // Submit button
    expect(screen.getByText('提交图文')).toBeInTheDocument()
  })

  // (e) Switch to en-US flips step labels + nav buttons
  it('switching to en-US flips wizard step labels + nav buttons', async () => {
    mountPublishPage()
    // Sanity: initial Chinese labels
    expect(screen.getByRole('list', { name: '发布向导步骤' })).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    // Step labels in English
    const stepList = screen.getByRole('list', { name: 'Publish wizard steps' })
    expect(within(stepList).getByText('Upload')).toBeInTheDocument()
    expect(within(stepList).getByText('Content')).toBeInTheDocument()
    expect(within(stepList).getByText('Review')).toBeInTheDocument()
    // Absorption: zh-CN step labels gone
    expect(within(stepList).queryByText('上传')).not.toBeInTheDocument()
    expect(within(stepList).queryByText('内容')).not.toBeInTheDocument()

    // Nav buttons in English
    expect(screen.getByText('Next')).toBeInTheDocument()
    // 「上一步」 absorption
    expect(screen.queryByText('上一步')).not.toBeInTheDocument()
  })

  // (f) Switch to en-US flips VideoForm placeholders + submit CTA
  it('switching to en-US flips VideoForm placeholders + submit button', async () => {
    setMode('video')
    mountPublishPage()
    // Sanity: initial Chinese placeholders
    expect(
      screen.getByPlaceholderText('请输入视频标题（建议 6-20 字）'),
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    // English placeholders
    expect(
      screen.getByPlaceholderText('Enter video title (6-20 chars recommended)'),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Add a description, background notes, or posting remarks'),
    ).toBeInTheDocument()
    // Submit button in English
    expect(screen.getByText('Submit video')).toBeInTheDocument()
    // Clear button in English
    expect(screen.getByText('Clear')).toBeInTheDocument()
    // Chinese placeholders gone
    expect(
      screen.queryByPlaceholderText('请输入视频标题（建议 6-20 字）'),
    ).not.toBeInTheDocument()
  })

  // (g) Round-trip persistence — zh-CN → en-US → zh-CN
  it('zh-CN → en-US → zh-CN round-trip restores Chinese wizard chrome', async () => {
    setMode('video')
    mountPublishPage()
    expect(
      screen.getByPlaceholderText('请输入视频标题（建议 6-20 字）'),
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    expect(
      screen.getByPlaceholderText('Enter video title (6-20 chars recommended)'),
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })
    // Chinese restored
    expect(
      screen.getByPlaceholderText('请输入视频标题（建议 6-20 字）'),
    ).toBeInTheDocument()
    expect(screen.getByText('提交视频')).toBeInTheDocument()
    // English gone
    expect(
      screen.queryByPlaceholderText('Enter video title (6-20 chars recommended)'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Submit video')).not.toBeInTheDocument()
  })

  // (h) Validation messages flip with locale. Three guards fire in
  //     order: no_group → no_file → no_title. We assert on the first
  //     two (reachable by toggling `mockGroupSelection`); the third
  //     (no_title) requires a non-null `fileRef.current` which can't
  //     be set from the test without firing a real file-input change
  //     event — deferred to a future round.
  it('validation messages flip with locale — no_group guard (groupSelection=null)', async () => {
    setMode('video')
    mockGroupSelection = null
    mountPublishPage()
    screen.getByText('提交视频').click()
    expect(
      await screen.findByText('请先在上方选择发布账号组和平台'),
      'expected zh-CN no_group validation toast',
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    screen.getByText('Submit video').click()
    expect(
      await screen.findByText('Please select an account group and platforms above first'),
      'expected en-US no_group validation toast',
    ).toBeInTheDocument()
  })

  it('validation messages flip with locale — no_file guard (groupSelection set, no file)', async () => {
    setMode('video')
    mockGroupSelection = {
      groupId: 1,
      groupName: 'qa',
      platforms: ['douyin'],
      mappings: [{ platform: 'douyin', cookieFile: 'cookie.json', authId: 1 }],
    }
    mountPublishPage()
    screen.getByText('提交视频').click()
    expect(
      await screen.findByText('请选择视频文件'),
      'expected zh-CN no_file validation toast',
    ).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
    screen.getByText('Submit video').click()
    expect(
      await screen.findByText('Please choose a video file'),
      'expected en-US no_file validation toast',
    ).toBeInTheDocument()
  })
})
