import { createFileRoute } from '@tanstack/react-router'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'

export const Route = createFileRoute('/login/forgot-password')({
  component: ForgotPasswordPage,
})
