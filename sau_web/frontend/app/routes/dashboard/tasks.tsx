import { createFileRoute } from '@tanstack/react-router'
import TasksPage from '@/pages/TasksPage'

export const Route = createFileRoute('/dashboard/tasks')({
  validateSearch: (search: Record<string, unknown>) => ({
    focus: typeof search.focus === 'string' ? search.focus : undefined,
  }),
  component: TasksPage,
})
