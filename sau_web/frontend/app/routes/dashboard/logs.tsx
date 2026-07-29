import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/dashboard/logs')({
  component: lazyPage(() => import('@/pages/LogsPage')),
})
