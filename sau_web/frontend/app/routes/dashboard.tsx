import { createFileRoute } from '@tanstack/react-router'
import AppShell from '@/AppShell'

/**
 * `/dashboard` layout — sidebar shell + child routes via <Outlet />.
 *
 * Auth stays on Flask (platform cookies / account files), not a web-user
 * session. Do not gate this layout on a non-existent `/api/auth/me`.
 */
export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
})

function DashboardLayout() {
  return <AppShell />
}
