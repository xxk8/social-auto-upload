import { createFileRoute } from '@tanstack/react-router'
import PublishPage from '@/pages/PublishPage'

export const Route = createFileRoute('/dashboard/publish')({
  component: PublishPage,
})
