import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  useAccountsDispatch,
  useAccountsState,
} from '@/features/accounts/AccountsProvider'
import { AccountsScrollContext } from '@/features/accounts/AccountsScrollContext'
import { GroupGridArea } from '@/features/accounts/GroupGridArea'
import { GroupListArea } from '@/features/accounts/GroupListArea'
import { GroupToolbar } from '@/features/accounts/GroupToolbar'
import { HomepageOverview } from '@/features/accounts/HomepageOverview'
import { DialogHost } from '@/features/accounts/dialogs'
import { ArrowUp, Plus, RefreshCw, Search, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Back-to-top after scrolling past this many body viewports. */
const BACK_TOP_THRESHOLD_VH = 0.9
/** Always show header when scrollTop is below this (px). */
const NEAR_TOP_PX = 48
/** Ignore single-frame deltas smaller than this (trackpad noise). */
const SCROLL_DELTA_MIN = 8

/** AccountsPage — wrapped by <AccountsProvider> in App.tsx so context
 *  survives Fast Refresh without tearing down provider state. */
export default function AccountsPage() {
  return <AccountsShell />
}

/**
 * Full-height shell:
 *   • Title + metrics auto-hide on scroll-down, return on scroll-up
 *   • Toolbar stays pinned (search/filter always reachable)
 *   • Focus inside header/metrics blocks auto-hide
 *   • 「回到顶部」 after deep scroll
 */
function AccountsShell() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()
  const navigate = useNavigate()

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  const headerFocusedRef = useRef(false)
  const rafRef = useRef(0)

  const [showBackTop, setShowBackTop] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  /** Title + metrics band (toolbar is separate & always pinned). */
  const [headerVisible, setHeaderVisible] = useState(true)
  /** Scroll element for tanstack-virtual (state so children re-bind). */
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)

  const setScrollNode = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node
    setScrollEl(node)
  }, [])

  const handleCreateGroup = useCallback(
    () => dispatch.setCreateDialogOpen(true),
    [dispatch],
  )
  const handleCheckAllStatus = useCallback(
    () => void dispatch.handleCheckAllStatus(),
    [dispatch],
  )
  const handleOpenTasks = useCallback(
    () => navigate({ to: '/dashboard/tasks', search: { focus: undefined } }),
    [navigate],
  )
  const handleOpenPublish = useCallback(
    () => navigate({ to: '/dashboard/publish' }),
    [navigate],
  )

  /** Apply scroll-driven chrome state — only setState when value flips. */
  const applyScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const st = el.scrollTop
    const delta = st - lastScrollTopRef.current
    const threshold = Math.max(240, el.clientHeight * BACK_TOP_THRESHOLD_VH)

    const nextBackTop = st > threshold
    const nextScrolled = st > 8
    setShowBackTop((v) => (v === nextBackTop ? v : nextBackTop))
    setScrolled((v) => (v === nextScrolled ? v : nextScrolled))

    // Near top or focusing header controls → always expand.
    if (st <= NEAR_TOP_PX || headerFocusedRef.current) {
      setHeaderVisible((v) => (v ? v : true))
      lastScrollTopRef.current = st
      return
    }

    if (Math.abs(delta) < SCROLL_DELTA_MIN) return

    if (delta > 0) {
      setHeaderVisible((v) => (v ? false : v))
    } else {
      setHeaderVisible((v) => (v ? v : true))
    }
    lastScrollTopRef.current = st
  }, [])

  const handleScroll = useCallback(() => {
    // Coalesce high-frequency wheel/trackpad events to one paint.
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      applyScrollState()
    })
  }, [applyScrollState])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const scrollToTop = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setHeaderVisible(true)
    el.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [])

  // Keep header open while interacting with its controls (search, buttons…).
  const onHeaderFocusIn = useCallback(() => {
    headerFocusedRef.current = true
    setHeaderVisible(true)
  }, [])
  const onHeaderFocusOut = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null
    if (next && headerRef.current?.contains(next)) return
    headerFocusedRef.current = false
  }, [])

  // Global "/" focuses search — ensure the band is open first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return
      setHeaderVisible(true)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    applyScrollState()
  }, [applyScrollState, state.filteredGroups.length, state.viewMode])

  const groupCount = state.filteredGroups.length
  const totalCount = state.localGroups.length
  const hasGroups = state.localGroups.length > 0

  return (
    <AccountsScrollContext.Provider value={scrollEl}>
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/*
        Auto-hide band: title + metrics only.
        Toolbar stays below so search/filter remain one glance away while
        browsing long group lists.
      */}
      <div
        ref={headerRef}
        onFocusCapture={onHeaderFocusIn}
        onBlurCapture={onHeaderFocusOut}
        className={cn(
          'grid shrink-0 transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
          headerVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        aria-hidden={!headerVisible}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              'relative border-b bg-background/80 backdrop-blur-2xl',
              'supports-[backdrop-filter]:bg-background/65',
              'transition-[border-color,box-shadow,opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
              headerVisible
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none -translate-y-1 opacity-0',
              scrolled ? 'border-border/40' : 'border-border/25',
            )}
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-20 right-[-5%] h-40 w-72 rounded-full bg-primary/[0.07] blur-3xl" />
              <div className="absolute -bottom-12 left-[15%] h-28 w-48 rounded-full bg-violet-400/[0.05] blur-3xl" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            </div>

            <div className="relative mx-auto w-full max-w-[1600px] space-y-2 px-4 py-2 sm:px-6 sm:py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary via-primary to-violet-500 text-primary-foreground shadow-[0_1px_2px_oklch(0.45_0.16_264_/_0.25),inset_0_1px_0_oklch(1_0_0_/_0.22)]">
                    <Users className="h-3.5 w-3.5" strokeWidth={2.25} />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1.5 top-1 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
                    />
                  </div>
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                      账号管理
                    </h1>
                    <span className="hidden text-[11px] tracking-wide text-muted-foreground/50 sm:inline">
                      分组 · 授权 · 拖拽
                    </span>
                  </div>
                </div>
                <HeaderActions />
              </div>

              <HomepageOverview
                onCreateGroup={handleCreateGroup}
                onCheckAllStatus={handleCheckAllStatus}
                onOpenTasks={handleOpenTasks}
                onOpenPublish={handleOpenPublish}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sticky toolbar — always available while groups exist */}
      {hasGroups && (
        <div
          className={cn(
            'relative z-20 shrink-0 border-b bg-background/85 backdrop-blur-xl',
            'supports-[backdrop-filter]:bg-background/70',
            'transition-[box-shadow,border-color] duration-300',
            scrolled || !headerVisible
              ? 'border-border/45 shadow-[0_6px_16px_-10px_oklch(0_0_0_/_0.12)]'
              : 'border-border/30',
          )}
        >
          <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 px-4 py-1.5 sm:gap-2.5 sm:px-6 sm:py-2">
            <div className="flex shrink-0 items-center gap-1.5 sm:min-w-[5.5rem]">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
                分组
              </h2>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border/40 bg-background/80 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-[inset_0_1px_0_oklch(1_0_0_/_0.04)]">
                {state.searchQuery || state.validityFilter !== 'all'
                  ? `${groupCount}/${totalCount}`
                  : totalCount}
              </span>
              {/* Hint that more chrome is available above when collapsed */}
              {!headerVisible && (
                <button
                  type="button"
                  onClick={() => {
                    setHeaderVisible(true)
                    // Soft nudge to top of body so NEAR_TOP keeps it open.
                    const el = scrollRef.current
                    if (el && el.scrollTop < NEAR_TOP_PX) return
                  }}
                  className="ml-0.5 hidden text-[10px] text-primary/70 transition-colors hover:text-primary sm:inline"
                  title="显示概览"
                >
                  概览
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <GroupToolbar />
            </div>
          </div>
        </div>
      )}

      {/* ── Group body ────────────────────────────────────────────────── */}
      <div
        ref={setScrollNode}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          aria-hidden
          className={cn(
            'pointer-events-none sticky top-0 z-10 -mb-3 h-2.5 transition-opacity duration-300',
            'bg-gradient-to-b from-background/60 to-transparent',
            scrolled ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div className="mx-auto w-full max-w-[1600px] px-4 py-3.5 sm:px-6 sm:py-4">
          <BodyArea />
        </div>
      </div>

      {/* ── Back to top ───────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="回到顶部"
        title="回到顶部"
        className={cn(
          'absolute bottom-5 right-5 z-30 flex h-10 items-center gap-1.5 rounded-full sm:bottom-6 sm:right-6',
          'border border-border/50 bg-background/90 px-3.5 text-[12px] font-medium text-foreground',
          'shadow-[0_4px_16px_-4px_oklch(0_0_0_/_0.12),0_1px_0_oklch(1_0_0_/_0.06)_inset]',
          'backdrop-blur-xl transition-all duration-200 ease-out',
          'hover:border-primary/35 hover:text-primary hover:shadow-[0_6px_20px_-4px_oklch(0.45_0.16_264_/_0.22)]',
          'active:scale-[0.97]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2',
          showBackTop
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-2.5 opacity-0',
        )}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
        </span>
        <span className="hidden sm:inline">回到顶部</span>
      </button>

      <DialogHost />
    </div>
    </AccountsScrollContext.Provider>
  )
}

function HeaderActions() {
  const dispatch = useAccountsDispatch()
  const state = useAccountsState()
  return (
    <div
      className="flex items-center gap-1.5 sm:gap-2"
      data-testid="page-header-actions"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => void dispatch.handleCheckAllStatus()}
        disabled={state.isCheckingStatus || state.groups.length === 0}
        className="h-8 gap-1.5 border-border/50 bg-background/60 shadow-none hover:bg-background"
        data-tour="check-all"
      >
        <RefreshCw
          className={cn('h-3.5 w-3.5', state.isCheckingStatus && 'animate-spin')}
        />
        <span className="hidden sm:inline">
          {state.isCheckingStatus ? '检测中…' : '一键检测'}
        </span>
      </Button>
      <Button
        size="sm"
        onClick={() => dispatch.setCreateDialogOpen(true)}
        data-tour="new-group"
        className="h-8 gap-1 shadow-[0_1px_2px_oklch(0.45_0.16_264_/_0.2),inset_0_1px_0_oklch(1_0_0_/_0.12)]"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
        <span className="hidden sm:inline">新建分组</span>
      </Button>
    </div>
  )
}

function BodyArea() {
  const state = useAccountsState()
  const dispatch = useAccountsDispatch()
  // No loading state — render content directly as soon as data arrives.
  // Previous skeleton screen was removed because the nested retry chain
  // (TanStack Query × axios) could keep `isLoading` true for 10+ seconds
  // even when the API already returned 200.
  if (state.groups.length === 0 && !state.isLoading) {
    // Initial empty (data fully loaded, no groups) — show empty state.
    if (!state.searchQuery && state.validityFilter === 'all') {
      return (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/40 bg-gradient-to-b from-muted/15 to-transparent px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/30 bg-background/80 shadow-sm">
            <Users className="h-5 w-5 text-muted-foreground/30" />
          </div>
          <p className="text-[13px] text-muted-foreground/60">
            创建第一个分组后，授权卡片会出现在这里
          </p>
        </div>
      )
    }
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/40 bg-gradient-to-b from-muted/15 to-transparent px-6 py-14 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/30 bg-background/80 shadow-sm">
          <Users className="h-5 w-5 text-muted-foreground/30" />
        </div>
        <p className="text-[13px] text-muted-foreground/60">
          创建第一个分组后，授权卡片会出现在这里
        </p>
      </div>
    )
  }
  if (state.filteredGroups.length === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-border/45 bg-muted/[0.08]">
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="未找到匹配的分组"
          description={`没有找到包含 "${state.searchQuery}" 的分组`}
          action={
            <Button size="sm" variant="outline" onClick={dispatch.handleClearSearch}>
              清除搜索
            </Button>
          }
        />
      </div>
    )
  }
  return state.viewMode === 'grid' ? <GroupGridArea /> : <GroupListArea />
}
