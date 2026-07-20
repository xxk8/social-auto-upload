import { createFileRoute } from '@tanstack/react-router'
import AboutPage from '@/Pages/AboutPage'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})
