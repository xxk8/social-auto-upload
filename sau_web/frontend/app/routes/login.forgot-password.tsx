import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/login/forgot-password')({
  component: lazyPage(() => import('@/pages/ForgotPasswordPage')),
})
