import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Outlet, Link, useNavigate, useRouterState } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

import { ThemeToggle } from '@/components/ThemeToggle'
import {
  BarChart3,
  Calendar,
  Clapperboard,
  FileText,
  HelpCircle,
  Inbox,
  LineChart,
  Loader2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Users,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/routes'
import { useInboxStore } from '@/stores/inboxStore'

const InboxJobQueue = lazy(() =>
  import('@/components/InboxJobQueue').then((m) => ({ default: m.InboxJobQueue })),
)

// Heavy dialog + task search — only download when the user hits ⌘K.
const CommandPalette = lazy(() =>
  import('@/components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
)

function resetOnboardingTour() {
  import('@/components/OnboardingTour').then((m) => m.resetOnboardingTour())
}

/** Skeleton screen for lazy-loaded route pages (∞ Suspense fallback).
 *  Mirrors the typical dashboard page layout: title bar, chip filters,
 *  and content rows — gives the user a smooth "content is coming" cue
 *  instead of a centered spinner. */
function PageLoader() {
  return (
    <div className="space-y-6 p-6">
      {/* PageHeader skeleton */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3.5 w-52" />
          </div>
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Chip filter bar skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-14 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>

      {/* Content area skeleton — table / list rows */}
      <div className="space-y-3">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-3/4 rounded-lg" />
      </div>
    </div>
  )
}

const MOBILE_BREAKPOINT = 768
const COLLAPSE_BREAKPOINT = 1024
const SIDEBAR_STORAGE_KEY = 'sau-sidebar-collapsed'

function getIsMobile() {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_BREAKPOINT
}

function getShouldAutoCollapse() {
  if (typeof window === 'undefined') return false
  return window.innerWidth > MOBILE_BREAKPOINT && window.innerWidth <= COLLAPSE_BREAKPOINT
}

function useViewport() {
  const [isMobile, setIsMobile] = useState(getIsMobile)
  const [shouldAutoCollapse, setShouldAutoCollapse] = useState(getShouldAutoCollapse)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT)
      setShouldAutoCollapse(
        window.innerWidth > MOBILE_BREAKPOINT && window.innerWidth <= COLLAPSE_BREAKPOINT,
      )
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return { isMobile, shouldAutoCollapse }
}

// Full historical dashboard nav (restored). Routes live under app/routes.
// Python Flask covers accounts/publish/tasks/logs/AI; other pages may
// show empty/degraded UI until matching /api routes exist.
const navItems = [
  { path: ROUTES.dashboard.root, label: '账号管理', icon: Users },
  { path: ROUTES.dashboard.publish, label: '发布中心', icon: Send },
  { path: ROUTES.dashboard.tasks, label: '任务列表', icon: BarChart3 },
  { path: ROUTES.dashboard.analytics, label: '数据分析', icon: LineChart },
  { path: ROUTES.dashboard.logs, label: '运行日志', icon: FileText },
  { path: ROUTES.dashboard.inbox, label: '下载中心', icon: Inbox },
  { path: ROUTES.dashboard.calendar, label: '内容日历', icon: Calendar },
  { path: ROUTES.dashboard.studio, label: '剧本工坊', icon: Clapperboard },
  { path: ROUTES.dashboard.crawl, label: '数据采集', icon: Search },
]

export default function AppShell() {
  const { isMobile, shouldAutoCollapse } = useViewport()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored !== null) return stored === 'true'
    return getShouldAutoCollapse()
  })
  const sidebarRef = useRef<HTMLElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Inbox downloads/transcribes continue in the module-level store when the
  // user leaves /dashboard/inbox — surface a live badge so background work
  // is visible from any dashboard page.
  const inboxInflight = useInboxStore((s) => s.inflightEntryIds.size)
  const inboxDownloading = useInboxStore(
    (s) =>
      s.entries.filter(
        (e) =>
          e.status === 'downloading' ||
          e.status === 'transcribing' ||
          e.status === 'subtitling',
      ).length,
  )
  const bgBusyCount = Math.max(inboxInflight, inboxDownloading)
  const onInboxPage =
    pathname === ROUTES.dashboard.inbox || pathname.startsWith(`${ROUTES.dashboard.inbox}/`)

  const prevAutoRef = useRef(shouldAutoCollapse)
  useEffect(() => {
    if (prevAutoRef.current !== shouldAutoCollapse) {
      setSidebarCollapsed(shouldAutoCollapse)
      prevAutoRef.current = shouldAutoCollapse
    }
  }, [shouldAutoCollapse])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
      return next
    })
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'k' &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable === true
      if (isTyping) return

      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        const el = document.querySelector<HTMLInputElement>('[data-search-input]')
        el?.focus()
        return
      }

      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        navigate({ to: '/dashboard/publish' })
        return
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lock document scroll while dashboard shell is mounted so only the
  // right-hand main pane scrolls (sidebar / top bar stay fixed).
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow
    const prevBody = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prevHtml
      document.body.style.overflow = prevBody
    }
  }, [])

  // Mobile layout — only the content pane scrolls (header + bottom nav fixed).
  if (isMobile) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
        <header className="z-50 flex h-14 shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
              <Zap className="h-3.5 w-3.5 text-background" />
            </div>
          </div>
          <ThemeToggle />
        </header>

        <main className="dashboard-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4 pb-24">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>

        {paletteOpen ? (
          <Suspense fallback={null}>
            <CommandPalette open onOpenChange={setPaletteOpen} />
          </Suspense>
        ) : null}

        <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/30 bg-background/80 backdrop-blur-xl">
          <div className="flex items-center justify-around py-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {navItems.map((item) => {
              const active = pathname === item.path
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-1.5 text-[10px] transition-all duration-150 rounded-xl",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                  to={item.path}
                >
                  <div className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150",
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "bg-muted/50"
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className={cn(active ? "font-medium" : "")}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    )
  }

  // Desktop layout — shell fills the viewport; ONLY the right main pane scrolls.
  // Sidebar / top bar stay fixed. `min-h-0` on flex children is required so
  // overflow-y-auto actually activates instead of growing the page.
  const isCollapsed = sidebarCollapsed
  const isTabletMode = shouldAutoCollapse

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {isTabletMode && !isCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-all"
          onClick={toggleSidebar}
        />
      )}

      <aside
        ref={sidebarRef}
        className={cn(
          "flex h-full shrink-0 flex-col border-r border-border/40 bg-sidebar transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isCollapsed ? "w-[60px]" : "w-[220px]",
          isTabletMode && !isCollapsed && "fixed inset-y-0 left-0 z-50 shadow-2xl"
        )}
      >
        {/* Logo */}
        <div className={cn(
          "flex items-center h-14 border-b border-border/30",
          isCollapsed ? "justify-center px-2" : "px-4 gap-3"
        )}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background flex-shrink-0">
            <Zap className="h-4 w-4" strokeWidth={2.5} />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[13px] font-semibold tracking-tight text-foreground">SAU Shell</span>
              <span className="text-[10px] text-muted-foreground/60">Social Auto Upload</span>
            </div>
          )}
          {!isCollapsed && (
            <button
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all duration-150"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Collapse button */}
        {isCollapsed && (
          <div className="flex justify-center py-3">
            <button
              className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all duration-150"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Navigation — scrolls inside sidebar if nav is long */}
        <ScrollArea className="min-h-0 flex-1 py-3">
          <nav className={cn("flex flex-col", isCollapsed ? "px-2" : "px-3")}>
            {!isCollapsed && (
              <div className="px-2 mb-1.5">
                <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-widest">
                  导航
                </span>
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {navItems.map((item) => {
                const active = pathname === item.path
                const Icon = item.icon
                const showInboxBadge =
                  item.path === ROUTES.dashboard.inbox && bgBusyCount > 0
                return (
                  <Link
                    key={item.path}
                    className={cn(
                      "group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-150",
                      isCollapsed ? "justify-center px-2 py-2 mx-0.5" : "px-2.5 py-2 mx-0.5 gap-2.5",
                      active
                        ? "bg-foreground/[0.08] text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
                    )}
                    to={item.path}
                    onClick={isTabletMode ? () => setSidebarCollapsed(true) : undefined}
                    data-tour={item.path === '/dashboard/publish' ? 'nav-publish' : undefined}
                  >
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-foreground" />
                    )}
                    <span className="relative flex-shrink-0">
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-all duration-150',
                          active
                            ? 'text-foreground'
                            : 'text-muted-foreground group-hover:text-foreground',
                        )}
                      />
                      {showInboxBadge && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground">
                          {bgBusyCount > 9 ? '9+' : bgBusyCount}
                        </span>
                      )}
                    </span>
                    {!isCollapsed && (
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate transition-all duration-150',
                          active && 'font-medium',
                        )}
                      >
                        {item.label}
                      </span>
                    )}
                    {!isCollapsed && showInboxBadge && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    )}
                    {isCollapsed && (
                      <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 whitespace-nowrap z-50 shadow-lg scale-95 group-hover:scale-100">
                        {item.label}
                        {showInboxBadge ? ` · ${bgBusyCount} 进行中` : ''}
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-foreground rotate-45" />
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className={cn(
          "border-t border-border/30",
          isCollapsed ? "p-2" : "p-3"
        )}>
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-muted/50 flex items-center justify-center">
                <span className="text-xs font-medium text-muted-foreground">S</span>
              </div>
              <ThemeToggle />
              <button
                onClick={resetOnboardingTour}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all duration-150"
                aria-label="重新引导"
                title="重新引导"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-1">
              <div className="h-8 w-8 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-medium text-muted-foreground">S</span>
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-foreground truncate">SAU Admin</span>
                <span className="text-[10px] text-muted-foreground/60">v1.0.0</span>
              </div>
              <button
                onClick={resetOnboardingTour}
                className="h-7 px-2 flex items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all duration-150 text-xs"
                aria-label="重新引导"
                title="重新触发新手引导"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                <span>重新引导</span>
              </button>
              <ThemeToggle />
            </div>
          )}
        </div>
      </aside>

      {/* Main Content — header fixed, only this column's main scrolls */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-border/50 bg-background/80 px-6 backdrop-blur-xl">
          {isTabletMode && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <Menu className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            <span>搜索</span>
            <kbd className="ml-1 hidden sm:inline-flex h-5 items-center px-1.5 rounded border border-border/40 bg-muted/40 text-[10px] font-mono text-muted-foreground">
              ⌘K
            </kbd>
          </Button>
        </header>

        {/* flex col + min-h-0 so pages can opt into full-height nested scroll
            (e.g. /dashboard accounts: sticky chrome + scrollable body). */}
        <main className="dashboard-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

{/* Global mini job queue — pinned top-right on non-inbox pages */}
       {!onInboxPage && bgBusyCount > 0 && (
         <Suspense fallback={null}>
           <InboxJobQueue pin="top" />
         </Suspense>
       )}

      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette open onOpenChange={setPaletteOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}
