import { createFileRoute } from '@tanstack/react-router'
import { lazyPage } from '@/lib/lazy-page'

export const Route = createFileRoute('/dashboard/settings')({
  component: lazyPage(() => import('@/pages/SettingsPage')),
})
