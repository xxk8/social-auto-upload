import { createFileRoute, redirect } from '@tanstack/react-router'
import AdminAuditPage from '@/features/admin/AdminAuditPage'

export const Route = createFileRoute('/dashboard/admin/audit')({
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { role?: string } }).user
    if (!user || user.role !== 'admin') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: AdminAuditPage,
})
