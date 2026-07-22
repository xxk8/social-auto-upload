import { createFileRoute } from '@tanstack/react-router'
import HotListPage from '@/pages/HotListPage'

export const Route = createFileRoute('/hotlist')({
  component: HotListPage,
})
