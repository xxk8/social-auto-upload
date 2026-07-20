import { createFileRoute, redirect } from '@tanstack/react-router'
import AdminOverviewPage from '@/features/admin/AdminOverviewPage'

export const Route = createFileRoute('/dashboard/admin/')({
  beforeLoad: async ({ context }) => {
    // context.user comes from parent /dashboard beforeLoad
    const user = (context as { user?: { role?: string } }).user
    if (!user || user.role !== 'admin') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: AdminOverviewPage,
})
