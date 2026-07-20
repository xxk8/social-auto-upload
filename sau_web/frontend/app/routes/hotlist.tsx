import { createFileRoute } from '@tanstack/react-router'
import HotListPage from '@/Pages/HotListPage'

export const Route = createFileRoute('/hotlist')({
  component: HotListPage,
})
