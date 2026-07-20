import { createFileRoute } from '@tanstack/react-router'
import PersonalizationPage from '@/Pages/PersonalizationPage'

export const Route = createFileRoute('/dashboard/personalization')({
  component: PersonalizationPage,
})
