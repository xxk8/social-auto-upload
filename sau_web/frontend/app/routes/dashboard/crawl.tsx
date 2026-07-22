import { createFileRoute } from '@tanstack/react-router'
import CrawlPage from '@/pages/CrawlPage'

export const Route = createFileRoute('/dashboard/crawl')({
  component: CrawlPage,
})
