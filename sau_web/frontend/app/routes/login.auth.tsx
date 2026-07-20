import { createFileRoute } from '@tanstack/react-router'
import LoginAuthPage from '@/Pages/LoginAuthPage'

export const Route = createFileRoute('/login/auth')({
  component: LoginAuthPage,
})
