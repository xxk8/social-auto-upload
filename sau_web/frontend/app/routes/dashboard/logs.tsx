import { createFileRoute } from '@tanstack/react-router'
import LogsPage from '@/Pages/LogsPage'

export const Route = createFileRoute('/dashboard/logs')({
  component: LogsPage,
})
