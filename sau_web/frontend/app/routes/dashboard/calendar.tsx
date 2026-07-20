import { createFileRoute } from '@tanstack/react-router'
import CalendarPage from '@/Pages/CalendarPage'

export const Route = createFileRoute('/dashboard/calendar')({
  component: CalendarPage,
})
