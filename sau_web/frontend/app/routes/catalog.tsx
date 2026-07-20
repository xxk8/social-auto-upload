import { createFileRoute } from '@tanstack/react-router'
import CatalogPage from '@/Pages/CatalogPage'

export const Route = createFileRoute('/catalog')({
  component: CatalogPage,
})
