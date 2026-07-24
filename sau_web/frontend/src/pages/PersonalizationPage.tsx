import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
import { PersonalizationTab } from '@/features/preferences'
import { Sun } from 'lucide-react'

export default function PersonalizationPage() {
  return (
    <PageWrapper variant="flush">
      <PageHeader
        title="个性化"
        description="外观模式与主题色"
        icon={<Sun className="h-5 w-5 text-muted-foreground" />}
      />
      <div className="mx-auto max-w-2xl px-6 pb-8">
        <PersonalizationTab />
      </div>
    </PageWrapper>
  )
}
