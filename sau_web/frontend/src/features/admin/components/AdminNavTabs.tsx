import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, FileText, Users } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/Components/ui/tabs'
import { ROUTES, type AdminRoute } from '@/routes'

/**
 * Admin tab discriminator — the 3 tabs in the admin nav strip. Kept
 * as a literal-string union (not just `string`) so a future contributor
 * adding a new tab to the `TABS` array MUST update this union first;
 * the TabsList `onValueChange` callback reads from this same set, so
 * the discriminated handling stays in lockstep with the array.
 *
 * Mirrors the `DashboardNavItem` pattern from `AppShell.tsx` — every
 * route in the manifest has a typed home here, and the array is
 * `readonly AdminNavItem[]` so a future widening/widening/typo is
 * caught at compile time.
 */
type AdminTabValue = 'overview' | 'users' | 'audit'

interface AdminNavItem {
  value: AdminTabValue
  label: string
  path: AdminRoute
  icon: LucideIcon
}

const TABS: readonly AdminNavItem[] = [
  {
    value: 'overview',
    label: '概览',
    path: ROUTES.dashboard.admin.root,
    icon: BarChart3,
  },
  {
    value: 'users',
    label: '用户管理',
    path: ROUTES.dashboard.admin.users,
    icon: Users,
  },
  {
    value: 'audit',
    label: '审计日志',
    path: ROUTES.dashboard.admin.audit,
    icon: FileText,
  },
]

/**
 * In-page admin dashboard navigation tabs.
 *
 * Renders a Radix Tabs strip with three items (概览 / 用户管理 / 审计日志)
 * and wires Cmd/Ctrl+1/2/3 keyboard shortcuts for rapid switching.
 *
 * Test contracts:
 *   • data-testid="admin-nav-tab-{overview|users|audit}"
 *   • active tab carries data-state="active" (Radix native)
 *   • keyboard shortcuts are gated on:
 *       – isOnAdminPage (pathname is admin root OR starts with admin root + '/')
 *       – modifier key only (no Shift / Alt)
 *       – not typing in input/textarea/contenteditable
 *       – no open modal/dialog (role="dialog"[aria-modal="true"])
 */
export function AdminNavTabs() {
  const location = useLocation()
  const navigate = useNavigate()

  const activeValue =
    TABS.find((t) => location.pathname === t.path)?.value ?? 'overview'

  // Keyboard shortcuts: Cmd/Ctrl+1/2/3 navigate between admin tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.altKey || e.shiftKey) return

      // Only fire on admin pages. The strict check (root OR root + '/')
      // is intentional — a bare `startsWith(root)` would also match a
      // hypothetical future page like `/dashboard/administrators` or
      // `/dashboard/admin-tools`, firing the shortcut on the wrong tab
      // and silently sending the admin to a 404 or unrelated page.
      if (
        location.pathname !== ROUTES.dashboard.admin.root &&
        !location.pathname.startsWith(ROUTES.dashboard.admin.root + '/')
      ) {
        return
      }

      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable === true
      if (isTyping) return

      // Suppress when a modal/dialog is open.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

      const index = parseInt(e.key, 10)
      if (Number.isNaN(index)) return
      const tab = TABS[index - 1]
      if (!tab) return

      e.preventDefault()
      navigate(tab.path)
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [location.pathname, navigate])

  return (
    <Tabs
      value={activeValue}
      onValueChange={(v) => {
        // Radix Tabs types `v` as `string`. Narrow it against the
        // literal-string union first so a stray `<TabsTrigger value="...">`
        // that's not in `AdminTabValue` surfaces as a no-op here
        // (rather than silently passing through to the find).
        if (v !== 'overview' && v !== 'users' && v !== 'audit') return
        const tab = TABS.find((t) => t.value === v)
        if (tab) navigate(tab.path)
      }}
      className="w-full"
    >
      <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-testid={`admin-nav-tab-${tab.value}`}
              aria-current={tab.value === activeValue ? 'page' : undefined}
              className="relative rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground transition-colors gap-1.5"
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {tab.label}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
