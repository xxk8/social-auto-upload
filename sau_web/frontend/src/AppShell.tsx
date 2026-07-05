import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/Components/ui/button'
import { ScrollArea } from '@/Components/ui/scroll-area'
import { ThemeToggle } from './Components/ThemeToggle'
import { UserMenu } from './Components/UserMenu'
import { CommandPalette } from './Components/CommandPalette'
import { NotFound } from './Components/NotFound'
import { cn } from '@/lib/utils'
import { AuthGuard } from './features/auth/AuthGuard'
import { useAuth } from './features/auth/useAuth'
import { LogOut } from 'lucide-react'
import {
  BarChart3,
  FileText,
  Inbox,
  LineChart,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Terminal,
  Users,
} from 'lucide-react'

const AccountsPage = lazy(() => import('@/features/accounts/AccountsPage'))
const PublishPage = lazy(() => import('./Pages/PublishPage'))
const LogsPage = lazy(() => import('./Pages/LogsPage'))
const TasksPage = lazy(() => import('./Pages/TasksPage'))
const AnalyticsPage = lazy(() => import('./Pages/AnalyticsPage'))
const InboxPage = lazy(() => import('./Pages/InboxPage'))
const ProfilePage = lazy(() => import('./Pages/ProfilePage'))
const SettingsPage = lazy(() => import('./Pages/SettingsPage'))
const PersonalizationPage = lazy(() => import('./Pages/PersonalizationPage'))

const APP_NAME =
  (import.meta.env.VITE_APP_NAME && import.meta.env.VITE_APP_NAME.trim()) || 'sau'
const APP_GIT_SHA = (
  (import.meta.env.VITE_GIT_SHA && import.meta.env.VITE_GIT_SHA.trim()) ||
  'dev'
).slice(0, 7)

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        <span className="text-sm text-muted-foreground">加载中...</span>
      </div>
    </div>
  )
}

const MOBILE_BREAKPOINT = 768
const COLLAPSE_BREAKPOINT = 1024
export const SIDEBAR_STORAGE_KEY = 'sau-sidebar-collapsed'

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

const navItems = [
  { path: '/app', label: '账号管理', icon: Users },
  { path: '/app/publish', label: '发布中心', icon: Send },
  { path: '/app/tasks', label: '任务列表', icon: BarChart3 },
  { path: '/app/analytics', label: '数据分析', icon: LineChart },
  { path: '/app/logs', label: '运行日志', icon: FileText },
  { path: '/app/inbox', label: '素材收件箱', icon: Inbox },
]

export function AppShell() {
  const { isMobile, shouldAutoCollapse } = useViewport()
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored !== null) return stored === 'true'
    return getShouldAutoCollapse()
  })
  const sidebarRef = useRef<HTMLElement>(null)

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

  const navigate = useNavigate()
  const { user: authUser, logout } = useAuth()
  const handleLogout = useCallback(async () => {
    await logout()
    navigate('/', { replace: true })
  }, [logout, navigate])
  const [paletteOpen, setPaletteOpen] = useState(false)

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
        navigate('/app/publish')
        return
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mobile layout
  if (isMobile) {
    return (
      <div className="flex flex-col min-h-dvh bg-background">
        <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b bg-background/80 backdrop-blur-xl px-4">
          <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-foreground">
            <Terminal className="h-3.5 w-3.5 text-background" strokeWidth={2.5} />
          </div>
            <span className="font-mono text-[11px] text-muted-foreground/80 tabular-nums">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu mode="mobile" />
          </div>
        </header>

        <main className="flex-1 p-4 pb-20">
          <Suspense fallback={<PageLoader />}>
            <Routes location={location}>
              <Route path="/" element={<AuthGuard><AccountsPage /></AuthGuard>} />
              <Route path="/publish" element={<AuthGuard><PublishPage /></AuthGuard>} />
              <Route path="/logs" element={<AuthGuard><LogsPage /></AuthGuard>} />
              <Route path="/tasks" element={<AuthGuard><TasksPage /></AuthGuard>} />
              <Route path="/analytics" element={<AuthGuard><AnalyticsPage /></AuthGuard>} />
              <Route path="/inbox" element={<AuthGuard><InboxPage /></AuthGuard>} />
              <Route path="/account" element={<AuthGuard><ProfilePage /></AuthGuard>} />
              <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
              <Route path="/personalization" element={<AuthGuard><PersonalizationPage /></AuthGuard>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

        <nav
          aria-label="主导航"
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/40 bg-background/85 backdrop-blur-xl shadow-[0_-1px_0_var(--border),0_-8px_24px_-12px_rgba(0,0,0,0.08)]"
        >
          <div className="flex items-stretch justify-around gap-1 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {navItems.map((item) => {
              const active = location.pathname === item.path
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  className={cn(
                    "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1.5 px-2 py-1 text-xs transition-all duration-150 rounded-xl select-none",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground active:scale-[0.98]"
                  )}
                  to={item.path}
                >
                  <div className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-150",
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "bg-muted/40"
                  )}>
                    <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
                  </div>
                  <span className={cn("leading-tight", active ? "font-medium" : "")}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    )
  }

  const isCollapsed = sidebarCollapsed
  const isTabletMode = shouldAutoCollapse

  return (
    <div className="flex h-dvh bg-background">
      {isTabletMode && !isCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-all"
          onClick={toggleSidebar}
        />
      )}

      <aside
        ref={sidebarRef}
        data-testid="app-shell-sidebar"
        className={cn(
          "flex flex-col border-r border-border/40 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] bg-sidebar",
          isCollapsed ? "w-[60px]" : "w-[260px]",
          isTabletMode && !isCollapsed && "fixed inset-y-0 left-0 z-50 shadow-2xl"
        )}
      >
        {/* Brand mark */}
        <div className={cn(
          "flex items-center h-14 border-b border-border/30",
          isCollapsed ? "justify-center px-2" : "px-4 gap-3"
        )}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background flex-shrink-0">
            <Terminal className="h-4 w-4" strokeWidth={2.5} />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-mono text-[13px] font-semibold tracking-tight text-foreground">{APP_NAME}</span>
              <span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums tracking-wide">build {APP_GIT_SHA}</span>
            </div>
          )}
          {!isCollapsed && (
            <button
              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-all hover:scale-105 active:scale-95"
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
              className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-all hover:scale-105 active:scale-95"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Navigation */}
        <ScrollArea className="flex-1 py-3">
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
                const active = location.pathname === item.path
                const Icon = item.icon
                return (
                  <Link
                    key={item.path}
                    className={cn(
                      "group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-150",
                      isCollapsed ? "justify-center px-2 py-2 mx-0.5" : "px-2.5 py-2 mx-0.5 gap-2.5",
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
                    )}
                    to={item.path}
                    onClick={isTabletMode ? () => setSidebarCollapsed(true) : undefined}
                    data-tour={item.path === '/publish' ? 'nav-publish' : undefined}
                  >
                    {/* Active indicator */}
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-primary" />
                    )}
                    <Icon className={cn(
                      "h-4 w-4 shrink-0 transition-colors duration-150",
                      active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                    )} />
                    {!isCollapsed && (
                      <span className={cn(
                        "truncate transition-colors duration-150",
                        active && "font-medium"
                      )}>
                        {item.label}
                      </span>
                    )}
                    {isCollapsed && (
                      <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 whitespace-nowrap z-50 shadow-lg scale-95 group-hover:scale-100">
                        {item.label}
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
        <div
          data-testid="app-shell-sidebar-footer"
          className={cn(
            "border-t border-border/30",
            isCollapsed ? "p-2" : "px-3 py-4"
          )}
        >
          {isCollapsed ? (
            <div
              data-testid="app-shell-sidebar-footer-collapsed"
              className="flex flex-col items-center gap-1.5"
            >
              <UserMenu mode="collapsed" />
              <ThemeToggle size="compact" />
              <button
                onClick={handleLogout}
                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                aria-label="登出"
                title="登出"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div
              data-testid="app-shell-sidebar-footer-expanded"
              className="flex items-center gap-3.5"
            >
              <UserMenu mode="expanded" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[14px] font-medium text-foreground truncate leading-tight" data-testid="app-shell-sidebar-email">{authUser?.email ?? "管理员"}</span>
                <span className="mt-0.5 text-[12px] text-muted-foreground/70 font-medium leading-tight">{authUser?.role === 'admin' ? '管理员' : '用户'}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleLogout}
                  className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                  aria-label="登出"
                  title="登出"
                >
                  <LogOut className="h-4 w-4" />
                </button>
                <ThemeToggle />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border/50 bg-background/80 backdrop-blur-xl px-6">
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/80 tabular-nums select-none">
            <span className="text-foreground/90">{APP_NAME}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>build {APP_GIT_SHA}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--status-success-fg)' }}
              />
              ws ok
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-foreground/90">mainline</span>
          </div>
          <div className="flex items-center gap-2">
            {isTabletMode && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar} aria-label="Toggle sidebar">
                <Menu className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              className="gap-2 text-muted-foreground hover:text-foreground btn-elegant"
            >
              <Search className="h-3.5 w-3.5" />
              <span>搜索</span>
              <kbd className="ml-1 hidden sm:inline-flex h-5 items-center px-1.5 rounded border border-border/40 bg-muted/40 text-[10px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <Suspense fallback={<PageLoader />}>
                <Routes location={location}>
                  <Route path="/" element={<AuthGuard><AccountsPage /></AuthGuard>} />
                  <Route path="/publish" element={<AuthGuard><PublishPage /></AuthGuard>} />
                  <Route path="/logs" element={<AuthGuard><LogsPage /></AuthGuard>} />
                  <Route path="/tasks" element={<AuthGuard><TasksPage /></AuthGuard>} />
                  <Route path="/analytics" element={<AuthGuard><AnalyticsPage /></AuthGuard>} />
                  <Route path="/inbox" element={<AuthGuard><InboxPage /></AuthGuard>} />
                  <Route path="/account" element={<AuthGuard><ProfilePage /></AuthGuard>} />
                  <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
                  <Route path="/personalization" element={<AuthGuard><PersonalizationPage /></AuthGuard>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

import {
  PreferencesDialog,
  PreferencesDialogProvider,
} from '@/features/preferences'

function AppShellWithPrefs() {
  return (
    <PreferencesDialogProvider>
      <AppShell />
      <PreferencesDialog />
    </PreferencesDialogProvider>
  )
}

export default AppShellWithPrefs