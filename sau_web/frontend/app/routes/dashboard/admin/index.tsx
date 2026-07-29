import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/dashboard/admin/')({
  component: lazyPage(() => import('@/features/admin/AdminOverviewPage')),
})
