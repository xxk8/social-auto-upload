import { createFileRoute } from '@tanstack/react-router'
import StudioPage from '@/Pages/StudioPage'

export const Route = createFileRoute('/dashboard/studio')({
  component: StudioPage,
})
