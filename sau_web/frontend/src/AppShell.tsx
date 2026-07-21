import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { ROUTES, RELATIVE_DASHBOARD_ROUTES, type DashboardRoute, type AdminRoute } from '@/routes'
import type { LucideIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/Components/ui/button'
import { ScrollArea } from '@/Components/ui/scroll-area'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/Components/ui/breadcrumb'
import { ThemeToggle } from './Components/ThemeToggle'
import { UserMenu } from './Components/UserMenu'
import { CommandPalette } from './Components/CommandPalette'
import { KeyboardShortcutsCheatSheet } from './Components/KeyboardShortcutsCheatSheet'
import { SidebarNav } from './Components/SidebarNav'
import { NotFound } from './Components/NotFound'
import { cn } from '@/lib/utils'
import { AuthGuard } from './features/auth/AuthGuard'
import { AuthLoadingSkeleton } from './features/auth/AuthLoadingSkeleton'
import { useAuth } from './features/auth/useAuth'
import { PreferencesDialogProvider } from '@/features/preferences'
import { usePreferencesDialog } from '@/features/preferences/PreferencesDialogProvider'
import { usePreferencesShortcut } from '@/features/preferences/shared/usePreferencesShortcut'
import {
  BarChart3,
  Calendar,
  Clapperboard,
  FileText,
  HelpCircle,
  Inbox,
  LineChart,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Shield,
  Terminal,
  Users,
} from 'lucide-react'

const AccountsPage = lazy(() => import('@/features/accounts/AccountsPage'))
const PublishPage = lazy(() => import('./Pages/PublishPage'))
const LogsPage = lazy(() => import('./Pages/LogsPage'))
const TasksPage = lazy(() => import('./Pages/TasksPage'))
const AnalyticsPage = lazy(() => import('./Pages/AnalyticsPage'))
const InboxPage = lazy(() => import('./Pages/InboxPage'))
const CalendarPage = lazy(() => import('./Pages/CalendarPage'))
const ProfilePage = lazy(() => import('./Pages/ProfilePage'))
const SettingsPage = lazy(() => import('./Pages/SettingsPage'))
const PersonalizationPage = lazy(() => import('./Pages/PersonalizationPage'))
const AdminOverviewPage = lazy(() => import('./features/admin/AdminOverviewPage'))
const AdminUsersPage = lazy(() => import('./features/admin/AdminUsersPage'))
const AdminAuditPage = lazy(() => import('./features/admin/AdminAuditPage'))
// Script Studio (Phase 1 of openspec/changes/script-studio).
// Lives in `/Pages` because it's a top-level Web Shell page (mirrors
// InboxPage / PublishPage / LogsPage), not a feature — `useStudioStore`
// and `Studio/ProjectList`/`Studio/ProjectCreateDialog` are siblings in
// `Components/Studio/`.
const StudioPage = lazy(() => import('./Pages/StudioPage'))
const StudioDetailPage = lazy(() => import('./Pages/StudioDetailPage'))
const CrawlPage = lazy(() => import('./Pages/CrawlPage'))

const APP_NAME =
  (import.meta.env.VITE_APP_NAME && import.meta.env.VITE_APP_NAME.trim()) || 'sau'
const APP_GIT_SHA = (
  (import.meta.env.VITE_GIT_SHA && import.meta.env.VITE_GIT_SHA.trim()) ||
  'dev'
).slice(0, 7)

const MODIFIER_LABEL =
  typeof navigator !== 'undefined' && /mac|darwin/i.test(navigator.platform)
    ? '⌘'
    : 'Ctrl+'

// Round-OPT-3J follow-up: <Suspense> fallbacks now render the shared
// `AuthLoadingSkeleton` (features/auth/AuthLoadingSkeleton.tsx) —
// the same chrome + sketched content-area contract as the AuthGuard
// auth window. A slow lazy chunk paints identically to a slow
// /api/auth/me: chrome stays mounted, content area gets a generic
// PageHeader + 3 content-block placeholder. No "加载中…" overlay,
// no layout jank. The error path still surfaces via the hoisted
// ErrorBoundary card.

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

// Typed nav-item manifests. Each `path` is constrained to a specific
// route union from `routes.ts` so the IDE catches typos at the call
// site (e.g. `path: '/dashbord/admin/users'` fails the type check
// instead of silently 404ing in production). The narrower unions
// (`DashboardRoute` for the main nav, `AdminRoute` for the admin
// group) catch MORE typos than the broadest `Route` would — e.g. a
// public path like `/login` accidentally dropped into the admin nav
// fails the `AdminRoute` check, not just the `Route` check.
interface DashboardNavItem {
  path: DashboardRoute
  label: string
  icon: LucideIcon
  shortcut: string
}

interface AdminNavItem {
  path: AdminRoute
  label: string
  icon: LucideIcon
  children?: readonly AdminNavItem[]
}

// Locale-key manifests for the static nav. Resolved inside the
// AppShell component via `useTranslation()` — `labelKey` is the
// dotted-path into the resource bundles, `labelFallback` is the
// zh-CN string used when i18n init hasn't completed yet (e.g. SSR)
// OR when the key is missing in the active resource. Mirrors
// MarketingTopBar.tsx's NAV_ITEMS shape; full rationale in
// `docs/dev/adr-i18n-invariant.md` (flat-namespace rule).
interface DashboardNavItemDef {
  path: DashboardRoute
  labelKey: string
  labelFallback: string
  icon: LucideIcon
  shortcut: string
}

interface AdminNavItemDef {
  path: AdminRoute
  labelKey: string
  labelFallback: string
  icon: LucideIcon
  children?: readonly AdminNavItemDef[]
}const DASHBOARD_NAV_DEFS: readonly DashboardNavItemDef[] = [
  { path: ROUTES.dashboard.root, labelKey: 'dashboard.sidebar.nav.accounts', labelFallback: '账号管理', icon: Users, shortcut: '1' },
  { path: ROUTES.dashboard.publish, labelKey: 'dashboard.sidebar.nav.publish', labelFallback: '发布中心', icon: Send, shortcut: '2' },
  { path: ROUTES.dashboard.tasks, labelKey: 'dashboard.sidebar.nav.tasks', labelFallback: '任务列表', icon: BarChart3, shortcut: '3' },
  { path: ROUTES.dashboard.analytics, labelKey: 'dashboard.sidebar.nav.analytics', labelFallback: '数据分析', icon: LineChart, shortcut: '4' },
  { path: ROUTES.dashboard.logs, labelKey: 'dashboard.sidebar.nav.logs', labelFallback: '运行日志', icon: FileText, shortcut: '5' },
  { path: ROUTES.dashboard.inbox, labelKey: 'dashboard.sidebar.nav.inbox', labelFallback: '下载中心', icon: Inbox, shortcut: '6' },
  { path: ROUTES.dashboard.calendar, labelKey: 'dashboard.sidebar.nav.calendar', labelFallback: '内容日历', icon: Calendar, shortcut: '7' },
  // Studio (Script Studio) — Phase 1 of openspec/changes/script-studio.
  // Shortcut '8' lands cleanly because no existing navItemDef claims '8';
  // the existing resolved `navItems.find((n) => n.shortcut === e.key)`
  // handler inside the component picks it up automatically. Phase 2
  // will add the detail-route subpath `/dashboard/studio/:id` once
  // ScriptViewer ships.
  { path: ROUTES.dashboard.studio, labelKey: 'dashboard.sidebar.nav.studio', labelFallback: '剧本工坊', icon: Clapperboard, shortcut: '8' },
  // Crawler (openspec/changes/mediacrawler-integration, 13.4) — navigation
  // entry for the 7-platform data-collection dashboard.
  // Shortcut '9' lands after Studio's '8'. The `Search` icon evokes
  // "searching / crawling" semantic rather than a nav arrow.
  { path: ROUTES.dashboard.crawl, labelKey: 'dashboard.sidebar.nav.crawl', labelFallback: '数据采集', icon: Search, shortcut: '9' },
]

const ADMIN_NAV_DEFS: readonly AdminNavItemDef[] = [
  {
    path: ROUTES.dashboard.admin.root,
    labelKey: 'dashboard.sidebar.admin.root',
    labelFallback: '管理后台',
    icon: Shield,
    children: [
      { path: ROUTES.dashboard.admin.root, labelKey: 'dashboard.sidebar.admin.overview', labelFallback: '概览', icon: BarChart3 },
      { path: ROUTES.dashboard.admin.users, labelKey: 'dashboard.sidebar.admin.users', labelFallback: '用户管理', icon: Users },
      { path: ROUTES.dashboard.admin.audit, labelKey: 'dashboard.sidebar.admin.audit', labelFallback: '审计日志', icon: FileText },
    ],
  },
] 

export function AppShell() {
  const { isMobile, shouldAutoCollapse } = useViewport()
  const location = useLocation()
  // Resolve static i18n manifests into SidebarNav-compatible rows.
  // The .map is cheap (~9 + ~4 items) and re-runs on locale change
  // because `t` is stable per-language from useTranslation(). The
  // resolved arrays swap atomically when i18n.changeLanguage fires
  // — both desktop sidebar nav + mobile bottom nav see the same
  // swapped labels because both consume these function-scoped
  // arrays. Mirrors MarketingTopBar's NAV_ITEMS pattern; full
  // invariant rationale in docs/dev/adr-i18n-invariant.md (labelKey
  // + labelFallback rule + never-mutate-the-DEFS invariant).
  const { t } = useTranslation()
  const navItems: readonly DashboardNavItem[] = DASHBOARD_NAV_DEFS.map((d): DashboardNavItem => ({
    ...d,
    label: t(d.labelKey, d.labelFallback),
  }))
  // The trailing `as AdminNavItem` casts are required because
  // the i18next `CustomTypeOptions` augmentation narrows
  // `t(string-key, fallback)` to a `never` return when the
  // `labelKey` argument is a widened `string` (not a literal) —
  // the resolver can't pick a single resource shape. Without
  // the cast, the inferred lambda return type has `label: never`
  // and TS2322 fires against the `AdminNavItem` contract
  // (`label: string`). The cast preserves the actual runtime
  // string while satisfying the type checker. (See
  // docs/dev/adr-i18n-invariant.md §type-augmentation-quirks.)
  const adminNavItems: readonly AdminNavItem[] = ADMIN_NAV_DEFS.map((d): AdminNavItem => ({
    ...d,
    label: t(d.labelKey, d.labelFallback),
    children: d.children?.map((c) => ({ ...c, label: t(c.labelKey, c.labelFallback) }) as AdminNavItem),
  } as AdminNavItem))
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

  // Logout is intentionally NOT inlined here as a standalone button.
  // Round-OPT-marketing-chrome v5 consolidated the AppShell sidebar
  // footer's standalone `<button aria-label="登出">` (and the parallel
  // one in the expanded-mode footer) into the <UserMenu> dropdown —
  // it's the 5th item after the 4 PREFERENCE_ITEMS, behind a
  // <DropdownMenuSeparator>, with the same `await logout(); navigate(
  // '/', { replace: true })` shape as the removed AppShell callback.
  // Three chrome surfaces now share ONE logout affordance: the
  // AppShell sidebar footer (mode=expanded | collapsed), the
  // AppShell mobile AppBar (mode=mobile), and the MarketingTopBar
  // authed branch (mode=mobile). MarketingTopBar's file-level
  // comment block documents the same consolidation.
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const { openPreferences } = usePreferencesDialog()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Round-OPT-3G+ v3: Cmd+, / Ctrl+, opens PreferencesDialog
  // already-focused on the Overview jump-off surface. Mirrors
  // Spotify / Slack / VSCode conventions so existing power users
  // land here without reading docs. Suppressed while typing
  // (handled inside the hook). Memoized so the hook's
  // `useEffect([onTrigger, enabled])` dep doesn't re-attach the
  // document-level listener on every render.
  const openPreferencesOverview = useCallback(
    () => openPreferences('overview'),
    [openPreferences],
  )
  usePreferencesShortcut({
    onTrigger: openPreferencesOverview,
  })

  // ── Main nav keyboard shortcuts (Cmd/Ctrl+1-6) ────────────────────────
  // Scoped to NON-admin pages so they don't collide with sidebar nav shortcuts.
  // Cmd+1/2/3. On /dashboard/admin/* the admin tab shortcuts win; everywhere
  // else the sidebar nav shortcuts win.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.altKey || e.shiftKey) return

      // Only active outside admin pages (exact /dashboard/admin AND subpaths).
      if (
        location.pathname === ROUTES.dashboard.admin.root ||
        location.pathname.startsWith(`${ROUTES.dashboard.admin.root}/`)
      )
        return

      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable === true
      if (isTyping) return

      // Suppress when a modal/dialog is open.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

      const item = navItems.find((n) => n.shortcut === e.key)
      if (item) {
        e.preventDefault()
        navigate(item.path)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [location.pathname, navigate])

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

      // Global keyboard shortcut: Cmd+? / Ctrl+? opens the shortcuts
      // cheat-sheet. The `Shift` key is required because `?` is
      // `Shift+/` on most layouts. We reject pure `/` (no modifier)
      // because that already maps to "focus search".
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === '?' &&
        e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault()
        setHelpOpen(true)
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
        navigate(ROUTES.dashboard.publish)
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
          <Link
            to={ROUTES.public.landing}
            className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-foreground hover:opacity-90 transition-opacity"
            aria-label={t('dashboard.sidebar.home_aria', '返回首页')}
          >
            <Terminal className="h-3.5 w-3.5 text-background" strokeWidth={2.5} />
          </Link>
            <span className="font-mono text-[11px] text-muted-foreground/80 tabular-nums">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu mode="mobile" />
          </div>
        </header>

        <main className="flex-1 p-4 pb-20">
          <Suspense fallback={<AuthLoadingSkeleton />}>
            <Routes location={location}>
              <Route path={RELATIVE_DASHBOARD_ROUTES.root} element={<AuthGuard><AccountsPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.publish} element={<AuthGuard><PublishPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.logs} element={<AuthGuard><LogsPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.tasks} element={<AuthGuard><TasksPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.analytics} element={<AuthGuard><AnalyticsPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.inbox} element={<AuthGuard><InboxPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.calendar} element={<AuthGuard><CalendarPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.account} element={<AuthGuard><ProfilePage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.settings} element={<AuthGuard><SettingsPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.personalization} element={<AuthGuard><PersonalizationPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.admin.root} element={<AuthGuard><AdminOverviewPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.admin.users} element={<AuthGuard><AdminUsersPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.admin.audit} element={<AuthGuard><AdminAuditPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.studio} element={<AuthGuard><StudioPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.studioDetail} element={<AuthGuard><StudioDetailPage /></AuthGuard>} />
              <Route path={RELATIVE_DASHBOARD_ROUTES.crawl} element={<AuthGuard><CrawlPage /></AuthGuard>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <KeyboardShortcutsCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />

        <nav
          aria-label={t('dashboard.sidebar.mobile_nav_label', '主导航')}
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/40 bg-background/85 backdrop-blur-xl shadow-[0_-1px_0_var(--border),0_-8px_24px_-12px_rgba(0,0,0,0.08)]"
        >
          <div className="flex items-stretch justify-around gap-1 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {[...navItems, ...(authUser?.role === 'admin' ? adminNavItems : [])].map((item) => {
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
          <Link
            to={ROUTES.public.landing}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background flex-shrink-0 hover:opacity-90 transition-opacity"
            aria-label={t('dashboard.sidebar.home_aria', '返回首页')}
          >
            <Terminal className="h-4 w-4" strokeWidth={2.5} />
          </Link>
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
              aria-label={t('dashboard.sidebar.collapse_sidebar', '收起侧边栏')}
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
              aria-label={t('dashboard.sidebar.expand_sidebar', '展开侧边栏')}
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
                  {t('dashboard.sidebar.section_main', '导航')}
                </span>
              </div>
            )}
            <SidebarNav
              items={[...navItems]}
              isCollapsed={isCollapsed}
              onNavigate={isTabletMode ? () => setSidebarCollapsed(true) : undefined}
              modifierLabel={MODIFIER_LABEL}
            />

            {authUser?.role === 'admin' && (
              <>
                <div className="px-2 mt-4 mb-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-widest">
                    {t('dashboard.sidebar.section_admin', '管理')}
                  </span>
                </div>
                <SidebarNav
                  items={[...adminNavItems]}
                  isCollapsed={isCollapsed}
                  onNavigate={isTabletMode ? () => setSidebarCollapsed(true) : undefined}
                  modifierLabel={MODIFIER_LABEL}
                />
              </>
            )}
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
            </div>
          ) : (
            <div
              data-testid="app-shell-sidebar-footer-expanded"
              className="flex items-center gap-3.5"
            >
              <UserMenu mode="expanded" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[14px] font-medium text-foreground truncate leading-tight" data-testid="app-shell-sidebar-email">{authUser?.email ?? t('dashboard.sidebar.footer.email_fallback', '管理员')}</span>
                <span className="mt-0.5 text-[12px] text-muted-foreground/70 font-medium leading-tight">{authUser?.role === 'admin' ? t('dashboard.sidebar.footer.role_admin', '管理员') : t('dashboard.sidebar.footer.role_user', '用户')}</span>
              </div>
              <ThemeToggle />
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border/50 bg-background/80 backdrop-blur-xl px-6">
          <Breadcrumb>
            <BreadcrumbList className="font-mono text-[11px]">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={ROUTES.dashboard.root} className="text-foreground/90">{APP_NAME}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>build {APP_GIT_SHA}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--status-success-fg)' }}
                  />
                  ws ok
                </span>
              </BreadcrumbItem>
              {(() => {
                const currentPage = navItems.find((n) => n.path === location.pathname)
                const isAdminPage = location.pathname.startsWith(ROUTES.dashboard.admin.root)
                const adminPage = isAdminPage
                  ? adminNavItems[0]?.children?.find((c) => c.path === location.pathname)
                  : undefined
                const label = currentPage?.label ?? adminPage?.label
                if (!label) return null
                return (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{label}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )
              })()}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center gap-2">
            {isTabletMode && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar} aria-label={t('dashboard.sidebar.toggle_sidebar', '切换侧边栏')}>
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
              <span>{t('dashboard.sidebar.search_button', '搜索')}</span>
              <kbd className="ml-1 hidden sm:inline-flex h-5 items-center px-1.5 rounded border border-border/40 bg-muted/40 text-[10px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHelpOpen(true)}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label={t('dashboard.sidebar.help_aria', '键盘快捷键')}
              title={`${t('dashboard.sidebar.help_aria', '键盘快捷键')} (${MODIFIER_LABEL}?)`}
            >
              <HelpCircle className="h-4 w-4" />
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
              <Suspense fallback={<AuthLoadingSkeleton />}>
                <Routes location={location}>
                  <Route path={RELATIVE_DASHBOARD_ROUTES.root} element={<AuthGuard><AccountsPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.publish} element={<AuthGuard><PublishPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.logs} element={<AuthGuard><LogsPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.tasks} element={<AuthGuard><TasksPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.analytics} element={<AuthGuard><AnalyticsPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.inbox} element={<AuthGuard><InboxPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.calendar} element={<AuthGuard><CalendarPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.account} element={<AuthGuard><ProfilePage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.settings} element={<AuthGuard><SettingsPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.personalization} element={<AuthGuard><PersonalizationPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.admin.root} element={<AuthGuard><AdminOverviewPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.admin.users} element={<AuthGuard><AdminUsersPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.admin.audit} element={<AuthGuard><AdminAuditPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.studio} element={<AuthGuard><StudioPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.studioDetail} element={<AuthGuard><StudioDetailPage /></AuthGuard>} />
                  <Route path={RELATIVE_DASHBOARD_ROUTES.crawl} element={<AuthGuard><CrawlPage /></AuthGuard>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}

import {
  PreferencesDialog,
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