import { createFileRoute } from '@tanstack/react-router'
import PersonalizationPage from '@/pages/PersonalizationPage'

export const Route = createFileRoute('/dashboard/personalization')({
  component: PersonalizationPage,
})
