import { createFileRoute } from '@tanstack/react-router'
import StudioPage from '@/pages/StudioPage'

export const Route = createFileRoute('/dashboard/studio')({
  component: StudioPage,
})
