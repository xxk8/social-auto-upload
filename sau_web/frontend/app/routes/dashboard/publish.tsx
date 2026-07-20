import { createFileRoute } from '@tanstack/react-router'
import PublishPage from '@/Pages/PublishPage'

export const Route = createFileRoute('/dashboard/publish')({
  component: PublishPage,
})
