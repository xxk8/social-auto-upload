import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/dashboard/tasks')({
  component: lazyPage(() => import('@/pages/TasksPage')),
})
