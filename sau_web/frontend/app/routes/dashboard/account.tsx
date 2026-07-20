import { createFileRoute } from '@tanstack/react-router'
import ProfilePage from '@/Pages/ProfilePage'

export const Route = createFileRoute('/dashboard/account')({
  component: ProfilePage,
})
