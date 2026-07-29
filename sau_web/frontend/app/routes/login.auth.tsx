import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/login/auth')({
  component: lazyPage(() => import('@/pages/LoginAuthPage')),
})
