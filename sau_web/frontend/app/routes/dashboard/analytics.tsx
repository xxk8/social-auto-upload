import { createFileRoute } from '@tanstack/react-router'
import AnalyticsPage from '@/Pages/AnalyticsPage'

export const Route = createFileRoute('/dashboard/analytics')({
  component: AnalyticsPage,
})
