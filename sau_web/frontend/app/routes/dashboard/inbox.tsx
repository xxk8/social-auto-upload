import { createFileRoute } from '@tanstack/react-router'
import InboxPage from '@/Pages/InboxPage'

export const Route = createFileRoute('/dashboard/inbox')({
  component: InboxPage,
})
