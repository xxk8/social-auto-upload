import { createFileRoute } from '@tanstack/react-router'
import ForgotPasswordPage from '@/Pages/ForgotPasswordPage'

export const Route = createFileRoute('/login/forgot-password')({
  component: ForgotPasswordPage,
})
