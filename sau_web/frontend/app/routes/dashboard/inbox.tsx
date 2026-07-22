import { createFileRoute } from '@tanstack/react-router'
import InboxPage from '@/pages/InboxPage'

export const Route = createFileRoute('/dashboard/inbox')({
  component: InboxPage,
})
