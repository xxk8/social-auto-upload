import { createFileRoute } from '@tanstack/react-router'
import LandingPage from '@/Pages/LandingPage'

export const Route = createFileRoute('/')({
  component: LandingPage,
})
