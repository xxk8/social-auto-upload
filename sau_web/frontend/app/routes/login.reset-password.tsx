import { createFileRoute } from '@tanstack/react-router'
import ResetPasswordPage from '@/pages/ResetPasswordPage'

export const Route = createFileRoute('/login/reset-password')({
  component: ResetPasswordPage,
})
