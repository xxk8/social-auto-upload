import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/about')({
  component: lazyPage(() => import('@/pages/AboutPage')),
})
