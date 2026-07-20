import { createFileRoute } from '@tanstack/react-router'
import SettingsPage from '@/Pages/SettingsPage'

export const Route = createFileRoute('/dashboard/settings')({
  component: SettingsPage,
})
