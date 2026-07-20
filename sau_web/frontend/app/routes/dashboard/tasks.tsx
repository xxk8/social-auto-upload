import { createFileRoute } from '@tanstack/react-router'
import TasksPage from '@/Pages/TasksPage'

export const Route = createFileRoute('/dashboard/tasks')({
  component: TasksPage,
})
