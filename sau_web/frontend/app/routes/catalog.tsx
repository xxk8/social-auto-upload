import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/catalog')({
  component: lazyPage(() => import('@/pages/CatalogPage')),
})
