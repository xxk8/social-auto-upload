import { createFileRoute } from '@tanstack/react-router'
import CrawlPage from '@/Pages/CrawlPage'

export const Route = createFileRoute('/dashboard/crawl')({
  component: CrawlPage,
})
