import { createFileRoute } from '@tanstack/react-router'
import AdminOverviewPage from '@/features/admin/AdminOverviewPage'

export const Route = createFileRoute('/dashboard/admin/')({
  component: AdminOverviewPage,
})
