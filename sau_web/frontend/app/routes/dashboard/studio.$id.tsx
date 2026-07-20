import { createFileRoute } from '@tanstack/react-router'
import StudioDetailPage from '@/Pages/StudioDetailPage'

export const Route = createFileRoute('/dashboard/studio/$id')({
  component: StudioDetailPage,
})
