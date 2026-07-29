import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/login/reset-password')({
  component: lazyPage(() => import('@/pages/ResetPasswordPage')),
})
