import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/pricing')({
  component: lazyPage(() => import('@/pages/PricingPage')),
})
