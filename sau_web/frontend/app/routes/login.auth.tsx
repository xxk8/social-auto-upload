import { createFileRoute } from '@tanstack/react-router'
import LoginAuthPage from '@/pages/LoginAuthPage'

export const Route = createFileRoute('/login/auth')({
  component: LoginAuthPage,
})
