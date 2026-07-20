import { createFileRoute, redirect } from '@tanstack/react-router'
import AdminUsersPage from '@/features/admin/AdminUsersPage'

export const Route = createFileRoute('/dashboard/admin/users')({
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { role?: string } }).user
    if (!user || user.role !== 'admin') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: AdminUsersPage,
})
