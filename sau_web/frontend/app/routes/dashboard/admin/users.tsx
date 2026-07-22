import { createFileRoute } from '@tanstack/react-router'
import AdminUsersPage from '@/features/admin/AdminUsersPage'

export const Route = createFileRoute('/dashboard/admin/users')({
  component: AdminUsersPage,
})
