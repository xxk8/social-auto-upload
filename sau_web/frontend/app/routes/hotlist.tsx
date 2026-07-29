import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/hotlist')({
  component: lazyPage(() => import('@/pages/HotListPage')),
})
