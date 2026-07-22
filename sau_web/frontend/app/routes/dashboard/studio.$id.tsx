import { createFileRoute } from '@tanstack/react-router'
import StudioDetailPage from '@/pages/StudioDetailPage'

export const Route = createFileRoute('/dashboard/studio/$id')({
  component: StudioDetailPage,
})
