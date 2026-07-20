import { createFileRoute } from '@tanstack/react-router'
import PricingPage from '@/Pages/PricingPage'

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
})
